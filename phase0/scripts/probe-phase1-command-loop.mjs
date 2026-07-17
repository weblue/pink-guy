#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DirectControlPlane } from "../direct/control-plane.mjs";
import { Phase0Store } from "../direct/store.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-command-loop.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value)}\n`);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-command-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "authority", "boss-man.sqlite"),
  stateRoot: join(root, "authority"),
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
authority.seed({
  projectId: "project-a",
  repositoryId: "repository-a",
  projectName: "Project A",
  taskId: "task-a",
  repositoryPath: fixture,
  title: "Implement command loop",
});
authority.seed({
  projectId: "project-b",
  repositoryId: "repository-b",
  projectName: "Project B",
  taskId: "task-b",
  repositoryPath: fixture,
  title: "Cross-project decoy",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

async function request(path, { method = "GET", body, token, idempotencyKey } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return { status: 204, value: null };
  return { status: response.status, value: await response.json() };
}

const page = await fetch(base).then((response) => response.text());
assert(page.includes("Phase 1 local cockpit") && page.includes("Recent commands"), "Phase 1 command observability is missing");

const registrationA = await request("/api/orchestrators", {
  method: "POST",
  body: { projectId: "project-a", transport: "daemon", endpoint: "pid:phase1-a", leaseSeconds: 90 },
});
const registrationB = await request("/api/orchestrators", {
  method: "POST",
  body: { projectId: "project-b", transport: "tmux", endpoint: "tmux:phase1-b", leaseSeconds: 90 },
});
assert(registrationA.status === 201 && registrationB.status === 201, "project orchestrators did not register");

const queued = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-command-one",
  body: { taskId: "task-a", kind: "start_task", phase: "implementation" },
});
assert(queued.status === 201 && queued.value.command.state === "queued", "command was not durably queued");
const replayed = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-command-one",
  body: { taskId: "task-a", kind: "start_task", phase: "implementation" },
});
assert(
  replayed.status === 200 && replayed.value.replayed && replayed.value.command.id === queued.value.command.id,
  "identical command request did not replay its original result",
);
const idempotencyConflict = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-command-one",
  body: { taskId: "task-a", kind: "start_task", phase: "review" },
});
assert(idempotencyConflict.status === 409, "idempotency key reuse with a different phase was accepted");
const crossProject = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-cross-project",
  body: { taskId: "task-b", kind: "start_task", phase: "test" },
});
assert(crossProject.status === 403, "cross-project task command was accepted");
const invalidPhase = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-invalid-phase",
  body: { taskId: "task-a", kind: "start_task", phase: "unscoped" },
});
assert(invalidPhase.status === 400, "unscoped task-agent phase was accepted");

const wrongProjectClaim = await request("/api/orchestrators/commands/claim", {
  method: "POST", body: {}, token: registrationB.value.token,
});
assert(wrongProjectClaim.status === 204, "orchestrator claimed another project's command");
const claimed = await request("/api/orchestrators/commands/claim", {
  method: "POST", body: {}, token: registrationA.value.token,
});
assert(claimed.status === 200 && claimed.value.command.id === queued.value.command.id, "active orchestrator did not claim FIFO command");
const duplicateClaim = await request("/api/orchestrators/commands/claim", {
  method: "POST", body: {}, token: registrationA.value.token,
});
assert(duplicateClaim.status === 204, "claimed command was offered a second time");
const wrongCompletion = await request(`/api/orchestrators/commands/${claimed.value.command.id}/complete`, {
  method: "POST", token: registrationB.value.token, body: { state: "succeeded", result: {} },
});
assert(wrongCompletion.status === 403, "wrong-project orchestrator completed a command");
const completed = await request(`/api/orchestrators/commands/${claimed.value.command.id}/complete`, {
  method: "POST",
  token: registrationA.value.token,
  body: { state: "succeeded", result: { sessionId: "session-a", runId: "run-a" } },
});
assert(completed.value.command.state === "succeeded", "command terminal success was not recorded");
assert(
  authority.store.orchestratorCommandEvents(claimed.value.command.id).map((event) => event.type).join(",")
    === "queued,claimed,succeeded",
  "command lifecycle event order changed",
);

const queuedForRelease = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-command-release",
  body: { taskId: "task-a", kind: "start_task", phase: "review" },
});
await request("/api/orchestrators/commands/claim", {
  method: "POST", body: {}, token: registrationA.value.token,
});
await request("/api/orchestrators/lease", { method: "DELETE", token: registrationA.value.token });
const releasedCommand = authority.store.orchestratorCommand(queuedForRelease.value.command.id);
assert(
  releasedCommand.state === "reconciliation_required"
    && releasedCommand.result.reason === "orchestrator_lease_released"
    && releasedCommand.result.automaticReplay === false,
  "lease release did not hold claimed work for reconciliation",
);
const unavailable = await request("/api/projects/project-a/commands", {
  method: "POST",
  idempotencyKey: "phase1-no-orchestrator",
  body: { taskId: "task-a", kind: "start_task", phase: "test" },
});
assert(unavailable.status === 409, "command was accepted without an active project orchestrator");
const publicCommands = await request("/api/commands?projectId=project-a");
assert(
  !JSON.stringify(publicCommands.value).includes("token_sha256")
    && !JSON.stringify(publicCommands.value).includes(registrationA.value.token),
  "public command projection leaked an orchestrator credential",
);

