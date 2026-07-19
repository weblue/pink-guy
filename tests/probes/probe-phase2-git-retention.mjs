#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function git(repository, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function createRepository(root, name) {
  const repository = join(root, name);
  await mkdir(repository, { recursive: true });
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Pink Guy probe");
  await git(repository, "config", "user.email", "pink-guy-probe@localhost.invalid");
  await writeFile(join(repository, "value.txt"), "base\n");
  await git(repository, "add", "value.txt");
  await git(repository, "commit", "-m", "base");
  return repository;
}

async function featureCommit(repository, root, branch, value, base = "main") {
  const path = join(root, `${branch}-worktree`);
  await git(repository, "worktree", "add", "-b", branch, path, base);
  await writeFile(join(path, "value.txt"), `${value}\n`);
  await git(path, "add", "value.txt");
  await git(path, "commit", "-m", `${branch} change`);
  return { path, revision: await git(path, "rev-parse", "HEAD") };
}

function capability(store, role, actorId, taskId, runId = null) {
  return store.issueCapability({
    role,
    actorId,
    taskId,
    runId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  });
}

function act(store, token, taskId, action, payload, suffix) {
  const task = store.getTask(taskId);
  return store.actOnTask({
    token,
    taskId,
    action,
    expectedVersion: task.version,
    payload,
    idempotencyKey: `${taskId}:${action}:${suffix}`,
  });
}

function completeTask(store, taskId, revision, suffix) {
  const testSessionId = `test-session-${suffix}`;
  const reviewSessionId = `review-session-${suffix}`;
  const testRunId = `test-run-${suffix}`;
  const reviewRunId = `review-run-${suffix}`;
  store.createSession({
    id: testSessionId,
    taskId,
    nativePath: `/retained/${testSessionId}.jsonl`,
    provider: "probe",
    model: "model-less",
  });
  store.createRun({ id: testRunId, sessionId: testSessionId, phase: "test" });
  store.finishRun(testRunId);
  store.createSession({
    id: reviewSessionId,
    taskId,
    nativePath: `/retained/${reviewSessionId}.jsonl`,
    provider: "probe",
    model: "model-less",
  });
  store.createRun({ id: reviewRunId, sessionId: reviewSessionId, phase: "review" });
  store.finishRun(reviewRunId);
  const worker = capability(store, "worker", `worker-${suffix}`, taskId);
  const orchestrator = capability(store, "orchestrator", `orchestrator-${suffix}`, taskId);
  const validator = capability(store, "validator", `validator-${suffix}`, taskId, testRunId);
  const reviewer = capability(store, "reviewer", `reviewer-${suffix}`, taskId, reviewRunId);
  act(store, worker.token, taskId, "claim", {}, suffix);
  act(store, orchestrator.token, taskId, "set_revision", { revision }, suffix);
  act(store, worker.token, taskId, "request_review", { revision }, suffix);
  act(store, validator.token, taskId, "record_validation", {
    revision,
    status: "passed",
    evidence: ["model-less integration probe"],
  }, suffix);
  act(store, reviewer.token, taskId, "submit_review", {
    revision,
    disposition: "approve",
    findings: [],
  }, suffix);
  act(store, orchestrator.token, taskId, "complete", {}, suffix);
  return store.getTaskDetails(taskId);
}

async function configurePolicy(plane, projectId, {
  mode,
  historyPolicy,
  targetBranch = "main",
  suffix,
}) {
  const current = await plane.ensureProjectGitPolicy(projectId);
  return plane.store.updateProjectGitPolicy({
    projectId,
    mode,
    historyPolicy,
    targetBranch,
    remoteName: "origin",
    allowPush: false,
    allowPullRequest: false,
    allowedTargetBranches: [targetBranch],
    expectedVersion: current.version,
    reason: `probe ${suffix}`,
    idempotencyKey: `policy:${projectId}:${suffix}`,
  }).policy;
}

