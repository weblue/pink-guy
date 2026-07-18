#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-local-task-controls.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-task-controls-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
authority.seed({
  projectId: "controls-project",
  repositoryId: "controls-repository",
  projectName: "Controls project",
  taskId: "controls-intake",
  repositoryPath: fixture,
  title: "Existing intake task",
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
  const value = await response.json();
  return { status: response.status, value };
}

const html = await fetch(base).then((response) => response.text());
assert(
  html.includes('id="create-task"')
    && html.includes("data-schedule")
    && html.includes("Phase timeline and workspaces")
    && html.includes("/workspace")
    && !html.includes("chat input"),
  "task-first local controls are absent or chat-first UI returned",
);
const invalidCreate = await request("/api/projects/controls-project/tasks", {
  method: "POST",
  idempotencyKey: "controls-invalid-create",
  body: { title: "   ", acceptanceCriteria: [] },
});
assert(invalidCreate.status === 400, "empty task title was accepted");

const createBody = {
  title: "Build local task controls",
  acceptanceCriteria: ["Create from the cockpit", "Schedule one explicit phase"],
};
const created = await request("/api/projects/controls-project/tasks", {
  method: "POST",
  idempotencyKey: "controls-create",
  body: createBody,
});
assert(created.status === 201 && created.value.task.status === "ready", "owner task was not created ready");
const taskId = created.value.task.id;
const head = execFileSync("git", ["-C", fixture, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert(created.value.task.revision === head, "task revision was not derived from repository HEAD");
assert(
  JSON.stringify(created.value.task.acceptance_criteria) === JSON.stringify(createBody.acceptanceCriteria),
  "acceptance criteria changed during task creation",
);
const createReplay = await request("/api/projects/controls-project/tasks", {
  method: "POST",
  idempotencyKey: "controls-create",
  body: createBody,
});
assert(
  createReplay.status === 200 && createReplay.value.replayed && createReplay.value.task.id === taskId,
  "task creation retry duplicated the task",
);
const replayAfterRevisionAdvance = authority.store.createOwnerTask({
  projectId: "controls-project",
  title: createBody.title,
  acceptanceCriteria: createBody.acceptanceCriteria,
  revision: "simulated-new-head",
  idempotencyKey: "controls-create",
});
assert(
  replayAfterRevisionAdvance.replayed && replayAfterRevisionAdvance.task.id === taskId,
  "task creation retry depended on a later repository revision",
);
const createConflict = await request("/api/projects/controls-project/tasks", {
  method: "POST",
  idempotencyKey: "controls-create",
  body: { ...createBody, title: "Different task" },
});
assert(createConflict.status === 409, "task creation idempotency mismatch was accepted");

const ownerDetail = await request(`/api/tasks/${taskId}`);
assert(
  ownerDetail.status === 200 && ownerDetail.value.id === taskId,
  "loopback owner could not inspect authoritative task detail",
);
const edited = await request(`/api/tasks/${taskId}`, {
  method: "PUT",
  idempotencyKey: "controls-edit",
  body: {
    title: "Build useful local task controls",
    description: "Expose description, acceptance, decisions, and activity without internal APIs.",
    acceptanceCriteria: [...createBody.acceptanceCriteria, "Edit and resolve from task detail"],
    expectedVersion: 1,
  },
});
assert(
  edited.status === 201
    && edited.value.task.version === 2
    && edited.value.task.description.includes("description, acceptance")
    && edited.value.task.activity.some((event) => event.type === "task_updated"),
  "owner task-detail edit did not preserve versioned activity",
);
const decision = await request(`/api/tasks/${taskId}/actions/add_decision_gate`, {
  method: "POST",
  idempotencyKey: "controls-decision",
  body: {
    expectedVersion: 2,
    payload: {
      id: "controls-decision-gate",
      category: "architecture",
      question: "Keep the first task inspector dependency-free?",
    },
  },
});
const resolved = await request(`/api/tasks/${taskId}/actions/resolve_decision`, {
  method: "POST",
  idempotencyKey: "controls-decision-resolve",
  body: {
    expectedVersion: 3,
    payload: { id: "controls-decision-gate", resolution: "Yes, use the existing cockpit." },
  },
});
assert(
  decision.status === 201
    && resolved.status === 201
    && resolved.value.task.version === 4
    && resolved.value.task.decision_gates[0].status === "resolved",
  "loopback owner could not resolve a protected decision through task detail controls",
);

const noOrchestrator = await request(`/api/tasks/${taskId}/schedule`, {
  method: "POST",
  idempotencyKey: "controls-no-orchestrator",
  body: { phase: "implementation" },
});
assert(noOrchestrator.status === 409, "task scheduled without an active project orchestrator");
assert(
  authority.store.getTask(taskId).status === "ready"
    && authority.store.getTask(taskId).version === 4
    && authority.store.orchestratorCommands({ projectId: "controls-project" }).length === 0,
  "failed scheduling partially mutated task or command state",
);

const registration = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "controls-project",
    transport: "daemon",
    endpoint: "pid:controls",
    leaseSeconds: 90,
  },
});
assert(registration.status === 201, "project orchestrator registration failed");
const workspaceInspector = await request(`/api/tasks/${taskId}/workspace`);
assert(
  workspaceInspector.status === 200
    && workspaceInspector.value.allowed_phases.join(",") === "implementation"
    && workspaceInspector.value.task.id === taskId
    && Array.isArray(workspaceInspector.value.runs),
  "owner workspace inspector did not expose authoritative phase controls",
);
const invalidPhase = await request(`/api/tasks/${taskId}/schedule`, {
  method: "POST",
  idempotencyKey: "controls-invalid-phase",
  body: { phase: "unscoped" },
});
assert(invalidPhase.status === 400 && authority.store.getTask(taskId).status === "ready", "invalid phase changed task state");

