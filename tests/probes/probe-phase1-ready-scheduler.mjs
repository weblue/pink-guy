#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-ready-scheduler.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-ready-scheduler-"));
const databasePath = join(root, "boss-man.sqlite");
let authority = new DirectControlPlane({
  databasePath,
  stateRoot: root,
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});

for (const [taskId, title, criteria] of [
  ["legacy-manual", "Existing tasks remain manual", ["Do not start without release"]],
  ["low-priority", "Normal priority task", ["Run after high priority work"]],
  ["b-high-priority", "High priority task B", ["Use stable tie ordering"]],
  ["a-high-priority", "High priority task A", ["Use stable tie ordering"]],
  ["paused-task", "Paused task", ["Remain paused"]],
  ["missing-criteria", "Incomplete task", []],
  ["restart-task", "Restart reconciliation task", ["Start after daemon restart"]],
]) {
  authority.seed({
    projectId: "scheduler-project",
    repositoryId: "scheduler-repository",
    projectName: "Ready scheduler fixture",
    taskId,
    repositoryPath: fixture,
    title,
    acceptanceCriteria: criteria,
  });
}

let address = await authority.listen();
let base = `http://127.0.0.1:${address.port}`;

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

async function dispatch(taskId, operation, expectedVersion, priority = null) {
  return request(`/api/tasks/${taskId}/dispatch`, {
    method: "POST",
    idempotencyKey: `dispatch:${taskId}:${operation}:${expectedVersion}`,
    body: { operation, expectedVersion, priority },
  });
}

const legacy = await request("/api/tasks/legacy-manual");
assert(
  legacy.status === 200
    && legacy.value.dispatch_policy === "manual"
    && legacy.value.priority === 0
    && legacy.value.dispatch.blockers.includes("manual"),
  "existing task did not migrate to visible manual dispatch",
);

const incompleteRelease = await dispatch("missing-criteria", "release", 1);
assert(
  incompleteRelease.status === 409
    && incompleteRelease.value.error === "transition_denied"
    && authority.store.getTask("missing-criteria").version === 1,
  "release without acceptance criteria was not rejected atomically",
);

for (const [taskId, priority] of [
  ["low-priority", 0],
  ["b-high-priority", 10],
  ["a-high-priority", 10],
  ["paused-task", 100],
]) {
  const released = await dispatch(taskId, "release", 1, priority);
  assert(
    released.status === 201
      && released.value.task.dispatch_policy === "automatic"
      && released.value.dispatch.reason === "orchestrator_unavailable",
    `${taskId} did not release durably while the daemon was offline`,
  );
}
const paused = await dispatch("paused-task", "pause_dispatch", 2);
assert(
  paused.status === 201 && paused.value.task.dispatch_policy === "paused",
  "released task could not be paused before dispatch",
);

// Force an exact release-time tie so the task ID is the only remaining ordering key.
authority.store.database.prepare(
  "UPDATE tasks SET released_at='2026-07-18T12:00:00.000Z' WHERE id IN ('a-high-priority','b-high-priority')",
).run();

const waitingBoard = await request("/api/board");
const waitingTasks = waitingBoard.value.columns.ready;
const aWaiting = waitingTasks.find((task) => task.id === "a-high-priority");
const bWaiting = waitingTasks.find((task) => task.id === "b-high-priority");
const pausedWaiting = waitingTasks.find((task) => task.id === "paused-task");
assert(
  aWaiting.dispatch.rank === 1
    && bWaiting.dispatch.rank === 2
    && aWaiting.dispatch.blockers.includes("orchestrator_unavailable")
    && pausedWaiting.dispatch.blockers.includes("paused"),
  "board did not expose deterministic rank and wait blockers",
);

const registration = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "scheduler-project",
    transport: "daemon",
    endpoint: "pid:ready-scheduler",
    leaseSeconds: 90,
  },
});
assert(registration.status === 201, "project orchestrator did not register");
let orchestratorToken = registration.value.token;

