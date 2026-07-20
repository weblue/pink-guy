#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extension = resolve(scriptDirectory, "../../src/pi/lifecycle-probe.ts");
const fixture = process.argv[2];

if (!fixture || !fixture.startsWith("/")) {
  console.error("usage: probe-pi-lifecycle.mjs /absolute/path/to/generated/fixture");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseJsonl(content) {
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

const root = await mkdtemp(join(tmpdir(), "boss-man-pi-lifecycle-"));
const home = join(root, "home");
const config = join(root, "pi-config");
const sessions = join(root, "sessions");
const snapshots = join(root, "snapshots");
await Promise.all(
  [home, config, sessions, snapshots].map((directory) =>
    mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
);

const childEnvironment = {
  HOME: home,
  LANG: process.env.LANG ?? "en_US.UTF-8",
  PATH: process.env.PATH,
  SHELL: process.env.SHELL ?? "/bin/sh",
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  PI_CODING_AGENT_DIR: config,
  PI_CODING_AGENT_SESSION_DIR: sessions,
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
  BOSS_MAN_PHASE0_LIFECYCLE_DIR: snapshots,
};

function startRpc(sessionFile) {
  const args = [
    "--mode",
    "rpc",
    "--session-dir",
    sessions,
    "--extension",
    extension,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "--offline",
    "--provider",
    "boss-man-phase0",
    "--model",
    "complete",
  ];
  if (sessionFile) args.push("--session", sessionFile);

  const child = spawn("pi", args, {
    cwd: fixture,
    env: childEnvironment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let commandSequence = 0;
  const messages = [];
  const waiters = [];

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    while (true) {
      const boundary = stdoutBuffer.indexOf("\n");
      if (boundary < 0) break;
      const line = stdoutBuffer.slice(0, boundary);
      stdoutBuffer = stdoutBuffer.slice(boundary + 1);
      if (!line) continue;
      const parsed = JSON.parse(line);
      messages.push(parsed);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (messages.length - 1 >= waiter.fromIndex && waiter.predicate(parsed)) {
          waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(parsed);
        }
      }
    }
  });

  function waitFor(predicate, description, fromIndex = 0) {
    for (let index = fromIndex; index < messages.length; index += 1) {
      if (predicate(messages[index])) return Promise.resolve(messages[index]);
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error(`timed out waiting for ${description}`)),
        30_000,
      );
      waiters.push({ predicate, fromIndex, resolve: resolvePromise, timer });
    });
  }

  async function command(payload) {
    commandSequence += 1;
    const id = `phase0-${commandSequence}`;
    const fromIndex = messages.length;
    child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    const response = await waitFor(
      (message) => message.type === "response" && message.id === id,
      `${payload.type} response`,
      fromIndex,
    );
    if (!response.success) throw new Error(`${payload.type} failed: ${response.error}`);
    return response.data;
  }

  async function stop() {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    if (child.exitCode && child.exitCode !== 143 && stderrBuffer) {
      throw new Error(stderrBuffer.trim());
    }
  }

  return { child, messages, command, waitFor, stop };
}

async function readManifests() {
  const names = (await readdir(snapshots)).filter(
    (name) => name.startsWith("snapshot-") && name.endsWith(".json"),
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      path: join(snapshots, name),
      value: JSON.parse(await readFile(join(snapshots, name), "utf8")),
    })),
  );
}

async function verifyManifest(manifest) {
  assert(manifest.value.committed === true, `${manifest.name} is not committed`);
  const native = await readFile(join(snapshots, manifest.value.native.path));
  assert(sha256(native) === manifest.value.native.sha256, `${manifest.name} checksum mismatch`);
  return native;
}