const scheduled = await request(`/api/tasks/${taskId}/schedule`, {
  method: "POST",
  idempotencyKey: "controls-schedule",
  body: { phase: "implementation" },
});
assert(
  scheduled.status === 201
    && scheduled.value.task.status === "in_progress"
    && scheduled.value.task.version === 5
    && scheduled.value.task.assigned_worker.startsWith("task-agent:implementation:")
    && scheduled.value.command.state === "queued"
    && scheduled.value.command.phase === "implementation",
  "atomic task scheduling result is invalid",
);
const claimed = await request("/api/orchestrators/commands/claim", {
  method: "POST",
  token: registration.value.token,
  body: {},
});
assert(
  claimed.status === 200 && claimed.value.command.id === scheduled.value.command.id,
  "scheduled command was not consumable by the project orchestrator",
);
const scheduleReplay = await request(`/api/tasks/${taskId}/schedule`, {
  method: "POST",
  idempotencyKey: "controls-schedule",
  body: { phase: "implementation" },
});
assert(
  scheduleReplay.status === 200
    && scheduleReplay.value.replayed
    && scheduleReplay.value.task.version === 5
    && scheduleReplay.value.command.id === scheduled.value.command.id,
  "scheduling retry duplicated task transition or command",
);
const scheduleConflict = await request(`/api/tasks/${taskId}/schedule`, {
  method: "POST",
  idempotencyKey: "controls-schedule",
  body: { phase: "review" },
});
assert(scheduleConflict.status === 409, "scheduling idempotency mismatch was accepted");
const auditTypes = authority.store.taskAudit(taskId).map((event) => event.type);
assert(
  auditTypes.join(",") === "task_created,task_updated,decision_required,decision_resolved,task_scheduled",
  `owner mutation audit is incomplete: ${auditTypes.join(",")}`,
);

let preListenDenied = false;
const guarded = new DirectControlPlane({
  databasePath: join(root, "guarded.sqlite"),
  stateRoot: join(root, "guarded"),
  fixturePath: fixture,
});
try {
  guarded.assertLocalOwnerProfile();
} catch (error) {
  preListenDenied = error.code === "local_operator_denied";
}
assert(preListenDenied, "owner mutations were enabled without selecting a loopback profile");
guarded.store.close();

const result = {
  status: "pass",
  task_creation: true,
  current_revision_server_derived: true,
  acceptance_criteria_preserved: true,
  task_detail_editing: true,
  owner_decision_resolution: true,
  create_idempotency: true,
  no_orchestrator_atomic_rollback: true,
  phase_scoped_schedule: "implementation",
  schedule_idempotency: true,
  task_and_command_atomic: true,
  owner_audit_events: auditTypes,
  local_profile_guard: true,
  provider_requests: 0,
  task_containers_started: 0,
  isolated_root: root,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await authority.close();
