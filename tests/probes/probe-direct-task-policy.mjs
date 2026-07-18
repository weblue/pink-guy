#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-direct-task-policy.mjs /absolute/path/to/generated/fixture");
  process.exit(64);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-direct-task-policy-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: join(root, "runtime"),
  fixturePath: fixture,
});
authority.seed();
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;
const expiresAt = "2099-01-01T00:00:00.000Z";

const capabilities = {
  worker: authority.store.issueCapability({ role: "worker", actorId: "worker-a", taskId: "phase0-task", runId: "run-worker", expiresAt }),
  unrelated: authority.store.issueCapability({ role: "worker", actorId: "worker-b", taskId: "phase0-task", runId: "run-unrelated", expiresAt }),
  reviewer: authority.store.issueCapability({ role: "reviewer", actorId: "reviewer-a", taskId: "phase0-task", runId: "run-reviewer", expiresAt }),
  selfReviewer: authority.store.issueCapability({ role: "reviewer", actorId: "worker-a", taskId: "phase0-task", runId: "run-self-review", expiresAt }),
  orchestrator: authority.store.issueCapability({ role: "orchestrator", actorId: "orchestrator", taskId: "phase0-task", runId: "run-orchestrator", expiresAt }),
  owner: authority.store.issueCapability({ role: "owner", actorId: "owner", taskId: "phase0-task", runId: "run-owner", expiresAt }),
};

async function request(path, { method = "GET", token, key, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, value: await response.json() };
}

async function task() {
  const response = await request("/api/tasks/phase0-task", { token: capabilities.worker.token });
  assert(response.status === 200, "task detail is unavailable");
  return response.value;
}

async function act(capability, action, payload, key, expectedVersion) {
  const currentVersion = expectedVersion ?? (await task()).version;
  return request(`/api/tasks/phase0-task/actions/${action}`, {
    method: "POST",
    token: capability.token,
    key,
    body: { expectedVersion: currentVersion, payload },
  });
}

const preClaimProgress = await act(capabilities.worker, "progress", { text: "must not commit" }, "pre-claim-progress", 1);
assert(preClaimProgress.status === 403, "worker mutated an unassigned task before claiming it");
let response = await act(capabilities.worker, "claim", {}, "claim-once");
assert(response.status === 201 && response.value.task.assigned_worker === "worker-a", "assigned worker claim failed");
const unauthenticatedRead = await request("/api/tasks/phase0-task");
assert(unauthenticatedRead.status === 403, "task detail was readable without a scoped capability");
const claimReplay = await act(capabilities.worker, "claim", {}, "claim-once", 1);
assert(claimReplay.status === 200 && claimReplay.value.replayed, "claim idempotency replay failed");

response = await act(capabilities.worker, "progress", { text: "first revision implemented" }, "progress-1");
assert(response.status === 201, "assigned worker progress failed");
const competingVersion = response.value.task.version;
const competing = await Promise.all([
  act(capabilities.worker, "progress", { text: "competing writer a" }, "competing-a", competingVersion),
  act(capabilities.worker, "progress", { text: "competing writer b" }, "competing-b", competingVersion),
]);
assert(competing.map((item) => item.status).sort().join(",") === "201,409", "competing writers did not produce exactly one commit and one conflict");
response = await act(capabilities.worker, "create_child", { id: "phase0-child", title: "Scoped follow-up" }, "child-1");
assert(response.status === 201 && response.value.task.children[0].id === "phase0-child", "scoped child creation failed");

const unrelated = await act(capabilities.unrelated, "progress", { text: "unauthorized" }, "unrelated-progress");
assert(unrelated.status === 403 && unrelated.value.error === "capability_denied", "unassigned worker was not rejected");

response = await act(capabilities.worker, "request_review", { revision: "fixture-revision-1" }, "review-request-1");
assert(response.status === 201 && response.value.task.status === "review", "first review request failed");
const selfReview = await act(capabilities.selfReviewer, "submit_review", {
  revision: "fixture-revision-1", disposition: "approve", findings: [],
}, "self-review");
assert(selfReview.status === 403 && selfReview.value.error === "self_approval_denied", "self-review was not rejected");
response = await act(capabilities.reviewer, "submit_review", {
  revision: "fixture-revision-1", disposition: "request_changes", findings: ["add regression coverage"],
}, "review-changes-1");
assert(response.status === 201 && response.value.task.status === "in_progress", "review change request failed");

