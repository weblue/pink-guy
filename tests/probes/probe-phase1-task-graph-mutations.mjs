#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-task-graph-mutations.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-task-graph-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
});
authority.seed({
  projectId: "graph-project",
  repositoryId: "graph-repository",
  projectName: "Graph project",
  taskId: "graph-existing-task",
  repositoryPath: fixture,
  title: "Existing graph task",
});
authority.seed({
  projectId: "other-project",
  repositoryId: "other-repository",
  projectName: "Other project",
  taskId: "other-task",
  repositoryPath: fixture,
  title: "Out-of-scope task",
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
  return {
    status: response.status,
    value: response.status === 204 ? null : await response.json(),
  };
}

const topic = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "graph-topic",
  body: { title: "Refine the task graph", projectId: "graph-project" },
});
assert(topic.status === 201, "bound graph topic creation failed");
const conversationId = topic.value.conversation.id;
const turn = await request(`/api/conversations/${conversationId}/turns`, {
  method: "POST",
  idempotencyKey: "graph-turn",
  body: { message: "Refine this project into an observable task graph." },
});
const lease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "project",
    scopeId: "graph-project",
    transport: "daemon",
    endpoint: "pid:graph-probe",
  },
});
assert(turn.status === 201 && lease.status === 201, "graph turn or lease setup failed");
const claimed = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: lease.value.token,
  body: {},
});
assert(claimed.status === 200 && claimed.value.turn.id === turn.value.turn.id, "graph turn claim failed");

async function mutate(idempotencyKey, body) {
  return request(`/api/orchestration/conversations/${conversationId}/task-mutations`, {
    method: "POST",
    token: lease.value.token,
    idempotencyKey,
    body,
  });
}

const first = await mutate("graph-create-first", {
  operation: "create",
  title: "Implement graph storage",
  acceptanceCriteria: ["Mutations retain exact turn provenance."],
});
const second = await mutate("graph-create-second", {
  operation: "create",
  title: "Verify graph storage",
  acceptanceCriteria: ["Cycle and scope checks are deterministic."],
});
assert(first.status === 201 && second.status === 201, "conversation task setup failed");
const firstId = first.value.task.id;
const secondId = second.value.task.id;

const updated = await mutate("graph-update", {
  operation: "update",
  taskId: firstId,
  expectedVersion: 1,
  title: "Implement audited graph storage",
  acceptanceCriteria: [
    "Every mutation retains exact conversation-turn provenance.",
    "Stale task versions are rejected.",
  ],
});
assert(
  updated.status === 201
    && updated.value.task.version === 2
    && updated.value.task.title === "Implement audited graph storage"
    && updated.value.task.origin.turn_id === turn.value.turn.id,
  "task update did not preserve content, version, and turn provenance",
);

const assumed = await mutate("graph-assumption", {
  operation: "record_assumption",
  taskId: firstId,
  expectedVersion: 2,
  body: "The first release needs only same-project dependencies.",
});
assert(
  assumed.status === 201
    && assumed.value.task.version === 3
    && assumed.value.task.context_items.some(
      (item) => item.kind === "assumption"
        && item.body === "The first release needs only same-project dependencies.",
    ),
  "conversation assumption was not retained on the task",
);

const decision = await mutate("graph-decision", {
  operation: "require_decision",
  taskId: firstId,
  expectedVersion: 3,
  category: "architecture",
  question: "Should task supersession become a first-class state?",
});
assert(
  decision.status === 201
    && decision.value.task.version === 4
    && decision.value.task.decision_gates.some(
      (gate) => gate.category === "architecture" && gate.status === "decision_required",
    )
    && authority.store.evaluateCompletion(firstId).reasons.includes("human_decision_required"),
  "protected decision did not create an unresolved completion gate",
);

