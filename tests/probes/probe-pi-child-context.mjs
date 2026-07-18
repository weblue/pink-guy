#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-pi-child-context.mjs /absolute/path/to/generated/fixture");
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

async function persistUnflushed(manager) {
  const path = manager.getSessionFile();
  assert(path, "child SessionManager did not allocate a file path");
  const content = `${[manager.getHeader(), ...manager.getEntries()]
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
  await writeFile(path, content, { mode: 0o600, flag: "wx" });
  return path;
}

const piExecutable = await realpath(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const piPackageRoot = dirname(dirname(piExecutable));
const { SessionManager } = await import(pathToFileURL(join(piPackageRoot, "dist/index.js")));

const root = await mkdtemp(join(tmpdir(), "boss-man-pi-child-context-"));
const sourceDirectory = join(root, "source");
const freshDirectory = join(root, "fresh");
const bundleDirectory = join(root, "bundle");
const forkDirectory = join(root, "fork");
const artifactsDirectory = join(root, "artifacts");
await Promise.all(
  [sourceDirectory, freshDirectory, bundleDirectory, forkDirectory, artifactsDirectory].map(
    (directory) => mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
);

const sourceSession = join(sourceDirectory, "source.jsonl");
const sourceRecords = [
  {
    type: "session",
    version: 3,
    id: "phase0-source",
    timestamp: "2026-07-16T12:00:00.000Z",
    cwd: fixture,
  },
  {
    type: "message",
    id: "20000001",
    parentId: null,
    timestamp: "2026-07-16T12:00:01.000Z",
    message: {
      role: "user",
      content: "Inspect the fixture and preserve child provenance.",
      timestamp: Date.UTC(2026, 6, 16, 12, 0, 1),
    },
  },
  {
    type: "message",
    id: "20000002",
    parentId: "20000001",
    timestamp: "2026-07-16T12:00:02.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "phase0-child-tool",
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
    id: "20000003",
    parentId: "20000002",
    timestamp: "2026-07-16T12:00:03.000Z",
    message: {
      role: "toolResult",
      toolCallId: "phase0-child-tool",
      toolName: "read",
      content: [{ type: "text", text: "synthetic child-context tool result" }],
      isError: false,
      timestamp: Date.UTC(2026, 6, 16, 12, 0, 3),
    },
  },
  {
    type: "custom",
    id: "20000004",
    parentId: "20000003",
    timestamp: "2026-07-16T12:00:04.000Z",
    customType: "boss-man.source-provenance",
    data: { decision: "retain-complete-session" },
  },
];
await writeFile(
  sourceSession,
  `${sourceRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  { mode: 0o600 },
);
const sourceContent = await readFile(sourceSession);
const sourceSha256 = sha256(sourceContent);

const selectedArtifact = join(artifactsDirectory, "review-input.txt");
const selectedArtifactContent = "Phase 0 selected child artifact\n";
await writeFile(selectedArtifact, selectedArtifactContent, { mode: 0o600 });
const selectedArtifactSha256 = sha256(selectedArtifactContent);

const bundleValue = {
  schema_version: "phase0-child-bundle-0.1.0",
  source_session: { id: "phase0-source", sha256: sourceSha256 },
  selected_branch_entry_ids: sourceRecords.slice(1).map((record) => record.id),
  task: {
    instruction: "Validate child context provenance without replaying source actions.",
  },
  selected_artifacts: [
    {
      logical_name: "review-input",
      sha256: selectedArtifactSha256,
    },
  ],
};
const bundleContent = `${JSON.stringify(bundleValue, null, 2)}\n`;
const bundleSha256 = sha256(bundleContent);
const bundlePath = join(artifactsDirectory, `bundle-${bundleSha256}.json`);
await writeFile(bundlePath, bundleContent, { mode: 0o600 });

const freshManager = SessionManager.create(fixture, freshDirectory, {
  id: "phase0-fresh",
  parentSession: sourceSession,
});
freshManager.appendCustomEntry("boss-man.child-provenance", {
  mode: "fresh",
  source_session_sha256: sourceSha256,
});
freshManager.appendCustomMessageEntry(
  "boss-man.child-context",
  `Fresh child instructions only. Artifact review-input sha256:${selectedArtifactSha256}`,
  false,
  { mode: "fresh", artifact_sha256: selectedArtifactSha256 },
);
const freshPath = await persistUnflushed(freshManager);

const bundleManager = SessionManager.create(fixture, bundleDirectory, {
  id: "phase0-bundle",
  parentSession: sourceSession,
});
bundleManager.appendCustomEntry("boss-man.child-provenance", {
  mode: "bundle",
  source_session_sha256: sourceSha256,
  bundle_sha256: bundleSha256,
});
bundleManager.appendCustomMessageEntry(
  "boss-man.child-context",
  `Verified deterministic context bundle sha256:${bundleSha256}. Selected artifact review-input sha256:${selectedArtifactSha256}. Retrieve bundle sections by checksum; do not assume the full source transcript is in context.`,
  false,
  {
    mode: "bundle",
    bundle_sha256: bundleSha256,
    artifact_sha256: selectedArtifactSha256,
  },
);
const bundleChildPath = await persistUnflushed(bundleManager);

const forkManager = SessionManager.forkFrom(sourceSession, fixture, forkDirectory, {
  id: "phase0-full-fork",
});
forkManager.appendCustomEntry("boss-man.child-provenance", {
  mode: "fork",
  source_session_sha256: sourceSha256,
  selected_leaf_id: "20000004",
});
const forkPath = forkManager.getSessionFile();
assert(forkPath, "full fork did not create a native session");

const reopenedFresh = SessionManager.open(freshPath);
const freshContext = reopenedFresh.buildSessionContext().messages;
assert(freshContext.length === 1 && freshContext[0].role === "custom", "fresh child context shape changed");
assert(
  !JSON.stringify(freshContext).includes("synthetic child-context tool result"),
  "fresh child leaked source transcript/tool context",
);

const reopenedBundle = SessionManager.open(bundleChildPath);
const bundleContext = reopenedBundle.buildSessionContext().messages;
assert(bundleContext.length === 1 && bundleContext[0].role === "custom", "bundle child context shape changed");
assert(JSON.stringify(bundleContext).includes(bundleSha256), "bundle child lost bundle checksum receipt");
assert(JSON.stringify(bundleContext).includes(selectedArtifactSha256), "bundle child lost artifact receipt");
assert(
  !JSON.stringify(bundleContext).includes("synthetic child-context tool result"),
  "bundle child eagerly injected source tool history",
);

const reopenedFork = SessionManager.open(forkPath);
const forkContext = reopenedFork.buildSessionContext().messages;
assert(
  JSON.stringify(forkContext).includes("synthetic child-context tool result"),
  "full fork lost source tool result",
);
assert(
  forkContext.map((message) => message.role).join(",") === "user,assistant,toolResult",
  "full fork did not preserve complete source message roles",
);

const forkRecords = parseJsonl(await readFile(forkPath, "utf8"));
assert(forkRecords[0].id === "phase0-full-fork", "full fork did not assign new identity");
assert(forkRecords[0].parentSession === sourceSession, "full fork lost source provenance");
for (const sourceRecord of sourceRecords.slice(1)) {
  const retained = forkRecords.find((record) => record.id === sourceRecord.id);
  assert(JSON.stringify(retained) === JSON.stringify(sourceRecord), `full fork changed ${sourceRecord.id}`);
}

const piVersion = execFileSync("pi", ["--version"], { encoding: "utf8" }).trim();
process.stdout.write(
  `${JSON.stringify(
    {
      pi_version: piVersion,
      provider_request_made: false,
      fresh_child_passed: true,
      bundle_child_passed: true,
      full_fork_child_passed: true,
      source_session_sha256: sourceSha256,
      bundle_sha256: bundleSha256,
      selected_artifact_sha256: selectedArtifactSha256,
      fresh_session_sha256: sha256(await readFile(freshPath)),
      bundle_session_sha256: sha256(await readFile(bundleChildPath)),
      fork_session_sha256: sha256(await readFile(forkPath)),
      isolated_root: root,
    },
    null,
    2,
  )}\n`,
);
