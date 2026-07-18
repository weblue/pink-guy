#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";
import {
  renderOrchestratorLeasesPanel,
  splitOrchestratorLeaseRecords,
} from "../../src/ui/lease-view.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-orchestrator-lease-history.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-lease-history-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
  runtimeThinking: "medium",
});
authority.seed({
  projectId: "lease-history-project",
  repositoryId: "lease-history-repository",
  projectName: "Lease history project",
  taskId: "lease-history-task",
  repositoryPath: fixture,
  title: "Existing visible task",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const value = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, value };
}

const shell = await request("/");
assert(shell.status === 200, "cockpit shell not served");
assert(shell.value.includes('import { renderOrchestratorLeasesPanel } from "/ui/lease-view.mjs";'), "cockpit did not load the lease view module");

const moduleResponse = await request("/ui/lease-view.mjs");
assert(moduleResponse.status === 200, "lease view module not served");
assert(moduleResponse.value.includes("renderOrchestratorLeasesPanel"), "lease view module content missing");

const leaseView = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../src/ui/lease-view.mjs")).href);
const split = leaseView.splitOrchestratorLeaseRecords({
  projectOrchestrators: [
    { project_name: "Project Alpha", transport: "daemon", status: "active", endpoint: "tcp://alpha" },
    { project_name: "Project Beta", transport: "tmux", status: "released", endpoint: "tmux://beta" },
  ],
  conversationLeases: [
    { scope_type: "project", scope_id: "alpha", transport: "daemon", status: "active", endpoint: "tcp://alpha-conv" },
    { scope_type: "system_intake", scope_id: "system-intake", transport: "tmux", status: "expired", endpoint: "tmux://intake" },
  ],
});
assert(split.activeProjectOrchestrators.length === 1, "active project orchestrator count incorrect");
assert(split.activeConversationLeases.length === 1, "active conversation lease count incorrect");
assert(split.inactiveCount === 2, "inactive lease count incorrect");

const rendered = leaseView.renderOrchestratorLeasesPanel({
  projectOrchestrators: [
    { project_name: "Project Alpha", transport: "daemon", status: "active", endpoint: "tcp://alpha" },
    { project_name: "Project Beta", transport: "tmux", status: "released", endpoint: "tmux://beta" },
  ],
  conversationLeases: [
    { scope_type: "project", scope_id: "alpha", transport: "daemon", status: "active", endpoint: "tcp://alpha-conv" },
    { scope_type: "system_intake", scope_id: "system-intake", transport: "tmux", status: "expired", endpoint: "tmux://intake" },
  ],
});
assert(rendered.includes("Active project orchestrators"), "active project heading missing");
assert(rendered.includes("Active conversation leases"), "active conversation heading missing");
assert(rendered.includes("Lease history</strong> · 2 inactive"), "history disclosure count incorrect");
assert(rendered.includes("Project Beta"), "inactive project lease missing from history");
assert(rendered.includes("system_intake:system-intake"), "inactive conversation lease missing from history");

await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  active_projects: split.activeProjectOrchestrators.length,
  active_conversations: split.activeConversationLeases.length,
  inactive_count: split.inactiveCount,
  isolated_root: root,
}, null, 2)}\n`);