const dependency = await mutate("graph-dependency", {
  operation: "add_dependency",
  taskId: firstId,
  expectedVersion: 4,
  dependsOnTaskId: secondId,
});
assert(
  dependency.status === 201
    && dependency.value.task.version === 5
    && dependency.value.task.dependencies.some((item) => item.id === secondId)
    && authority.store.evaluateCompletion(firstId).reasons.includes("unresolved_dependency"),
  "same-project dependency was not persisted",
);
const cycle = await mutate("graph-cycle", {
  operation: "add_dependency",
  taskId: secondId,
  expectedVersion: 1,
  dependsOnTaskId: firstId,
});
assert(cycle.status === 409 && cycle.value.error === "transition_denied", "dependency cycle was accepted");

const split = await mutate("graph-split", {
  operation: "split",
  taskId: firstId,
  expectedVersion: 5,
  title: "Add graph mutation API coverage",
  acceptanceCriteria: ["The model-less probe covers every mutation operation."],
});
assert(
  split.status === 201
    && split.value.task.version === 6
    && split.value.task.task_kind === "umbrella"
    && split.value.childTask.task_kind === "executable"
    && split.value.childTask.parent_task_id === firstId
    && split.value.childTask.origin.parent_task_id === firstId
    && split.value.childTask.origin.turn_id === turn.value.turn.id,
  "task split did not create a provenance-linked child",
);
const splitReplay = await mutate("graph-split", {
  operation: "split",
  taskId: firstId,
  expectedVersion: 5,
  title: "Add graph mutation API coverage",
  acceptanceCriteria: ["The model-less probe covers every mutation operation."],
});
assert(
  splitReplay.status === 200
    && splitReplay.value.replayed
    && splitReplay.value.childTask.id === split.value.childTask.id,
  "split retry duplicated the child task",
);

const crossProject = await mutate("graph-cross-project", {
  operation: "update",
  taskId: "other-task",
  expectedVersion: 1,
  title: "Must not change",
  acceptanceCriteria: ["Must remain outside scope."],
});
assert(
  crossProject.status === 403 && crossProject.value.error === "orchestrator_denied",
  "conversation mutated another project's task",
);

const commandLease = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "graph-project",
    transport: "daemon",
    endpoint: "pid:graph-command-probe",
  },
});
const dependencyBlockedSchedule = await request(`/api/tasks/${firstId}/schedule`, {
  method: "POST",
  idempotencyKey: "graph-schedule-blocked",
  body: { phase: "implementation" },
});
assert(
  commandLease.status === 201
    && dependencyBlockedSchedule.status === 409
    && dependencyBlockedSchedule.value.error === "transition_denied",
  "an unresolved dependency did not block task scheduling",
);

const stale = await mutate("graph-stale", {
  operation: "record_assumption",
  taskId: firstId,
  expectedVersion: 5,
  body: "This stale mutation must not commit.",
});
assert(stale.status === 409 && stale.value.error === "version_conflict", "stale task version was accepted");

const context = await request(`/api/conversations/${conversationId}/context`);
const events = await request(`/api/conversations/${conversationId}/events`);
const operations = events.value.events
  .filter((event) => event.type === "task_mutation_applied")
  .map((event) => event.payload.operation);
assert(
  ["create", "update", "record_assumption", "require_decision", "add_dependency", "split"]
    .every((operation) => operations.includes(operation)),
  "structured conversation change projection omitted a mutation operation",
);
assert(
  context.value.tasks.some((task) => task.id === split.value.childTask.id)
    && context.value.tasks.find((task) => task.id === firstId).children.some(
      (child) => child.id === split.value.childTask.id,
    ),
  "authoritative conversation context did not project the resulting task graph",
);

await request(`/api/orchestration/turns/${turn.value.turn.id}/complete`, {
  method: "POST",
  token: lease.value.token,
  body: { state: "completed", result: { mutationCount: operations.length } },
});
await authority.close();

process.stdout.write(`${JSON.stringify({
  status: "pass",
  operations: [...new Set(operations)],
  optimistic_versioning: true,
  exact_turn_provenance: true,
  split_child_idempotency: true,
  split_parent_classified_umbrella: true,
  same_project_scope: true,
  dependency_cycle_rejected: true,
  unresolved_dependency_blocks_schedule: true,
  protected_decision_gate: true,
  provider_requests: 0,
  task_containers_started: 0,
  isolated_root: root,
}, null, 2)}\n`);
