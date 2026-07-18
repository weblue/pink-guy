#!/usr/bin/env node

import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConversationOrchestratorRuntime } from "../../src/server/conversation-runtime.mjs";
import {
  DirectControlPlane,
  sanitizePiTaskEvent,
  taskStateAllowsPhase,
} from "../../src/server/control-plane.mjs";
import {
  createModelRoutePolicy,
  loadModelRoutePolicy,
} from "../../src/server/model-routes.mjs";
import {
  DEFAULT_PROMPT_DIRECTORY,
  DEFAULT_PROMPT_PROFILES,
  phaseKickoffPrompt,
} from "../../src/server/prompt-profiles.mjs";
import { PiRpcProcess } from "../../src/server/rpc.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-dogfood-readiness.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fakeRpcChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = (signal) => {
    child.exitCode = signal === "SIGKILL" ? 137 : 0;
    child.emit("exit", child.exitCode, signal);
    return true;
  };
  return child;
}

const activeChild = fakeRpcChild();
const activeRpc = new PiRpcProcess({ child: activeChild });
const activityAwareSettlement = activeRpc.waitFor(
  (message) => message.type === "agent_settled",
  "activity-aware settlement",
  0,
  500,
  60,
);
setTimeout(() => activeChild.stdout.write('{"type":"message_update"}\n'), 40);
setTimeout(() => activeChild.stdout.write('{"type":"agent_settled"}\n'), 80);
await activityAwareSettlement;

const exitedChild = fakeRpcChild();
const exitedRpc = new PiRpcProcess({ child: exitedChild });
const exitDetected = exitedRpc.waitFor(
  (message) => message.type === "agent_settled",
  "process-exit settlement",
  0,
  500,
  100,
).then(() => false, (error) => error.message.includes("Pi RPC exited"));
setTimeout(() => exitedChild.kill("SIGTERM"), 10);
assert(await exitDetected, "Pi process exit was not detected before the timeout ceiling");
assert(
  sanitizePiTaskEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_delta",
      delta: "private reasoning",
      partial: { thinkingSignature: "private-signature" },
    },
  }) === null,
  "task event projection retained private reasoning metadata",
);
assert(
  sanitizePiTaskEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "visible progress" },
  })?.payload?.delta === "visible progress",
  "task event projection dropped visible text progress",
);
assert(
  taskStateAllowsPhase("in_progress", "implementation")
    && taskStateAllowsPhase("review", "test")
    && taskStateAllowsPhase("review", "review")
    && !taskStateAllowsPhase("ready", "implementation"),
  "task startup and scheduling disagree about phase-active states",
);

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../..");
const fakePi = resolve(moduleDirectory, "fixtures/fake-pi-rpc.mjs");
await chmod(fakePi, 0o755);
const configuredDefaultPolicy = await loadModelRoutePolicy(
  resolve(repositoryRoot, "config/model-routes.json"),
);
const modelPolicy = createModelRoutePolicy({
  provider: configuredDefaultPolicy.default.provider,
  model: configuredDefaultPolicy.default.model,
  thinking: configuredDefaultPolicy.default.thinking,
  billingClass: configuredDefaultPolicy.default.billingClass,
  phases: {
    implementation: {
      provider: "ollama",
      model: "qwen2.5-coder:14b",
      thinking: "low",
      billingClass: "local",
    },
  },
  source: "configured_default",
});
const root = await mkdtemp(join(tmpdir(), "boss-man-dogfood-readiness-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: modelPolicy.default.provider,
  runtimeModel: modelPolicy.default.model,
  runtimeThinking: modelPolicy.default.thinking,
  modelRoutePolicy: modelPolicy,
});
authority.seed({
  projectId: "dogfood-project",
  repositoryId: "dogfood-repository",
  projectName: "Dogfood project",
  taskId: "dogfood-task",
  repositoryPath: fixture,
  title: "Exercise explicit sub-agent routing",
});
const address = await authority.listen();
const api = `http://127.0.0.1:${address.port}`;

async function request(path, {
  method = "GET",
  body,
  token,
  idempotencyKey,
} = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    value: response.status === 204 ? null : await response.json(),
  };
}

for (const phase of ["orchestrator", "implementation", "test", "review"]) {
  assert(
    DEFAULT_PROMPT_PROFILES[phase].prompt
      === (await readFile(join(DEFAULT_PROMPT_DIRECTORY, "profiles", `${phase}.txt`), "utf8")).trim(),
    `${phase} profile was not loaded from its plain-text file`,
  );
  if (phase !== "orchestrator") {
    assert(
      phaseKickoffPrompt(phase)
        === (await readFile(join(DEFAULT_PROMPT_DIRECTORY, "kickoffs", `${phase}.txt`), "utf8")).trim(),
      `${phase} kickoff was not loaded from its plain-text file`,
    );
  }
}

const routes = await request("/api/model-routes");
assert(
  routes.status === 200
    && routes.value.default.provider === "openai-codex"
    && routes.value.phases.implementation.model === "qwen2.5-coder:14b",
  "human-editable model route defaults were not exposed",
);

const topic = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "dogfood-intake-topic",
  body: {
    title: "Prototype before repository binding",
    ownerDescription: "Preserve this conversation when it becomes executable.",
  },
});
const conversationId = topic.value.conversation.id;
await request(`/api/conversations/${conversationId}/turns`, {
  method: "POST",
  idempotencyKey: "dogfood-intake-turn",
  body: { message: "Clarify the smallest useful prototype." },
});
const systemRuntime = new ConversationOrchestratorRuntime({
  api,
  scopeType: "system_intake",
  stateRoot: root,
  piCommand: fakePi,
  piExtension: resolve(repositoryRoot, "src/pi/orchestrator-extension.ts"),
  leaseSeconds: 90,
  pollMs: 100,
});
await systemRuntime.runOnce();
const beforeTransfer = await request(`/api/topics/${topic.value.topic.id}`);
const originalNativePath = beforeTransfer.value.conversation.native_session_path;