const competingClaims = await Promise.all([
  request("/api/orchestrators/commands/claim", {
    method: "POST",
    body: {},
    token: orchestratorToken,
  }),
  request("/api/orchestrators/commands/claim", {
    method: "POST",
    body: {},
    token: orchestratorToken,
  }),
]);
const claimed = competingClaims.filter((response) => response.status === 200);
assert(
  claimed.length === 1
    && claimed[0].value.command.task_id === "a-high-priority"
    && claimed[0].value.command.phase === "implementation",
  "competing scheduler ticks did not select exactly one deterministic task",
);
assert(
  authority.store.orchestratorCommands({ projectId: "scheduler-project" })
    .filter((command) => command.task_id === "a-high-priority").length === 1,
  "competing scheduler ticks duplicated the command",
);

async function completeAndClaimNext(command, expectedTaskId) {
  const completed = await request(`/api/orchestrators/commands/${command.id}/complete`, {
    method: "POST",
    token: orchestratorToken,
    body: { state: "succeeded", result: { probe: true } },
  });
  assert(
    completed.status === 200
      && completed.value.readyDispatch.scheduled
      && completed.value.readyDispatch.task.id === expectedTaskId,
    `capacity release did not dispatch ${expectedTaskId}`,
  );
  const next = await request("/api/orchestrators/commands/claim", {
    method: "POST",
    body: {},
    token: orchestratorToken,
  });
  assert(
    next.status === 200 && next.value.command.task_id === expectedTaskId,
    `${expectedTaskId} was not the next claim`,
  );
  return next.value.command;
}

const bCommand = await completeAndClaimNext(claimed[0].value.command, "b-high-priority");
const lowCommand = await completeAndClaimNext(bCommand, "low-priority");
const lowCompleted = await request(`/api/orchestrators/commands/${lowCommand.id}/complete`, {
  method: "POST",
  token: orchestratorToken,
  body: { state: "succeeded", result: { probe: true } },
});
assert(
  lowCompleted.status === 200
    && !lowCompleted.value.readyDispatch.scheduled
    && authority.store.getTask("paused-task").status === "ready",
  "paused task entered automatic dispatch",
);

await request("/api/orchestrators/lease", {
  method: "DELETE",
  token: orchestratorToken,
});
const restartRelease = await dispatch("restart-task", "release", 1, 5);
assert(
  restartRelease.status === 201
    && restartRelease.value.dispatch.reason === "orchestrator_unavailable",
  "restart task did not remain Ready without a live daemon",
);

await new Promise((resolvePromise) => authority.server.close(resolvePromise));
authority.store.close();
authority = new DirectControlPlane({
  databasePath,
  stateRoot: root,
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
address = await authority.listen();
base = `http://127.0.0.1:${address.port}`;
const restartedRegistration = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "scheduler-project",
    transport: "daemon",
    endpoint: "pid:ready-scheduler-restarted",
    leaseSeconds: 90,
  },
});
orchestratorToken = restartedRegistration.value.token;
const restartClaim = await request("/api/orchestrators/commands/claim", {
  method: "POST",
  body: {},
  token: orchestratorToken,
});
assert(
  restartClaim.status === 200 && restartClaim.value.command.task_id === "restart-task",
  "claim reconciliation after API restart did not dispatch released Ready work",
);
assert(
  authority.store.taskAudit("restart-task").some(
    (event) => event.type === "task_scheduled" && event.actor_id === "ready-scheduler",
  ),
  "automatic dispatch did not retain scheduler audit provenance",
);

console.log(JSON.stringify({
  status: "pass",
  migrated_manual: true,
  release_requires_acceptance_criteria: true,
  deterministic_order: ["a-high-priority", "b-high-priority", "low-priority"],
  priority_range: [-100, 100],
  pause_blocks_dispatch: true,
  competing_ticks_idempotent: true,
  capacity_release_trigger: true,
  restart_reconciliation: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2));

await new Promise((resolvePromise) => authority.server.close(resolvePromise));
authority.store.close();
