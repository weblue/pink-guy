#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const fixture = process.argv[2];

if (!fixture || !fixture.startsWith("/")) {
  console.error("usage: probe-pi-resume.mjs /absolute/path/to/generated/fixture");
  process.exit(64);
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

function countBashMarker(entries, marker) {
  return entries.filter(
    (entry) =>
      entry.type === "message" &&
      entry.message?.role === "bashExecution" &&
      entry.message?.output?.includes(marker),
  ).length;
}

function hasAncestor(entries, entry, ancestorId) {
  const byId = new Map(entries.filter((candidate) => candidate.id).map((candidate) => [candidate.id, candidate]));
  let current = entry;
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-pi-resume-"));
const sourceHome = join(root, "source-home");
const sourceConfig = join(root, "source-config");
const sourceSessions = join(root, "source-sessions");
const importHome = join(root, "import-home");
const importConfig = join(root, "import-config");
const importSessions = join(root, "import-sessions");
await Promise.all(
  [sourceHome, sourceConfig, sourceSessions, importHome, importConfig, importSessions].map(
    (directory) => mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
);

const sourceSession = join(sourceSessions, "phase0-resume-seed.jsonl");
const unknownEntry = {
  type: "boss_man_future_entry",
  id: "10000006",
  parentId: "10000005",
  timestamp: "2026-07-16T12:00:06.000Z",
  schemaVersion: 47,
  opaque: { preserve: true, value: "phase0-unknown-entry" },
};
const seedRecords = [
  {
    type: "session",
    version: 3,
    id: "019f6caf-bbfb-74c5-ad24-0b2e8cb49140",
    timestamp: "2026-07-16T12:00:00.000Z",
    cwd: fixture,
  },
  {
    type: "message",
    id: "10000001",
    parentId: null,
    timestamp: "2026-07-16T12:00:01.000Z",
    message: {
      role: "user",
      content: "Phase 0 resume seed",
      timestamp: Date.UTC(2026, 6, 16, 12, 0, 1),
    },
  },
  {
    type: "message",
    id: "10000002",
    parentId: "10000001",
    timestamp: "2026-07-16T12:00:02.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "phase0-tool-call",
          name: "read",
          arguments: { path: "TASK.md" },
        },
      ],
      api: "google-generative-ai",
      provider: "google",
      model: "phase0-no-provider",
      usage: {
        input: 100,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.UTC(2026, 6, 16, 12, 0, 2),
    },
  },
  {
    type: "message",
    id: "10000003",
    parentId: "10000002",
    timestamp: "2026-07-16T12:00:03.000Z",
    message: {
      role: "toolResult",
      toolCallId: "phase0-tool-call",
      toolName: "read",
      content: [{ type: "text", text: "synthetic TASK.md result" }],
      isError: false,
      timestamp: Date.UTC(2026, 6, 16, 12, 0, 3),
    },
  },
  {
    type: "model_change",
    id: "10000004",
    parentId: "10000003",
    timestamp: "2026-07-16T12:00:04.000Z",
    provider: "openai-codex",
    modelId: "phase0-model-change",
  },
  {
    type: "custom",
    id: "10000005",
    parentId: "10000004",
    timestamp: "2026-07-16T12:00:05.000Z",
    customType: "boss-man.phase0",
    data: { checkpoint: "before-resume" },
  },
  unknownEntry,
];
await writeFile(
  sourceSession,
  `${seedRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  { mode: 0o600 },
);

const baseEnvironment = (home, config, sessions) => ({
  HOME: home,
  LANG: process.env.LANG ?? "en_US.UTF-8",
  PATH: process.env.PATH,
  SHELL: process.env.SHELL ?? "/bin/sh",
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  PI_CODING_AGENT_DIR: config,
  PI_CODING_AGENT_SESSION_DIR: sessions,
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
});

async function runRpc({ home, config, sessions, session, marker }) {
  const child = spawn(
    "pi",
    [
      "--mode",
      "rpc",
      "--session-dir",
      sessions,
      "--session",
      session,
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-approve",
      "--offline",
    ],
    {
      cwd: fixture,
      env: baseEnvironment(home, config, sessions),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdoutBuffer = "";
  let stderrBuffer = "";
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
      for (let index = 0; index < waiters.length; index += 1) {
        const waiter = waiters[index];
        if (waiter.predicate(parsed)) {
          waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(parsed);
          break;
        }
      }
    }
  });

  function waitFor(predicate, description) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error(`timed out waiting for ${description}`)),
        30_000,
      );
      waiters.push({ predicate, resolve: resolvePromise, timer });
    });
  }

  async function command(payload) {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    const response = await waitFor(
      (message) => message.type === "response" && message.command === payload.type,
      `${payload.type} response`,
    );
    const index = messages.indexOf(response);
    if (index >= 0) messages.splice(index, 1);
    if (!response.success) throw new Error(`${payload.type} failed: ${response.error}`);
    return response.data;
  }

  try {
    const initialState = await command({ type: "get_state" });
    const initialMessages = await command({ type: "get_messages" });
    const bash = await command({
      type: "bash",
      command: `printf '%s\\n' '${marker}'`,
    });
    assert(bash.exitCode === 0, `bash append failed for ${marker}`);
    const finalState = await command({ type: "get_state" });
    return { initialState, initialMessages: initialMessages.messages, finalState };
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    if (child.exitCode && stderrBuffer) {
      throw new Error(stderrBuffer.trim());
    }
  }
}

const firstMarker = "phase0-resume-first";
const secondMarker = "phase0-resume-second";
const importMarker = "phase0-import-append";

const firstRun = await runRpc({
  home: sourceHome,
  config: sourceConfig,
  sessions: sourceSessions,
  session: sourceSession,
  marker: firstMarker,
});
assert(firstRun.initialState.sessionId === seedRecords[0].id, "first run changed session id");
assert(firstRun.initialMessages.length === 3, "first run did not reconstruct message/tool context");

let sourceEntries = parseJsonl(await readFile(sourceSession, "utf8"));
let retainedUnknown = sourceEntries.find((entry) => entry.id === unknownEntry.id);
assert(JSON.stringify(retainedUnknown) === JSON.stringify(unknownEntry), "first run changed unknown entry");
const firstAppend = sourceEntries.find(
  (entry) => entry.type === "message" && entry.message?.output?.includes(firstMarker),
);
assert(
  firstAppend && hasAncestor(sourceEntries, firstAppend, unknownEntry.id),
  "first resume did not continue from unknown leaf",
);

const secondRun = await runRpc({
  home: sourceHome,
  config: sourceConfig,
  sessions: sourceSessions,
  session: sourceSession,
  marker: secondMarker,
});
assert(secondRun.initialState.sessionId === seedRecords[0].id, "second run changed session id");
assert(secondRun.initialMessages.length === 4, "second run did not restore prior runtime append");

sourceEntries = parseJsonl(await readFile(sourceSession, "utf8"));
retainedUnknown = sourceEntries.find((entry) => entry.id === unknownEntry.id);
assert(JSON.stringify(retainedUnknown) === JSON.stringify(unknownEntry), "second run changed unknown entry");
assert(countBashMarker(sourceEntries, firstMarker) === 1, "first append was lost or replayed");
assert(countBashMarker(sourceEntries, secondMarker) === 1, "second append was lost or replayed");

const piExecutable = await realpath(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const piPackageRoot = dirname(dirname(piExecutable));
const { SessionManager } = await import(pathToFileURL(join(piPackageRoot, "dist/index.js")));
const importedManager = SessionManager.forkFrom(sourceSession, fixture, importSessions, {
  id: "phase0-import",
});
const importedSession = importedManager.getSessionFile();
assert(importedSession, "clean-home import did not create a session file");

let importedEntries = parseJsonl(await readFile(importedSession, "utf8"));
retainedUnknown = importedEntries.find((entry) => entry.id === unknownEntry.id);
assert(JSON.stringify(retainedUnknown) === JSON.stringify(unknownEntry), "import changed unknown entry");
assert(importedEntries[0].id === "phase0-import", "import did not assign the requested session id");
assert(importedEntries[0].parentSession === sourceSession, "import did not record source provenance");

const importRun = await runRpc({
  home: importHome,
  config: importConfig,
  sessions: importSessions,
  session: importedSession,
  marker: importMarker,
});
assert(importRun.initialState.sessionId === "phase0-import", "imported session id did not resume");
assert(importRun.initialMessages.length === 5, "import did not restore complete runtime context");

importedEntries = parseJsonl(await readFile(importedSession, "utf8"));
retainedUnknown = importedEntries.find((entry) => entry.id === unknownEntry.id);
assert(JSON.stringify(retainedUnknown) === JSON.stringify(unknownEntry), "import resume changed unknown entry");
assert(countBashMarker(importedEntries, firstMarker) === 1, "import replayed first append");
assert(countBashMarker(importedEntries, secondMarker) === 1, "import replayed second append");
assert(countBashMarker(importedEntries, importMarker) === 1, "import append was lost or replayed");

const piVersion = execFileSync("pi", ["--version"], {
  encoding: "utf8",
  env: baseEnvironment(importHome, importConfig, importSessions),
}).trim();
process.stdout.write(
  `${JSON.stringify(
    {
      pi_version: piVersion,
      provider_request_made: false,
      exact_resume_passed: true,
      clean_home_import_passed: true,
      unknown_entry_preserved: true,
      tool_result_preserved: true,
      completed_runtime_actions_replayed: false,
      source_session_sha256: sha256(await readFile(sourceSession)),
      imported_session_sha256: sha256(await readFile(importedSession)),
      source_entry_count: sourceEntries.length,
      imported_entry_count: importedEntries.length,
      isolated_root: root,
    },
    null,
    2,
  )}\n`,
);