const root = await mkdtemp(join(tmpdir(), "pink-guy-phase2-git-retention-"));
const stateRoot = join(root, "state");
const repositoryOne = await createRepository(root, "merge-repository");
const repositoryTwo = await createRepository(root, "squash-repository");
const plane = new DirectControlPlane({
  databasePath: join(stateRoot, "pink-guy.sqlite"),
  stateRoot,
  fixturePath: repositoryOne,
  storageHardBytes: 1,
});

const firstBase = await git(repositoryOne, "rev-parse", "main");
plane.seed({
  projectId: "project-merge",
  repositoryId: "repository-merge",
  projectName: "merge repository",
  taskId: "task-merge",
  repositoryPath: repositoryOne,
  revision: firstBase,
  title: "Merge a clean task",
  acceptanceCriteria: ["The clean feature is integrated."],
});
const firstFeature = await featureCommit(repositoryOne, root, "feature-merge", "merge");
completeTask(plane.store, "task-merge", firstFeature.revision, "merge");

const defaultPolicy = await plane.ensureProjectGitPolicy("project-merge");
assert(defaultPolicy.mode === "prepare_only", "Git policy did not default to prepare-only");
assert(defaultPolicy.history_policy === "merge_commit", "Git policy did not default to merge commit");
const defaultPlan = await plane.prepareGitIntegration({
  taskId: "task-merge",
  idempotencyKey: "prepare:merge:default",
});
assert(defaultPlan.integration.state === "prepared", "clean merge preparation did not succeed");
let prepareOnlyDenied = false;
try {
  await plane.actOnGitIntegration({
    integrationId: defaultPlan.integration.id,
    action: "execute",
    expectedVersion: defaultPlan.integration.version,
    reason: "must be denied",
    idempotencyKey: "execute:merge:denied",
  });
} catch (error) {
  prepareOnlyDenied = error.code === "integration_execution_disabled";
}
assert(prepareOnlyDenied, "prepare-only policy allowed Git execution");
assert(await git(repositoryOne, "rev-parse", "main") === firstBase, "prepare changed target branch");

await configurePolicy(plane, "project-merge", {
  mode: "local_integrate",
  historyPolicy: "merge_commit",
  suffix: "merge",
});
const mergePlan = await plane.prepareGitIntegration({
  taskId: "task-merge",
  idempotencyKey: "prepare:merge:enabled",
});
const merged = await plane.actOnGitIntegration({
  integrationId: mergePlan.integration.id,
  action: "execute",
  expectedVersion: mergePlan.integration.version,
  reason: "execute clean merge",
  idempotencyKey: "execute:merge",
});
assert(merged.integration.state === "integrated", "merge integration did not settle integrated");
assert(await git(repositoryOne, "rev-parse", "main") === merged.integration.result_revision, "merge target did not advance");
assert(await git(repositoryOne, "rev-parse", firstFeature.revision) === firstFeature.revision, "source revision was rewritten");
assert(
  !(await git(repositoryOne, "worktree", "list", "--porcelain"))
    .includes(`/integrations/${mergePlan.integration.id}`),
  "completed integration worktree was retained",
);
assert(
  !(await git(
    repositoryOne,
    "branch",
    "--list",
    `pink-guy/integration/${mergePlan.integration.id}`,
  )),
  "completed integration branch was retained",
);
const mergePlanReplay = await plane.prepareGitIntegration({
  taskId: "task-merge",
  idempotencyKey: "prepare:merge:enabled",
});
assert(
  mergePlanReplay.replayed
    && mergePlanReplay.integration.id === mergePlan.integration.id
    && mergePlanReplay.integration.target_revision === mergePlan.integration.target_revision,
  "Git preparation did not replay after target movement",
);

