#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-automatic-continuation.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-auto-continuation-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
for (const [taskId, title] of [
  ["auto-task", "Automatically continue successful phases"],
  ["untouched-ready", "Remain ready until explicitly selected"],
  ["failed-validation", "Stop after failed validation"],
  ["decision-gated", "Stop for a protected decision"],
  ["historical-evidence", "Reject phase evidence from an earlier run"],
]) {
  authority.seed({
    projectId: "auto-project",
    repositoryId: "auto-repository",
    projectName: "Automatic continuation fixture",
    taskId,
    repositoryPath: fixture,
    title,
  });
}
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

function capability(role, actorId, taskId, actions, runId = null) {
  return authority.store.issueCapability({
    role,
    actorId,
    taskId,
    actions,
    runId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

function act(taskId, role, actorId, action, payload, key, runId = null) {
  const issued = capability(role, actorId, taskId, [action], runId);
  try {
    const task = authority.store.getTask(taskId);
    return authority.store.actOnTask({
      token: issued.token,
      taskId,
      action,
      payload,
      expectedVersion: task.version,
      idempotencyKey: key,
    });
  } finally {
    authority.store.revokeCapability(issued.id);
  }
}

const registration = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "auto-project",
    transport: "daemon",
    endpoint: "pid:auto-continuation",
    leaseSeconds: 90,
  },
});
assert(registration.status === 201, "project orchestrator did not register");
const orchestratorToken = registration.value.token;

async function scheduleImplementation(taskId) {
  const scheduled = await request(`/api/tasks/${taskId}/schedule`, {
    method: "POST",
    idempotencyKey: `initial:${taskId}`,
    body: { phase: "implementation" },
  });
  assert(scheduled.status === 201, `${taskId} implementation did not schedule`);
  const claimed = await request("/api/orchestrators/commands/claim", {
    method: "POST",
    body: {},
    token: orchestratorToken,
  });
  assert(
    claimed.status === 200
      && claimed.value.command.id === scheduled.value.command.id
      && claimed.value.command.phase === "implementation",
    `${taskId} implementation command was not claimed`,
  );
  return claimed.value.command;
}

async function complete(command, state = "succeeded") {
  const response = await request(`/api/orchestrators/commands/${command.id}/complete`, {
    method: "POST",
    token: orchestratorToken,
    body: { state, result: { probe: true } },
  });
  assert(response.status === 200, `${command.phase} command did not complete`);
  return response.value;
}

const implementation = await scheduleImplementation("auto-task");
const implementationActor = authority.store.getTask("auto-task").assigned_worker;
act(
  "auto-task",
  "worker",
  implementationActor,
  "request_review",
  { revision: authority.store.getTask("auto-task").revision },
  "auto-request-review",
);
const implementationCompletion = await complete(implementation);
assert(
  implementationCompletion.continuation.some(
    (receipt) => receipt.taskId === "auto-task" && receipt.phase === "test" && receipt.scheduled,
  ),
  "successful implementation did not automatically schedule test",
);
assert(
  authority.store.getTask("untouched-ready").status === "ready"
    && authority.store.orchestratorCommands({ projectId: "auto-project" })
      .every((command) => command.task_id !== "untouched-ready"),
  "automatic reconciliation selected an untouched Ready task",
);

const testClaim = await request("/api/orchestrators/commands/claim", {
  method: "POST",
  body: {},
  token: orchestratorToken,
});
assert(testClaim.status === 200 && testClaim.value.command.phase === "test", "automatic test was not claimable");
act(
  "auto-task",
  "orchestrator",
  "probe-orchestrator",
  "record_validation",
  {
    revision: authority.store.getTask("auto-task").revision,
    status: "passed",
    evidence: ["model-less automatic continuation probe"],
  },
  "auto-validation-pass",
);
const testCompletion = await complete(testClaim.value.command);
assert(
  testCompletion.continuation.some(
    (receipt) => receipt.taskId === "auto-task" && receipt.phase === "review" && receipt.scheduled,
  ),
  "passed validation did not automatically schedule review",
);
const reviewCommandsBeforeReplay = authority.store.orchestratorCommands({ projectId: "auto-project" })
  .filter((command) => command.task_id === "auto-task" && command.phase === "review");
