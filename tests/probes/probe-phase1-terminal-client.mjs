#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const execFileAsync = promisify(execFile);
const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-terminal-client.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-terminal-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
  runtimeThinking: "medium",
});
authority.seed({
  projectId: "terminal-project",
  repositoryId: "terminal-repository",
  projectName: "Terminal project",
  taskId: "terminal-existing-task",
  repositoryPath: fixture,
  title: "Existing terminal-visible task",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repositoryRoot, "scripts", "boss.mjs");

async function runCli(arguments_) {
  return execFileAsync(process.execPath, [cli, ...arguments_, "--api", base], {
    cwd: repositoryRoot,
    maxBuffer: 4 * 1024 * 1024,
  });
}

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
  if (response.status === 204) return { status: 204, value: null };
  return { status: response.status, value: await response.json() };
}

const status = JSON.parse((await runCli(["status", "--json"])).stdout);
assert(
  status.health.ok
    && status.projects.some((project) => project.id === "terminal-project"),
  "terminal status does not use the central fleet projection",
);

const submitted = JSON.parse((await runCli([
  "chat",
  "--repo", fixture,
  "--message", "Define a terminal-visible regression task.",
  "--no-wait",
  "--json",
])).stdout);
assert(
  submitted.turn.state === "queued"
    && submitted.turn.sequence === 1
    && submitted.orchestratorOnline === false,
  "repository-selected terminal chat did not queue one durable turn",
);

const topics = await request("/api/topics");
assert(
  topics.value.topics.length === 1
    && topics.value.topics[0].project_id === "terminal-project",
  "terminal chat did not create the same project-bound topic used by the cockpit",
);
const topic = topics.value.topics[0];
const conversationId = topic.conversation.id;

const lease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "project",
    scopeId: "terminal-project",
    transport: "tmux",
    endpoint: "tmux-pane:%42",
  },
});
const claimed = await request("/api/orchestration/turns/claim", {
  method: "POST",
  token: lease.value.token,
  body: {},
});
assert(claimed.value.turn.id === submitted.turn.id, "terminal turn was not claimable by the project orchestrator");
const mutation = await request(`/api/orchestration/conversations/${conversationId}/task-mutations`, {
  method: "POST",
  token: lease.value.token,
  idempotencyKey: "terminal-task-create",
  body: {
    operation: "create",
    title: "Keep browser and terminal conversation state aligned",
    acceptanceCriteria: ["Both surfaces show the same durable turn and task change."],
  },
});
assert(mutation.status === 201, "terminal-originated conversation could not project a task change");
await request(`/api/orchestration/turns/${submitted.turn.id}/complete`, {
  method: "POST",
  token: lease.value.token,
  body: {
    state: "completed",
    result: { assistantText: "I created one bounded parity task." },
  },
});
await request("/api/orchestration/leases/current", {
  method: "DELETE",
  token: lease.value.token,
});

const reopened = await runCli([
  "chat",
  "--topic", topic.id,
  "--message", "Queue this while the orchestrator is offline.",
  "--no-wait",
]);
assert(
  reopened.stdout.includes("Orchestrator: offline · messages remain queued")
    && reopened.stdout.includes(`Browser: ${base}/#${topic.id}`)
    && reopened.stdout.includes("Define a terminal-visible regression task.")
    && reopened.stdout.includes("I created one bounded parity task.")
    && reopened.stdout.includes("create: Keep browser and terminal conversation state aligned")
    && reopened.stdout.includes("message retained; orchestrator is offline"),
  "terminal reopen did not preserve browser parity, durable history, task changes, and lease status",
);

const detail = await request(`/api/topics/${topic.id}`);
assert(
  detail.value.turns.length === 2
    && detail.value.turns[1].owner_message === "Queue this while the orchestrator is offline.",
  "terminal reopen duplicated the project topic or lost the second turn",
);

const topicList = (await runCli(["topics"])).stdout;
assert(
  topicList.includes(topic.id) && topicList.includes(`${base}/#${topic.id}`),
  "terminal topic list omitted the cockpit deep link",
);

const imported = JSON.parse((await runCli([
  "import",
  "--repo-url", fixture,
  "--name", "Imported fixture",
  "--description", "Treat the attached maintenance ticket as immutable source context.",
  "--json",
])).stdout);
await access(imported.project.repository_path);
assert(
  imported.project.repository_path !== fixture
    && imported.project.source_url === fixture
    && imported.topic.project_id === imported.project.id,
  "terminal repository import did not create a host-owned clone and project topic",
);
const snapshot = await request(`/api/projects/${imported.project.id}/sources`, {
  method: "POST",
  idempotencyKey: "terminal-source-snapshot",
  body: {
    kind: "jira",
    sourceRef: "JIRA-PROBE-42",
    content: "The refined ticket requires one deterministic maintenance change.",
  },
});
const importedContext = await request(`/api/conversations/${imported.conversation.id}/context`);
assert(
  snapshot.status === 201
    && importedContext.value.sources.length === 1
    && importedContext.value.sources[0].content_sha256 === snapshot.value.snapshot.content_sha256,
  "immutable source snapshot was not available in orchestrator context",
);
const importReplay = JSON.parse((await runCli([
  "import",
  "--repo-url", fixture,
  "--name", "Imported fixture",
  "--json",
])).stdout);
assert(
  importReplay.project.id === imported.project.id
    && importReplay.topic.id === imported.topic.id,
  "repository re-import duplicated the project or durable topic",
);

await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  shared_topic_identity: true,
  repository_selection: true,
  durable_history: true,
  structured_task_changes: true,
  orchestrator_lease_status: true,
  cockpit_deep_link: true,
  host_owned_repository_import: true,
  immutable_source_snapshot: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);