const rebaseBase = await git(repositoryOne, "rev-parse", "main");
plane.seed({
  projectId: "project-merge",
  repositoryId: "repository-merge",
  projectName: "merge repository",
  taskId: "task-rebase",
  repositoryPath: repositoryOne,
  revision: rebaseBase,
  title: "Rebase a clean task",
  acceptanceCriteria: ["The source is rebased without rewriting its retained commit."],
});
const rebaseFeaturePath = join(root, "feature-rebase-worktree");
await git(repositoryOne, "worktree", "add", "-b", "feature-rebase", rebaseFeaturePath, rebaseBase);
await writeFile(join(rebaseFeaturePath, "feature.txt"), "feature\n");
await git(rebaseFeaturePath, "add", "feature.txt");
await git(rebaseFeaturePath, "commit", "-m", "feature rebase change");
const rebaseFeatureRevision = await git(rebaseFeaturePath, "rev-parse", "HEAD");
await writeFile(join(repositoryOne, "target.txt"), "target movement\n");
await git(repositoryOne, "add", "target.txt");
await git(repositoryOne, "commit", "-m", "move target before rebase");
completeTask(plane.store, "task-rebase", rebaseFeatureRevision, "rebase");
await configurePolicy(plane, "project-merge", {
  mode: "local_integrate",
  historyPolicy: "rebase",
  suffix: "rebase",
});
const rebasePlan = await plane.prepareGitIntegration({
  taskId: "task-rebase",
  idempotencyKey: "prepare:rebase",
});
assert(rebasePlan.integration.state === "prepared", "clean rebase preparation did not succeed");
const rebased = await plane.actOnGitIntegration({
  integrationId: rebasePlan.integration.id,
  action: "execute",
  expectedVersion: rebasePlan.integration.version,
  reason: "execute clean rebase",
  idempotencyKey: "execute:rebase",
});
assert(rebased.integration.state === "integrated", "rebase integration did not settle integrated");
assert(rebased.integration.result_revision !== rebaseFeatureRevision, "rebase rewrote no result commit");
assert(await git(repositoryOne, "rev-parse", rebaseFeatureRevision) === rebaseFeatureRevision, "retained rebase source was lost");

const secondBase = await git(repositoryTwo, "rev-parse", "main");
plane.seed({
  projectId: "project-squash",
  repositoryId: "repository-squash",
  projectName: "squash repository",
  taskId: "task-squash",
  repositoryPath: repositoryTwo,
  revision: secondBase,
  title: "Squash a clean task",
  acceptanceCriteria: ["The clean feature is squashed."],
});
const secondFeature = await featureCommit(repositoryTwo, root, "feature-squash", "squash");
completeTask(plane.store, "task-squash", secondFeature.revision, "squash");
await plane.ensureProjectGitPolicy("project-squash");
await configurePolicy(plane, "project-squash", {
  mode: "local_integrate",
  historyPolicy: "squash",
  suffix: "squash",
});
const squashPlan = await plane.prepareGitIntegration({
  taskId: "task-squash",
  idempotencyKey: "prepare:squash",
});
const squashed = await plane.actOnGitIntegration({
  integrationId: squashPlan.integration.id,
  action: "execute",
  expectedVersion: squashPlan.integration.version,
  reason: "execute clean squash",
  idempotencyKey: "execute:squash",
});
assert(squashed.integration.state === "integrated", "squash integration did not settle integrated");
assert(squashed.integration.result_revision !== secondFeature.revision, "squash reused the source commit");

const conflictBase = await git(repositoryTwo, "rev-parse", "main");
plane.seed({
  projectId: "project-squash",
  repositoryId: "repository-squash",
  projectName: "squash repository",
  taskId: "task-conflict",
  repositoryPath: repositoryTwo,
  revision: conflictBase,
  title: "Detect a conflict",
  acceptanceCriteria: ["The target conflict is surfaced without mutation."],
});
const conflictFeature = await featureCommit(
  repositoryTwo,
  root,
  "feature-conflict",
  "feature-side",
  conflictBase,
);
await writeFile(join(repositoryTwo, "value.txt"), "target-side\n");
await git(repositoryTwo, "add", "value.txt");
await git(repositoryTwo, "commit", "-m", "move target into conflict");
const conflictTarget = await git(repositoryTwo, "rev-parse", "main");
completeTask(plane.store, "task-conflict", conflictFeature.revision, "conflict");
const conflictPlan = await plane.prepareGitIntegration({
  taskId: "task-conflict",
  idempotencyKey: "prepare:conflict",
});
assert(conflictPlan.integration.state === "conflict", "conflicting plan did not enter attention");
assert(await git(repositoryTwo, "rev-parse", "main") === conflictTarget, "conflict preview changed target");
assert(
  plane.store.integrationAttention("project-squash")
    .some((item) => item.integration.id === conflictPlan.integration.id),
  "conflict was absent from integration attention",
);