const first = startRpc();
let firstSessionFile;
let secondSessionFile;
let initialSessionId;
let secondSessionId;
let settledSnapshot;
try {
  const startupNotification = await first.waitFor(
    (message) =>
      message.type === "extension_ui_request" &&
      message.method === "notify" &&
      message.message?.startsWith("phase0-session-start:"),
    "startup notification",
  );
  initialSessionId = startupNotification.message.split(":").at(-1);

  const initialState = await first.command({ type: "get_state" });
  assert(initialState.sessionId === initialSessionId, "startup notification session id mismatch");
  assert(initialState.model?.provider === "boss-man-phase0", "local provider was not selected");
  assert(initialState.model?.id === "complete", "initial local model was not selected");
  assert(initialState.sessionFile, "Pi did not allocate a session path");
  firstSessionFile = initialState.sessionFile;
  assert(!(await exists(firstSessionFile)), "header-only Pi session unexpectedly existed on disk");

  let manifests = await readManifests();
  assert(manifests.length === 0, "session startup copied native state before a custody boundary");

  const available = await first.command({ type: "get_available_models" });
  const localModelIds = available.models
    .filter((model) => model.provider === "boss-man-phase0")
    .map((model) => model.id)
    .sort();
  assert(JSON.stringify(localModelIds) === JSON.stringify(["complete", "slow"]), "local model list mismatch");

  const completeStartIndex = first.messages.length;
  await first.command({ type: "prompt", message: "phase0 complete prompt" });
  await first.waitFor(
    (message) => message.type === "agent_settled",
    "completed prompt to settle",
    completeStartIndex,
  );
  const completeEvents = first.messages.slice(completeStartIndex).map((message) => message.type);
  for (const required of [
    "agent_start",
    "turn_start",
    "message_start",
    "message_update",
    "message_end",
    "turn_end",
    "agent_end",
    "agent_settled",
  ]) {
    assert(completeEvents.includes(required), `completed prompt omitted ${required}`);
  }

  manifests = await readManifests();
  settledSnapshot = manifests.find(
    (manifest) =>
      manifest.value.session_id === initialSessionId &&
      manifest.value.trigger === "agent_settled" &&
      manifest.value.message_roles.includes("assistant"),
  );
  assert(settledSnapshot, "agent-settled snapshot was not committed");
  assert(settledSnapshot.value.source_file_existed === true, "settled snapshot did not use native JSONL");
  await verifyManifest(settledSnapshot);
  assert(
    manifests.filter((manifest) => manifest.value.session_id === initialSessionId).length === 1,
    "one owner-level turn produced more than one native custody copy",
  );
  assert(await exists(firstSessionFile), "completed turn did not flush native JSONL");

  const selectedSlow = await first.command({
    type: "set_model",
    provider: "boss-man-phase0",
    modelId: "slow",
  });
  assert(selectedSlow.provider === "boss-man-phase0" && selectedSlow.id === "slow", "set_model failed");
  const slowState = await first.command({ type: "get_state" });
  assert(slowState.model?.id === "slow", "model selection was not reflected in state");

  const abortStartIndex = first.messages.length;
  await first.command({ type: "prompt", message: "phase0 abort prompt" });
  await first.waitFor(
    (message) =>
      message.type === "message_update" && JSON.stringify(message).includes("phase0-abort-pending"),
    "abortable local provider delta",
    abortStartIndex,
  );
  await first.command({ type: "abort" });
  await first.waitFor(
    (message) => message.type === "agent_settled",
    "aborted prompt to settle",
    abortStartIndex,
  );
  const afterAbort = await first.command({ type: "get_state" });
  assert(afterAbort.isStreaming === false, "abort left Pi streaming");
  const abortEvents = first.messages.slice(abortStartIndex);
  assert(
    !abortEvents.some((message) => message.type?.startsWith("tool_execution_")),
    "abort path executed a tool",
  );

  const firstEntries = parseJsonl(await readFile(firstSessionFile, "utf8"));
  assert(
    firstEntries.some(
      (entry) => entry.type === "model_change" && entry.provider === "boss-man-phase0" && entry.modelId === "slow",
    ),
    "model change was not persisted",
  );
  assert(
    firstEntries.some(
      (entry) => entry.type === "message" && entry.message?.role === "assistant" && entry.message.stopReason === "aborted",
    ),
    "aborted assistant record was not persisted",
  );

  const oldId = initialSessionId;
  const newResult = await first.command({ type: "new_session", parentSession: firstSessionFile });
  assert(newResult.cancelled === false, "new_session was cancelled");
  const newState = await first.command({ type: "get_state" });
  secondSessionId = newState.sessionId;
  secondSessionFile = newState.sessionFile;
  assert(secondSessionId !== oldId, "new_session reused the prior id");
  assert(secondSessionFile && !(await exists(secondSessionFile)), "new session was not initially unflushed");

  manifests = await readManifests();
  assert(
    !manifests.some((manifest) => manifest.value.session_id === secondSessionId),
    "new session copied native state before its first owner-level settlement",
  );
  assert(
    manifests.some(
      (manifest) =>
        manifest.value.session_id === oldId && manifest.value.trigger === "before_switch_new",
    ),
    "old session was not snapshotted before new_session",
  );

  await first.command({ type: "set_model", provider: "boss-man-phase0", modelId: "complete" });
  const secondPromptIndex = first.messages.length;
  await first.command({ type: "prompt", message: "phase0 child session prompt" });
  await first.waitFor(
    (message) => message.type === "agent_settled",
    "new session prompt to settle",
    secondPromptIndex,
  );
  const secondEntries = parseJsonl(await readFile(secondSessionFile, "utf8"));
  assert(secondEntries[0].parentSession === firstSessionFile, "new session lost parent provenance");
  assert(
    secondEntries.filter(
      (entry) =>
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        JSON.stringify(entry.message.content).includes("phase0-deterministic-completion"),
    ).length === 1,
    "new session completion was lost or replayed",
  );

  const notifications = first.messages.filter(
    (message) => message.type === "extension_ui_request" && message.method === "notify",
  );
  assert(notifications.length >= 4, "RPC notification stream was incomplete");
} finally {
  await first.stop();
}