let clock = "2026-07-17T12:00:00.000Z";
const expiryStore = new Phase0Store(join(root, "expiry", "boss-man.sqlite"), { clock: () => clock });
expiryStore.seedProjectTask({
  projectId: "expiry-project",
  taskId: "expiry-task",
  repositoryPath: fixture,
  title: "Hold expired claimed work",
});
const expiryLease = expiryStore.registerProjectOrchestrator({
  projectId: "expiry-project", endpoint: "pid:expiry", leaseSeconds: 15,
});
const expiryCommand = expiryStore.enqueueOrchestratorCommand({
  projectId: "expiry-project",
  taskId: "expiry-task",
  phase: "test",
  idempotencyKey: "phase1-expiry",
});
expiryStore.claimOrchestratorCommand(expiryLease.token);
clock = "2026-07-17T12:00:16.000Z";
expiryStore.expireOrchestratorLeases();
assert(
  expiryStore.orchestratorCommand(expiryCommand.command.id).state === "reconciliation_required",
  "expired lease did not hold claimed work for reconciliation",
);
expiryStore.close();

const delivered = [
  { id: "fake-success", project_id: "fake-project", task_id: "task-success", kind: "start_task", phase: "implementation" },
  { id: "fake-failure", project_id: "fake-project", task_id: "task-failure", kind: "start_task", phase: "review" },
];
const deliveryCounts = new Map();
const completions = [];
let resolveCompletions;
const completionsReady = new Promise((resolvePromise) => {
  resolveCompletions = resolvePromise;
});
const fakeServer = createServer(async (incoming, response) => {
  const url = new URL(incoming.url, "http://fake.invalid");
  if (incoming.method === "POST" && url.pathname === "/api/orchestrators") {
    await readRequestBody(incoming);
    return sendJson(response, 201, { id: "fake-lease", token: "fake-token" });
  }
  if (incoming.method === "POST" && url.pathname === "/api/orchestrators/heartbeat") {
    await readRequestBody(incoming);
    return sendJson(response, 200, { id: "fake-lease", status: "active" });
  }
  if (incoming.method === "DELETE" && url.pathname === "/api/orchestrators/lease") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end('{"released":true}\n');
  }
  if (incoming.method === "POST" && url.pathname === "/api/orchestrators/commands/claim") {
    await readRequestBody(incoming);
    const command = delivered.shift();
    if (!command) {
      response.writeHead(204);
      return response.end();
    }
    deliveryCounts.set(command.id, (deliveryCounts.get(command.id) ?? 0) + 1);
    return sendJson(response, 200, { command });
  }
  const start = url.pathname.match(/^\/api\/tasks\/([^/]+)\/sessions$/);
  if (incoming.method === "POST" && start) {
    const body = await readRequestBody(incoming);
    if (start[1] === "task-failure") {
      return sendJson(response, 409, { error: "fixture_failure", message: `fixture rejected ${body.phase}` });
    }
    return sendJson(response, 201, {
      session: { id: "fake-session" },
      run: { id: "fake-run", phase: body.phase },
    });
  }
  const complete = url.pathname.match(/^\/api\/orchestrators\/commands\/([^/]+)\/complete$/);
  if (incoming.method === "POST" && complete) {
    const body = await readRequestBody(incoming);
    completions.push({ id: complete[1], ...body });
    if (completions.length === 2) resolveCompletions();
    return sendJson(response, 200, { command: { id: complete[1], state: body.state } });
  }
  return sendJson(response, 404, { error: "not_found" });
});
await new Promise((resolvePromise, rejectPromise) => {
  fakeServer.once("error", rejectPromise);
  fakeServer.listen(0, "127.0.0.1", resolvePromise);
});
const fakeAddress = fakeServer.address();
const orchestratorPath = fileURLToPath(new URL("./project-orchestrator.mjs", import.meta.url));
const child = spawn(process.execPath, [
  orchestratorPath,
  "--api", `http://127.0.0.1:${fakeAddress.port}`,
  "--project-id", "fake-project",
  "--lease-seconds", "15",
  "--poll-ms", "100",
], { stdio: ["ignore", "pipe", "pipe"] });
let childOutput = "";
child.stdout.on("data", (chunk) => { childOutput += chunk; });
child.stderr.on("data", (chunk) => { childOutput += chunk; });
await Promise.race([
  completionsReady,
  new Promise((_, rejectPromise) => setTimeout(() => rejectPromise(new Error("project orchestrator did not complete fixture commands")), 10_000)),
]);
child.kill("SIGINT");
await new Promise((resolvePromise, rejectPromise) => {
  child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`project orchestrator exited ${code}: ${childOutput}`)));
});
await new Promise((resolvePromise) => fakeServer.close(resolvePromise));
assert(deliveryCounts.get("fake-success") === 1 && deliveryCounts.get("fake-failure") === 1, "consumer retried a terminal command");
assert(
  completions.find((item) => item.id === "fake-success")?.state === "succeeded"
    && completions.find((item) => item.id === "fake-success")?.result.phase === "implementation",
  "consumer did not forward a phase-scoped successful start",
);
assert(
  completions.find((item) => item.id === "fake-failure")?.state === "failed"
    && completions.find((item) => item.id === "fake-failure")?.result.message.includes("fixture rejected review"),
  "consumer did not report a structured terminal failure",
);

const result = {
  status: "pass",
  command_states: ["queued", "claimed", "succeeded", "failed", "reconciliation_required"],
  phase_scopes: ["implementation", "test", "review"],
  idempotent_replay: true,
  cross_project_claim_denied: true,
  lease_release_reconciliation: true,
  lease_expiry_reconciliation: true,
  automatic_replay: false,
  consumer_success_and_failure: true,
  public_token_leak: false,
  isolated_root: root,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await authority.close();

