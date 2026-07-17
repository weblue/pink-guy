#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../direct/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-orchestrator-conversations.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-conversations-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
  runtimeThinking: "high",
});
authority.seed({
  projectId: "conversation-project",
  repositoryId: "conversation-repository",
  projectName: "Conversation project",
  taskId: "conversation-existing-task",
  repositoryPath: fixture,
  title: "Existing task",
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

const created = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "topic-new-project",
  body: {
    title: "Prototype an observability tool",
    ownerDescription: "Explore before creating a repository.",
  },
});
assert(created.status === 201, "unbound topic creation failed");
const topicId = created.value.topic.id;
const conversationId = created.value.conversation.id;
assert(
  created.value.topic.project_id === null
    && created.value.conversation.scope_type === "system_intake"
    && created.value.conversation.scope_id === "system-intake",
  "unbound topic did not receive system-intake scope",
);
assert(
  created.value.conversation.model_provider === "openai"
    && created.value.conversation.model_id === "gpt-test"
    && created.value.conversation.thinking_level === "high"
    && created.value.conversation.model_policy.source === "control_plane_default",
  "centrally assigned model policy was not persisted",
);

const createReplay = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "topic-new-project",
  body: {
    title: "Prototype an observability tool",
    ownerDescription: "Explore before creating a repository.",
  },
});
assert(
  createReplay.status === 200
    && createReplay.value.replayed
    && createReplay.value.topic.id === topicId
    && createReplay.value.conversation.id === conversationId,
  "topic creation retry duplicated durable identity",
);
const createConflict = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "topic-new-project",
  body: { title: "Different topic" },
});
assert(createConflict.status === 409, "topic idempotency mismatch was accepted");

const bound = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "topic-existing-project",
  body: {
    title: "Maintenance ticket",
    projectId: "conversation-project",
    modelProvider: "google",
    modelId: "gemini-test",
    thinkingLevel: "low",
    billingClass: "api",
  },
});
assert(
  bound.status === 201
    && bound.value.conversation.scope_type === "project"
    && bound.value.conversation.scope_id === "conversation-project"
    && bound.value.conversation.model_provider === "google"
    && bound.value.conversation.model_id === "gemini-test",
  "bound topic scope or explicit model assignment is invalid",
);

const first = await request(`/api/conversations/${conversationId}/turns`, {
  method: "POST",
  idempotencyKey: "turn-one",
  body: { message: "Help me turn this idea into a concrete task graph." },
});
const second = await request(`/api/conversations/${conversationId}/turns`, {
  method: "POST",
  idempotencyKey: "turn-two",
  body: { message: "Keep the first prototype local-only." },
});
assert(
  first.status === 201
    && second.status === 201
    && first.value.turn.sequence === 1
    && second.value.turn.sequence === 2
    && first.value.turn.state === "queued"
    && second.value.turn.state === "queued",
  "owner turns were not durably ordered",
);
const turnReplay = await request(`/api/conversations/${conversationId}/turns`, {
  method: "POST",
  idempotencyKey: "turn-one",
  body: { message: "Help me turn this idea into a concrete task graph." },
});
assert(
  turnReplay.status === 200 && turnReplay.value.replayed && turnReplay.value.turn.id === first.value.turn.id,
  "owner turn retry duplicated the turn",
);

const projectLease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "project",
    scopeId: "conversation-project",
    transport: "daemon",
    endpoint: "pid:project-conversation",
  },
});
assert(projectLease.status === 201, "project conversation lease registration failed");
const projectCannotClaimIntake = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: projectLease.value.token,
  body: {},
});
assert(projectCannotClaimIntake.status === 204, "project lease claimed an unbound intake turn");

const intakeLease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "system_intake",
    transport: "daemon",
    endpoint: "pid:system-intake",
  },
});
assert(intakeLease.status === 201, "system-intake lease registration failed");
const duplicateLease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "system_intake",
    transport: "daemon",
    endpoint: "pid:competing-intake",
  },
});
assert(duplicateLease.status === 409, "competing system-intake lease was accepted");

const claimedFirst = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: intakeLease.value.token,
  body: {},
});
assert(
  claimedFirst.status === 200
    && claimedFirst.value.turn.id === first.value.turn.id
    && claimedFirst.value.turn.state === "running",
  "system-intake lease did not claim the first queued turn",
);
const concurrentSameConversation = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: intakeLease.value.token,
  body: {},
});
assert(
  concurrentSameConversation.status === 204,
  "a second turn raced the active turn in the same conversation",
);
const completedFirst = await request(`/api/orchestration/turns/${first.value.turn.id}/complete`, {
  method: "POST",
  token: intakeLease.value.token,
  body: {
    state: "completed",
    result: { summary: "Created a bounded draft task graph.", taskMutations: [] },
  },
});
assert(
  completedFirst.status === 200 && completedFirst.value.turn.state === "completed",
  "claimed conversation turn did not complete",
);
const claimedSecond = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: intakeLease.value.token,
  body: {},
});
assert(
  claimedSecond.status === 200 && claimedSecond.value.turn.id === second.value.turn.id,
  "conversation queue did not preserve turn order",
);

const release = await request("/api/orchestration/leases/current", {
  method: "DELETE",
  token: intakeLease.value.token,
});
assert(release.status === 200 && release.value.lease.status === "released", "lease release failed");
const turnsAfterRelease = await request(`/api/conversations/${conversationId}/turns`);
const reconciled = turnsAfterRelease.value.turns.find((turn) => turn.id === second.value.turn.id);
assert(
  reconciled.state === "reconciliation_required"
    && reconciled.result.reason === "orchestrator_lease_released"
    && reconciled.result.automaticReplay === false,
  "in-flight turn was replayable or not reconciled after lease loss",
);

const eventPage = await request(`/api/conversations/${conversationId}/events?after=1`);
assert(
  eventPage.status === 200
    && eventPage.value.events.length >= 5
    && eventPage.value.events.every((event) => event.sequence > 1),
  "conversation event cursor did not preserve ordered reconnect history",
);

const archived = await request(`/api/topics/${bound.value.topic.id}/archive`, {
  method: "POST",
  idempotencyKey: "archive-bound-topic",
  body: {},
});
assert(archived.status === 201 && archived.value.topic.state === "archived", "topic archival failed");
const rejectedArchivedTurn = await request(`/api/conversations/${bound.value.conversation.id}/turns`, {
  method: "POST",
  idempotencyKey: "archived-turn",
  body: { message: "This must not be accepted." },
});
assert(rejectedArchivedTurn.status === 409, "archived topic accepted a new conversation turn");

const topicList = await request("/api/topics");
assert(
  topicList.status === 200
    && topicList.value.topics.some((topic) => topic.id === topicId)
    && topicList.value.topics.every((topic) => topic.id !== bound.value.topic.id),
  "active topic projection did not exclude archived topics",
);

const result = {
  status: "pass",
  first_class_topics: true,
  system_intake_scope: true,
  project_scope: true,
  centrally_assigned_model_policy: true,
  topic_idempotency: true,
  ordered_owner_turns: [1, 2],
  scoped_lease_claims: true,
  one_active_lease_per_scope: true,
  reconnect_event_cursor: true,
  lease_loss_state: reconciled.state,
  automatic_replay: reconciled.result.automaticReplay,
  archived_turn_rejected: true,
  provider_requests: 0,
  task_containers_started: 0,
  isolated_root: root,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await authority.close();