const sessionRoot = join(stateRoot, "runs", "retention-run");
const nativePath = join(sessionRoot, "sessions", "retained.jsonl");
const artifactPath = join(sessionRoot, "artifacts", "result.txt");
await mkdir(join(sessionRoot, "sessions"), { recursive: true });
await mkdir(join(sessionRoot, "artifacts"), { recursive: true });
await writeFile(nativePath, "{\"type\":\"session\"}\n");
await writeFile(artifactPath, "retained evidence\n");
plane.store.createSession({
  id: "retention-session",
  taskId: "task-merge",
  nativePath,
  provider: "probe",
  model: "model-less",
});
plane.store.createRun({
  id: "retention-run",
  sessionId: "retention-session",
  phase: "test",
});
plane.store.finishRun("retention-run");
const workspace = await plane.gitService(repositoryOne).createWorkspace({
  taskId: "task-merge",
  runId: "retention-run",
});
plane.store.recordArtifact({
  sessionId: "retention-session",
  kind: "probe",
  path: artifactPath,
  sha256: "fixture-sha",
});
const hold = plane.store.createRetentionHold({
  projectId: "project-merge",
  scopeType: "workspace",
  scopeId: workspace.id,
  reason: "audit before cleanup",
  idempotencyKey: "hold:workspace",
}).hold;
let invalidHoldRejected = false;
try {
  plane.store.createRetentionHold({
    projectId: "project-squash",
    scopeType: "workspace",
    scopeId: workspace.id,
    reason: "cross-project typo",
    idempotencyKey: "hold:cross-project",
  });
} catch (error) {
  invalidHoldRejected = error.code === "scope_mismatch";
}
assert(invalidHoldRejected, "cross-project retention hold was accepted");
const heldPreview = await plane.taskCleanupPreview("task-merge");
assert(
  heldPreview.resources.find((resource) => resource.workspaceId === workspace.id)
    .blockers.includes("retention_hold"),
  "retention hold did not block cleanup",
);
plane.store.releaseRetentionHold({
  holdId: hold.id,
  reason: "audit complete",
  idempotencyKey: "hold:workspace:release",
});
const cleanupPreview = await plane.taskCleanupPreview("task-merge");
assert(
  cleanupPreview.resources.find((resource) => resource.workspaceId === workspace.id).eligible,
  "settled integrated workspace was not cleanup eligible",
);
const retentionGit = plane.gitService(repositoryOne);
const retireWorkspace = retentionGit.retireWorkspace.bind(retentionGit);
let failCleanupOnce = true;
retentionGit.retireWorkspace = async (candidate) => {
  if (candidate.id === workspace.id && failCleanupOnce) {
    failCleanupOnce = false;
    throw Object.assign(new Error("injected cleanup interruption"), {
      code: "probe_cleanup_interrupted",
    });
  }
  return retireWorkspace(candidate);
};
const partialCleanup = await plane.executeTaskCleanup({
  taskId: "task-merge",
  previewSha256: cleanupPreview.previewSha256,
  reason: "retire ephemeral runtime",
  idempotencyKey: "cleanup:task-merge",
});
assert(
  partialCleanup.operation.state === "cleanup_pending",
  "partial cleanup was not retained for retry",
);
const cleanup = await plane.executeTaskCleanup({
  taskId: "task-merge",
  previewSha256: cleanupPreview.previewSha256,
  reason: "retire ephemeral runtime",
  idempotencyKey: "cleanup:task-merge",
});
assert(cleanup.operation.state === "complete", "workspace cleanup did not complete");
assert(cleanup.replayed, "cleanup retry did not reuse the durable intent");
assert(plane.store.getWorkspace(workspace.id).state === "retired", "workspace was not marked retired");

