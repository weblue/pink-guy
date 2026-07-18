#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const execFileAsync = promisify(execFile);
const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-phase1-project-deletion.mjs /absolute/path/to/git-repository");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const root = await mkdtemp(join(tmpdir(), "boss-man-project-delete-"));
let fault = null;
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot: root,
  fixturePath: fixture,
  runtimeProvider: "openai",
  runtimeModel: "gpt-test",
  runtimeThinking: "medium",
  faultInjector: async (point) => {
    if (fault === point) throw new Error(`injected ${point}`);
  },
});
authority.seed({
  projectId: "direct-project",
  repositoryId: "direct-repository",
  projectName: "Direct repository",
  taskId: "direct-task",
  repositoryPath: fixture,
  title: "Direct repository task",
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repositoryRoot, "scripts", "boss.mjs");

async function request(path, {
  method = "GET",
  body,
  idempotencyKey,
  token,
} = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, value: await response.json() };
}

let sourceSequence = 0;
async function sourceRepository() {
  sourceSequence += 1;
  const path = join(root, `source-${sourceSequence}`);
  await execFileAsync("git", ["clone", "--quiet", "--", fixture, path]);
  return path;
}

let importSequence = 0;
async function importProject(name, { topic = true, source = null } = {}) {
  importSequence += 1;
  const repositoryUrl = source ?? await sourceRepository();
  const imported = await request("/api/projects/import", {
    method: "POST",
    idempotencyKey: `delete-probe-import-${importSequence}`,
    body: { repositoryUrl, name },
  });
  assert(imported.status === 201, `failed to import ${name}`);
  let createdTopic = null;
  if (topic) {
    createdTopic = await request("/api/topics", {
      method: "POST",
      idempotencyKey: `delete-probe-topic-${importSequence}`,
      body: {
        title: `${name} orchestrator`,
        ownerDescription: "Empty generated topic for deletion verification.",
        projectId: imported.value.project.id,
      },
    });
    assert(createdTopic.status === 201, `failed to create topic for ${name}`);
  }
  return {
    source: repositoryUrl,
    project: imported.value.project,
    topic: createdTopic?.value.topic ?? null,
  };
}

async function deleteRequest(project, key, reason = "Canceled unused import") {
  return request(`/api/projects/${project.id}`, {
    method: "DELETE",
    idempotencyKey: key,
    body: { confirmName: project.name, reason },
  });
}

const directDelete = await request("/api/projects/direct-project", {
  method: "DELETE",
  idempotencyKey: "delete-direct-project",
  body: { confirmName: "Direct repository", reason: "Must be refused" },
});
assert(
  directDelete.status === 409 && directDelete.value.error === "deletion_blocked",
  "direct repository deletion was not refused",
);
assert(await pathExists(fixture), "direct repository was altered");

const cliCandidate = await importProject("CLI disposable import");
const beforeList = await request("/api/projects");
const listedCandidate = beforeList.value.projects.find(
  (project) => project.id === cliCandidate.project.id,
);
assert(
  listedCandidate?.deletion_eligible === true
    && listedCandidate.deletion_blockers.length === 0,
  "unused managed import was not identified as deletable",
);
const confirmationMismatch = await request(`/api/projects/${cliCandidate.project.id}`, {
  method: "DELETE",
  idempotencyKey: "delete-wrong-confirmation",
  body: { confirmName: "wrong name", reason: "Must be refused" },
});
assert(
  confirmationMismatch.status === 409
    && confirmationMismatch.value.error === "confirmation_mismatch"
    && await pathExists(cliCandidate.project.repository_path),
  "confirmation mismatch changed the managed checkout",
);
const cliDeletion = await execFileAsync(process.execPath, [
  cli,
  "delete-project",
  "--project", cliCandidate.project.id,
  "--confirm", cliCandidate.project.name,
  "--reason", "Canceled CLI import",
  "--api", base,
], { cwd: repositoryRoot });
assert(
  cliDeletion.stdout.includes("Project deleted safely; retained receipt"),
  "terminal client did not expose safe project deletion",
);
assert(
  !(await pathExists(cliCandidate.project.repository_path))
    && authority.store.getProject(cliCandidate.project.id) === null
    && authority.store.getProject(cliCandidate.project.id, { includeDeleted: true })?.deleted_at,
  "successful deletion did not remove the checkout and retain a tombstone",
);
const archivedTopic = authority.store.topics({ includeArchived: true })
  .find((topic) => topic.id === cliCandidate.topic.id);
assert(
  archivedTopic?.state === "archived" && archivedTopic.conversation.state === "archived",
  "empty generated topic was not archived with its deleted project",
);

