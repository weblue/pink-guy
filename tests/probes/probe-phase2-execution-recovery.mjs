#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase2-execution-recovery.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase2-recovery-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "authority", "boss-man.sqlite"),
  stateRoot: join(root, "authority"),
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
authority.seed({
  projectId: "recovery-project",
  repositoryId: "recovery-repository",
  projectName: "Recovery fixture",
  taskId: "recovery-task",
  repositoryPath: fixture,
  title: "Exercise execution custody",
});
const registration = authority.store.registerProjectOrchestrator({
  projectId: "recovery-project",
  transport: "daemon",
  endpoint: "pid:recovery-probe",
  leaseSeconds: 90,
});
let launches = 0;
let releaseLaunch;
const launchBoundary = new Promise((resolvePromise) => {
  releaseLaunch = resolvePromise;
});
authority.runCommandExecution = async () => {
  launches += 1;
  await launchBoundary;
};
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;
const scheduled = authority.store.scheduleOwnerTaskRun({
  taskId: "recovery-task",
  phase: "implementation",
  idempotencyKey: "recovery-schedule",
  modelRoute: {
    provider: "boss-man-phase0",
    model: "complete",
    thinking: "medium",
    billingClass: "local",
  },
});
const command = authority.store.claimOrchestratorCommand(registration.token);
assert(command.id === scheduled.command.id, "fixture command was not claimed");

async function request(path, {
  method = "GET",
  body,
  token = null,
  idempotencyKey = null,
} = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    value: response.status === 204 ? null : await response.json(),
  };
}

const acceptancePath = `/api/orchestrators/commands/${command.id}/executions`;
const acceptanceOptions = {
  method: "POST",
  token: registration.token,
  idempotencyKey: `execute-command:${command.id}`,
  body: {},
};
const [acceptedA, acceptedB] = await Promise.all([
  request(acceptancePath, acceptanceOptions),
  request(acceptancePath, acceptanceOptions),
]);
assert(
  acceptedA.status === 202
    && acceptedB.status === 202
    && acceptedA.value.execution.id === acceptedB.value.execution.id,
  `repeated acceptance did not return one durable execution: ${JSON.stringify([acceptedA, acceptedB])}`,
);
await new Promise((resolvePromise) => setImmediate(resolvePromise));
assert(launches === 1, "in-process launch registry started duplicate work");

const acceptedExecution = authority.store.commandExecution(acceptedA.value.execution.id);
assert(
  acceptedExecution.state === "starting"
    && authority.store.orchestratorCommand(command.id).state === "running",
  "acceptance did not atomically transfer settlement authority",
);
const legacyCompletion = await request(
  `/api/orchestrators/commands/${command.id}/complete`,
  {
    method: "POST",
    token: registration.token,
    body: { state: "failed", result: { message: "observer disconnected" } },
  },
);
assert(
  legacyCompletion.status === 409 && legacyCompletion.value.error === "execution_managed",
  "observer transport could still settle an execution-backed command",
);