const preCompaction = await request(
  `/api/orchestration/conversations/${conversationId}/custody`,
  {
    method: "POST",
    token: systemRuntime.token,
    body: { trigger: "before_compact" },
  },
);
assert(
  preCompaction.status === 201
    && preCompaction.value.snapshot.native_sha256
    && authority.store.conversationEvents(conversationId)
      .some((event) => event.type === "pre_compaction_custody_exported"),
  "orchestrator pre-compaction custody did not block on a verified native snapshot",
);

const transfer = await request(`/api/topics/${topic.value.topic.id}/project`, {
  method: "POST",
  idempotencyKey: "dogfood-scope-transfer",
  body: {
    projectId: "dogfood-project",
    expectedVersion: beforeTransfer.value.conversation.version,
  },
});
assert(
  transfer.status === 201
    && transfer.value.binding.custody_snapshot_id
    && transfer.value.binding.conversation.scope_type === "project"
    && transfer.value.binding.conversation.scope_id === "dogfood-project"
    && transfer.value.binding.conversation.native_session_path === originalNativePath,
  "intake-to-project transfer did not preserve verified native custody",
);
await systemRuntime.runOnce();
assert(systemRuntime.sessions.size === 0, "system intake retained an out-of-scope Pi process");

const legacyProjectOrchestrator = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "dogfood-project",
    transport: "daemon",
    endpoint: "pid:dogfood-readiness",
  },
});
assert(legacyProjectOrchestrator.status === 201, "task-command orchestrator registration failed");

await request(`/api/conversations/${conversationId}/turns`, {
  method: "POST",
  idempotencyKey: "dogfood-project-turn",
  body: { message: "Schedule the implementation using the best configured route." },
});
const projectRuntime = new ConversationOrchestratorRuntime({
  api,
  scopeType: "project",
  scopeId: "dogfood-project",
  stateRoot: root,
  piCommand: fakePi,
  piExtension: resolve(repositoryRoot, "src/pi/orchestrator-extension.ts"),
  leaseSeconds: 90,
  pollMs: 100,
});
const claimed = await projectRuntime.claim();
const rejectedUnconfiguredRoute = await request(
  `/api/orchestration/conversations/${conversationId}/task-schedules`,
  {
    method: "POST",
    token: projectRuntime.token,
    idempotencyKey: "dogfood-unconfigured-model-schedule",
    body: {
      taskId: "dogfood-task",
      phase: "implementation",
      modelProvider: "openai",
      modelId: "gpt-5.4-mini",
      thinkingLevel: "medium",
      billingClass: "subscription",
    },
  },
);
assert(
  rejectedUnconfiguredRoute.status === 400
    && rejectedUnconfiguredRoute.value.error === "invalid_request",
  "orchestrator scheduled an unconfigured model route",
);
const scheduled = await request(
  `/api/orchestration/conversations/${conversationId}/task-schedules`,
  {
    method: "POST",
    token: projectRuntime.token,
    idempotencyKey: "dogfood-local-model-schedule",
    body: {
      taskId: "dogfood-task",
      phase: "implementation",
      modelProvider: "ollama",
      modelId: "qwen2.5-coder:14b",
      thinkingLevel: "low",
      billingClass: "local",
    },
  },
);
assert(
  scheduled.status === 201
    && scheduled.value.command.payload.modelRoute.provider === "ollama"
    && scheduled.value.command.payload.modelRoute.model === "qwen2.5-coder:14b"
    && scheduled.value.command.payload.modelRoute.policySource === "orchestrator_selection",
  "orchestrator-selected sub-agent route was not resolved before command creation",
);
await projectRuntime.execute(claimed);
const nativeLines = (await readFile(originalNativePath, "utf8"))
  .trim().split("\n").filter(Boolean).map(JSON.parse);
assert(
  nativeLines.filter((entry) => entry.type === "startup").length === 2
    && nativeLines.filter((entry) => entry.type === "received_prompt").length === 2,
  "project orchestrator did not resume the transferred native Pi session",
);

authority.store.createSession({
  id: "dogfood-route-session",
  taskId: "dogfood-task",
  nativePath: join(root, "dogfood-route-session.jsonl"),
  provider: "ollama",
  model: "qwen2.5-coder:14b",
});
const recordedRun = authority.store.createRun({
  id: "dogfood-route-run",
  sessionId: "dogfood-route-session",
  phase: "implementation",
  modelProvider: "ollama",
  modelId: "qwen2.5-coder:14b",
  thinkingLevel: "low",
  modelPolicySource: "orchestrator_selection",
  billingClass: "local",
});
assert(
  recordedRun.model_provider === "ollama"
    && recordedRun.model_id === "qwen2.5-coder:14b"
    && recordedRun.thinking_level === "low"
    && recordedRun.billing_class === "local",
  "task run omitted resolved model-route provenance",
);

await projectRuntime.close();
await systemRuntime.close();
await request("/api/orchestrators/lease", {
  method: "DELETE",
  token: legacyProjectOrchestrator.value.token,
});
await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  prompts_from_text_files: true,
  configured_model_defaults: true,
  orchestrator_selected_subagent_route: true,
  unconfigured_orchestrator_route_rejected: true,
  local_model_route_recorded: true,
  pre_compaction_custody: preCompaction.value.snapshot.snapshot_id,
  scope_transfer_custody: transfer.value.binding.custody_snapshot_id,
  transferred_native_session_resumed: true,
  progress_aware_task_supervision: true,
  sanitized_task_event_projection: true,
  phase_state_contract_aligned: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);
