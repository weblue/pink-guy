import { writeFile } from "node:fs/promises";

import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

const apiUrl = process.env.PINK_GUY_API_URL ?? process.env.BOSS_MAN_API_URL;
const taskId = process.env.PINK_GUY_TASK_ID ?? process.env.BOSS_MAN_TASK_ID;
const capabilityToken =
  process.env.PINK_GUY_CAPABILITY_TOKEN ?? process.env.BOSS_MAN_CAPABILITY_TOKEN;

function configured(): { apiUrl: string; taskId: string; capabilityToken: string } {
  if (!apiUrl || !taskId || !capabilityToken) {
    throw new Error(
      "Pink Guy task tools require PINK_GUY_API_URL, PINK_GUY_TASK_ID, and PINK_GUY_CAPABILITY_TOKEN",
    );
  }
  return { apiUrl, taskId, capabilityToken };
}

async function request(path: string, options: RequestInit = {}): Promise<JsonObject> {
  const configuration = configured();
  const response = await fetch(`${configuration.apiUrl}${path}`, options);
  const body = await response.json() as JsonObject;
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : "request_failed";
    const message = typeof body.message === "string" ? body.message : `Pink Guy request failed with HTTP ${response.status}`;
    throw new Error(`${code}: ${message}`);
  }
  return body;
}

async function task(signal?: AbortSignal): Promise<JsonObject> {
  const configuration = configured();
  return request(`/api/tasks/${encodeURIComponent(configuration.taskId)}`, {
    signal,
    headers: { authorization: `Bearer ${configuration.capabilityToken}` },
  });
}

async function act(toolCallId: string, action: string, payload: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
  const configuration = configured();
  const current = await task(signal);
  return request(`/api/tasks/${encodeURIComponent(configuration.taskId)}/actions/${encodeURIComponent(action)}`, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${configuration.capabilityToken}`,
      "content-type": "application/json",
      "idempotency-key": `pi-tool:${toolCallId}`,
    },
    body: JSON.stringify({ expectedVersion: current.version, payload }),
  });
}

async function gitRead(operation: "status" | "diff", signal?: AbortSignal): Promise<JsonObject> {
  const configuration = configured();
  return request(`/api/tasks/${encodeURIComponent(configuration.taskId)}/git/${operation}`, {
    signal,
    headers: { authorization: `Bearer ${configuration.capabilityToken}` },
  });
}

async function gitMutate(
  toolCallId: string,
  operation: "checkpoint" | "commit",
  payload: JsonObject,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const configuration = configured();
  return request(`/api/tasks/${encodeURIComponent(configuration.taskId)}/git/${operation}`, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${configuration.capabilityToken}`,
      "content-type": "application/json",
      "idempotency-key": `pi-tool:${toolCallId}`,
    },
    body: JSON.stringify(payload),
  });
}

