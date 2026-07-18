import { randomUUID } from "node:crypto";

const ACTIONS = {
  worker: new Set(["progress", "block", "create_child", "request_review"]),
  reviewer: new Set(["submit_review"]),
  orchestrator: new Set(["complete", "reopen"]),
  owner: new Set(["resolve_decision", "complete", "reopen"]),
};

export class TaskPolicy {
  constructor({ clock = () => new Date().toISOString() } = {}) {
    this.clock = clock;
    this.tasks = new Map();
    this.capabilities = new Map();
    this.events = [];
  }

  createTask({ id, title, assignedWorker, revision, validationPassed = false }) {
    const task = {
      id, title, assignedWorker, revision, validationPassed,
      status: "in_progress", children: [], reviews: [], decisionGates: [], mergeRequested: false,
    };
    this.tasks.set(id, task);
    this.record("task_created", "orchestrator", id, { revision });
    return task;
  }

  issueCapability({ role, actorId, taskId, runId, actions = [...(ACTIONS[role] ?? [])], expiresAt }) {
    if (!ACTIONS[role]) throw new Error(`unknown role: ${role}`);
    const capability = { id: randomUUID(), role, actorId, taskId, runId, actions, expiresAt };
    this.capabilities.set(capability.id, capability);
    return capability;
  }

  authorize(capabilityId, action, taskId) {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw Object.assign(new Error("unknown capability"), { code: "capability_denied" });
    if (Date.parse(capability.expiresAt) <= Date.parse(this.clock())) throw Object.assign(new Error("capability expired"), { code: "capability_denied" });
    if (capability.taskId !== taskId || !capability.actions.includes(action) || !ACTIONS[capability.role].has(action)) {
      throw Object.assign(new Error("action is outside capability scope"), { code: "capability_denied" });
    }
    return capability;
  }

  act(capabilityId, action, taskId, payload = {}) {
    const capability = this.authorize(capabilityId, action, taskId);
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    if (capability.role === "worker" && capability.actorId !== task.assignedWorker) {
      throw Object.assign(new Error("worker is not assigned"), { code: "capability_denied" });
    }

    if (action === "progress") this.record("task_progress", capability.actorId, taskId, { text: payload.text });
    else if (action === "block") {
      task.status = "blocked";
      this.record("task_blocked", capability.actorId, taskId, { reason: payload.reason });
    } else if (action === "create_child") {
      const childId = payload.id;
      if (!childId || this.tasks.has(childId)) throw new Error("invalid child task id");
      const child = this.createTask({ id: childId, title: payload.title, assignedWorker: capability.actorId, revision: task.revision });
      child.parentId = taskId;
      task.children.push(childId);
      this.record("child_task_created", capability.actorId, taskId, { childId });
    } else if (action === "request_review") {
      if (payload.revision !== task.revision) throw Object.assign(new Error("review revision is stale"), { code: "revision_conflict" });
      task.status = "review";
      task.requestedReviewRevision = payload.revision;
      this.record("review_requested", capability.actorId, taskId, { revision: payload.revision });
    } else if (action === "submit_review") {
      if (capability.actorId === task.assignedWorker) throw Object.assign(new Error("implementer cannot self-approve"), { code: "self_approval_denied" });
      if (payload.revision !== task.revision || payload.revision !== task.requestedReviewRevision) {
        throw Object.assign(new Error("review must target the fixed current revision"), { code: "revision_conflict" });
      }
      if (!["approve", "request_changes", "blocked"].includes(payload.disposition)) throw new Error("invalid review disposition");
      const review = { reviewer: capability.actorId, revision: payload.revision, disposition: payload.disposition, findings: payload.findings ?? [] };
      task.reviews.push(review);
      task.status = payload.disposition === "approve" ? "review" : payload.disposition === "request_changes" ? "in_progress" : "blocked";
      this.record("review_submitted", capability.actorId, taskId, review);
    } else if (action === "resolve_decision") {
      if (!payload.id) throw new Error("decision id is required");
      const gate = task.decisionGates.find((item) => item.id === payload.id);
      if (!gate) throw new Error("unknown decision gate");
      gate.status = "resolved";
      gate.resolution = payload.resolution;
      this.record("decision_resolved", capability.actorId, taskId, { id: gate.id, resolution: payload.resolution });
    } else if (action === "complete") {
      const evaluation = this.evaluateCompletion(taskId);
      if (!evaluation.allowed) throw Object.assign(new Error(`completion blocked: ${evaluation.reasons.join(",")}`), { code: "completion_blocked", reasons: evaluation.reasons });
      task.status = "done";
      task.mergeRequested = true;
      this.record("task_completed", capability.actorId, taskId, { revision: task.revision, mergeRequested: true });
    } else if (action === "reopen") {
      task.status = "in_progress";
      task.mergeRequested = false;
      this.record("task_reopened", capability.actorId, taskId, {});
    }
    return structuredClone(task);
  }

  addDecisionGate(taskId, gate) {
    const task = this.tasks.get(taskId);
    task.decisionGates.push({ ...gate, status: "decision_required" });
    this.record("decision_required", "policy", taskId, gate);
  }

  updateRevision(taskId, revision, { validationPassed }) {
    const task = this.tasks.get(taskId);
    task.revision = revision;
    task.validationPassed = validationPassed;
    task.requestedReviewRevision = null;
    this.record("task_revision_updated", task.assignedWorker, taskId, { revision, validationPassed });
  }

  evaluateCompletion(taskId) {
    const task = this.tasks.get(taskId);
    const currentApproval = task.reviews.find((review) => review.revision === task.revision && review.disposition === "approve" && review.reviewer !== task.assignedWorker);
    const reasons = [];
    if (!currentApproval) reasons.push("independent_review_required");
    if (!task.validationPassed) reasons.push("validation_required");
    if (task.decisionGates.some((gate) => gate.status === "decision_required")) reasons.push("human_decision_required");
    return { allowed: reasons.length === 0, reasons, reviewedRevision: currentApproval?.revision ?? null };
  }

  record(type, actor, taskId, payload) {
    this.events.push({ sequence: this.events.length + 1, type, actor, taskId, payload, at: this.clock() });
  }
}
