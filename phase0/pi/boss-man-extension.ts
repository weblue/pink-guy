import { writeFile } from "node:fs/promises";

import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

const apiUrl = process.env.BOSS_MAN_API_URL;
const taskId = process.env.BOSS_MAN_TASK_ID;
const capabilityToken = process.env.BOSS_MAN_CAPABILITY_TOKEN;

function configured(): { apiUrl: string; taskId: string; capabilityToken: string } {
  if (!apiUrl || !taskId || !capabilityToken) {
    throw new Error("Boss Man task tools require BOSS_MAN_API_URL, BOSS_MAN_TASK_ID, and BOSS_MAN_CAPABILITY_TOKEN");
  }
  return { apiUrl, taskId, capabilityToken };
}

async function request(path: string, options: RequestInit = {}): Promise<JsonObject> {
  const configuration = configured();
  const response = await fetch(`${configuration.apiUrl}${path}`, options);
  const body = await response.json() as JsonObject;
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : "request_failed";
    const message = typeof body.message === "string" ? body.message : `Boss Man request failed with HTTP ${response.status}`;
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

function result(value: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

export default function bossManExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "boss_task_get",
    label: "Get assigned Boss Man task",
    description: "Read the authoritative assigned task, policy state, reviews, validations, and decision gates.",
    promptSnippet: "Read the authoritative assigned task and its current policy state",
    promptGuidelines: ["Use boss_task_get before planning a task transition or when a Boss Man mutation reports a conflict."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      return result(await task(signal));
    },
  });

  pi.registerTool({
    name: "boss_task_claim",
    label: "Claim assigned Boss Man task",
    description: "Claim the capability-scoped task. Identity and assignment are derived by the server.",
    promptSnippet: "Claim the capability-scoped assigned task",
    parameters: Type.Object({}),
    async execute(toolCallId, _params, signal) {
      return result(await act(toolCallId, "claim", {}, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_progress",
    label: "Record Boss Man task progress",
    description: "Append concise progress and evidence to the assigned task's authoritative audit stream.",
    promptSnippet: "Record meaningful progress on the assigned task",
    parameters: Type.Object({ text: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "progress", { text: params.text }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_block",
    label: "Block Boss Man task",
    description: "Mark the assigned task blocked with an explicit reason.",
    promptSnippet: "Block the assigned task with an explicit reason",
    parameters: Type.Object({ reason: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "block", { reason: params.reason }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_create_child",
    label: "Create scoped Boss Man child task",
    description: "Create a child task within the assigned task's project and scope.",
    promptSnippet: "Create a scoped child task when independent follow-up work is discovered",
    parameters: Type.Object({ id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "create_child", { id: params.id, title: params.title }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_request_review",
    label: "Request Boss Man review",
    description: "Request an independent review of the task's current fixed revision.",
    promptSnippet: "Request independent review after validation evidence is ready",
    parameters: Type.Object({ revision: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "request_review", { revision: params.revision }, signal));
    },
  });

  pi.registerTool({
    name: "boss_task_propose_complete",
    label: "Propose Boss Man task completion",
    description: "Record that implementation is ready; this does not approve, complete, commit, or merge the task.",
    promptSnippet: "Propose completion without self-approving or merging",
    parameters: Type.Object({ summary: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return result(await act(toolCallId, "propose_complete", { summary: params.summary }, signal));
    },
  });

  pi.registerTool({
    name: "boss_review_submit",
    label: "Submit Boss Man fixed-revision review",
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

  pi.on("session_start", async () => {
    const path = process.env.BOSS_MAN_EXTENSION_EVIDENCE_PATH;
    if (!path) return;
    const names = pi.getAllTools().map((tool) => tool.name).filter((name) => name.startsWith("boss_")).sort();
    await writeFile(path, `${JSON.stringify({ schema_version: "1.0.0", tools: names }, null, 2)}\n`, { mode: 0o600 });
  });
}
