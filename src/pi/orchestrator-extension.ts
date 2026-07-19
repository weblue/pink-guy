import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

const apiUrl = process.env.PINK_GUY_API_URL ?? process.env.BOSS_MAN_API_URL;
const conversationId =
  process.env.PINK_GUY_CONVERSATION_ID ?? process.env.BOSS_MAN_CONVERSATION_ID;
const orchestrationToken =
  process.env.PINK_GUY_ORCHESTRATION_TOKEN ?? process.env.BOSS_MAN_ORCHESTRATION_TOKEN;

function configured(): { apiUrl: string; conversationId: string; orchestrationToken: string } {
  if (!apiUrl || !conversationId || !orchestrationToken) {
    throw new Error(
      "Pink Guy orchestrator tools require PINK_GUY_API_URL, PINK_GUY_CONVERSATION_ID, and PINK_GUY_ORCHESTRATION_TOKEN",
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
    label: "Read Pink Guy orchestration context",
    description: "Read the authoritative topic, project, conversation policy, and current project tasks.",
    promptSnippet: "Read authoritative Pink Guy topic, project, and task state",
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
    label: "Create a Pink Guy task",
    description: "Create one ready task in the bound project with exact conversation-turn provenance.",
    promptSnippet: "Create a scoped project task only when intent and acceptance criteria are sufficiently concrete",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 500 }),
      acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
      taskKind: Type.Optional(Type.Union([
        Type.Literal("executable"),
        Type.Literal("umbrella"),
        Type.Literal("intake"),
      ])),
      tags: Type.Optional(Type.Array(
        Type.String({ minLength: 1, maxLength: 50 }),
        { maxItems: 20 },
      )),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "create", {
        title: params.title,
        acceptanceCriteria: params.acceptanceCriteria,
        taskKind: params.taskKind,
        tags: params.tags,
      }, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_update_task",
    label: "Update a Pink Guy task",
    description: "Replace a scoped task's title and acceptance criteria using its current version.",
    promptSnippet: "Refine a current task without changing its execution state",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      title: Type.String({ minLength: 1, maxLength: 500 }),
      acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
      taskKind: Type.Optional(Type.Union([
        Type.Literal("executable"),
        Type.Literal("umbrella"),
        Type.Literal("intake"),
      ])),
      tags: Type.Optional(Type.Array(
        Type.String({ minLength: 1, maxLength: 50 }),
        { maxItems: 20 },
      )),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "update", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_split_task",
    label: "Split a Pink Guy task",
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
    label: "Add a Pink Guy task dependency",
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
    label: "Record a Pink Guy task assumption",
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
    label: "Require a Pink Guy owner decision",
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
    name: "boss_orchestrator_archive_task",
    label: "Archive a Pink Guy task artifact",
    description: "Remove a settled task or planning artifact from the active board while retaining its complete history.",
    promptSnippet: "Archive only when the record is no longer active and state the concrete reason",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "archive", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_restore_task",
    label: "Restore a Pink Guy task artifact",
    description: "Return one archived task to its retained execution-status column without scheduling it.",
    promptSnippet: "Restore an archived task only when it should become active again",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      reason: Type.Optional(Type.String({ maxLength: 2_000 })),
    }),
    async execute(toolCallId, params, signal) {
      return mutateTask(toolCallId, "restore", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_release_task",
    label: "Release a Pink Guy task for automatic dispatch",
    description: "Durably release one refined Ready task to the deterministic scheduler with optional priority and model route.",
    promptSnippet: "Release concrete work after ambiguity and protected decisions are resolved",
    promptGuidelines: [
      "Release only executable Ready tasks with concrete acceptance criteria.",
      "Priority ranges from -100 to 100; omit it for normal priority 0.",
      "Omit provider, model, and thinkingLevel to pin the configured implementation default.",
      "Release does not choose queue order or spawn directly; the model-less scheduler does.",
    ],
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      priority: Type.Optional(Type.Integer({ minimum: -100, maximum: 100 })),
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
      return mutateTask(toolCallId, "release", params, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_update_dispatch",
    label: "Update Pink Guy task dispatch policy",
    description: "Pause, return to manual, or reprioritize one queued task without starting it.",
    promptSnippet: "Adjust queued automatic work only when owner intent or task ordering materially changed",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      expectedVersion: Type.Integer({ minimum: 1 }),
      operation: Type.Union([
        Type.Literal("pause_dispatch"),
        Type.Literal("manualize_dispatch"),
        Type.Literal("set_priority"),
      ]),
      priority: Type.Optional(Type.Integer({ minimum: -100, maximum: 100 })),
    }),
    async execute(toolCallId, params, signal) {
      const { operation, ...payload } = params;
      return mutateTask(toolCallId, operation, payload, signal);
    },
  });

  pi.registerTool({
    name: "boss_orchestrator_schedule_task",
    label: "Manually schedule a Pink Guy task phase",
    description: "Explicit recovery/override: directly queue one implementation, test, or review sub-agent.",
    promptSnippet: "Use direct scheduling only for explicit recovery or owner-requested override",
    promptGuidelines: [
      "For normal new work, release the refined task to deterministic automatic dispatch instead.",
      "Omit provider, model, and thinkingLevel to use the configured phase default.",
      "Only select a route already declared in Pink Guy model-route configuration.",
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