const replayCandidate = await importProject("Replay disposable import");
const firstDelete = await deleteRequest(
  replayCandidate.project,
  "delete-replay-candidate",
  "Verify idempotent deletion",
);
const replayDelete = await deleteRequest(
  replayCandidate.project,
  "delete-replay-candidate",
  "Verify idempotent deletion",
);
assert(
  firstDelete.status === 200
    && firstDelete.value.receipt.state === "complete"
    && replayDelete.status === 200
    && replayDelete.value.replayed === true
    && replayDelete.value.receipt.id === firstDelete.value.receipt.id,
  "project deletion did not replay one durable receipt",
);
const reimported = await request("/api/projects/import", {
  method: "POST",
  idempotencyKey: "reimport-deleted-source",
  body: { repositoryUrl: replayCandidate.source, name: "Reimported source" },
});
assert(
  reimported.status === 201 && reimported.value.project.id !== replayCandidate.project.id,
  "a tombstone prevented a new import of the same source",
);

const taskCandidate = reimported.value.project;
const task = await request(`/api/projects/${taskCandidate.id}/tasks`, {
  method: "POST",
  idempotencyKey: "deletion-blocking-task",
  body: { title: "Retained maintenance task", acceptanceCriteria: [] },
});
assert(task.status === 201, "failed to create deletion-blocking task");
const taskBlocked = await deleteRequest(taskCandidate, "delete-task-bearing-project");
assert(
  taskBlocked.status === 409
    && taskBlocked.value.message.includes("tasks:1")
    && await pathExists(taskCandidate.repository_path),
  "task-bearing project deletion was not refused",
);

const conversationCandidate = await importProject("Conversation-bearing import");
const conversation = authority.store.topicDetails(conversationCandidate.topic.id).conversation;
const queuedTurn = await request(`/api/conversations/${conversation.id}/turns`, {
  method: "POST",
  idempotencyKey: "deletion-blocking-turn",
  body: { message: "Retain this maintenance context." },
});
assert(queuedTurn.status === 201, "failed to create deletion-blocking turn");
const conversationBlocked = await deleteRequest(
  conversationCandidate.project,
  "delete-conversation-bearing-project",
);
assert(
  conversationBlocked.status === 409
    && conversationBlocked.value.message.includes("turns:1"),
  "conversation-bearing project deletion was not refused",
);

const leaseCandidate = await importProject("Lease-bearing import");
const lease = await request("/api/orchestration/leases", {
  method: "POST",
  body: {
    scopeType: "project",
    scopeId: leaseCandidate.project.id,
    transport: "tmux",
    endpoint: "tmux-pane:%delete-probe",
  },
});
assert(lease.status === 201, "failed to create deletion-blocking lease");
const leaseBlocked = await deleteRequest(leaseCandidate.project, "delete-leased-project");
assert(
  leaseBlocked.status === 409
    && leaseBlocked.value.message.includes("active_orchestration_leases:1"),
  "active lease did not block project deletion",
);
await request("/api/orchestration/leases/current", { method: "DELETE", token: lease.value.token });

const restoreCandidate = await importProject("Quarantine restoration import");
fault = "project_delete_after_quarantine";
const failedTombstone = await deleteRequest(
  restoreCandidate.project,
  "delete-quarantine-restore",
);
fault = null;
assert(
  failedTombstone.status === 400
    && await pathExists(restoreCandidate.project.repository_path)
    && authority.store.getProject(restoreCandidate.project.id),
  "failed tombstoning did not restore the original checkout",
);
const restoredRetry = await deleteRequest(
  restoreCandidate.project,
  "delete-quarantine-restore",
);
assert(
  restoredRetry.status === 200 && restoredRetry.value.receipt.state === "complete",
  "restored prepared deletion did not resume safely",
);

const cleanupCandidate = await importProject("Cleanup retry import");
fault = "project_delete_before_cleanup";
const cleanupPending = await deleteRequest(
  cleanupCandidate.project,
  "delete-cleanup-retry",
);
fault = null;
assert(
  cleanupPending.status === 202
    && cleanupPending.value.cleanupPending === true
    && cleanupPending.value.receipt.state === "tombstoned"
    && await pathExists(cleanupPending.value.receipt.quarantine_path),
  "cleanup failure did not retain a retryable tombstone receipt",
);
const cleanupRetry = await deleteRequest(
  cleanupCandidate.project,
  "delete-cleanup-retry",
);
assert(
  cleanupRetry.status === 200
    && cleanupRetry.value.receipt.state === "complete"
    && !(await pathExists(cleanupRetry.value.receipt.quarantine_path)),
  "cleanup-pending replay did not remove quarantine and complete",
);

const cockpit = await readFile(join(repositoryRoot, "src", "ui", "cockpit.html"), "utf8");
assert(
  cockpit.includes("data-delete-project")
    && cockpit.includes("Type the exact project name")
    && cockpit.includes("cleanup remains pending"),
  "cockpit does not expose the guarded safe-delete flow",
);

await authority.close();
process.stdout.write(`${JSON.stringify({
  status: "pass",
  managed_import_only: true,
  exact_confirmation: true,
  terminal_and_cockpit_controls: true,
  activity_blockers: true,
  tombstone_and_topic_archive: true,
  idempotent_replay: true,
  quarantine_restore: true,
  cleanup_retry: true,
  source_reimport_after_tombstone: true,
  provider_requests: 0,
  isolated_root: root,
}, null, 2)}\n`);
