#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { restoreBundle, verifyBundle } from "../../src/server/continuity.mjs";
import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function git(repository, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function request(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return {
    response,
    value: text ? JSON.parse(text) : null,
  };
}

async function treeContains(root, needle) {
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const candidate = join(path, entry.name);
      if (entry.isDirectory()) {
        if (await walk(candidate)) return true;
      } else if (entry.isFile()) {
        if ((await readFile(candidate)).includes(needle)) return true;
      }
    }
    return false;
  }
  return walk(root);
}

const fixture = process.argv[2];
if (!fixture) throw new Error("fixture repository path is required");

const root = await mkdtemp(join(tmpdir(), "pink-guy-phase2-continuity-"));
const stateRoot = join(root, "source-state");
const bundlePath = join(root, "continuity-bundle");
const corruptedPath = join(root, "corrupted-bundle");
const restoredRoot = join(root, "restored-state");
const canary = "PINK_GUY_CREDENTIAL_CANARY_9f12a0";
const originalHead = await git(fixture, "rev-parse", "HEAD");
const plane = new DirectControlPlane({
  databasePath: join(stateRoot, "pink-guy.sqlite"),
  stateRoot,
  fixturePath: fixture,
  runtimeOffline: true,
});

try {
  plane.seed({
    projectId: "continuity-project",
    repositoryId: "continuity-repository",
    projectName: "Continuity fixture",
    taskId: "continuity-task",
    title: "Retain work through an isolated restore",
    acceptanceCriteria: ["The restored task remains schedulable."],
  });

  const sessionPath = join(stateRoot, "runs", "retained-run", "sessions", "session.jsonl");
  const artifactPath = join(stateRoot, "runs", "retained-run", "artifacts", "result.txt");
  await mkdir(join(stateRoot, "runs", "retained-run", "sessions"), { recursive: true });
  await mkdir(join(stateRoot, "runs", "retained-run", "artifacts"), { recursive: true });
  await writeFile(sessionPath, '{"type":"session","content":"retained owner context"}\n');
  await writeFile(artifactPath, "retained artifact\n");
  plane.store.createSession({
    id: "retained-session",
    taskId: "continuity-task",
    nativePath: sessionPath,
    provider: "probe",
    model: "model-less",
  });
  plane.store.recordArtifact({
    sessionId: "retained-session",
    kind: "probe",
    path: artifactPath,
    sha256: sha256(await readFile(artifactPath)),
    metadata: { continuity: true },
  });

  const topic = plane.store.createTopic({
    title: "Continuity custody",
    ownerDescription: "Retain the orchestrator's settled context.",
    projectId: "continuity-project",
    idempotencyKey: "continuity-topic",
    modelProvider: "probe",
    modelId: "model-less",
    thinkingLevel: "medium",
    modelPolicy: { source: "probe" },
  });
  const custodyPath = join(
    stateRoot,
    "conversation-context",
    topic.conversation.id,
    "owner-settled",
    "manifest.json",
  );
  await mkdir(join(custodyPath, ".."), { recursive: true });
  await writeFile(custodyPath, '{"custody":"retained"}\n');
  plane.store.recordConversationCustodySnapshot({
    snapshotId: "continuity-custody",
    conversationId: topic.conversation.id,
    trigger: "owner_message_settled",
    path: custodyPath,
    manifestSha256: sha256(await readFile(custodyPath)),
  });

  const credentialCanaryPath = join(stateRoot, "runs", "secret-run", "pi-config", "auth.json");
  await mkdir(join(credentialCanaryPath, ".."), { recursive: true });
  await writeFile(credentialCanaryPath, canary, { mode: 0o600 });

  const address = await plane.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;

  plane.store.createSession({
    id: "blocking-session",
    taskId: "continuity-task",
    nativePath: join(stateRoot, "runs", "blocking-run", "sessions", "session.jsonl"),
    provider: "probe",
    model: "model-less",
  });
  plane.store.createRun({
    id: "blocking-run",
    sessionId: "blocking-session",
    phase: "implementation",
  });
  const blockedByRun = await request(origin, "/api/continuity/exports", {
    method: "POST",
    body: { outputPath: bundlePath },
  });
  assert(
    blockedByRun.response.status === 409
      && blockedByRun.value.error === "continuity_not_quiescent"
      && blockedByRun.value.blockers.some(({ kind }) => kind === "runs"),
    "active run did not block continuity export",
  );
  plane.store.finishRun("blocking-run", "stopped");

  await writeFile(join(fixture, "continuity-dirty-canary.txt"), "uncommitted\n");
  const blockedByGit = await request(origin, "/api/continuity/exports", {
    method: "POST",
    body: { outputPath: bundlePath },
  });
  assert(
    blockedByGit.response.status === 409
      && blockedByGit.value.error === "continuity_repository_dirty",
    "dirty repository did not block continuity export",
  );
  await rm(join(fixture, "continuity-dirty-canary.txt"));

  plane.continuityExportActive = true;
  const gatedClaim = await request(origin, "/api/orchestration/turns/claim", {
    method: "POST",
    body: {},
  });
  assert(
    gatedClaim.response.status === 204
      && gatedClaim.response.headers.get("x-pink-guy-wait-reason") === "continuity_export_active",
    "conversation claim was not paused by continuity gate",
  );
  const gatedReady = await plane.reconcileReadyProject("continuity-project");
  assert(
    gatedReady.reason === "continuity_export_active",
    "ready dispatch was not paused by continuity gate",
  );
  plane.continuityExportActive = false;

  const exported = await request(origin, "/api/continuity/exports", {
    method: "POST",
    body: { outputPath: bundlePath },
  });
  assert(
    exported.response.status === 201 && exported.value.verified,
    `continuity export failed: ${JSON.stringify(exported.value)}`,
  );
  const verified = await verifyBundle(bundlePath);
  assert(verified.verified && verified.projectCount === 1, "standalone verification failed");
  assert(!(await treeContains(bundlePath, Buffer.from(canary))), "credential canary entered the bundle");
  assert(
    verified.manifest.exclusions.includes("credential-runs")
      && verified.manifest.exclusions.includes("runs/*/pi-config"),
    "credential exclusions were not declared",
  );

  await cp(bundlePath, corruptedPath, { recursive: true });
  await writeFile(
    join(corruptedPath, "state", "runs", "retained-run", "artifacts", "result.txt"),
    "corrupted artifact\n",
  );
  let corruptionRejected = false;
  try {
    await verifyBundle(corruptedPath);
  } catch (error) {
    corruptionRejected = error.code === "continuity_checksum_mismatch";
  }
  assert(corruptionRejected, "standalone verification accepted a corrupted bundle");

  await plane.close();
  const sourceDatabaseSha256 = sha256(await readFile(join(stateRoot, "pink-guy.sqlite")));
  const sourceArtifactSha256 = sha256(await readFile(artifactPath));
  const restored = await restoreBundle({ bundlePath, targetRoot: restoredRoot });
  assert(restored.auditDigestsPreserved, "restore changed append-only audit evidence");
  assert(restored.ephemeralAuthorityRevoked, "restore retained ephemeral authority");
  assert(
    sha256(await readFile(join(stateRoot, "pink-guy.sqlite"))) === sourceDatabaseSha256
      && sha256(await readFile(artifactPath)) === sourceArtifactSha256,
    "restore mutated source state",
  );

  const restoredDatabase = new DatabaseSync(join(restoredRoot, "pink-guy.sqlite"));
  const restoredProject = restoredDatabase.prepare("SELECT * FROM projects WHERE id=?")
    .get("continuity-project");
  const restoredSession = restoredDatabase.prepare("SELECT * FROM sessions WHERE id=?")
    .get("retained-session");
  const activeCapabilities = Number(
    restoredDatabase.prepare("SELECT COUNT(*) count FROM capabilities WHERE revoked_at IS NULL").get().count,
  );
  const activeLeases = Number(
    restoredDatabase.prepare(
      "SELECT COUNT(*) count FROM orchestration_leases WHERE status='active'",
    ).get().count,
  );
  const activeProjectOrchestrators = Number(
    restoredDatabase.prepare(
      "SELECT COUNT(*) count FROM project_orchestrators WHERE status='active'",
    ).get().count,
  );
  restoredDatabase.close();
  assert(
    restoredProject.repository_path === join(restoredRoot, "repositories", "continuity-project"),
    "restored project path was not rebased",
  );
  assert(restoredSession.native_path.startsWith(restoredRoot), "restored session path was not rebased");
  assert(
    activeCapabilities === 0 && activeLeases === 0 && activeProjectOrchestrators === 0,
    "restored ephemeral authority remained active",
  );
  assert(restored.tableCountsPreserved, "restore changed durable row counts");
  assert(
    await git(restoredProject.repository_path, "rev-parse", "HEAD") === originalHead,
    "restored repository revision changed",
  );

  const restoredPlane = new DirectControlPlane({
    databasePath: join(restoredRoot, "pink-guy.sqlite"),
    stateRoot: restoredRoot,
    fixturePath: restoredProject.repository_path,
    runtimeOffline: true,
  });
  const orchestrator = restoredPlane.store.registerProjectOrchestrator({
    projectId: "continuity-project",
    transport: "daemon",
    endpoint: "model-less",
    leaseSeconds: 90,
  });
  const scheduled = restoredPlane.store.scheduleOwnerTaskRun({
    taskId: "continuity-task",
    phase: "implementation",
    modelRoute: {
      provider: "probe",
      model: "model-less",
      thinking: "medium",
      policySource: "restored_probe",
    },
    idempotencyKey: "continuity-restored-schedule",
  });
  assert(
    scheduled.command.state === "queued"
      && scheduled.command.orchestrator_id === orchestrator.id,
    "restored task could not be scheduled without a provider call",
  );
  await restoredPlane.close();

  process.stdout.write(`${JSON.stringify({
    probe: "phase2-continuity",
    modelCalls: 0,
    activeRunBlocked: true,
    dirtyRepositoryBlocked: true,
    dispatchGateObserved: true,
    credentialCanaryExcluded: true,
    corruptionRejected: true,
    sourceUnchanged: true,
    auditDigestsPreserved: true,
    tableCountsPreserved: true,
    restoredTaskSchedulable: true,
    bundleFiles: verified.fileCount,
    bundleBytes: verified.byteCount,
  }, null, 2)}\n`);
} finally {
  await plane.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
