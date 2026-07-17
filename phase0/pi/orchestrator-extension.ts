import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

const apiUrl = process.env.BOSS_MAN_API_URL;
const conversationId = process.env.BOSS_MAN_CONVERSATION_ID;
const orchestrationToken = process.env.BOSS_MAN_ORCHESTRATION_TOKEN;

function configured(): { apiUrl: string; conversationId: string; orchestrationToken: string } {
  if (!apiUrl || !conversationId || !orchestrationToken) {
    throw new Error(
      "Boss Man orchestrator tools require BOSS_MAN_API_URL, BOSS_MAN_CONVERSATION_ID, and BOSS_MAN_ORCHESTRATION_TOKEN",
    );
  }
  return { apiUrl, conversationId, orchestrationToken };
}

async function request(path: string, options: RequestInit = {}): Promise<JsonObject> {
  const configuration = configured();
  const response = await fetch(`${configuration.apiUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${configuration.orchestrationToken}`,
      ...options.headers,
    },
  });
  const body = await response.json() as JsonObject;
  if (!response.ok) {
    throw new Error(
      `${typeof body.error === "string" ? body.error : "request_failed"}: ${
        typeof body.message === "string" ? body.message : `HTTP ${response.status}`
      }`,
    );
  }
  return body;
}

function result(value: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

export default function orchestratorExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "boss_orchestrator_context",
    label: "Read Boss Man orchestration context",
    description: "Read the authoritative topic, project, conversation policy, and current project tasks.",
    promptSnippet: "Read authoritative Boss Man topic, project, and task state",
    promptGuidelines: ["Use this before proposing or applying task graph changes."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const configuration = configured();
      return result(await request(
        `/api/conversations/${encodeURIComponent(configuration.conversationId)}/context`,
        { signal },
      ));
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_create_task",
    label: "Create a Boss Man task",
    description: "Create one ready task in the bound project with exact conversation-turn provenance.",
    promptSnippet: "Create a scoped project task only when intent and acceptance criteria are sufficiently concrete",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 500 }),
      acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
    }),
    async execute(toolCallId, params, signal) {
      const configuration = configured();
      return result(await request(
        `/api/orchestration/conversations/${encodeURIComponent(configuration.conversationId)}/task-mutations`,
        {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": `pi-tool:${toolCallId}`,
        },
        body: JSON.stringify({
          operation: "create",
          title: params.title,
          acceptanceCriteria: params.acceptanceCriteria,
        }),
        },
      ));
    },
  });
}
