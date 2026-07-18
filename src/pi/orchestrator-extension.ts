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

async function mutateTask(
  toolCallId: string,
  operation: string,
  payload: JsonObject,
  signal: AbortSignal,
) {
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
      body: JSON.stringify({ operation, ...payload }),
    },
  ));
}

export default function orchestratorExtension(pi: ExtensionAPI): void {
  pi.on("session_before_compact", async () => {
    const configuration = configured();
    await request(
      `/api/orchestration/conversations/${encodeURIComponent(configuration.conversationId)}/custody`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "before_compact" }),
      },
    );
  });

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
      return mutateTask(toolCallId, "create", {
        title: params.title,
        acceptanceCriteria: params.acceptanceCriteria,
      }, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_update_task",
    label: "Update a Boss Man task",
    description: "Replace a scoped task's title and acceptance criteria using its current version.",
    promptSnippet: "Refine a current task without changing its execution state",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      title: Type.String({ minLength: 1, maxLength: 500 }),
      acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "update", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_split_task",
    label: "Split a Boss Man task",
    description: "Create one ready child task beneath a scoped parent; call again for another child.",
    promptSnippet: "Split a task into independently observable child work while leaving the parent intact",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      title: Type.String({ minLength: 1, maxLength: 500 }),
      acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "split", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_add_dependency",
    label: "Add a Boss Man task dependency",
    description: "Make one scoped task depend on another task in the same project; cycles are rejected.",
    promptSnippet: "Record only dependencies that materially constrain task ordering",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      dependsOnTaskId: Type.String({ minLength: 1 }),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "add_dependency", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_record_assumption",
    label: "Record a Boss Man task assumption",
    description: "Record a low-risk reversible assumption against one scoped task.",
    promptSnippet: "State an assumption explicitly before proceeding through low-risk ambiguity",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      body: Type.String({ minLength: 1, maxLength: 20_000 }),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "record_assumption", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_require_decision",
    label: "Require a Boss Man owner decision",
    description: "Create an unresolved protected decision gate against one scoped task.",
    promptSnippet: "Escalate high-risk or hard-to-change ambiguity to the owner",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      category: Type.String({ minLength: 1, maxLength: 200 }),
      question: Type.String({ minLength: 1, maxLength: 20_000 }),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "require_decision", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_schedule_task",
    label: "Schedule a Boss Man task sub-agent",
    description: "Queue one implementation, test, or review sub-agent with an explicit or configured model route.",
    promptSnippet: "Select the phase and model route for a scoped task sub-agent",
    promptGuidelines: [
      "Omit provider, model, and thinkingLevel to use the configured phase default.",
      "Only select a route already declared in Boss Man model-route configuration.",
      "Choose a different configured route only when task needs, cost, or local-model policy justify it.",
    ],
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      phase: Type.Union([
        Type.Literal("implementation"),
        Type.Literal("test"),
        Type.Literal("review"),
      ]),
      modelProvider: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      modelId: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      thinkingLevel: Type.Optional(Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
      ])),
      billingClass: Type.Optional(Type.Union([
        Type.Literal("subscription"),
        Type.Literal("direct_api"),
        Type.Literal("prepaid"),
        Type.Literal("local"),
        Type.Literal("unknown"),
      ])),
    }),
    async execute(toolCallId, params, signal) {
      const configuration = configured();
      return result(await request(
        `/api/orchestration/conversations/${encodeURIComponent(configuration.conversationId)}/task-schedules`,
        {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "idempotency-key": `pi-tool:${toolCallId}`,
          },
          body: JSON.stringify(params),
        },
      ));
    },
  });
}
