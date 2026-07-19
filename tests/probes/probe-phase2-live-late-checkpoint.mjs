#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";
import { createModelRoutePolicy } from "../../src/server/model-routes.mjs";

const [fixture, credentialSource, provider = "openai-codex", model = "gpt-5.4-mini"] =
  process.argv.slice(2);
if (!fixture?.startsWith("/") || !credentialSource?.startsWith("/")) {
  console.error(
    "usage: probe-phase2-live-late-checkpoint.mjs "
    + "/absolute/git-fixture /absolute/pi-auth.json [provider] [model]",
  );
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(read, predicate, description, timeoutMs = 10 * 60 * 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`timed out waiting for ${description}`);
}

let checkpointReachedResolve;
let releaseCheckpointResolve;
const checkpointReached = new Promise((resolvePromise) => {
  checkpointReachedResolve = resolvePromise;
});
const releaseCheckpoint = new Promise((resolvePromise) => {
  releaseCheckpointResolve = resolvePromise;
});
let checkpointBoundaryUsed = false;
const faultInjector = async (boundary, context) => {
  if (boundary !== "git_after_commit" || checkpointBoundaryUsed) return;
  checkpointBoundaryUsed = true;
  checkpointReachedResolve(context);
  await releaseCheckpoint;
};

const root = await mkdtemp(join(tmpdir(), "boss-man-p2-live-late-"));
const modelRoutePolicy = createModelRoutePolicy({
  provider,
  model,
  thinking: "medium",
  billingClass: "subscription",
});
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  enforceOrchestratorLease: true,
  runtimeProvider: provider,
  runtimeModel: model,
  runtimeThinking: "medium",
  modelRoutePolicy,
  runtimeOffline: false,
  faultInjector,
  credentialProfile: {
    id: "p2-live-recovery",
    authType: "oauth_snapshot",
    billingMode: "subscription",
    sourcePath: credentialSource,
    maxConcurrentRuns: 1,
  },
});
authority.seed({
  projectId: "p2-live-project",
  repositoryId: "p2-live-repository",
  projectName: "P2 live recovery",
  taskId: "p2-live-task",
  repositoryPath: fixture,
  title: "Fix slugify normalization and retain regression coverage",
  acceptanceCriteria: [
    "Punctuation, whitespace, and repeated separators collapse to one hyphen.",
    "Leading and trailing separators are removed.",
    "npm test passes without adding a dependency.",
    "Implementation records a host checkpoint and requests review.",
  ],
});
const address = await authority.listen();
const api = `http://127.0.0.1:${address.port}`;

async function request(path, {
  method = "GET",
  body = null,
  token = null,
  idempotencyKey = null,
} = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(value?.message ?? `HTTP ${response.status}`), {
      code: value?.error,
      status: response.status,
    });
  }
  return value;
}

const registration = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "p2-live-project",
    transport: "daemon",
    endpoint: "probe:late-checkpoint",
    leaseSeconds: 600,
  },
});
authority.store.scheduleOwnerTaskRun({
  taskId: "p2-live-task",
  phase: "implementation",
  idempotencyKey: "p2-live-implementation",
  modelRoute: {
    provider,
    model,
    thinking: "medium",
    billingClass: "subscription",
  },
});

async function claimAndAccept(expectedPhase) {
  const claimed = await waitFor(
    () => request("/api/orchestrators/commands/claim", {
      method: "POST",
      token: registration.token,
      body: {},
    }),
    (value) => value?.command,
    `${expectedPhase} command`,
  );
  assert(
    claimed.command.phase === expectedPhase,
    `expected ${expectedPhase}, claimed ${claimed.command.phase}`,
  );
  return request(`/api/orchestrators/commands/${claimed.command.id}/executions`, {
    method: "POST",
    token: registration.token,
    idempotencyKey: `execute-command:${claimed.command.id}`,
    body: {},
  });
}

const implementation = await claimAndAccept("implementation");
const checkpoint = await Promise.race([
  checkpointReached,
  new Promise((_, rejectPromise) =>
    setTimeout(() => rejectPromise(new Error("implementation never reached git_after_commit")), 5 * 60 * 1_000)
  ),
]);
const beforeStop = authority.store.commandExecution(implementation.execution.id);
const stopRequest = request(`/api/executions/${beforeStop.id}/actions`, {
  method: "POST",
  idempotencyKey: "p2-live-stop-after-commit",
  body: {
    action: "stop",
    expectedVersion: beforeStop.version,
    reason: "Exercise post-fence checkpoint recovery",
  },
});
await waitFor(
  () => Promise.resolve(authority.store.commandExecution(beforeStop.id)),
  (execution) => execution.state === "stopping",
  "durable mutation fence",
);
releaseCheckpointResolve();
const stopped = await stopRequest;
assert(
  ["failed", "reconciliation_required"].includes(stopped.execution.state),
  `stopped execution settled ${stopped.execution.state}`,
);
const candidate = await waitFor(
  () => Promise.resolve(
    authority.store.recoveryCandidates({ taskId: "p2-live-task" })
      .find((item) => item.execution_id === beforeStop.id),
  ),
  (value) => value?.state === "pending",
  "pending late checkpoint",
);
assert(
  candidate.revision === checkpoint.newRevision
    && authority.store.getTask("p2-live-task").revision === candidate.base_revision,
  "late checkpoint advanced task authority before owner acceptance",
);

await request(`/api/recovery-candidates/${candidate.id}/actions`, {
  method: "POST",
  idempotencyKey: "p2-live-accept-checkpoint",
  body: {
    action: "accept",
    expectedVersion: candidate.version,
    reason: "Named-boundary proof matches the fixture execution and base revision",
  },
});
const afterAcceptance = authority.store.getTaskDetails("p2-live-task");
assert(
  afterAcceptance.revision === candidate.revision
    && !afterAcceptance.validation_passed
    && afterAcceptance.requested_review_revision === candidate.revision,
  "accepted late checkpoint did not require fresh validation and review",
);

const test = await claimAndAccept("test");
await waitFor(
  () => Promise.resolve(authority.store.commandExecution(test.execution.id)),
  (execution) => ["succeeded", "failed", "reconciliation_required"].includes(execution.state),
  "fresh test settlement",
);
assert(
  authority.store.commandExecution(test.execution.id).state === "succeeded",
  "fresh test did not succeed",
);

const review = await claimAndAccept("review");
await waitFor(
  () => Promise.resolve(authority.store.commandExecution(review.execution.id)),
  (execution) => ["succeeded", "failed", "reconciliation_required"].includes(execution.state),
  "fresh review settlement",
);
const finalTask = authority.store.getTaskDetails("p2-live-task");
assert(
  authority.store.commandExecution(review.execution.id).state === "succeeded"
    && finalTask.status === "done"
    && finalTask.validation_passed
    && finalTask.reviews.at(-1)?.disposition === "approve",
  "accepted checkpoint did not pass fresh validation, review, and completion",
);

process.stdout.write(`${JSON.stringify({
  status: "pass",
  checkpoint_boundary: "git_after_commit",
  fenced_execution: beforeStop.id,
  stopped_state: stopped.execution.state,
  recovery_candidate: candidate.id,
  base_revision: candidate.base_revision,
  accepted_revision: candidate.revision,
  fresh_test_execution: test.execution.id,
  fresh_review_execution: review.execution.id,
  final_task_status: finalTask.status,
  validation: finalTask.validations.at(-1)?.status,
  review: finalTask.reviews.at(-1)?.disposition,
  provider,
  model,
  isolated_root: root,
}, null, 2)}\n`);
await authority.close();
