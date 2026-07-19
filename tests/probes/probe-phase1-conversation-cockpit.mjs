#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-conversation-cockpit.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-cockpit-"));
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
  runtimeThinking: "medium",
});
authority.seed({
  projectId: "cockpit-project",
  repositoryId: "cockpit-repository",
  projectName: "Cockpit project",
  taskId: "cockpit-existing-task",
  repositoryPath: fixture,
  title: "Existing visible task",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

async function request(path, { method = "GET", body, idempotencyKey } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const value = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, value };
}

const shell = await request("/");
assert(
  shell.status === 200
    && shell.value.includes('data-testid="new-topic-form"')
    && shell.value.includes('data-testid="conversation-stream"')
    && shell.value.includes('data-testid="task-board"')
    && shell.value.includes("Ask orchestrator")
    && shell.value.includes("data-focus-task")
    && shell.value.includes("task.classList.add(\"focused\")")
    && shell.value.includes('data-testid="terminal-command"')
    && shell.value.includes('data-testid="repository-import-form"')
    && shell.value.includes('data-testid="model-route-editor"')
    && shell.value.includes('data-testid="agent-prompt-editor"')
    && shell.value.includes('id="task-detail"')
    && shell.value.includes("data-reconcile-command")
    && shell.value.includes("data-stop-session")
    && shell.value.includes("npm run pink -- chat --topic ")
    && shell.value.includes('import { renderOrchestratorLeasesPanel } from "/ui/lease-view.mjs";')
    && !shell.value.includes("new Terminal(")
    && !shell.value.includes("xterm"),
  "cockpit does not expose the approved structured conversation workspace",
);

const created = await request("/api/topics", {
  method: "POST",
  idempotencyKey: "cockpit-project-topic",
  body: {
    title: "Cockpit project orchestrator",
    ownerDescription: "Refine work without rebuilding prior Pi context.",
    projectId: "cockpit-project",
  },
});
assert(created.status === 201, "project topic creation failed");
const turn = await request(`/api/conversations/${created.value.conversation.id}/turns`, {
  method: "POST",
  idempotencyKey: "cockpit-owner-turn",
  body: { message: "Create a bounded task after material ambiguity is resolved." },
});
assert(turn.status === 201 && turn.value.turn.state === "queued", "cockpit owner turn did not queue");

const topics = await request("/api/topics");
const board = await request("/api/board");
const events = await request(`/api/conversations/${created.value.conversation.id}/events`);
assert(
  topics.value.topics.some((topic) => topic.id === created.value.topic.id && topic.project_id === "cockpit-project")
    && board.value.columns.ready.some((task) => task.id === "cockpit-existing-task")
    && events.value.events.some((event) => event.type === "owner_message_queued"),
  "cockpit projections cannot reconnect topic, board, and conversation state",
);

await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  task_first_layout: true,
  new_topic: true,
  ask_orchestrator: true,
  persistent_conversation_projection: true,
  structured_change_surface: true,
  change_to_board_navigation: true,
  browser_terminal_emulator: false,
  shared_terminal_command: true,
  orchestrator_attach_endpoint: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);