const restarted = startRpc(secondSessionFile);
try {
  const restartedState = await restarted.command({ type: "get_state" });
  assert(restartedState.sessionId === secondSessionId, "restart did not reopen the exact session");
  assert(restartedState.isStreaming === false, "restart incorrectly reported an active stream");
  const restartedEntries = parseJsonl(await readFile(secondSessionFile, "utf8"));
  assert(
    restartedEntries.filter(
      (entry) =>
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        JSON.stringify(entry.message.content).includes("phase0-deterministic-completion"),
    ).length === 1,
    "restart replayed a completed provider response",
  );
} finally {
  await restarted.stop();
}

const piExecutable = await realpath(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const piPackageRoot = dirname(dirname(piExecutable));
const { SessionManager } = await import(pathToFileURL(join(piPackageRoot, "dist/index.js")));
const settledManager = SessionManager.open(join(snapshots, settledSnapshot.value.native.path));
const settledContext = settledManager.buildSessionContext();
assert(
  settledContext.messages.length === 2
    && settledContext.messages[0].role === "user"
    && settledContext.messages[1].role === "assistant",
  "Pi could not reopen the owner-level settled snapshot",
);

const providerInvocations = parseJsonl(
  await readFile(join(snapshots, "local-provider-invocations.jsonl"), "utf8"),
);
assert(providerInvocations.length === 3, "unexpected local provider invocation count");
assert(
  providerInvocations.every((invocation) => invocation.provider === "boss-man-phase0"),
  "a non-local provider was invoked",
);

const piVersion = execFileSync("pi", ["--version"], {
  encoding: "utf8",
  env: childEnvironment,
}).trim();
process.stdout.write(
  `${JSON.stringify(
    {
      pi_version: piVersion,
      external_network_request_made: false,
      local_provider_invocations: providerInvocations.length,
      owner_settled_snapshot_reopenable: true,
      rpc_prompt_notifications_complete: true,
      rpc_abort_safe: true,
      model_selection_persisted: true,
      new_session_parent_provenance: true,
      exact_restart_no_replay: true,
      initial_session_id: initialSessionId,
      child_session_id: secondSessionId,
      settled_snapshot_sha256: settledSnapshot.value.native.sha256,
      isolated_root: root,
    },
    null,
    2,
  )}\n`,
);