function result(value: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

export default function bossManExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "boss_task_get",
    label: "Get assigned Pink Guy task",
    description: "Read the authoritative assigned task, policy state, reviews, validations, and decision gates.",
    promptSnippet: "Read the authoritative assigned task and its current policy state",
    promptGuidelines: ["Use boss_task_get before planning a task transition or when a Pink Guy mutation reports a conflict."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      return result(await task(signal));
    },
  });

  pi.registerTool({
    name: "boss_task_claim",
    label: "Claim assigned Pink Guy task",
    description: "Claim the capability-scoped task. Identity and assignment are derived by the server.",
    promptSnippet: "Claim the capability-scoped assigned task",
    parameters: Type.Object({}),
    async execute(toolCallId, _params, signal) {
      return result(await act(toolCallId, "claim", {}, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_progress",
    label: "Record Pink Guy task progress",
    description: "Append concise progress and evidence to the assigned task's authoritative audit stream.",
    promptSnippet: "Record meaningful progress on the assigned task",
    parameters: Type.Object({ text: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "progress", { text: params.text }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_block",
    label: "Block Pink Guy task",
    description: "Mark the assigned task blocked with an explicit reason.",
    promptSnippet: "Block the assigned task with an explicit reason",
    parameters: Type.Object({ reason: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "block", { reason: params.reason }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_create_child",
    label: "Create scoped Pink Guy child task",
    description: "Create a child task within the assigned task's project and scope.",
    promptSnippet: "Create a scoped child task when independent follow-up work is discovered",
    parameters: Type.Object({ id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "create_child", { id: params.id, title: params.title }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_request_review",
    label: "Request Pink Guy review",
    description: "Request an independent review of the task's current fixed revision.",
    promptSnippet: "Request independent review after validation evidence is ready",
    parameters: Type.Object({ revision: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "request_review", { revision: params.revision }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_propose_complete",
    label: "Propose Pink Guy task completion",
    description: "Record that implementation is ready; this does not approve, complete, commit, or merge the task.",
    promptSnippet: "Propose completion without self-approving or merging",
    parameters: Type.Object({ summary: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "propose_complete", { summary: params.summary }, signal));
    },
  });

  pi.registerTool({
    name: "boss_review_submit",
    label: "Submit Pink Guy fixed-revision review",
    description: "Submit an independent structured review. The server rejects implementer self-review and stale revisions.",
    promptSnippet: "Submit an independent fixed-revision review",
    parameters: Type.Object({
      revision: Type.String({ minLength: 1 }),
      disposition: StringEnum(["approve", "request_changes", "blocked"] as const),
      findings: Type.Array(Type.String()),
    }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "submit_review", {
        revision: params.revision,
        disposition: params.disposition,
        findings: params.findings,
      }, signal));
    },
  });

  pi.registerTool({
    name: "boss_test_record_validation",
    label: "Record Pink Guy fixed-revision validation",
    description: "Record independent pass/fail test evidence for the task's current fixed revision. Only a test-phase capability may use this tool.",
    promptSnippet: "Record exact test evidence against the current fixed revision",
    parameters: Type.Object({
      revision: Type.String({ minLength: 1 }),
      status: StringEnum(["passed", "failed"] as const),
      evidence: Type.Array(Type.String()),
    }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "record_validation", {
        revision: params.revision,
        status: params.status,
        evidence: params.evidence,
      }, signal));
    },
  });

  pi.registerTool({
    name: "boss_git_status",
    label: "Inspect Pink Guy workspace status",
    description: "Read host-authoritative Git status for this run without granting writable Git metadata to the container.",
    promptSnippet: "Inspect the assigned workspace through the host Git service",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      return result(await gitRead("status", signal));
    },
  });

  pi.registerTool({
    name: "boss_git_diff",
    label: "Inspect Pink Guy workspace diff",
    description: "Read the complete host-generated workspace diff for the current revision.",
    promptSnippet: "Inspect the assigned workspace diff through the host Git service",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      return result(await gitRead("diff", signal));
    },
  });

  pi.registerTool({
    name: "boss_git_checkpoint_request",
    label: "Request Pink Guy Git checkpoint",
    description: "Ask the host Git service to stage assigned-workspace changes and create a provenance-linked checkpoint.",
    promptSnippet: "Request a host-owned checkpoint after a coherent implementation increment",
    parameters: Type.Object({
      message: Type.String({ minLength: 1 }),
      evidence: Type.Array(Type.String()),
    }),
    async execute(toolCallId, params, signal) {
      return result(await gitMutate(toolCallId, "checkpoint", { message: params.message, evidence: params.evidence }, signal));
    },
  });

  pi.registerTool({
    name: "boss_git_commit_request",
    label: "Request Pink Guy Git commit",
    description: "Ask the host Git service to create a provenance-linked commit; the agent never receives commit or merge authority.",
    promptSnippet: "Request a host-owned commit after validation",
    parameters: Type.Object({
      message: Type.String({ minLength: 1 }),
      evidence: Type.Array(Type.String()),
    }),
    async execute(toolCallId, params, signal) {
      return result(await gitMutate(toolCallId, "commit", { message: params.message, evidence: params.evidence }, signal));
    },
  });

  pi.on("session_start", async () => {
    const path =
      process.env.PINK_GUY_EXTENSION_EVIDENCE_PATH
      ?? process.env.BOSS_MAN_EXTENSION_EVIDENCE_PATH;
    if (!path) return;
    const names = pi.getAllTools().map((tool) => tool.name).filter((name) => name.startsWith("boss_")).sort();
    await writeFile(path, `${JSON.stringify({ schema_version: "1.0.0", tools: names }, null, 2)}\n`, { mode: 0o600 });
  });
}
