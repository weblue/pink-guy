#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConversationOrchestratorRuntime } from "../../src/server/conversation-runtime.mjs";
import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-conversation-runtime.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const fakePi = resolve(moduleDirectory, "fixtures/fake-pi-rpc.mjs");
await chmod(fakePi, 0o755);
const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-pi-runtime-"));
const credentialSource = join(root, "owner-managed", "auth.json");
await mkdir(dirname(credentialSource), { recursive: true, mode: 0o700 });
await writeFile(
  credentialSource,
  `${JSON.stringify({ "fake-provider": { type: "api_key", key: "RUNTIME-CREDENTIAL-CANARY" } })}\n`,
  { mode: 0o600 },
);
const credentialBefore = sha256(await readFile(credentialSource));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
  runtimeThinking: "high",
});
authority.seed({
  projectId: "runtime-project",
  repositoryId: "runtime-repository",
  projectName: "Runtime project",
  taskId: "runtime-existing-task",
  repositoryPath: fixture,
  title: "Existing task",
});
const address = await authority.listen();
const api = `http://127.0.0.1:${address.port}`;

async function request(path, { method = "GET", body, idempotencyKey } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, value: response.status === 204 ? null : await response.json() };
}

const promptUpdate = await request("/api/agent-profiles/orchestrator", {
  method: "PUT",
  idempotencyKey: "runtime-orchestrator-prompt-v2",
  body: {
    prompt: "Runtime probe orchestrator guidance. Create only deterministic, bounded work.",
    expectedVersion: 1,
  },
});
assert(promptUpdate.status === 201, "orchestrator prompt update failed");

const created = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "runtime-topic",
  body: { title: "Persistent Pi conversation", projectId: "runtime-project" },
});
assert(created.status === 201, "runtime topic creation failed");
const conversationId = created.value.conversation.id;
const messages = [
  "Turn this request into one bounded implementation task.",
  "Keep the validation local and deterministic.",
];
for (let index = 0; index < messages.length; index += 1) {
  const submitted = await request(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    idempotencyKey: `runtime-turn-${index + 1}`,
    body: { message: messages[index] },
  });
  assert(submitted.status === 201, `runtime turn ${index + 1} submission failed`);
}

const runtime = new ConversationOrchestratorRuntime({
  api,
  scopeType: "project",
  scopeId: "runtime-project",
  stateRoot: root,
  piCommand: fakePi,
  piExtension: resolve(moduleDirectory, "../../src/pi/orchestrator-extension.ts"),
  credentialSource,
  leaseSeconds: 90,
  pollMs: 100,
});
await runtime.runOnce();
const modelSwitch = await request(`/api/conversations/${conversationId}/model`, {
  method: "POST",
  idempotencyKey: "runtime-model-switch",
  body: {
    modelProvider: "anthropic",
    modelId: "claude-probe",
    thinkingLevel: "medium",
    expectedVersion: 1,
  },
});
assert(
  modelSwitch.status === 201
    && modelSwitch.value.change.new_route.modelProvider === "anthropic",
  "model switch did not create a custody-backed route change",
);
await runtime.runOnce();

const detail = await request(`/api/topics/${created.value.topic.id}`);
const events = await request(`/api/conversations/${conversationId}/events`);
const nativeSessionPath = detail.value.conversation.native_session_path;
const nativeLines = (await readFile(nativeSessionPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const receivedPrompts = nativeLines.filter((entry) => entry.type === "received_prompt").map((entry) => entry.message);
const startups = nativeLines.filter((entry) => entry.type === "startup");
const conversationRun = authority.store.database.prepare(
  "SELECT * FROM conversation_runs WHERE conversation_id=? ORDER BY started_at LIMIT 1",
).get(conversationId);
const custody = await authority.context.verifyBundle(modelSwitch.value.custodySnapshot.path);
assert(
  detail.value.turns.every((turn) => turn.state === "completed")
    && detail.value.turns.every((turn) => turn.result.contextResend === false),
  "managed Pi turns did not complete without transcript reconstruction",
);
assert(
  receivedPrompts.length === 2
    && receivedPrompts[0] === messages[0]
    && receivedPrompts[1] === messages[1],
  "runtime resent or rewrote conversation history instead of sending only the new owner message",
);
assert(
  startups.length === 2
    && startups.every((startup) => startup.systemPrompt.includes("Runtime probe orchestrator guidance."))
    && startups.every((startup) => startup.systemPrompt.includes("Pink Guy tools and the central API are authoritative"))
    && startups[0].provider === "openai"
    && startups[1].provider === "anthropic"
    && startups[1].model === "claude-probe",
  "runtime did not compose the active editable prompt inside the immutable policy envelope",
);
assert(
  conversationRun
    && JSON.parse(conversationRun.metadata_json).promptProfileKey === "orchestrator"
    && JSON.parse(conversationRun.metadata_json).promptProfileVersion === 2
    && JSON.parse(conversationRun.metadata_json).promptSha256 === promptUpdate.value.profile.prompt_sha256,
  "conversation run omitted its pinned prompt revision provenance",
);
assert(
  detail.value.conversation.version === 2
    && detail.value.conversation.model_provider === "anthropic"
    && custody.manifest.schema_version === "boss-man-conversation-custody-manifest-v1"
    && custody.manifest.record_counts.turns === 2
    && custody.checksums["native.pi-session.jsonl"],
  "model switch did not verify and retain a complete pre-switch conversation snapshot",
);
assert(
  events.value.events.some((event) => event.type === "pi_run_started")
    && events.value.events.some((event) => event.type === "pi_text_delta")
    && events.value.events.some((event) => event.type === "pi_tool_end")
    && events.value.events.some((event) => event.type === "pi_agent_settled"),
  "sanitized Pi RPC lifecycle was not projected into durable conversation events",
);
assert(
  events.value.events.every((event) => {
    const payload = JSON.stringify(event.payload);
    return !payload.includes("thinking content") && !payload.includes("PRIVATE-TOOL-RESULT");
  }),
  "private reasoning or oversized tool output leaked into projected conversation events",
);

await runtime.close();
assert(
  sha256(await readFile(credentialSource)) === credentialBefore,
  "managed Pi runtime changed the owner credential source",
);
assert(
  !(await exists(join(root, "orchestrator-config", "project-runtime-project", "auth.json"))),
  "private managed Pi credential copy survived normal shutdown",
);
await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  persistent_native_pi_session: nativeSessionPath,
  owner_messages_sent_once: receivedPrompts.length,
  prompt_profile_version: 2,
  prompt_provenance_recorded: true,
  custody_snapshot: modelSwitch.value.custodySnapshot.snapshot_id,
  model_switch_restart: true,
  context_resend: false,
  sanitized_stream_events: true,
  oversized_tool_results_projected_before_transport: true,
  browser_terminal_required: false,
  canonical_credential_unchanged: true,
  private_credential_removed: true,
  provider_requests: 0,
}, null, 2)}\n`);
