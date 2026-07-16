#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extension = resolve(scriptDirectory, "../pi/custody-probe.ts");
const fixture = process.argv[2];
const forceFailure = process.argv[3] === "--force-failure";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

if (!fixture || !fixture.startsWith("/")) {
  console.error(
    "usage: probe-pi-custody.mjs /absolute/path/to/generated/fixture [--force-failure]",
  );
  process.exit(64);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-pi-custody-"));
const home = join(root, "home");
const config = join(root, "pi-config");
const sessions = join(root, "sessions");
const exportsDirectory = join(root, "exports");
await Promise.all([
  mkdir(home, { recursive: true }),
  mkdir(config, { recursive: true }),
  mkdir(sessions, { recursive: true }),
  mkdir(exportsDirectory, { recursive: true }),
]);

const seedSession = join(sessions, "phase0-seed.jsonl");
const seedRecords = [
  {
    type: "session",
    version: 3,
    id: "019f6caf-bbfb-74c5-ad24-0b2e8cb4913f",
    timestamp: "2026-07-16T12:00:00.000Z",
    cwd: fixture,
  },
];

let parentId = null;
for (let index = 0; index < 6; index += 1) {
  const userId = (index * 2 + 1).toString(16).padStart(8, "0");
  const assistantId = (index * 2 + 2).toString(16).padStart(8, "0");
  seedRecords.push({
    type: "message",
    id: userId,
    parentId,
    timestamp: `2026-07-16T12:00:${String(index * 2 + 1).padStart(2, "0")}.000Z`,
    message: {
      role: "user",
      content: `Phase 0 synthetic turn ${index}: preserve native session evidence.`,
      timestamp: Date.UTC(2026, 6, 16, 12, 0, index * 2 + 1),
    },
  });
  seedRecords.push({
    type: "message",
    id: assistantId,
    parentId: userId,
    timestamp: `2026-07-16T12:00:${String(index * 2 + 2).padStart(2, "0")}.000Z`,
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Synthetic assistant evidence ${index}. ${"context ".repeat(2500)}`,
        },
      ],
      api: "google-generative-ai",
      provider: "google",
      model: "phase0-no-provider",
      usage: {
        input: (index + 1) * 10_000,
        output: 1_000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: (index + 1) * 10_000 + 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.UTC(2026, 6, 16, 12, 0, index * 2 + 2),
    },
  });
  parentId = assistantId;
}
await writeFile(seedSession, `${seedRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, {
  mode: 0o600,
});

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
  BOSS_MAN_PHASE0_EXPORT_DIR: exportsDirectory,
  ...(forceFailure ? { BOSS_MAN_PHASE0_FORCE_EXPORT_FAILURE: "1" } : {}),
};

const piVersion = execFileSync("pi", ["--version"], {
  encoding: "utf8",
  env: childEnvironment,
}).trim();

if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(piVersion)) {
  throw new Error(`unexpected Pi version output: ${JSON.stringify(piVersion)}`);
}

const child = spawn(
  "pi",
  [
    "--mode",
    "rpc",
    "--session-dir",
    sessions,
    "--session",
    seedSession,
    "--extension",
    extension,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "--offline",
  ],
  {
    cwd: fixture,
    env: childEnvironment,
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
    const record = stdoutBuffer.slice(0, boundary);
    stdoutBuffer = stdoutBuffer.slice(boundary + 1);
    if (record.length === 0) continue;
    const parsed = JSON.parse(record);
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
    const timer = setTimeout(() => {
      rejectPromise(new Error(`timed out waiting for ${description}`));
    }, 30_000);
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
  return response;
}

let exitCode = 1;
try {
  const initialState = await command({ type: "get_state" });
  if (!initialState.success || !initialState.data?.sessionFile) {
    throw new Error("Pi did not create a persistent session");
  }

  const bash = await command({
    type: "bash",
    command: "printf 'phase0 runtime append\\n'",
  });
  if (!bash.success || bash.data?.exitCode !== 0) {
    throw new Error("bash runtime append failed");
  }

  const compact = await command({ type: "compact" });
  if (forceFailure) {
    const files = await readdir(exportsDirectory);
    const manifests = files.filter((name) => name.startsWith("snapshot-") && name.endsWith(".json"));
    if (compact.success || manifests.length !== 0 || files.includes("provider-request-observed")) {
      throw new Error("forced export failure did not cancel compaction cleanly");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          pi_version: piVersion,
          provider_request_made: false,
          forced_export_failure: true,
          compaction_cancelled: true,
          committed_snapshot_count: 0,
          isolated_home: root,
        },
        null,
        2,
      )}\n`,
    );
    exitCode = 0;
    throw new Error("__EXPECTED_FORCE_FAILURE_COMPLETE__");
  }
  if (!compact.success) {
    throw new Error(`compact failed: ${compact.error ?? "unknown error"}`);
  }

  const files = await readdir(exportsDirectory);
  const manifestName = files.find((name) => name.startsWith("snapshot-") && name.endsWith(".json"));
  if (!manifestName) {
    throw new Error("pre-compaction snapshot manifest was not committed");
  }

  const manifest = JSON.parse(await readFile(join(exportsDirectory, manifestName), "utf8"));
  if (manifest.committed !== true) {
    throw new Error("snapshot manifest is not committed");
  }

  const nativeContent = await readFile(join(exportsDirectory, manifest.native.path));
  const bundleContent = await readFile(join(exportsDirectory, manifest.bundle.path));
  if (sha256(nativeContent) !== manifest.native.sha256) {
    throw new Error("native snapshot checksum mismatch");
  }
  if (sha256(bundleContent) !== manifest.bundle.sha256) {
    throw new Error("bundle snapshot checksum mismatch");
  }

  const nativeEntries = nativeContent
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (nativeEntries.some((entry) => entry.type === "compaction")) {
    throw new Error("pre-compaction native snapshot unexpectedly contains compaction entry");
  }

  const finalState = await command({ type: "get_state" });
  const committedSession = (await readFile(finalState.data.sessionFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (!committedSession.some((entry) => entry.type === "compaction")) {
    throw new Error("active session did not commit the post-snapshot compaction entry");
  }
  if (files.includes("provider-request-observed")) {
    throw new Error("probe observed an unexpected provider request");
  }
  const result = {
    pi_version: piVersion,
    provider_request_made: false,
    isolated_home: root,
    session_file: finalState.data?.sessionFile,
    snapshot_manifest: join(exportsDirectory, manifestName),
    native_sha256: manifest.native.sha256,
    bundle_sha256: manifest.bundle.sha256,
    compact_summary: compact.data?.summary,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitCode = 0;
} catch (error) {
  if (!(error instanceof Error && error.message === "__EXPECTED_FORCE_FAILURE_COMPLETE__")) {
    console.error(error instanceof Error ? error.message : error);
    if (stderrBuffer) console.error(stderrBuffer.trim());
  }
} finally {
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

process.exit(exitCode);
