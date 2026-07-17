import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runGit(repositoryPath, args) {
  return new Promise((resolvePromise) => {
    execFile("git", ["-C", repositoryPath, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolvePromise({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

function gitError(operation, result) {
  return Object.assign(new Error(`${operation} failed: ${result.stderr || result.stdout}`.trim()), { code: "git_operation_failed", operation });
}

async function makeWorkspaceWritable(root) {
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await chmod(child, 0o777);
        await visit(child);
      } else if (entry.isFile()) {
        if (entry.name === ".git" && path === root) await chmod(child, 0o444);
        else {
          const current = await stat(child);
          await chmod(child, 0o666 | (current.mode & 0o111));
        }
      }
    }
  }
  await chmod(root, 0o777);
  await visit(root);
}

function cleanMessage(value, fallback) {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return fallback;
  if (message.includes("\0") || message.length > 500) throw Object.assign(new Error("commit message is invalid"), { code: "invalid_request" });
  return message;
}

export class HostGitService {
  constructor({ store, repositoryPath, workspaceRoot, faultInjector = async () => undefined }) {
    this.store = store;
    this.repositoryPath = repositoryPath;
    this.workspaceRoot = workspaceRoot;
    this.faultInjector = faultInjector;
  }

  async createWorkspace({ taskId, runId }) {
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    const shortRun = runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
    const branch = `boss-man/${taskId.replace(/[^a-zA-Z0-9_.-]/g, "-")}/${shortRun}`;
    const path = join(this.workspaceRoot, runId);
    const base = await runGit(this.repositoryPath, ["rev-parse", "HEAD"]);
    if (base.code !== 0) throw gitError("resolve workspace base", base);
    const created = await runGit(this.repositoryPath, ["worktree", "add", "-b", branch, path, base.stdout.trim()]);
    if (created.code !== 0) throw gitError("create worktree", created);
    await makeWorkspaceWritable(path);
    const gitMarker = await readFile(join(path, ".git"));
    const workspace = this.store.recordWorkspace({
      id: randomUUID(), taskId, runId, repositoryPath: this.repositoryPath, workspacePath: path,
      branch, baseRevision: base.stdout.trim(), gitMarkerSha256: sha256(gitMarker),
    });
    return { ...workspace, gitMarkerSha256: sha256(gitMarker) };
  }

  async assertWorkspace(workspace) {
    const marker = await readFile(join(workspace.workspace_path, ".git"));
    if (sha256(marker) !== workspace.git_marker_sha256) {
      throw Object.assign(new Error("workspace Git metadata pointer changed outside the host service"), { code: "workspace_tampered" });
    }
  }

  async status(workspace) {
    await this.assertWorkspace(workspace);
    const result = await runGit(workspace.workspace_path, ["status", "--porcelain=v1", "--branch"]);
    if (result.code !== 0) throw gitError("git status", result);
    return { workspaceId: workspace.id, branch: workspace.branch, output: result.stdout, dirty: result.stdout.split("\n").some((line) => line && !line.startsWith("##")) };
  }

  async diff(workspace) {
    await this.assertWorkspace(workspace);
    const result = await runGit(workspace.workspace_path, ["diff", "--no-ext-diff", "--binary", "HEAD", "--"]);
    if (result.code !== 0) throw gitError("git diff", result);
    return { workspaceId: workspace.id, revision: await this.revision(workspace), diff: result.stdout };
  }

  async revision(workspace) {
    const result = await runGit(workspace.workspace_path, ["rev-parse", "HEAD"]);
    if (result.code !== 0) throw gitError("resolve workspace revision", result);
    return result.stdout.trim();
  }

  async checkpoint({ workspace, capability, kind, idempotencyKey, message, evidence = [] }) {
    if (!idempotencyKey) throw Object.assign(new Error("idempotency key is required"), { code: "invalid_request" });
    await this.assertWorkspace(workspace);
    const requestSha256 = sha256(JSON.stringify({ capabilityId: capability.id, workspaceId: workspace.id, kind, message, evidence }));
    const prior = this.store.findGitOperation(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw Object.assign(new Error("idempotency key was reused for a different Git request"), { code: "idempotency_conflict" });
      }
      return { replayed: true, operation: prior };
    }
    const status = await this.status(workspace);
    if (!status.dirty) throw Object.assign(new Error("workspace has no changes to checkpoint"), { code: "git_no_changes" });
    const priorRevision = await this.revision(workspace);
    const subject = cleanMessage(message, kind === "checkpoint" ? "chore: Boss Man checkpoint" : "chore: Boss Man commit");
    const journal = this.store.beginSideEffect({
      runId: workspace.run_id,
      kind: "git",
      idempotencyKey,
      intent: {
        workspaceId: workspace.id,
        taskId: workspace.task_id,
        capabilityId: capability.id,
        operationKind: kind,
        requestSha256,
        priorRevision,
        subject,
        evidence,
      },
    });
    if (journal.replayed) {
      if (journal.effect.state === "completed") {
        const operation = this.store.findGitOperation(idempotencyKey) ?? journal.effect.result?.operation;
        if (operation) return { replayed: true, operation };
      }
      throw Object.assign(new Error("prior Git side effect requires reconciliation before retry"), {
        code: "reconciliation_required",
        sideEffectId: journal.effect.id,
      });
    }
    const staged = await runGit(workspace.workspace_path, ["add", "--all", "--", "."]);
    if (staged.code !== 0) throw gitError("stage workspace", staged);
    const trailers = [
      `Boss-Man-Task: ${workspace.task_id}`,
      `Boss-Man-Run: ${workspace.run_id}`,
      `Boss-Man-Workspace: ${workspace.id}`,
      ...evidence.map((item) => `Boss-Man-Evidence: ${String(item).replace(/[\r\n]/g, " ")}`),
    ].join("\n");
    const committed = await runGit(workspace.workspace_path, [
      "-c", "user.name=Boss Man", "-c", "user.email=boss-man@localhost.invalid",
      "commit", "-m", subject, "-m", trailers,
    ]);
    if (committed.code !== 0) throw gitError("commit workspace checkpoint", committed);
    const newRevision = await this.revision(workspace);
    await this.faultInjector("git_after_commit", {
      sideEffectId: journal.effect.id,
      runId: workspace.run_id,
      workspaceId: workspace.id,
      priorRevision,
      newRevision,
    });
    const operation = this.store.recordGitOperation({
      id: randomUUID(), workspaceId: workspace.id, taskId: workspace.task_id, runId: workspace.run_id,
      capabilityId: capability.id, kind, idempotencyKey, requestSha256, priorRevision, newRevision,
      metadata: { message: subject, evidence, changed: status.output },
    });
    this.store.completeSideEffect(journal.effect.id, { operation });
    return { replayed: false, operation };
  }

  async reconcileSideEffect(effect, workspace) {
    if (effect.kind !== "git") throw new Error(`cannot reconcile non-Git side effect: ${effect.kind}`);
    const intent = effect.intent;
    const priorOperation = this.store.findGitOperation(effect.idempotency_key);
    if (priorOperation) {
      this.store.completeSideEffect(effect.id, { operation: priorOperation }, { reconciled: true });
      return { state: "completed", operation: priorOperation, source: "git_operation" };
    }
    await this.assertWorkspace(workspace);
    const currentRevision = await this.revision(workspace);
    if (currentRevision === intent.priorRevision) {
      this.store.requireSideEffectReconciliation(effect.id, "git_commit_not_observed", {
        currentRevision,
        priorRevision: intent.priorRevision,
      });
      return { state: "reconciliation_required", reason: "git_commit_not_observed" };
    }
    const parent = await runGit(workspace.workspace_path, ["rev-parse", `${currentRevision}^`]);
    const message = await runGit(workspace.workspace_path, ["show", "-s", "--format=%B", currentRevision]);
    const provenance = message.code === 0
      && message.stdout.includes(`Boss-Man-Task: ${workspace.task_id}`)
      && message.stdout.includes(`Boss-Man-Run: ${workspace.run_id}`)
      && message.stdout.includes(`Boss-Man-Workspace: ${workspace.id}`);
    if (parent.code !== 0 || parent.stdout.trim() !== intent.priorRevision || !provenance) {
      this.store.requireSideEffectReconciliation(effect.id, "git_revision_identity_ambiguous", {
        currentRevision,
        expectedParent: intent.priorRevision,
        parentRevision: parent.stdout.trim() || null,
        provenance,
      });
      return { state: "reconciliation_required", reason: "git_revision_identity_ambiguous" };
    }
    const operation = this.store.recordGitOperation({
      id: randomUUID(),
      workspaceId: workspace.id,
      taskId: workspace.task_id,
      runId: workspace.run_id,
      capabilityId: intent.capabilityId,
      kind: intent.operationKind,
      idempotencyKey: effect.idempotency_key,
      requestSha256: intent.requestSha256,
      priorRevision: intent.priorRevision,
      newRevision: currentRevision,
      metadata: {
        message: intent.subject,
        evidence: intent.evidence,
        recoveredAfterRestart: true,
      },
    });
    this.store.completeSideEffect(effect.id, { operation }, { reconciled: true });
    return { state: "completed", operation, source: "git_provenance" };
  }
}
