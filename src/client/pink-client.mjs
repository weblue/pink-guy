import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const TERMINAL_TURN_STATES = new Set([
  "waiting_for_owner",
  "completed",
  "failed",
  "cancelled",
  "reconciliation_required",
]);

async function responseValue(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function matchingLease(conversation, leases) {
  return leases.find((lease) =>
    lease.scope_type === conversation.scope_type
    && lease.scope_id === conversation.scope_id
    && lease.status === "active"
  ) ?? null;
}

export function assistantText(turn, events) {
  return turn.result?.assistantText
    || events
      .filter((event) => event.turn_id === turn.id && event.type === "pi_text_delta")
      .map((event) => event.payload?.delta ?? "")
      .join("")
    || null;
}

export function mutationSummary(event) {
  const payload = event.payload ?? {};
  const operation = String(payload.operation ?? "changed").replaceAll("_", " ");
  if (payload.operation === "add_dependency") {
    return `${operation}: ${payload.taskId} depends on ${payload.dependsOnTaskId}`;
  }
  if (payload.operation === "record_assumption") {
    return `${operation}: ${payload.assumption ?? payload.taskId}`;
  }
  if (payload.operation === "require_decision") {
    return `${operation}: ${payload.decisionQuestion ?? payload.taskId}`;
  }
  if (payload.operation === "split") {
    return `${operation}: ${payload.childTaskId ?? payload.taskId}`;
  }
  return `${operation}: ${payload.title ?? payload.taskId ?? "task"}`;
}

export class PinkGuyClient {
  constructor({ api = "http://127.0.0.1:4310", fetchImplementation = fetch } = {}) {
    this.api = api.replace(/\/$/, "");
    this.fetch = fetchImplementation;
  }

  async request(path, { method = "GET", body, idempotencyKey } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.api}${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw Object.assign(
        new Error(`cannot reach Pink Guy at ${this.api}: ${error.message}`),
        { code: "api_unavailable" },
      );
    }
    const value = await responseValue(response);
    if (!response.ok) {
      const message = typeof value === "object" && value
        ? value.message ?? value.error
        : value;
      throw Object.assign(
        new Error(message || `Pink Guy returned HTTP ${response.status}`),
        { code: value?.error ?? "request_failed", status: response.status },
      );
    }
    return value;
  }

  async fleet() {
    const [health, projects, topics, leases] = await Promise.all([
      this.request("/api/health"),
      this.request("/api/projects"),
      this.request("/api/topics"),
      this.request("/api/orchestration/leases"),
    ]);
    return {
      health,
      projects: projects.projects,
      topics: topics.topics,
      leases: leases.leases,
    };
  }

  async agentProfiles() {
    const result = await this.request("/api/agent-profiles");
    return result.profiles;
  }

  async providerCatalog({ refresh = false } = {}) {
    return this.request(
      refresh ? "/api/provider-catalog/refresh" : "/api/provider-catalog",
      refresh ? { method: "POST" } : {},
    );
  }

  async importProject(
    repositoryUrl,
    { name = null, idempotencyKey = `terminal-import-${randomUUID()}` } = {},
  ) {
    return this.request("/api/projects/import", {
      method: "POST",
      idempotencyKey,
      body: { repositoryUrl, name },
    });
  }

  async deleteProject(
    projectId,
    { confirmName, reason },
    { idempotencyKey = `terminal-project-delete-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
      idempotencyKey,
      body: { confirmName, reason },
    });
  }

  async createSourceSnapshot(
    projectId,
    { kind, sourceRef = null, content },
    { idempotencyKey = `terminal-source-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/sources`, {
      method: "POST",
      idempotencyKey,
      body: { kind, sourceRef, content },
    });
  }

  async agentProfile(profileKey) {
    const result = await this.request(`/api/agent-profiles/${encodeURIComponent(profileKey)}`);
    return result.profile;
  }

  async updateAgentProfile(
    profileKey,
    prompt,
    expectedVersion,
    { idempotencyKey = `terminal-prompt-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/agent-profiles/${encodeURIComponent(profileKey)}`, {
      method: "PUT",
      idempotencyKey,
      body: { prompt, expectedVersion },
    });
  }

  async taskDetail(taskId) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}`);
  }

  async setTaskDispatch(
    taskId,
    {
      operation,
      expectedVersion,
      priority = null,
      modelProvider = null,
      modelId = null,
      thinkingLevel = null,
      billingClass = null,
    },
    { idempotencyKey = `terminal-dispatch-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/dispatch`, {
      method: "POST",
      idempotencyKey,
      body: {
        operation,
        expectedVersion,
        priority,
        modelProvider,
        modelId,
        thinkingLevel,
        billingClass,
      },
    });
  }

  async topicDetail(topicId) {
    return this.request(`/api/topics/${encodeURIComponent(topicId)}`);
  }

  async topicEvents(conversationId, after = 0) {
    const result = await this.request(
      `/api/conversations/${encodeURIComponent(conversationId)}/events?after=${after}`,
    );
    return result.events;
  }

  async resolveTopic({
    topicId,
    projectId,
    repositoryPath,
    newTopicTitle,
    description = null,
  }) {
    if (topicId) return this.topicDetail(topicId);

    const [projectsResult, topicsResult] = await Promise.all([
      this.request("/api/projects"),
      this.request("/api/topics"),
    ]);
    let selectedProject = null;
    if (projectId) {
      selectedProject = projectsResult.projects.find((project) => project.id === projectId);
      if (!selectedProject) throw new Error(`unknown project: ${projectId}`);
    } else if (repositoryPath) {
      const requestedPath = resolve(repositoryPath);
      selectedProject = projectsResult.projects.find(
        (project) => resolve(project.repository_path) === requestedPath,
      );
      if (!selectedProject) {
        throw new Error(`Pink Guy does not manage repository: ${requestedPath}`);
      }
    }

    if (selectedProject && !newTopicTitle) {
      const existing = topicsResult.topics.find(
        (topic) => topic.project_id === selectedProject.id && topic.state !== "archived",
      );
      if (existing) return this.topicDetail(existing.id);
    }
    if (!selectedProject && !newTopicTitle) {
      throw new Error("chat requires --topic, --project, --repo, or --new-topic");
    }

    return this.request("/api/topics", {
      method: "POST",
      idempotencyKey: `terminal-topic-${randomUUID()}`,
      body: {
        title: newTopicTitle ?? `${selectedProject.name} orchestrator`,
        ownerDescription: description
          ?? (selectedProject
            ? "Durable project conversation for new work and board refinement."
            : null),
        projectId: selectedProject?.id ?? null,
      },
    });
  }

  async conversationState(detail) {
    const [events, leaseResult] = await Promise.all([
      this.topicEvents(detail.conversation.id),
      this.request("/api/orchestration/leases"),
    ]);
    return {
      detail,
      events,
      lease: matchingLease(detail.conversation, leaseResult.leases),
      browserUrl: `${this.api}/#${detail.topic.id}`,
    };
  }

  async submit(conversationId, message, { idempotencyKey = `terminal-turn-${randomUUID()}` } = {}) {
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      idempotencyKey,
      body: { message },
    });
  }

  async conversationCustody(conversationId) {
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/custody`);
  }

  async exportConversationCustody(conversationId) {
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/custody`, {
      method: "POST",
    });
  }

  async bindTopicToProject(
    topicId,
    { projectId, expectedVersion },
    { idempotencyKey = `terminal-topic-bind-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/topics/${encodeURIComponent(topicId)}/project`, {
      method: "POST",
      idempotencyKey,
      body: { projectId, expectedVersion },
    });
  }

  async switchConversationModel(
    conversationId,
    { modelProvider, modelId, thinkingLevel, expectedVersion },
    { idempotencyKey = `terminal-model-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/model`, {
      method: "POST",
      idempotencyKey,
      body: { modelProvider, modelId, thinkingLevel, expectedVersion },
    });
  }

  async recoveryAttention(projectId = null) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const result = await this.request(`/api/recovery/attention${query}`);
    return result.attention;
  }

  async gitPolicy(projectId) {
    const result = await this.request(
      `/api/projects/${encodeURIComponent(projectId)}/git-policy`,
    );
    return result.policy;
  }

  async updateGitPolicy(
    projectId,
    policy,
    { idempotencyKey = `pink-policy-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/git-policy`, {
      method: "PUT",
      idempotencyKey,
      body: policy,
    });
  }

  async prepareIntegration(
    taskId,
    { idempotencyKey = `pink-integration-prepare-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/integrations`, {
      method: "POST",
      idempotencyKey,
      body: {},
    });
  }

  async integration(integrationId) {
    const result = await this.request(
      `/api/integrations/${encodeURIComponent(integrationId)}`,
    );
    return result.integration;
  }

  async actOnIntegration(
    integrationId,
    { action, expectedVersion, reason },
    { idempotencyKey = `pink-integration-${randomUUID()}` } = {},
  ) {
    return this.request(
      `/api/integrations/${encodeURIComponent(integrationId)}/actions/${encodeURIComponent(action)}`,
      {
        method: "POST",
        idempotencyKey,
        body: { expectedVersion, reason },
      },
    );
  }

  async integrationAttention(projectId = null) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const result = await this.request(`/api/integrations/attention${query}`);
    return result.attention;
  }

  async storageInventory() {
    const result = await this.request("/api/storage");
    return result.inventory;
  }

  async retentionHolds(projectId, { active = true } = {}) {
    const result = await this.request(
      `/api/retention/holds?projectId=${encodeURIComponent(projectId)}&active=${active}`,
    );
    return result.holds;
  }

  async createRetentionHold(
    input,
    { idempotencyKey = `pink-hold-${randomUUID()}` } = {},
  ) {
    return this.request("/api/retention/holds", {
      method: "POST",
      idempotencyKey,
      body: input,
    });
  }

  async releaseRetentionHold(
    holdId,
    reason,
    { idempotencyKey = `pink-hold-release-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/retention/holds/${encodeURIComponent(holdId)}/release`, {
      method: "POST",
      idempotencyKey,
      body: { reason },
    });
  }

  async taskCleanupPreview(taskId) {
    const result = await this.request(`/api/tasks/${encodeURIComponent(taskId)}/cleanup`);
    return result.preview;
  }

  async executeTaskCleanup(
    taskId,
    { previewSha256, reason },
    { idempotencyKey = `pink-cleanup-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/cleanup`, {
      method: "POST",
      idempotencyKey,
      body: { previewSha256, reason },
    });
  }

  async sessionDeletionPreview(sessionId) {
    const result = await this.request(
      `/api/sessions/${encodeURIComponent(sessionId)}/artifacts`,
    );
    return result.preview;
  }

  async deleteSessionArtifacts(
    sessionId,
    { confirmSessionId, previewSha256, reason },
    { idempotencyKey = `pink-session-delete-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, {
      method: "DELETE",
      idempotencyKey,
      body: { confirmSessionId, previewSha256, reason },
    });
  }

  async actOnExecution(
    executionId,
    { action, expectedVersion, reason, modelRoute = null },
    { idempotencyKey = `terminal-execution-${randomUUID()}` } = {},
  ) {
    return this.request(`/api/executions/${encodeURIComponent(executionId)}/actions`, {
      method: "POST",
      idempotencyKey,
      body: { action, expectedVersion, reason, modelRoute },
    });
  }

  async resolveRecoveryCandidate(
    candidateId,
    { action, expectedVersion, reason },
    { idempotencyKey = `terminal-candidate-${randomUUID()}` } = {},
  ) {
    return this.request(
      `/api/recovery-candidates/${encodeURIComponent(candidateId)}/actions`,
      {
        method: "POST",
        idempotencyKey,
        body: { action, expectedVersion, reason },
      },
    );
  }

  async followTurn(
    detail,
    turnId,
    {
      pollMs = 750,
      timeoutMs = 10 * 60 * 1_000,
      after = 0,
      onEvent = () => {},
      onState = () => {},
    } = {},
  ) {
    const deadline = Date.now() + timeoutMs;
    let cursor = after;
    let lastState = null;
    while (Date.now() < deadline) {
      const [latest, events] = await Promise.all([
        this.topicDetail(detail.topic.id),
        this.topicEvents(detail.conversation.id, cursor),
      ]);
      for (const event of events) {
        cursor = Math.max(cursor, Number(event.sequence));
        if (event.turn_id === turnId) onEvent(event);
      }
      const turn = latest.turns.find((candidate) => candidate.id === turnId);
      if (!turn) throw new Error(`turn disappeared from conversation: ${turnId}`);
      if (turn.state !== lastState) {
        lastState = turn.state;
        onState(turn.state);
      }
      if (TERMINAL_TURN_STATES.has(turn.state)) {
        return { detail: latest, turn, cursor };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    }
    throw Object.assign(new Error(`timed out waiting for turn ${turnId}`), { code: "turn_timeout" });
  }
}

// Compatibility export for existing scripts and third-party callers.
export const BossManClient = PinkGuyClient;