const deletionPreview = await plane.sessionDeletionPreview("retention-session");
assert(deletionPreview.eligible, `session deletion blocked: ${deletionPreview.blockers.join(",")}`);
const deleted = await plane.deleteSessionArtifacts({
  sessionId: "retention-session",
  confirmSessionId: "retention-session",
  previewSha256: deletionPreview.previewSha256,
  reason: "explicit probe deletion",
  idempotencyKey: "delete:retention-session",
});
assert(deleted.receipt.state === "complete", "session deletion did not complete");
assert(plane.store.getSession("retention-session").state === "deleted", "session tombstone was not retained");
assert(
  JSON.parse(await readFile(deleted.receipt.manifest_path, "utf8")).sessionId === "retention-session",
  "session deletion manifest was not retained",
);
const deletionReplay = await plane.deleteSessionArtifacts({
  sessionId: "retention-session",
  confirmSessionId: "retention-session",
  previewSha256: deletionPreview.previewSha256,
  reason: "explicit probe deletion",
  idempotencyKey: "delete:retention-session",
});
assert(
  deletionReplay.replayed
    && deletionReplay.receipt.id === deleted.receipt.id
    && deletionReplay.receipt.state === "complete",
  "completed session deletion did not replay its original receipt",
);

const storage = await plane.storageInventory();
assert(storage.hardBlocked, "configured hard storage limit did not activate");
plane.store.setRuntimeFlag("storage_pressure", {
  hardBlocked: false,
  warning: false,
  totalBytes: 0,
  hardBytes: 1,
  warningBytes: 1,
  measuredAt: new Date(0).toISOString(),
});
plane.seed({
  projectId: "project-merge",
  repositoryId: "repository-merge",
  projectName: "merge repository",
  taskId: "task-storage-blocked",
  repositoryPath: repositoryOne,
  revision: await git(repositoryOne, "rev-parse", "main"),
  title: "Blocked by storage pressure",
  acceptanceCriteria: ["Automatic dispatch remains paused."],
});
plane.store.setTaskDispatch({
  taskId: "task-storage-blocked",
  operation: "release",
  expectedVersion: 1,
  priority: 0,
  idempotencyKey: "release:storage-blocked",
});
const pressureDispatch = await plane.reconcileReadyProject("project-merge");
assert(
  pressureDispatch.reason === "storage_pressure",
  "automatic dispatch did not refresh configured storage pressure",
);
assert(
  plane.store.taskDispatchProjection("task-storage-blocked").blockers.includes("storage_pressure"),
  "storage pressure was absent from deterministic dispatch blockers",
);

const interrupted = plane.store.transitionGitIntegration({
  integrationId: conflictPlan.integration.id,
  expectedVersion: conflictPlan.integration.version,
  state: "integrating",
  result: { probe: "interrupted before side effect" },
});
assert(interrupted.state === "integrating", "integration restart fixture was not created");
plane.store.close();
const restarted = new DirectControlPlane({
  databasePath: join(stateRoot, "pink-guy.sqlite"),
  stateRoot,
  fixturePath: repositoryOne,
});
await restarted.reconcileAfterRestart();
assert(
  restarted.store.gitIntegration(interrupted.id).state === "reconciliation_required",
  "interrupted integration was not reconciled without replay",
);
restarted.store.close();

process.stdout.write(`${JSON.stringify({
  status: "pass",
  product_identity: "Pink Guy",
  prepare_only_default: true,
  clean_repository_integrations: 2,
  preparation_replay_after_target_movement: true,
  integration_workspace_cleaned: true,
  history_policies: ["merge_commit", "squash", "rebase"],
  conflict_target_unchanged: true,
  force_push: false,
  retention_hold: true,
  retention_scope_validated: true,
  workspace_retired: true,
  cleanup_retry: true,
  session_manifest_retained: true,
  session_deletion_replay: true,
  storage_pressure_blocks_dispatch: true,
  integration_restart_automatic_replay: false,
  provider_requests: 0,
  task_containers_started: 0,
  isolated_root: root,
}, null, 2)}\n`);
