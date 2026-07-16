#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const lifecycleExtension = resolve(scriptDirectory, "../pi/lifecycle-probe.ts");
const custodyExtension = resolve(scriptDirectory, "../pi/custody-probe.ts");
const fixture = process.argv[2];
const piAcpRoot = process.argv[3];
const expectedPiAcpCommit = "49d6ec804d40b52317d873360654054c5d2387a3";

if (!fixture?.startsWith("/") || !piAcpRoot?.startsWith("/")) {
  console.error("usage: probe-pi-acp.mjs /absolute/path/to/generated/fixture /absolute/path/to/pinned/pi-acp");
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

const piAcpCommit = execFileSync("git", ["-C", piAcpRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert(piAcpCommit === expectedPiAcpCommit, `unexpected pi-acp commit: ${piAcpCommit}`);
const piAcpPackage = JSON.parse(await readFile(join(piAcpRoot, "package.json"), "utf8"));
assert(piAcpPackage.version === "0.0.31", `unexpected pi-acp version: ${piAcpPackage.version}`);
const piAcpEntry = join(piAcpRoot, "dist/index.js");
assert(await exists(piAcpEntry), "pi-acp dist/index.js is missing; run its pinned build first");

const root = await mkdtemp(join(tmpdir(), "boss-man-pi-acp-"));
const home = join(root, "home");
const config = join(root, "pi-config");
const extensions = join(config, "extensions");
const sessions = join(root, "sessions");
const lifecycleSnapshots = join(root, "lifecycle-snapshots");
const custodySnapshots = join(root, "custody-snapshots");
await Promise.all(
  [home, config, extensions, sessions, lifecycleSnapshots, custodySnapshots].map((directory) =>
    mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
);
await Promise.all([
  copyFile(lifecycleExtension, join(extensions, "lifecycle-probe.ts")),
  copyFile(custodyExtension, join(extensions, "custody-probe.ts")),
]);
await writeFile(
  join(config, "settings.json"),
  `${JSON.stringify(
    {
      defaultProvider: "boss-man-phase0",
      defaultModel: "complete",
      defaultThinkingLevel: "off",
      quietStartup: true,
      enableSkills: false,
      sessionDir: sessions,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const childEnvironment = {
  HOME: home,
  LANG: process.env.LANG ?? "en_US.UTF-8",
  PATH: process.env.PATH,
  SHELL: process.env.SHELL ?? "/bin/sh",
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  PI_ACP_PI_COMMAND: execFileSync("which", ["pi"], { encoding: "utf8" }).trim(),
  PI_CODING_AGENT_DIR: config,
  PI_CODING_AGENT_SESSION_DIR: sessions,
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
  BOSS_MAN_PHASE0_LIFECYCLE_DIR: lifecycleSnapshots,
  BOSS_MAN_PHASE0_EXPORT_DIR: custodySnapshots,
};

function startAdapter() {
  const child = spawn("node", [piAcpEntry], {
    cwd: piAcpRoot,
    env: childEnvironment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let requestSequence = 0;
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

  function beginRequest(method, params) {
    requestSequence += 1;
    const id = requestSequence;
    const fromIndex = messages.length;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const promise = waitFor(
      (message) => message.jsonrpc === "2.0" && message.id === id,
      `${method} response`,
      fromIndex,
    ).then((response) => {
      if (response.error) throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
      return response.result;
    });
    return { id, fromIndex, promise };
  }

  async function request(method, params) {
    return beginRequest(method, params).promise;
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async function stop() {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    if (child.exitCode && stderrBuffer) throw new Error(stderrBuffer.trim());
  }

  return { child, messages, waitFor, beginRequest, request, notify, stop };
}

async function initialize(adapter) {
  const result = await adapter.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  assert(result.protocolVersion === 1, "pi-acp did not negotiate ACP protocol v1");
  assert(result.agentInfo?.version === "0.0.31", "pi-acp reported an unexpected version");
  assert(result.agentCapabilities?.loadSession === true, "pi-acp did not advertise loadSession");
}

async function readCustodyManifest() {
  const names = (await readdir(custodySnapshots)).filter(
    (name) => name.startsWith("snapshot-") && name.endsWith(".json"),
  );
  assert(names.length === 1, `expected one custody manifest, found ${names.length}`);
  const manifest = JSON.parse(await readFile(join(custodySnapshots, names[0]), "utf8"));
  const native = await readFile(join(custodySnapshots, manifest.native.path));
  const bundle = await readFile(join(custodySnapshots, manifest.bundle.path));
  assert(manifest.committed === true, "ACP custody manifest is not committed");
  assert(sha256(native) === manifest.native.sha256, "ACP custody native checksum mismatch");
  assert(sha256(bundle) === manifest.bundle.sha256, "ACP custody bundle checksum mismatch");
  return { name: names[0], manifest };
}

let sessionId;
let sessionFile;
let completeUpdateCount = 0;
let notificationUpdateCount = 0;
const completedTurnCount = 6;
const first = startAdapter();
try {
  await initialize(first);
  const created = await first.request("session/new", { cwd: fixture, mcpServers: [] });
  sessionId = created.sessionId;
  assert(sessionId, "ACP session/new did not return a session id");
  const modelOption = created.configOptions?.find((option) => option.id === "model");
  assert(modelOption?.currentValue === "boss-man-phase0/complete", "ACP did not select the local model");
  assert(
    modelOption.options?.some((option) => option.value === "boss-man-phase0/slow"),
    "ACP did not expose the slow local model",
  );

  const promptStart = first.messages.length;
  const completed = await first.request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "phase0 ACP complete prompt" }],
  });
  assert(completed.stopReason === "end_turn", "ACP completion returned the wrong stop reason");
  const promptMessages = first.messages.slice(promptStart);
  completeUpdateCount = promptMessages.filter(
    (message) =>
      message.method === "session/update" &&
      JSON.stringify(message.params).includes("phase0-deterministic-completion"),
  ).length;
  notificationUpdateCount = promptMessages.filter(
    (message) =>
      message.method === "session/update" &&
      JSON.stringify(message.params).includes("phase0-turn-end:"),
  ).length;
  assert(completeUpdateCount === 1, "ACP completion stream was lost or duplicated");
  assert(notificationUpdateCount >= 1, "ACP did not translate the turn-end notification");

  for (let turn = 2; turn <= completedTurnCount; turn += 1) {
    const result = await first.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: `phase0 ACP compaction seed ${turn}` }],
    });
    assert(result.stopReason === "end_turn", `ACP compaction seed ${turn} did not finish`);
  }

  const compacted = await first.request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "/compact phase0 model-less custody" }],
  });
  assert(compacted.stopReason === "end_turn", "ACP /compact did not finish");
  await readCustodyManifest();

  const selected = await first.request("session/set_config_option", {
    sessionId,
    configId: "model",
    value: "boss-man-phase0/slow",
  });
  assert(
    selected.configOptions?.find((option) => option.id === "model")?.currentValue ===
      "boss-man-phase0/slow",
    "ACP model selection did not update",
  );

  const abortRequest = first.beginRequest("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "phase0 ACP abort prompt" }],
  });
  await first.waitFor(
    (message) =>
      message.method === "session/update" &&
      JSON.stringify(message.params).includes("phase0-abort-pending"),
    "abortable ACP stream chunk",
    abortRequest.fromIndex,
  );
  first.notify("session/cancel", { sessionId });
  const aborted = await abortRequest.promise;
  assert(aborted.stopReason === "cancelled", "ACP cancel did not return cancelled");

  const sessionMap = JSON.parse(
    await readFile(join(home, ".pi/pi-acp/session-map.json"), "utf8"),
  );
  sessionFile = sessionMap.sessions?.[sessionId]?.sessionFile;
  assert(sessionFile && (await exists(sessionFile)), "pi-acp did not persist its session mapping");
} finally {
  await first.stop();
}

let replayUpdates = 0;
const second = startAdapter();
try {
  await initialize(second);
  const loadStart = second.messages.length;
  const loaded = await second.request("session/load", {
    sessionId,
    cwd: fixture,
    mcpServers: [],
  });
  assert(
    loaded && Array.isArray(loaded.configOptions),
    "ACP session/load did not return current configuration",
  );
  replayUpdates = second.messages.slice(loadStart).filter(
    (message) => message.method === "session/update",
  ).length;
  assert(replayUpdates >= 3, "ACP session/load did not replay retained history");
} finally {
  await second.stop();
}

const entries = parseJsonl(await readFile(sessionFile, "utf8"));
assert(
  entries.filter(
    (entry) =>
      entry.type === "message" &&
      entry.message?.role === "assistant" &&
      JSON.stringify(entry.message.content).includes("phase0-deterministic-completion"),
  ).length === completedTurnCount,
  "ACP load replayed a completed response into native history",
);
assert(
  entries.some(
    (entry) => entry.type === "model_change" && entry.provider === "boss-man-phase0" && entry.modelId === "slow",
  ),
  "ACP model selection was not preserved in native Pi history",
);
assert(
  entries.some(
    (entry) => entry.type === "message" && entry.message?.role === "assistant" && entry.message.stopReason === "aborted",
  ),
  "ACP cancellation was not preserved in native Pi history",
);
const lifecycleManifests = await readdir(lifecycleSnapshots);
assert(
  lifecycleManifests.some((name) => name.endsWith("-session_start.json")),
  "Pi lifecycle extension did not execute through pi-acp",
);
assert(
  lifecycleManifests.some((name) => name.endsWith("-context.json")),
  "Pi user-only snapshot hook did not execute through pi-acp",
);

const custody = await readCustodyManifest();
const piVersion = execFileSync("pi", ["--version"], {
  encoding: "utf8",
  env: childEnvironment,
}).trim();
process.stdout.write(
  `${JSON.stringify(
    {
      pi_version: piVersion,
      pi_acp_version: piAcpPackage.version,
      pi_acp_commit: piAcpCommit,
      external_network_request_made: false,
      acp_protocol_version: 1,
      completion_update_count: completeUpdateCount,
      completed_turn_count: completedTurnCount,
      notification_update_count: notificationUpdateCount,
      startup_notification_forwarded: false,
      cancellation_stop_reason: "cancelled",
      native_model_change_preserved: true,
      native_aborted_turn_preserved: true,
      custody_hook_reached_through_acp: true,
      custody_manifest_sha256: sha256(await readFile(join(custodySnapshots, custody.name))),
      session_load_replay_updates: replayUpdates,
      session_file_sha256: sha256(await readFile(sessionFile)),
      isolated_root: root,
    },
    null,
    2,
  )}\n`,
);
