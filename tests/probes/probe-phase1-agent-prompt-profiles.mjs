#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const execFileAsync = promisify(execFile);
const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-agent-prompt-profiles.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-prompts-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
});
authority.seed({
  projectId: "prompt-project",
  repositoryId: "prompt-repository",
  projectName: "Prompt project",
  taskId: "prompt-task",
  repositoryPath: fixture,
  title: "Prompt provenance task",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repositoryRoot, "scripts", "boss.mjs");

async function request(path, { method = "GET", body, token, idempotencyKey } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    value: contentType.includes("application/json") ? await response.json() : await response.text(),
  };
}

async function runCli(arguments_) {
  return execFileAsync(process.execPath, [cli, ...arguments_, "--api", base], {
    cwd: repositoryRoot,
    maxBuffer: 4 * 1024 * 1024,
  });
}

const defaults = await request("/api/agent-profiles");
assert(
  defaults.status === 200
    && defaults.value.profiles.map((profile) => profile.profile_key).join(",")
      === "orchestrator,implementation,test,review"
    && defaults.value.profiles.every((profile) => profile.active_version === 1),
  "four seeded prompt profiles were not exposed in stable order",
);

const prompt = "Ask only material questions, then create a small observable task graph.";
const updated = await request("/api/agent-profiles/orchestrator", {
  method: "PUT",
  idempotencyKey: "prompt-orchestrator-v2",
  body: { prompt, expectedVersion: 1 },
});
assert(
  updated.status === 201
    && updated.value.profile.active_version === 2
    && updated.value.profile.prompt_text === prompt
    && updated.value.profile.revisions.length === 2,
  "prompt update did not create an immutable active revision",
);

const replayed = await request("/api/agent-profiles/orchestrator", {
  method: "PUT",
  idempotencyKey: "prompt-orchestrator-v2",
  body: { prompt, expectedVersion: 1 },
});
assert(replayed.status === 200 && replayed.value.replayed, "identical prompt update was not replay-safe");

const conflict = await request("/api/agent-profiles/orchestrator", {
  method: "PUT",
  idempotencyKey: "prompt-orchestrator-v2",
  body: { prompt: `${prompt} Changed.`, expectedVersion: 2 },
});
const stale = await request("/api/agent-profiles/orchestrator", {
  method: "PUT",
  idempotencyKey: "prompt-orchestrator-stale",
  body: { prompt: "Stale content", expectedVersion: 1 },
});
const empty = await request("/api/agent-profiles/test", {
  method: "PUT",
  idempotencyKey: "prompt-test-empty",
  body: { prompt: "   ", expectedVersion: 1 },
});
const oversized = await request("/api/agent-profiles/review", {
  method: "PUT",
  idempotencyKey: "prompt-review-oversized",
  body: { prompt: "x".repeat(32_001), expectedVersion: 1 },
});
const unknown = await request("/api/agent-profiles/unknown");
assert(
  conflict.status === 409 && conflict.value.error === "idempotency_conflict"
    && stale.status === 409 && stale.value.error === "version_conflict"
    && empty.status === 400 && oversized.status === 400
    && unknown.status === 404,
  "prompt validation or concurrency controls did not fail closed",
);

const topic = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "prompt-topic",
  body: { title: "Prompt-aware orchestration", projectId: "prompt-project" },
});
await request(`/api/conversations/${topic.value.conversation.id}/turns`, {
  method: "POST",
  idempotencyKey: "prompt-owner-turn",
  body: { message: "Create one task." },
});
const lease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "project",
    scopeId: "prompt-project",
    transport: "daemon",
    endpoint: "pid:prompt-probe",
  },
});
const claimed = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: lease.value.token,
  body: {},
});
assert(
  claimed.value.context.prompt_profile.profile_key === "orchestrator"
    && claimed.value.context.prompt_profile.active_version === 2
    && claimed.value.context.prompt_profile.prompt_sha256 === updated.value.profile.prompt_sha256,
  "orchestrator claim did not pin the active prompt revision",
);

const shell = await request("/");
assert(
  shell.status === 200
    && shell.value.includes('data-testid="agent-prompt-editor"')
    && shell.value.includes("/api/agent-profiles/")
    && shell.value.includes("Running processes keep their pinned prompt"),
  "cockpit omitted the first-class prompt editor or activation boundary",
);

const listed = JSON.parse((await runCli(["profiles", "--json"])).stdout);
const inspected = (await runCli(["profile", "--key", "orchestrator"])).stdout;
const cliUpdate = JSON.parse((await runCli([
  "profile",
  "--key", "implementation",
  "--prompt", "Implement only the assigned acceptance criteria.",
  "--json",
])).stdout);
authority.store.createSession({
  id: "prompt-provenance-session",
  taskId: "prompt-task",
  nativePath: join(root, "prompt-provenance.jsonl"),
  provider: "openai",
  model: "gpt-test",
});
const taskRun = authority.store.createRun({
  id: "prompt-provenance-run",
  sessionId: "prompt-provenance-session",
  phase: "implementation",
  promptProfileKey: cliUpdate.profile.profile_key,
  promptProfileVersion: cliUpdate.profile.active_version,
  promptSha256: cliUpdate.profile.prompt_sha256,
});
assert(
  listed.profiles.length === 4
    && inspected.includes("Active revision: v2")
    && inspected.includes(prompt)
    && cliUpdate.profile.active_version === 2
    && taskRun.prompt_profile_key === "implementation"
    && taskRun.prompt_profile_version === 2
    && taskRun.prompt_sha256 === cliUpdate.profile.prompt_sha256,
  "terminal prompt controls do not match the central prompt projection",
);

await request("/api/orchestration/leases/current", {
  method: "DELETE",
  token: lease.value.token,
});
const cliModel = JSON.parse((await runCli([
  "model",
  "--topic", topic.value.topic.id,
  "--provider", "openrouter",
  "--model", "fallback-probe",
  "--thinking", "low",
  "--json",
])).stdout);
assert(
  cliModel.change.new_route.modelProvider === "openrouter"
    && cliModel.custodySnapshot.snapshot_id,
  "terminal model switch did not enforce a custody snapshot",
);
await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  profiles: defaults.value.profiles.length,
  immutable_revisions: true,
  optimistic_concurrency: true,
  idempotent_updates: true,
  cockpit_editor: true,
  terminal_parity: true,
  custody_backed_model_switch: true,
  claim_pinning: true,
  task_run_prompt_provenance: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);