authority.store.bindExecutionResources({
  executionId: acceptedExecution.id,
  generation: acceptedExecution.generation,
  runId: "late-run",
  sessionId: "late-session",
  workspaceId: "late-workspace",
});
const capability = authority.store.issueCapability({
  role: "worker",
  actorId: authority.store.getTask("recovery-task").assigned_worker,
  taskId: "recovery-task",
  runId: "late-run",
  executionId: acceptedExecution.id,
  executionGeneration: acceptedExecution.generation,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const beforeFence = authority.store.commandExecution(acceptedExecution.id);
authority.store.fenceExecution({
  executionId: beforeFence.id,
  expectedVersion: beforeFence.version,
  reason: "fault-boundary:checkpoint-after-intent",
  failureClass: "owner_stop",
});
let fencedCapability = false;
try {
  authority.store.authorizeCapability(capability.token, "progress", "recovery-task");
} catch (error) {
  fencedCapability = error.code === "capability_denied" || error.code === "execution_fenced";
}
assert(fencedCapability, "mutation capability remained usable after the durable fence");

const lateRevision = "2222222222222222222222222222222222222222";
const authoritativeRevision = authority.store.getTask("recovery-task").revision;
const lateReceipt = authority.store.recordHostGitRevision({
  id: "late-operation",
  task_id: "recovery-task",
  run_id: "late-run",
  workspace_id: "late-workspace",
  capability_id: capability.id,
  kind: "checkpoint",
  prior_revision: authoritativeRevision,
  new_revision: lateRevision,
});
assert(
  lateReceipt.lateEvidence
    && lateReceipt.candidate.state === "pending"
    && authority.store.getTask("recovery-task").revision === authoritativeRevision,
  "post-fence checkpoint was not quarantined away from task authority",
);

authority.store.settleExecution({
  executionId: acceptedExecution.id,
  state: "failed",
  failureClass: "owner_stop",
  failure: { boundary: "checkpoint-after-intent" },
});
const candidate = authority.store.recoveryCandidate(lateReceipt.candidate.id);
const acceptedCandidate = authority.store.resolveRecoveryCandidate({
  candidateId: candidate.id,
  action: "accept",
  expectedVersion: candidate.version,
  reason: "verified fixture checkpoint",
  idempotencyKey: "accept-late-candidate",
});
assert(
  acceptedCandidate.task.revision === lateRevision
    && acceptedCandidate.task.validation_passed === false
    && acceptedCandidate.task.requested_review_revision === lateRevision,
  "candidate acceptance did not advance revision while requiring fresh gates",
);

const secondCandidate = authority.store.createRecoveryCandidate({
  executionId: acceptedExecution.id,
  revision: "3333333333333333333333333333333333333333",
  baseRevision: lateRevision,
  evidence: { fixture: "reject" },
  proof: { eligible: true },
  eligible: true,
}).candidate;
const rejected = authority.store.resolveRecoveryCandidate({
  candidateId: secondCandidate.id,
  action: "reject",
  expectedVersion: secondCandidate.version,
  reason: "fixture rejection",
  idempotencyKey: "reject-late-candidate",
});
assert(
  rejected.candidate.state === "rejected"
    && authority.store.getTask("recovery-task").revision === lateRevision,
  "candidate rejection changed authoritative task state",
);

const timeoutTask = authority.store.createOwnerTask({
  projectId: "recovery-project",
  title: "Preserve an authoritative checkpoint after timeout",
  acceptanceCriteria: ["A proven checkpoint remains owner-recoverable."],
  revision: authoritativeRevision,
  idempotencyKey: "timeout-task-create",
}).task;
const timeoutScheduled = authority.store.scheduleOwnerTaskRun({
  taskId: timeoutTask.id,
  phase: "implementation",
  idempotencyKey: "timeout-task-schedule",
  modelRoute: {
    provider: "boss-man-phase0",
    model: "complete",
    thinking: "medium",
    billingClass: "local",
  },
});
const timeoutCommand = authority.store.claimOrchestratorCommand(registration.token);
assert(timeoutCommand.id === timeoutScheduled.command.id, "timeout fixture command was not claimed");
const timeoutExecution = authority.store.acceptCommandExecution({
  token: registration.token,
  commandId: timeoutCommand.id,
  idempotencyKey: `execute-command:${timeoutCommand.id}`,
}).execution;
authority.store.recordWorkspace({
  id: "timeout-workspace",
  taskId: timeoutTask.id,
  runId: "timeout-run",
  repositoryPath: fixture,
  workspacePath: join(root, "timeout-workspace"),
  branch: "pink-guy/timeout-checkpoint",
  baseRevision: authoritativeRevision,
  gitMarkerSha256: "timeout-marker",
});
authority.store.bindExecutionResources({
  executionId: timeoutExecution.id,
  generation: timeoutExecution.generation,
  runId: "timeout-run",
  sessionId: "timeout-session",
  workspaceId: "timeout-workspace",
});
const timeoutCapability = authority.store.issueCapability({
  role: "worker",
  actorId: authority.store.getTask(timeoutTask.id).assigned_worker,
  taskId: timeoutTask.id,
  runId: "timeout-run",
  executionId: timeoutExecution.id,
  executionGeneration: timeoutExecution.generation,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const timeoutRevision = "4444444444444444444444444444444444444444";
authority.store.database.prepare(`INSERT INTO git_operations(
  id,workspace_id,task_id,run_id,capability_id,kind,idempotency_key,request_sha256,
  prior_revision,new_revision,status,metadata_json,created_at
) VALUES(?,?,?,?,?,'checkpoint',?,?,?,?, 'committed','{}',?)`).run(
  "timeout-operation",
  "timeout-workspace",
  timeoutTask.id,
  "timeout-run",
  timeoutCapability.id,
  "timeout-checkpoint",
  "timeout-request",
  authoritativeRevision,
  timeoutRevision,
  new Date().toISOString(),
);
authority.store.recordHostGitRevision({
  id: "timeout-operation",
  task_id: timeoutTask.id,
  run_id: "timeout-run",
  workspace_id: "timeout-workspace",
  capability_id: timeoutCapability.id,
  kind: "checkpoint",
  prior_revision: authoritativeRevision,
  new_revision: timeoutRevision,
});
const timeoutBeforeFence = authority.store.commandExecution(timeoutExecution.id);
authority.store.fenceExecution({
  executionId: timeoutExecution.id,
  expectedVersion: timeoutBeforeFence.version,
  reason: "hard deadline after checkpoint",
  failureClass: "hard_deadline",
});
const timeoutRecovery = authority.store.checkpointRecoveryAfterTimeout(timeoutExecution.id);
assert(
  timeoutRecovery?.candidate.state === "pending"
    && timeoutRecovery.candidate.revision === timeoutRevision
    && timeoutRecovery.candidate.base_revision === timeoutRevision
    && timeoutRecovery.candidate.proof.checkpointAlreadyAuthoritative,
  "timeout did not project the already-authoritative checkpoint for owner recovery",
);
authority.store.settleExecution({
  executionId: timeoutExecution.id,
  state: "reconciliation_required",
  failureClass: "side_effect_uncertain",
  failure: { trigger: "hard_deadline" },
});
const acceptedTimeout = authority.store.resolveRecoveryCandidate({
  candidateId: timeoutRecovery.candidate.id,
  action: "accept",
  expectedVersion: timeoutRecovery.candidate.version,
  reason: "continue the fixed timeout checkpoint through fresh gates",
  idempotencyKey: "accept-timeout-checkpoint",
});
assert(
  acceptedTimeout.task.revision === timeoutRevision
    && acceptedTimeout.task.status === "review"
    && acceptedTimeout.task.requested_review_revision === timeoutRevision,
  "accepting an already-authoritative timeout checkpoint did not require fresh gates",
);

const attention = await request("/api/recovery/attention");
assert(
  attention.status === 200
    && attention.value.attention.some((item) =>
      item.execution.id === acceptedExecution.id
      && item.execution.state === "failed"
      && item.recovery_candidates.length === 2
    ),
  "shared recovery attention projection omitted execution evidence",
);

releaseLaunch();
await authority.close();

const restart = new DirectControlPlane({
  databasePath: join(root, "restart", "boss-man.sqlite"),
  stateRoot: join(root, "restart"),
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
restart.seed({
  projectId: "restart-project",
  taskId: "restart-task",
  repositoryPath: fixture,
  title: "Restart at accepted-before-run",
});
const restartLease = restart.store.registerProjectOrchestrator({
  projectId: "restart-project",
  endpoint: "pid:restart-probe",
  leaseSeconds: 90,
});
restart.store.scheduleOwnerTaskRun({
  taskId: "restart-task",
  phase: "implementation",
  idempotencyKey: "restart-schedule",
  modelRoute: {
    provider: "boss-man-phase0",
    model: "complete",
    thinking: "medium",
    billingClass: "local",
  },
});
const restartCommand = restart.store.claimOrchestratorCommand(restartLease.token);
const restartExecution = restart.store.acceptCommandExecution({
  token: restartLease.token,
  commandId: restartCommand.id,
  idempotencyKey: `execute-command:${restartCommand.id}`,
}).execution;
let staleActionRejected = false;
try {
  restart.store.recordExecutionAction({
    executionId: restartExecution.id,
    action: "stop",
    expectedVersion: restartExecution.version + 1,
    reason: "stale owner action probe",
    idempotencyKey: "stale-owner-action",
    result: { requestedState: "failed" },
  });
} catch (error) {
  staleActionRejected = error.code === "version_conflict";
}
assert(
  staleActionRejected
    && !restart.store.executionActionReceipt("stale-owner-action")
    && restart.store.commandExecution(restartExecution.id).state === "starting",
  "failed owner action left a receipt or mutation behind",
);
restart.store.close();

const recovered = new DirectControlPlane({
  databasePath: join(root, "restart", "boss-man.sqlite"),
  stateRoot: join(root, "restart"),
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
await recovered.listen();
const afterRestart = recovered.store.commandExecution(restartExecution.id);
assert(
  afterRestart.state === "failed"
    && afterRestart.failure_class === "control_plane_restart"
    && recovered.store.orchestratorCommand(restartCommand.id).state === "failed",
  "accepted-before-run restart boundary was replayed or left nonterminal",
);
await recovered.close();

process.stdout.write(`${JSON.stringify({
  status: "pass",
  accepted_execution_identity: acceptedExecution.id,
  concurrent_acceptance_singleton: true,
  observer_disconnect_not_authoritative: true,
  durable_generation_fence: true,
  late_checkpoint_quarantined: lateReceipt.candidate.id,
  candidate_accept_requires_fresh_gates: true,
  candidate_rejection_retains_evidence: true,
  timeout_checkpoint_recoverable: true,
  owner_action_receipt_atomic: true,
  restart_automatic_replay: false,
  attention_projection: true,
  provider_requests: 0,
  task_containers_started: 0,
  isolated_root: root,
}, null, 2)}\n`);
