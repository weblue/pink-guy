#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DirectControlPlane } from "../direct/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-direct-foundation.mjs /absolute/path/to/generated/fixture");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const root = await mkdtemp(join(tmpdir(), "boss-man-direct-foundation-"));
const databasePath = join(root, "boss-man.sqlite");
const stateRoot = join(root, "runtime");
let authority = new DirectControlPlane({ databasePath, stateRoot, fixturePath: fixture });
authority.seed();
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

async function request(path, { method = "GET", body, idempotencyKey, capabilityToken } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(capabilityToken ? { authorization: `Bearer ${capabilityToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const value = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, value };
}

const page = await request("/");
assert(page.status === 200 && page.value.includes("task-first route"), "minimal board route is missing");
const health = await request("/api/health");
assert(health.value.authority === "direct_pi_daemon", "daemon authority identity is missing");
const initialBoard = await request("/api/board");
assert(initialBoard.value.columns.ready.length === 1, "seed task is not ready");
const workerCapability = authority.store.issueCapability({
  role: "worker", actorId: "phase0-worker", taskId: "phase0-task", runId: "phase0-claim-run",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

const claim = await request("/api/tasks/phase0-task/actions/claim", {
  method: "POST",
  idempotencyKey: "phase0-claim-once",
  capabilityToken: workerCapability.token,
  body: { expectedVersion: 1, payload: {} },
});
assert(claim.status === 201 && claim.value.task.version === 2, "task claim was not committed");
const replay = await request("/api/tasks/phase0-task/actions/claim", {
  method: "POST",
  idempotencyKey: "phase0-claim-once",
  capabilityToken: workerCapability.token,
  body: { expectedVersion: 1, payload: {} },
});
assert(replay.status === 200 && replay.value.replayed === true, "idempotent task mutation was duplicated");
const conflict = await request("/api/tasks/phase0-task/actions/progress", {
  method: "POST",
  idempotencyKey: "phase0-stale-write",
  capabilityToken: workerCapability.token,
  body: { expectedVersion: 1, payload: { text: "stale" } },
});
assert(conflict.status === 409, "stale task mutation was not rejected");

const started = await request("/api/tasks/phase0-task/sessions", { method: "POST", body: {} });
assert(started.status === 201, `session start failed: ${JSON.stringify(started.value)}`);
const { session, run } = started.value;
assert(session.state === "idle" && run.state === "running", "durable session/run records are invalid");
const managed = authority.sessions.get(session.id);
const registeredTools = JSON.parse(await readFile(managed.env.BOSS_MAN_EXTENSION_EVIDENCE_PATH, "utf8"));
assert(registeredTools.tools.length === 8 && registeredTools.tools.every((name) => name.startsWith("boss_")), "Pi did not register the Boss Man capability tools");

const shellProof = join(fixture, ".boss-man-shell-proof");
const shell = await request(`/api/sessions/${session.id}/shell`, {
  method: "POST",
  body: { command: "printf 'persistent-shell-ok' > .boss-man-shell-proof && pwd" },
});
assert(shell.status === 200 && shell.value.status === 0, "workspace shell command failed");
assert((await readFile(shellProof, "utf8")) === "persistent-shell-ok", "workspace shell did not mutate the assigned workspace");

const prompted = await request(`/api/sessions/${session.id}/prompt`, {
  method: "POST",
  body: { message: "phase0 direct control plane prompt" },
});
assert(prompted.status === 200, `Pi prompt failed: ${JSON.stringify(prompted.value)}`);
const eventTypes = prompted.value.events.map((event) => event.type);
for (const required of ["agent_start", "turn_start", "message_update", "turn_end", "agent_end", "agent_settled", "workspace_shell_result"]) {
  assert(eventTypes.includes(required), `structured run events omitted ${required}`);
}
const artifacts = authority.store.artifacts(session.id);
assert(artifacts.length >= 3, "context custody manifests were not ingested");
assert(await exists(session.native_path), "native Pi session was not retained");
const nativeBeforeRestart = await readFile(session.native_path);
assert(nativeBeforeRestart.includes(Buffer.from("phase0-deterministic-completion")), "native session lacks deterministic assistant output");
const nativeHash = sha256(nativeBeforeRestart);

await authority.close({ record: false });
authority = new DirectControlPlane({ databasePath, stateRoot, fixturePath: fixture });
assert(authority.reconciledRunIds.includes(run.id), "restart did not reconcile the ambiguous active run");
const reconciled = authority.store.getRun(run.id);
assert(reconciled.state === "orphaned", "ambiguous run was reported healthy after restart");
const reconciledEvents = authority.store.runEvents(run.id);
assert(reconciledEvents.at(-1).type === "run_reconciliation_required", "restart reconciliation event is missing");
assert(sha256(await readFile(session.native_path)) === nativeHash, "restart mutated the retained native session");

const result = {
  pi_version: "0.80.9",
  provider_request_made: false,
  one_daemon_authority: true,
  task_board_route: true,
  task_idempotency: true,
  optimistic_conflict_rejection: true,
  pi_capability_tools: registeredTools.tools,
  durable_session_and_run: true,
  direct_pi_rpc: true,
  structured_event_count: prompted.value.events.length,
  persistent_workspace_shell: true,
  custody_manifest_count: artifacts.length,
  restart_reconciliation: reconciled.state,
  native_session_sha256: nativeHash,
  database_sha256: sha256(await readFile(databasePath)),
  isolated_root: root,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

await authority.close();
await rm(shellProof, { force: true });
