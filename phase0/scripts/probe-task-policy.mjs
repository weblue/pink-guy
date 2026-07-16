#!/usr/bin/env node

import { TaskPolicy } from "../policy/task-policy.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectCode(action, code) {
  try {
    action();
  } catch (error) {
    assert(error.code === code, `expected ${code}, received ${error.code}: ${error.message}`);
    return error;
  }
  throw new Error(`expected ${code}`);
}

const now = "2026-07-16T23:00:00.000Z";
const policy = new TaskPolicy({ clock: () => now });
const task = policy.createTask({
  id: "phase0-policy-task", title: "Exercise worker and reviewer policy",
  assignedWorker: "worker-a", revision: "revision-1", validationPassed: true,
});
const expiry = "2026-07-17T23:00:00.000Z";
const worker = policy.issueCapability({ role: "worker", actorId: "worker-a", taskId: task.id, runId: "run-worker", expiresAt: expiry });
const unrelatedWorker = policy.issueCapability({ role: "worker", actorId: "worker-b", taskId: task.id, runId: "run-other", expiresAt: expiry });
const reviewer = policy.issueCapability({ role: "reviewer", actorId: "reviewer-a", taskId: task.id, runId: "run-review", expiresAt: expiry });
const selfReviewer = policy.issueCapability({ role: "reviewer", actorId: "worker-a", taskId: task.id, runId: "run-self", expiresAt: expiry });
const orchestrator = policy.issueCapability({ role: "orchestrator", actorId: "orchestrator", taskId: task.id, runId: "run-orchestrator", expiresAt: expiry });
const owner = policy.issueCapability({ role: "owner", actorId: "owner", taskId: task.id, runId: "run-owner", expiresAt: expiry });

policy.act(worker.id, "progress", task.id, { text: "implemented first revision" });
policy.act(worker.id, "create_child", task.id, { id: "phase0-child", title: "Scoped follow-up" });
expectCode(() => policy.act(unrelatedWorker.id, "progress", task.id, { text: "unauthorized" }), "capability_denied");
policy.act(worker.id, "request_review", task.id, { revision: "revision-1" });
expectCode(() => policy.act(selfReviewer.id, "submit_review", task.id, { revision: "revision-1", disposition: "approve" }), "self_approval_denied");
policy.act(reviewer.id, "submit_review", task.id, { revision: "revision-1", disposition: "request_changes", findings: ["add regression coverage"] });

policy.updateRevision(task.id, "revision-2", { validationPassed: true });
policy.act(worker.id, "request_review", task.id, { revision: "revision-2" });
expectCode(() => policy.act(reviewer.id, "submit_review", task.id, { revision: "revision-1", disposition: "approve" }), "revision_conflict");
policy.act(reviewer.id, "submit_review", task.id, { revision: "revision-2", disposition: "approve", findings: [] });

policy.addDecisionGate(task.id, { id: "foundation-choice", category: "foundation", question: "Select the long-lived foundation" });
const blocked = expectCode(() => policy.act(orchestrator.id, "complete", task.id), "completion_blocked");
assert(blocked.reasons.includes("human_decision_required"), "human decision did not block completion");
expectCode(() => policy.act(orchestrator.id, "resolve_decision", task.id, { id: "foundation-choice", resolution: "invalid" }), "capability_denied");
policy.act(owner.id, "resolve_decision", task.id, { id: "foundation-choice", resolution: "owner-selected-candidate" });
const evaluation = policy.evaluateCompletion(task.id);
assert(evaluation.allowed && evaluation.reviewedRevision === "revision-2", "completion remained blocked after valid owner decision");
const completed = policy.act(orchestrator.id, "complete", task.id);
assert(completed.status === "done" && completed.mergeRequested, "orchestrator did not request platform merge");

const reviewEvents = policy.events.filter((event) => event.type === "review_submitted");
assert(reviewEvents.length === 2 && reviewEvents[1].payload.revision === "revision-2", "review provenance is incomplete");
process.stdout.write(`${JSON.stringify({
  implementer_self_approval_rejected: true,
  unrelated_worker_rejected: true,
  child_task_scoped: completed.children.includes("phase0-child"),
  change_request_then_rereview: true,
  stale_revision_review_rejected: true,
  fixed_revision_approved: evaluation.reviewedRevision,
  human_decision_blocked_completion: true,
  owner_resolved_decision: true,
  orchestrator_completed_and_requested_merge: true,
  audit_event_count: policy.events.length,
}, null, 2)}\n`);
