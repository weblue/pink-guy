#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";
import { Phase0Store } from "../../src/server/store.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-task-lifecycle.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-phase1-task-lifecycle-"));

const legacyPath = join(root, "legacy.sqlite");
const legacy = new DatabaseSync(legacyPath);
legacy.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    parent_task_id TEXT
  );
  INSERT INTO projects VALUES('legacy-project','Legacy project','${fixture.replaceAll("'", "''")}','2026-07-18T00:00:00.000Z');
  INSERT INTO tasks VALUES('legacy-parent','legacy-project','Parent','ready',1,'2026-07-18T00:00:00.000Z',NULL);
  INSERT INTO tasks VALUES('legacy-child','legacy-project','Child','done',1,'2026-07-18T00:00:00.000Z','legacy-parent');
  INSERT INTO tasks VALUES('intake-legacy','legacy-project','Bootstrap','ready',1,'2026-07-18T00:00:00.000Z',NULL);
`);
legacy.close();
const migrated = new Phase0Store(legacyPath);
assert(
  migrated.getTask("legacy-parent").task_kind === "umbrella"
    && migrated.getTask("legacy-child").task_kind === "executable"
    && migrated.getTask("intake-legacy").task_kind === "intake",
  "deterministic compatibility classification failed",
);
migrated.close();

const authority = new DirectControlPlane({
  databasePath: join(root, "authority.sqlite"),
  stateRoot: join(root, "authority"),
  fixturePath: fixture,
  enforceOrchestratorLease: true,
});
authority.seed({
  projectId: "lifecycle-project",
  repositoryId: "lifecycle-repository",
  projectName: "Lifecycle project",
  taskId: "lifecycle-seed",
  repositoryPath: fixture,
  title: "Lifecycle seed task",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

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
  return {
    status: response.status,
    value: response.status === 204 ? null : await response.json(),
  };
}

const registration = await request("/api/orchestrators", {
  method: "POST",
  body: {
    projectId: "lifecycle-project",
    transport: "daemon",
    endpoint: "pid:lifecycle-probe",
    leaseSeconds: 90,
  },
});
assert(registration.status === 201, "project orchestrator did not register");

const umbrella = await request("/api/projects/lifecycle-project/tasks", {
  method: "POST",
  idempotencyKey: "lifecycle-create-umbrella",
  body: {
    title: "Retain planning umbrella",
    taskKind: "umbrella",
    tags: ["Planning", "planning", "UI"],
    acceptanceCriteria: ["Retain planning provenance without execution."],
  },
});
assert(
  umbrella.status === 201
    && umbrella.value.task.task_kind === "umbrella"
    && umbrella.value.task.tags.join(",") === "planning,ui",
  "explicit kind or normalized tags were not retained",
);
const umbrellaId = umbrella.value.task.id;
const commandsBeforeDeniedSchedule = authority.store.orchestratorCommands({
  projectId: "lifecycle-project",
}).length;
const deniedSchedule = await request(`/api/tasks/${umbrellaId}/schedule`, {
  method: "POST",
  idempotencyKey: "lifecycle-denied-umbrella",
  body: { phase: "implementation" },
});
assert(
  deniedSchedule.status === 409
    && authority.store.orchestratorCommands({ projectId: "lifecycle-project" }).length
      === commandsBeforeDeniedSchedule,
  "umbrella scheduling created a command side effect",
);

const archived = await request(`/api/tasks/${umbrellaId}/archive`, {
  method: "POST",
  idempotencyKey: "lifecycle-archive-umbrella",
  body: {
    expectedVersion: umbrella.value.task.version,
    reason: "Child execution replaced this planning artifact.",
  },
});
assert(
  archived.status === 201
    && archived.value.task.archived
    && archived.value.task.status === "ready"
    && archived.value.task.archive_reason === "Child execution replaced this planning artifact.",
  "archive did not retain status and provenance",
);
const archiveReplay = await request(`/api/tasks/${umbrellaId}/archive`, {
  method: "POST",
  idempotencyKey: "lifecycle-archive-umbrella",
  body: {
    expectedVersion: umbrella.value.task.version,
    reason: "Child execution replaced this planning artifact.",
  },
});
assert(archiveReplay.status === 200 && archiveReplay.value.replayed, "archive replay was not idempotent");
let board = await request("/api/board");
assert(
  !Object.values(board.value.columns).flat().some((task) => task.id === umbrellaId)
    && board.value.archived.some((task) => task.id === umbrellaId),
  "archived task was not separated from active board columns",
);
const archivedSchedule = await request(`/api/tasks/${umbrellaId}/schedule`, {
  method: "POST",
  idempotencyKey: "lifecycle-denied-archived",
  body: { phase: "implementation" },
});
assert(archivedSchedule.status === 409, "archived task was schedulable");

const staleRestore = await request(`/api/tasks/${umbrellaId}/restore`, {
  method: "POST",
  idempotencyKey: "lifecycle-stale-restore",
  body: { expectedVersion: umbrella.value.task.version },
});
assert(staleRestore.status === 409, "stale lifecycle version was accepted");
const restored = await request(`/api/tasks/${umbrellaId}/restore`, {
  method: "POST",
  idempotencyKey: "lifecycle-restore-umbrella",
  body: { expectedVersion: archived.value.task.version, reason: "Reclassify as executable for busy-state probe." },
});
assert(
  restored.status === 201
    && !restored.value.task.archived
    && restored.value.task.status === "ready",
  "restore did not return the retained task to Ready",
);
const executable = await request(`/api/tasks/${umbrellaId}`, {
  method: "PUT",
  idempotencyKey: "lifecycle-make-executable",
  body: {
    title: restored.value.task.title,
    description: restored.value.task.description,
    acceptanceCriteria: restored.value.task.acceptance_criteria,
    taskKind: "executable",
    tags: ["ui", "work"],
    expectedVersion: restored.value.task.version,
  },
});
assert(executable.status === 201 && executable.value.task.task_kind === "executable", "explicit executable conversion failed");
const scheduled = await request(`/api/tasks/${umbrellaId}/schedule`, {
  method: "POST",
  idempotencyKey: "lifecycle-schedule-executable",
  body: { phase: "implementation" },
});
assert(scheduled.status === 201, "restored executable task did not schedule");
const busyKindChange = await request(`/api/tasks/${umbrellaId}`, {
  method: "PUT",
  idempotencyKey: "lifecycle-busy-kind-change",
  body: {
    title: executable.value.task.title,
    description: executable.value.task.description,
    acceptanceCriteria: executable.value.task.acceptance_criteria,
    taskKind: "umbrella",
    tags: executable.value.task.tags,
    expectedVersion: scheduled.value.task.version,
  },
});
const busyArchive = await request(`/api/tasks/${umbrellaId}/archive`, {
  method: "POST",
  idempotencyKey: "lifecycle-busy-archive",
  body: { expectedVersion: scheduled.value.task.version, reason: "Must be rejected while active." },
});
assert(
  busyKindChange.status === 409 && busyArchive.status === 409,
  "active task classification or archival bypassed recovery semantics",
);

const intake = await request("/api/projects/lifecycle-project/tasks", {
  method: "POST",
  idempotencyKey: "lifecycle-create-intake",
  body: {
    title: "Retained request context",
    taskKind: "intake",
    tags: ["intake", "source"],
    acceptanceCriteria: [],
  },
});
const intakeArchive = await request(`/api/tasks/${intake.value.task.id}/archive`, {
  method: "POST",
  idempotencyKey: "lifecycle-archive-intake",
  body: { expectedVersion: intake.value.task.version, reason: "Request context is retained but no longer active." },
});
const projects = await request("/api/projects");
board = await request("/api/board");
assert(
  intakeArchive.status === 201
    && projects.value.projects[0].archived_task_count === 1
    && board.value.archived.some((task) => task.id === intake.value.task.id),
  "archived project count or intake projection is incorrect",
);
const auditTypes = authority.store.taskAudit(umbrellaId).map((event) => event.type);
assert(
  auditTypes.includes("task_archived") && auditTypes.includes("task_restored"),
  "archive/restore lifecycle audit events are missing",
);

const invalidTags = await request("/api/projects/lifecycle-project/tasks", {
  method: "POST",
  idempotencyKey: "lifecycle-invalid-tags",
  body: {
    title: "Invalid tag task",
    tags: ["not valid"],
    acceptanceCriteria: [],
  },
});
assert(invalidTags.status === 400, "invalid tags were accepted");

const page = await fetch(base).then((response) => response.text());
assert(
  page.includes("archived-task-artifacts")
    && page.includes("task-detail-kind")
    && page.includes("data-archive-task")
    && page.includes("data-restore-task"),
  "cockpit lifecycle controls are missing",
);

await authority.close();

process.stdout.write(`${JSON.stringify({
  status: "pass",
  compatibility_classification: true,
  explicit_kinds: ["executable", "umbrella", "intake"],
  normalized_tags: true,
  non_executable_schedule_denied: true,
  archive_restore_idempotent: true,
  active_work_archive_denied: true,
  board_archive_projection: true,
  project_archive_count: true,
  lifecycle_audit: true,
  cockpit_controls: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);