response = await act(capabilities.orchestrator, "set_revision", { revision: "fixture-revision-2" }, "revision-2");
assert(response.status === 201 && !response.value.task.validation_passed, "revision update did not invalidate validation");
response = await act(capabilities.orchestrator, "record_validation", {
  revision: "fixture-revision-2", status: "passed", evidence: [{ command: "node --test", exitCode: 0 }],
}, "validation-2");
assert(response.status === 201 && response.value.task.validation_passed, "fixed-revision validation failed");
response = await act(capabilities.worker, "request_review", { revision: "fixture-revision-2" }, "review-request-2");
assert(response.status === 201, "second review request failed");
const staleReview = await act(capabilities.reviewer, "submit_review", {
  revision: "fixture-revision-1", disposition: "approve", findings: [],
}, "stale-review");
assert(staleReview.status === 409 && staleReview.value.error === "revision_conflict", "stale review was not rejected");
response = await act(capabilities.reviewer, "submit_review", {
  revision: "fixture-revision-2", disposition: "approve", findings: [],
}, "review-approve-2");
assert(response.status === 201, "independent approval failed");

response = await act(capabilities.orchestrator, "add_decision_gate", {
  id: "foundation-choice", category: "foundation", question: "Select the long-lived foundation",
}, "decision-required");
assert(response.status === 201 && response.value.task.decision_gates[0].status === "decision_required", "decision gate was not persisted");
const blockedCompletion = await act(capabilities.orchestrator, "complete", {}, "complete-blocked");
assert(blockedCompletion.status === 409 && blockedCompletion.value.message.includes("human_decision_required"), "decision gate did not block completion");
const orchestratorResolution = await act(capabilities.orchestrator, "resolve_decision", {
  id: "foundation-choice", resolution: { selected: "invalid" },
}, "invalid-resolution");
assert(orchestratorResolution.status === 403, "orchestrator resolved an owner-only decision");
response = await act(capabilities.owner, "resolve_decision", {
  id: "foundation-choice", resolution: { selected: "direct_pi" },
}, "owner-resolution");
assert(response.status === 201 && response.value.task.decision_gates[0].status === "resolved", "owner decision resolution failed");

const evaluation = authority.store.evaluateCompletion("phase0-task");
assert(evaluation.allowed && evaluation.reviewedRevision === "fixture-revision-2", "completion policy remained blocked");
response = await act(capabilities.orchestrator, "complete", {}, "complete-final");
assert(response.status === 201 && response.value.task.status === "done" && response.value.task.merge_requested, "orchestrator completion/merge request failed");
const completeReplay = await act(capabilities.orchestrator, "complete", {}, "complete-final", response.value.task.version - 1);
assert(completeReplay.status === 200 && completeReplay.value.replayed, "completion replay was duplicated");
const reusedKey = await act(capabilities.owner, "reopen", {}, "complete-final");
assert(reusedKey.status === 409 && reusedKey.value.error === "idempotency_conflict", "idempotency key reuse mismatch was not rejected");

const auditResponse = await request("/api/tasks/phase0-task/audit", { token: capabilities.worker.token });
const audit = auditResponse.value.events;
assert(audit.length === 13, `expected 13 committed audit events, found ${audit.length}`);
assert(audit.every((event, index) => event.sequence === index + 1), "audit sequence is not strictly ordered");
assert(audit.every((event) => event.capability_id && event.actor_id && event.actor_role && event.run_id), "audit provenance is incomplete");
assert(audit.at(-1).type === "task_completed" && audit.at(-1).current.merge_requested, "completion audit event is incomplete");

process.stdout.write(`${JSON.stringify({
  status: "pass",
  task_version: (await task()).version,
  committed_audit_events: audit.length,
  capability_identity_server_derived: true,
  idempotent_replay: true,
  idempotency_key_mismatch_rejected: true,
  optimistic_conflict_rejected: staleReview.status === 409,
  competing_writers_serialized: true,
  unassigned_worker_rejected: unrelated.status === 403,
  self_approval_rejected: selfReview.status === 403,
  fixed_revision_reviewed: evaluation.reviewedRevision,
  owner_only_decision_resolution: orchestratorResolution.status === 403,
  merge_requested_after_all_gates: true,
  isolated_root: root,
}, null, 2)}\n`);

await authority.close();
