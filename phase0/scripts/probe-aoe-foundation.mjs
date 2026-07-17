#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const expectedCommit = "90855a59360f46652786a49f54a56df002d8ef98";
const root = process.argv[2];

if (!root?.startsWith("/")) {
  console.error("usage: probe-aoe-foundation.mjs /absolute/path/to/pinned-agent-of-empires");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const paths = {
  container: "src/session/container_config.rs",
  cliAdd: "src/cli/add.rs",
  cliSession: "src/cli/session.rs",
  server: "src/server/mod.rs",
  serverSessions: "src/server/api/sessions.rs",
  pluginApi: "aoe-plugin-api/src/capability.rs",
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(join(root, path), "utf8")])),
);
const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert(commit === expectedCommit, `expected AoE ${expectedCommit}, found ${commit}`);

const cliStorageWrites = count(`${contents.cliAdd}\n${contents.cliSession}`, /storage\.update\(/g);
const serverStorageWrites = count(`${contents.server}\n${contents.serverSessions}`, /storage\.update\(/g);
const writableMainRepoMounts = count(contents.container, /host_path:\s*main_repo_canonical[\s\S]{0,180}?read_only:\s*false/g)
  + count(contents.container, /host_path:\s*repo_path[\s\S]{0,180}?read_only:\s*false/g);
const sessionRoutes = count(contents.server, /\.route\("\/api\/sessions/g);
const taskRoutes = count(contents.server, /\.route\("\/api\/tasks/g);
const authorityCapabilities = count(
  contents.pluginApi,
  /"(?:task|git|worktree)\.[^"]+"|"session\.(?:create|start|stop|prompt|resume)"/g,
);

assert(cliStorageWrites > 0, "expected CLI session storage mutation seam was not found");
assert(serverStorageWrites > 0, "expected server session storage mutation seam was not found");
assert(writableMainRepoMounts > 0, "expected writable main Git repository mount was not found");
assert(sessionRoutes > 0 && taskRoutes === 0, "expected session-first routes without a task route");
assert(authorityCapabilities === 0, "plugin capability surface unexpectedly exposes task/session/Git authority");

process.stdout.write(`${JSON.stringify({
  candidate: "aoe",
  commit,
  inspection_passed: true,
  candidate_eligible: false,
  stop_rule: "A bounded product layer would need to replace or mediate lifecycle storage, server routing, sandbox Git mounts, and top-level task navigation.",
  hard_gate_conflicts: {
    "G-01": {
      cli_storage_writes: cliStorageWrites,
      server_storage_writes: serverStorageWrites,
      result: "current CLI and daemon are both durable lifecycle writers",
    },
    "G-05": {
      writable_main_repo_mount_seams: writableMainRepoMounts,
      result: "sandbox resolution mounts the main repository and shared Git metadata read-write",
    },
  },
  product_layer_gaps: {
    session_routes: sessionRoutes,
    task_routes: taskRoutes,
    plugin_task_session_git_authority_capabilities: authorityCapabilities,
  },
  source_sha256: Object.fromEntries(Object.entries(contents).map(([key, body]) => [paths[key], sha256(body)])),
}, null, 2)}\n`);
