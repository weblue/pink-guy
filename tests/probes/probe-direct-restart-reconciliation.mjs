#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-direct-restart-reconciliation.mjs /absolute/path/to/generated/fixture");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function faultController() {
  const armed = new Set();
  return {
    arm(point) {
      armed.add(point);
    },
    async inject(point) {
      if (!armed.delete(point)) return;
      throw Object.assign(new Error(`injected daemon crash boundary: ${point}`), {
        code: "injected_crash",
        point,
      });
    },
  };
}

async function startClaimedRun({ root, faults }) {
  const databasePath = join(root, "boss-man.sqlite");
  const stateRoot = join(root, "runtime");
  const authority = new DirectControlPlane({
    databasePath,
    stateRoot,
    fixturePath: fixture,
    faultInjector: faults.inject,
  });
  authority.seed();
  const worker = authority.store.issueCapability({
    role: "worker",
    actorId: "restart-worker",
    taskId: "phase0-task",
    runId: "restart-claim",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  authority.store.actOnTask({
    token: worker.token,
    taskId: "phase0-task",
    action: "claim",
    idempotencyKey: `restart-claim:${root}`,
    expectedVersion: 1,
    payload: {},
  });
  await authority.listen();
  const started = await authority.startTask("phase0-task");
  return { authority, databasePath, stateRoot, ...started };
}

async function restartAndReconcile({ databasePath, stateRoot }) {
  const authority = new DirectControlPlane({ databasePath, stateRoot, fixturePath: fixture });
  await authority.listen();
  return { authority, result: authority.recoveryResults[0] };
}

const suiteRoot = await mkdtemp(join(tmpdir(), "boss-man-direct-restart-"));

const idleRoot = join(suiteRoot, "idle");
const idleFaults = faultController();
let idle = await startClaimedRun({ root: idleRoot, faults: idleFaults });
await idle.authority.prompt(idle.session.id, "complete the deterministic idle recovery turn");
const idleNativeBefore = await readFile(idle.session.native_path);
const idleNativeSha256 = sha256(idleNativeBefore);
await idle.authority.crashForProbe();
let idleRestart = await restartAndReconcile(idle);
assert(idleRestart.result.state === "paused", "verified idle run was not paused after restart");
assert(idleRestart.result.containerInspectionAvailable, "container inspection was unavailable during idle reconciliation");
assert(idleRestart.result.containerIdentityProven, "idle container identity was not proven");
assert(idleRestart.result.containerRemoved, "idle container was not removed after safe pause");
assert(sha256(await readFile(idle.session.native_path)) === idleNativeSha256, "idle recovery changed native Pi bytes");
assert(idleRestart.authority.store.sideEffectsForRun(idle.run.id).every((effect) => effect.state === "completed"), "idle run retained an unresolved side effect");
await idleRestart.authority.close();

const responseRoot = join(suiteRoot, "active-response");
const responseFaults = faultController();
let response = await startClaimedRun({ root: responseRoot, faults: responseFaults });
responseFaults.arm("provider_after_settled");
let responseCrashObserved = false;
try {
  await response.authority.prompt(response.session.id, "complete exactly one deterministic provider response");
} catch (error) {
  responseCrashObserved = error.code === "injected_crash";
}
assert(responseCrashObserved, "active-response crash boundary was not reached");
const responseNativeBefore = await readFile(response.session.native_path);
const responseNativeSha256 = sha256(responseNativeBefore);
await response.authority.crashForProbe();
let responseRestart = await restartAndReconcile(response);
const responseEffect = responseRestart.authority.store.sideEffectsForRun(response.run.id)
  .find((effect) => effect.kind === "provider_response");
assert(responseRestart.result.state === "reconciliation_required", "uncertain provider response was not paused for reconciliation");
assert(responseEffect?.state === "reconciliation_required", "provider response side effect was reported complete");
assert(responseEffect.result?.evidence?.automaticReplay === false, "provider response permitted automatic replay");
assert(sha256(await readFile(response.session.native_path)) === responseNativeSha256, "active-response recovery changed native Pi bytes");
await responseRestart.authority.close();

const effectsRoot = join(suiteRoot, "tool-snapshot-git");
const effectsFaults = faultController();
let effects = await startClaimedRun({ root: effectsRoot, faults: effectsFaults });
const managed = effects.authority.sessions.get(effects.session.id);
await effects.authority.ingestSnapshots(managed);
const markerPath = join(managed.workspace.workspace_path, "side-effect-count.txt");
effectsFaults.arm("tool_after_execute");
let toolCrashObserved = false;
try {
  await effects.authority.shell(effects.session.id, "printf 'executed-once\\n' >> side-effect-count.txt");
} catch (error) {
  toolCrashObserved = error.code === "injected_crash";
}
assert(toolCrashObserved, "active-tool crash boundary was not reached");
assert((await readFile(markerPath, "utf8")).trim().split("\n").length === 1, "tool did not execute exactly once before crash");

const snapshotPath = join(managed.snapshotDirectory, "snapshot-restart-proof.json");
const snapshotContent = `${JSON.stringify({
  schema_version: "boss-man-context-snapshot-v1",
  trigger: "restart-proof",
  native: { path: effects.session.native_path },
}, null, 2)}\n`;
await writeFile(snapshotPath, snapshotContent);
effectsFaults.arm("snapshot_after_record");
let snapshotCrashObserved = false;
try {
  await effects.authority.ingestSnapshots(managed);
} catch (error) {
  snapshotCrashObserved = error.code === "injected_crash";
}
assert(snapshotCrashObserved, "snapshot crash boundary was not reached");

effectsFaults.arm("git_after_commit");
let gitCrashObserved = false;
try {
  await effects.authority.git.checkpoint({
    workspace: managed.workspace,
    capability: managed.capability,
    kind: "checkpoint",
    idempotencyKey: "restart-checkpoint-once",
    message: "chore: restart reconciliation checkpoint",
    evidence: ["P0-DIRECT-RESTART-RECONCILIATION"],
  });
} catch (error) {
  gitCrashObserved = error.code === "injected_crash";
}
assert(gitCrashObserved, "Git post-commit crash boundary was not reached");
const committedRevision = await effects.authority.git.revision(managed.workspace);
await effects.authority.crashForProbe();

let effectsRestart = await restartAndReconcile(effects);
const reconciledSideEffects = effectsRestart.authority.store.sideEffectsForRun(effects.run.id);
const toolEffect = reconciledSideEffects.find((effect) => effect.kind === "tool");
const snapshotEffect = reconciledSideEffects.find((effect) => effect.kind === "snapshot" && effect.intent.path === snapshotPath);
const gitEffect = reconciledSideEffects.find((effect) => effect.kind === "git");
assert(effectsRestart.result.state === "reconciliation_required", "uncertain tool did not hold the run for reconciliation");
assert(toolEffect?.state === "reconciliation_required", "uncertain tool was reported complete");
assert(snapshotEffect?.state === "completed" && snapshotEffect.reconciled_at, "checksummed snapshot was not recovered");
assert(gitEffect?.state === "completed" && gitEffect.reconciled_at, "provenance checkpoint was not recovered");
assert(await effectsRestart.authority.git.revision(managed.workspace) === committedRevision, "Git reconciliation created another commit");
assert((await readFile(markerPath, "utf8")).trim().split("\n").length === 1, "tool side effect was replayed");
const recoveredOperation = effectsRestart.authority.store.findGitOperation("restart-checkpoint-once");
assert(recoveredOperation?.new_revision === committedRevision, "recovered Git receipt does not identify the committed revision");
const snapshotArtifacts = effectsRestart.authority.store.artifacts(effects.session.id)
  .filter((artifact) => artifact.path === snapshotPath && artifact.sha256 === sha256(snapshotContent));
assert(snapshotArtifacts.length === 1, "snapshot reconciliation duplicated or lost the artifact index");
const receiptCount = effectsRestart.authority.store.sideEffectReceipts(effects.run.id).length;
assert(receiptCount >= 8, "side-effect receipt stream is incomplete");
await effectsRestart.authority.close();

process.stdout.write(`${JSON.stringify({
  status: "pass",
  idle: {
    state: idleRestart.result.state,
    container_inspection_available: idleRestart.result.containerInspectionAvailable,
    container_identity_proven: idleRestart.result.containerIdentityProven,
    container_removed: idleRestart.result.containerRemoved,
    native_session_sha256: idleNativeSha256,
  },
  active_response: {
    state: responseRestart.result.state,
    side_effect_state: responseEffect.state,
    automatic_replay: false,
    native_session_sha256: responseNativeSha256,
  },
  active_tool: {
    state: toolEffect.state,
    execution_count: 1,
    automatic_replay: false,
  },
  snapshot: {
    state: snapshotEffect.state,
    recovered_from_checksum: true,
    indexed_artifact_count: snapshotArtifacts.length,
  },
  git_checkpoint: {
    state: gitEffect.state,
    revision: committedRevision,
    duplicate_commits: 0,
    recovered_operation_receipt: true,
  },
  side_effect_receipt_count: receiptCount,
  isolated_root: suiteRoot,
}, null, 2)}\n`);