const replayClaim = await request("/api/orchestrators/commands/claim", {
  method: "POST",
  body: {},
  token: orchestratorToken,
});
assert(replayClaim.status === 200 && replayClaim.value.command.phase === "review", "automatic review was not claimable");
assert(
  reviewCommandsBeforeReplay.length === 1
    && authority.store.orchestratorCommands({ projectId: "auto-project" })
      .filter((command) => command.task_id === "auto-task" && command.phase === "review").length === 1,
  "reconciliation duplicated an automatic review command",
);
act(
  "auto-task",
  "reviewer",
  "independent-probe-reviewer",
  "submit_review",
  {
    revision: authority.store.getTask("auto-task").revision,
    disposition: "approve",
    findings: [],
  },
  "auto-review-approve",
);
await complete(replayClaim.value.command);

const failedImplementation = await scheduleImplementation("failed-validation");
act(
  "failed-validation",
  "worker",
  authority.store.getTask("failed-validation").assigned_worker,
  "request_review",
  { revision: authority.store.getTask("failed-validation").revision },
  "failed-request-review",
);
await complete(failedImplementation);
const failedTest = await request("/api/orchestrators/commands/claim", {
  method: "POST",
  body: {},
  token: orchestratorToken,
});
assert(failedTest.value.command.phase === "test", "failed-validation test was not scheduled");
act(
  "failed-validation",
  "orchestrator",
  "probe-orchestrator",
  "record_validation",
  {
    revision: authority.store.getTask("failed-validation").revision,
    status: "failed",
    evidence: ["intentional failure"],
  },
  "auto-validation-fail",
);
const failedCompletion = await complete(failedTest.value.command);
assert(
  failedCompletion.continuation.some(
    (receipt) => receipt.taskId === "failed-validation"
      && receipt.reason === "validation_failed"
      && !receipt.scheduled,
  ),
  "failed validation did not stop automatic continuation",
);

const gatedImplementation = await scheduleImplementation("decision-gated");
act(
  "decision-gated",
  "worker",
  authority.store.getTask("decision-gated").assigned_worker,
  "request_review",
  { revision: authority.store.getTask("decision-gated").revision },
  "gated-request-review",
);
act(
  "decision-gated",
  "owner",
  "probe-owner",
  "add_decision_gate",
  { id: "architecture-decision", category: "architecture", question: "Owner decision required" },
  "auto-decision-gate",
);
const gatedCompletion = await complete(gatedImplementation);
assert(
  gatedCompletion.continuation.some(
    (receipt) => receipt.taskId === "decision-gated"
      && receipt.reason === "human_decision_required"
      && !receipt.scheduled,
  ),
  "protected decision did not stop automatic continuation",
);

const missingImplementationOutcome = authority.store.taskPhaseOutcome("untouched-ready", "implementation");
assert(!missingImplementationOutcome.recorded, "missing implementation outcome was treated as settled");

act(
  "historical-evidence",
  "worker",
  "historical-worker",
  "claim",
  {},
  "historical-claim",
  "historical-run",
);
act(
  "historical-evidence",
  "worker",
  "historical-worker",
  "request_review",
  { revision: authority.store.getTask("historical-evidence").revision },
  "historical-review-request",
  "historical-run",
);
assert(
  authority.store.taskPhaseOutcome("historical-evidence", "implementation", {
    runId: "historical-run",
  }).recorded,
  "same-run implementation evidence was not recognized",
);
assert(
  !authority.store.taskPhaseOutcome("historical-evidence", "implementation", {
    runId: "replacement-run",
  }).recorded,
  "historical implementation evidence satisfied a replacement run",
);

process.stdout.write(`${JSON.stringify({
  status: "pass",
  automatic_test: true,
  automatic_review: true,
  idempotent_reconciliation: true,
  failed_validation_stops: true,
  protected_decision_stops: true,
  untouched_ready_not_started: true,
  missing_phase_outcome_detected: true,
  current_run_phase_evidence_required: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);

await authority.close();
