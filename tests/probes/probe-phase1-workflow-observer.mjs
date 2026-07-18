#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { HostGitService } from "../../src/server/git-service.mjs";
import { Phase0Store } from "../../src/server/store.mjs";

const execFileAsync = promisify(execFile);
const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-workflow-observer.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-workflow-observer-"));
const store = new Phase0Store(join(root, "boss-man.sqlite"));
const { stdout: revisionOutput } = await execFileAsync("git", ["-C", fixture, "rev-parse", "HEAD"]);
const initialRevision = revisionOutput.trim();
store.seedProjectTask({
  projectId: "observer-project",
  repositoryId: "observer-repository",
  projectName: "Workflow observer",
  taskId: "observer-task",
  repositoryPath: fixture,
  title: "Exercise fixed-revision phase custody",
  revision: initialRevision,
  acceptanceCriteria: ["Create an observable implementation artifact", "Validate and review one fixed revision"],
});
const registration = store.registerProjectOrchestrator({
  projectId: "observer-project",
  endpoint: "pid:model-less-observer",
  leaseSeconds: 300,
});
const git = new HostGitService({
  store,
  repositoryPath: fixture,
  workspaceRoot: join(root, "workspaces"),
});
const timeline = [];
const observe = (phase, state, detail) => {
  const item = { phase, state, detail };
  timeline.push(item);
  process.stdout.write(`[workflow] ${phase.padEnd(14)} ${state.padEnd(12)} ${detail}\n`);
};

async function startObservedRun(phase, sequence) {
  const scheduled = store.scheduleOwnerTaskRun({
    taskId: "observer-task",
    phase,
    idempotencyKey: `observer-schedule-${phase}`,
    modelRoute: {
      provider: "model-less",
      model: "workflow-observer",
      thinking: "off",
      billingClass: "local",
      policySource: "workflow_observer",
    },
  });
  const command = store.claimOrchestratorCommand(registration.token);
  assert(command?.id === scheduled.command.id, `${phase} command was not claimed`);
  const runId = `observer-run-${sequence}-${phase}`;
  const sessionId = `observer-session-${sequence}-${phase}`;
  const workspace = await git.createWorkspace({ taskId: "observer-task", runId });
  await mkdir(join(root, "sessions"), { recursive: true });
  store.createSession({
    id: sessionId,
    taskId: "observer-task",
    nativePath: join(root, "sessions", `${sessionId}.jsonl`),
    provider: "model-less",
    model: "workflow-observer",
  });
  const run = store.createRun({
    id: runId,
    sessionId,
    workspaceId: workspace.id,
    phase,
    promptProfileKey: phase,
    promptProfileVersion: 1,
    promptSha256: `observer-${phase}`,
    modelProvider: "model-less",
    modelId: "workflow-observer",
    thinkingLevel: "off",
    modelPolicySource: "workflow_observer",
    billingClass: "local",
  });
  observe(phase, "running", `command=${command.id} run=${run.id} base=${workspace.base_revision.slice(0, 12)}`);
  return { command, run, sessionId, workspace };
}

function finishObservedRun(observed, result) {
  store.finishRun(observed.run.id, "stopped");
  store.completeOrchestratorCommand({
    token: registration.token,
    commandId: observed.command.id,
    state: "succeeded",
    result,
  });
  observe(observed.run.phase, "succeeded", result);
}

const implementation = await startObservedRun("implementation", 1);
const implementationTask = store.getTask("observer-task");
const implementer = store.issueCapability({
  role: "worker",
  actorId: implementationTask.assigned_worker,
  taskId: "observer-task",
  runId: implementation.run.id,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
await appendFile(join(implementation.workspace.workspace_path, "workflow-observer.txt"), "fixed revision evidence\n");
const checkpoint = await git.checkpoint({
  workspace: implementation.workspace,
  capability: implementer,
  kind: "checkpoint",
  idempotencyKey: "observer-checkpoint",
  message: "test: add workflow observer evidence",
  evidence: ["model-less baseline"],
});
const checkpointRevision = checkpoint.operation.new_revision;
observe("checkpoint", "recorded", `${initialRevision.slice(0, 12)} -> ${checkpointRevision.slice(0, 12)}`);
let task = store.getTask("observer-task");
store.actOnTask({
  token: implementer.token,
  taskId: task.id,
  action: "request_review",
  idempotencyKey: "observer-request-review",
  expectedVersion: task.version,
  payload: { revision: checkpointRevision },
});
finishObservedRun(implementation, `revision=${checkpointRevision.slice(0, 12)}`);

const testRun = await startObservedRun("test", 2);
assert(testRun.workspace.base_revision === checkpointRevision, "test worktree did not use the fixed checkpoint");
const validator = store.issueCapability({
  role: "validator",
  actorId: `task-agent:test:${testRun.run.id}`,
  taskId: "observer-task",
  runId: testRun.run.id,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
task = store.getTask("observer-task");
store.actOnTask({
  token: validator.token,
  taskId: task.id,
  action: "record_validation",
  idempotencyKey: "observer-validation",
  expectedVersion: task.version,
  payload: {
    revision: checkpointRevision,
    status: "passed",
    evidence: ["model-less observer verified fixed-base worktree"],
  },
});
finishObservedRun(testRun, `validation=passed revision=${checkpointRevision.slice(0, 12)}`);

const reviewRun = await startObservedRun("review", 3);
assert(reviewRun.workspace.base_revision === checkpointRevision, "review worktree did not use the fixed checkpoint");
const reviewer = store.issueCapability({
  role: "reviewer",
  actorId: `task-agent:review:${reviewRun.run.id}`,
  taskId: "observer-task",
  runId: reviewRun.run.id,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
task = store.getTask("observer-task");
store.actOnTask({
  token: reviewer.token,
  taskId: task.id,
  action: "submit_review",
  idempotencyKey: "observer-review",
  expectedVersion: task.version,
  payload: {
    revision: checkpointRevision,
    disposition: "approve",
    findings: [],
  },
});
finishObservedRun(reviewRun, `review=approve revision=${checkpointRevision.slice(0, 12)}`);

const owner = store.issueCapability({
  role: "orchestrator",
  actorId: `project-orchestrator:${registration.id}`,
  taskId: "observer-task",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
task = store.getTask("observer-task");
const completed = store.actOnTask({
  token: owner.token,
  taskId: task.id,
  action: "complete",
  idempotencyKey: "observer-complete",
  expectedVersion: task.version,
});
observe("completion", "done", `merge-requested revision=${checkpointRevision.slice(0, 12)}`);

const projection = store.taskWorkspaceProjection("observer-task");
assert(completed.task.status === "done", "completion gates did not admit the validated approved revision");
assert(projection.runs.length === 3, "inspector projection did not retain all phase runs");
assert(projection.task.validations[0]?.revision === checkpointRevision, "validation lost revision identity");
assert(projection.task.reviews[0]?.reviewer_id !== implementationTask.assigned_worker, "review was not independent");
assert(projection.task.merge_requests[0]?.revision === checkpointRevision, "completion did not retain merge-request custody");

const result = {
  status: "pass",
  provider_requests: 0,
  initial_revision: initialRevision,
  checkpoint_revision: checkpointRevision,
  phases: projection.runs.map((run) => run.phase),
  final_status: completed.task.status,
  validation: projection.task.validations[0].status,
  review: projection.task.reviews[0].disposition,
  merge_request: projection.task.merge_requests[0].status,
  timeline,
  isolated_root: root,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
store.close();
