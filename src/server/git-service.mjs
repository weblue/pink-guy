import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, readdir, stat } from "node:fs/promises";
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

const DEFAULT_DIFF_MAX_BYTES = 256 * 1024;
const DIFF_STAT_MAX_CHARS = 32 * 1024;
const DIFF_BINARY_PATH_LIMIT = 100;

function runGitBounded(repositoryPath, args, { maxStdoutBytes = DEFAULT_DIFF_MAX_BYTES } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn("git", ["-C", repositoryPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let retainedBytes = 0;
    let stderrBytes = 0;
    let spawnError = null;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (retainedBytes >= maxStdoutBytes) return;
      const retained = chunk.subarray(0, maxStdoutBytes - retainedBytes);
      stdout.push(retained);
      retainedBytes += retained.length;
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= 64 * 1024) return;
      const retained = chunk.subarray(0, 64 * 1024 - stderrBytes);
      stderr.push(retained);
      stderrBytes += retained.length;
    });
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code) => resolvePromise({
      code: spawnError?.code ?? code ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdoutBytes,
      truncated: stdoutBytes > retainedBytes,
    }));
  });
}

function diffSummary(statResult, numstatResult) {
  const rows = numstatResult.stdout.split("\n").filter(Boolean);
  const binaryFiles = rows.filter((line) => line.startsWith("-\t-\t"))
    .map((line) => line.split("\t").slice(2).join("\t"));
  const stat = statResult.stdout.trim();
  return {
    stat: stat.slice(0, DIFF_STAT_MAX_CHARS),
    statTruncated: stat.length > DIFF_STAT_MAX_CHARS,
    filesChanged: rows.length,
    binaryFileCount: binaryFiles.length,
    binaryFiles: binaryFiles.slice(0, DIFF_BINARY_PATH_LIMIT),
    binaryFilesTruncated: binaryFiles.length > DIFF_BINARY_PATH_LIMIT,
  };
}

function runFile(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    }, (error, stdout, stderr) => {
      resolvePromise({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

function gitError(operation, result) {
  return Object.assign(new Error(`${operation} failed: ${result.stderr || result.stdout}`.trim()), { code: "git_operation_failed", operation });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
    const branch = `pink-guy/${taskId.replace(/[^a-zA-Z0-9_.-]/g, "-")}/${shortRun}`;
    const path = join(this.workspaceRoot, runId);
    const task = this.store.getTask(taskId);
    if (!task?.revision) {
      throw Object.assign(new Error("task has no authoritative Git revision"), { code: "revision_required" });
    }
    const base = await runGit(this.repositoryPath, ["rev-parse", `${task.revision}^{commit}`]);
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

  async diff(workspace, { maxBytes = DEFAULT_DIFF_MAX_BYTES } = {}) {
    await this.assertWorkspace(workspace);
    const [result, statResult, numstatResult] = await Promise.all([
      runGitBounded(workspace.workspace_path, ["diff", "--no-ext-diff", "--no-color", "HEAD", "--"], {
        maxStdoutBytes: maxBytes,
      }),
      runGit(workspace.workspace_path, ["diff", "--no-ext-diff", "--stat", "HEAD", "--"]),
      runGit(workspace.workspace_path, ["diff", "--no-ext-diff", "--numstat", "HEAD", "--"]),
    ]);
    if (result.code !== 0) throw gitError("git diff", result);
    if (statResult.code !== 0) throw gitError("git diff stat", statResult);
    if (numstatResult.code !== 0) throw gitError("git diff numstat", numstatResult);
    return {
      workspaceId: workspace.id,
      revision: await this.revision(workspace),
      diff: result.stdout,
      truncated: result.truncated,
      totalBytes: result.stdoutBytes,
      maxBytes,
      summary: diffSummary(statResult, numstatResult),
    };
  }

  async comparisonDiff(workspace, { maxBytes = DEFAULT_DIFF_MAX_BYTES } = {}) {
    await this.assertWorkspace(workspace);
    const currentRevision = await this.revision(workspace);
    const range = [workspace.base_revision, currentRevision, "--"];
    const [result, statResult, numstatResult] = await Promise.all([
      runGitBounded(workspace.workspace_path, [
        "diff", "--no-ext-diff", "--no-color", ...range,
      ], { maxStdoutBytes: maxBytes }),
      runGit(workspace.workspace_path, ["diff", "--no-ext-diff", "--stat", ...range]),
      runGit(workspace.workspace_path, ["diff", "--no-ext-diff", "--numstat", ...range]),
    ]);
    if (result.code !== 0) throw gitError("compare workspace revision", result);
    if (statResult.code !== 0) throw gitError("compare workspace stat", statResult);
    if (numstatResult.code !== 0) throw gitError("compare workspace numstat", numstatResult);
    return {
      workspaceId: workspace.id,
      baseRevision: workspace.base_revision,
      revision: currentRevision,
      diff: result.stdout,
      truncated: result.truncated,
      totalBytes: result.stdoutBytes,
      maxBytes,
      summary: diffSummary(statResult, numstatResult),
    };
  }

  async revision(workspace) {
    const result = await runGit(workspace.workspace_path, ["rev-parse", "HEAD"]);
    if (result.code !== 0) throw gitError("resolve workspace revision", result);
    return result.stdout.trim();
  }

  async repositoryIdentity() {
    const [topLevel, head, originHead, originUrl] = await Promise.all([
      runGit(this.repositoryPath, ["rev-parse", "--show-toplevel"]),
      runGit(this.repositoryPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      runGit(this.repositoryPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
      runGit(this.repositoryPath, ["remote", "get-url", "origin"]),
    ]);
    if (topLevel.code !== 0) throw gitError("resolve repository identity", topLevel);
    const defaultBranch = originHead.code === 0
      ? originHead.stdout.trim().replace(/^origin\//, "")
      : head.code === 0 ? head.stdout.trim() : null;
    if (!defaultBranch) {
      throw Object.assign(new Error("repository has no detectable default branch"), {
        code: "git_default_branch_required",
      });
    }
    return {
      repositoryPath: topLevel.stdout.trim(),
      repositorySha256: sha256(topLevel.stdout.trim()),
      defaultBranch,
      remoteName: "origin",
      remoteUrl: originUrl.code === 0 ? originUrl.stdout.trim() : null,
    };
  }

  async resolveRef(ref) {
    const resolved = await runGit(this.repositoryPath, ["rev-parse", `${ref}^{commit}`]);
    if (resolved.code !== 0) throw gitError(`resolve ${ref}`, resolved);
    return resolved.stdout.trim();
  }

  integrationBranch(integrationId, suffix = "") {
    const safe = integrationId.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80);
    return `pink-guy/integration/${safe}${suffix}`;
  }

  async removeManagedWorktree(path, branch = null) {
    if (await exists(path)) {
      const removed = await runGit(this.repositoryPath, ["worktree", "remove", "--force", path]);
      if (removed.code !== 0) throw gitError("remove managed worktree", removed);
    }
    await runGit(this.repositoryPath, ["worktree", "prune"]);
    if (branch) {
      const deleted = await runGit(this.repositoryPath, ["branch", "-D", branch]);
      if (deleted.code !== 0 && !/not found|not exist/i.test(`${deleted.stderr}\n${deleted.stdout}`)) {
        throw gitError("delete managed branch", deleted);
      }
    }
  }

  async simulateIntegration({
    integrationId,
    sourceRevision,
    targetBranch,
    historyPolicy,
  }) {
    const source = await this.resolveRef(sourceRevision);
    const target = await this.resolveRef(`refs/heads/${targetBranch}`);
    const previewPath = join(this.workspaceRoot, "integration-previews", integrationId);
    const previewBranch = historyPolicy === "rebase"
      ? this.integrationBranch(integrationId, "-preview")
      : null;
    await mkdir(join(this.workspaceRoot, "integration-previews"), { recursive: true, mode: 0o700 });
    await this.removeManagedWorktree(previewPath, previewBranch).catch(() => undefined);
    const addArgs = historyPolicy === "rebase"
      ? ["worktree", "add", "-b", previewBranch, previewPath, source]
      : ["worktree", "add", "--detach", previewPath, target];
    const created = await runGit(this.repositoryPath, addArgs);
    if (created.code !== 0) throw gitError("create integration preview", created);
    let operation;
    try {
      if (historyPolicy === "merge_commit") {
        operation = await runGit(previewPath, ["merge", "--no-commit", "--no-ff", source]);
      } else if (historyPolicy === "squash") {
        operation = await runGit(previewPath, ["merge", "--squash", source]);
      } else if (historyPolicy === "rebase") {
        const mergeBase = await runGit(this.repositoryPath, ["merge-base", target, source]);
        if (mergeBase.code !== 0) throw gitError("resolve integration merge base", mergeBase);
        operation = await runGit(previewPath, [
          "-c", "user.name=Pink Guy", "-c", "user.email=pink-guy@localhost.invalid",
          "rebase", "--onto", target, mergeBase.stdout.trim(), previewBranch,
        ]);
      } else {
        throw Object.assign(new Error(`unsupported history policy: ${historyPolicy}`), {
          code: "invalid_request",
        });
      }
      const clean = operation.code === 0;
      const conflictFiles = clean
        ? []
        : (await runGit(previewPath, ["diff", "--name-only", "--diff-filter=U"]))
          .stdout.split("\n").map((value) => value.trim()).filter(Boolean);
      return {
        clean,
        sourceRevision: source,
        targetBranch,
        targetRevision: target,
        historyPolicy,
        conflictFiles,
        diagnostic: clean ? null : (operation.stderr || operation.stdout).trim().slice(0, 8_000),
      };
    } finally {
      await this.removeManagedWorktree(previewPath, previewBranch).catch(() => undefined);
    }
  }

  async createIntegrationResult({
    integrationId,
    sourceRevision,
    targetBranch,
    targetRevision,
    historyPolicy,
    taskId,
  }) {
    const currentTarget = await this.resolveRef(`refs/heads/${targetBranch}`);
    if (currentTarget !== targetRevision) {
      throw Object.assign(new Error("integration target moved after preparation"), {
        code: "integration_stale",
        expectedTargetRevision: targetRevision,
        currentTargetRevision: currentTarget,
      });
    }
    const source = await this.resolveRef(sourceRevision);
    const branch = this.integrationBranch(integrationId);
    const path = join(this.workspaceRoot, "integrations", integrationId);
    await mkdir(join(this.workspaceRoot, "integrations"), { recursive: true, mode: 0o700 });
    await this.removeManagedWorktree(path, branch).catch(() => undefined);
    const startRevision = historyPolicy === "rebase" ? source : targetRevision;
    const created = await runGit(this.repositoryPath, [
      "worktree", "add", "-b", branch, path, startRevision,
    ]);
    if (created.code !== 0) throw gitError("create integration worktree", created);
    let operation;
    if (historyPolicy === "merge_commit") {
      operation = await runGit(path, [
        "-c", "user.name=Pink Guy", "-c", "user.email=pink-guy@localhost.invalid",
        "merge", "--no-ff", source,
        "-m", `Integrate Pink Guy task ${taskId}`,
        "-m", `Pink-Guy-Task: ${taskId}\nPink-Guy-Integration: ${integrationId}`,
      ]);
    } else if (historyPolicy === "squash") {
      operation = await runGit(path, ["merge", "--squash", source]);
      if (operation.code === 0) {
        operation = await runGit(path, [
          "-c", "user.name=Pink Guy", "-c", "user.email=pink-guy@localhost.invalid",
          "commit", "-m", `Integrate Pink Guy task ${taskId}`,
          "-m", `Pink-Guy-Task: ${taskId}\nPink-Guy-Integration: ${integrationId}`,
        ]);
      }
    } else if (historyPolicy === "rebase") {
      const mergeBase = await runGit(this.repositoryPath, ["merge-base", targetRevision, source]);
      if (mergeBase.code !== 0) throw gitError("resolve integration merge base", mergeBase);
      operation = await runGit(path, [
        "-c", "user.name=Pink Guy", "-c", "user.email=pink-guy@localhost.invalid",
        "rebase", "--onto", targetRevision, mergeBase.stdout.trim(), branch,
      ]);
    } else {
      throw Object.assign(new Error(`unsupported history policy: ${historyPolicy}`), {
        code: "invalid_request",
      });
    }
    if (operation.code !== 0) {
      const conflicts = (await runGit(path, ["diff", "--name-only", "--diff-filter=U"]))
        .stdout.split("\n").map((value) => value.trim()).filter(Boolean);
      throw Object.assign(new Error(
        `integration produced conflicts: ${(operation.stderr || operation.stdout).trim()}`,
      ), {
        code: "integration_conflict",
        conflicts,
        branch,
        path,
      });
    }
    const resultRevision = await this.resolveRef(branch);
    return {
      branch,
      path,
      sourceRevision: source,
      targetBranch,
      targetRevision,
      resultRevision,
      historyPolicy,
    };
  }

  async cleanupIntegration(integrationId) {
    const branch = this.integrationBranch(integrationId);
    const path = join(this.workspaceRoot, "integrations", integrationId);
    await this.removeManagedWorktree(path, branch);
    return { integrationId, path, branch };
  }

  async publishLocalIntegration(result) {
    const currentTarget = await this.resolveRef(`refs/heads/${result.targetBranch}`);
    if (currentTarget !== result.targetRevision) {
      throw Object.assign(new Error("integration target moved before publication"), {
        code: "integration_stale",
        expectedTargetRevision: result.targetRevision,
        currentTargetRevision: currentTarget,
      });
    }
    const worktreeList = await runGit(this.repositoryPath, ["worktree", "list", "--porcelain"]);
    if (worktreeList.code !== 0) throw gitError("inspect target worktrees", worktreeList);
    const entries = worktreeList.stdout.trim().split(/\n\n+/).map((block) =>
      Object.fromEntries(block.split("\n").map((line) => {
        const [key, ...rest] = line.split(" ");
        return [key, rest.join(" ") || true];
      }))
    );
    const targetEntry = entries.find((entry) =>
      entry.branch === `refs/heads/${result.targetBranch}`
    );
    if (targetEntry?.worktree) {
      const status = await runGit(targetEntry.worktree, ["status", "--porcelain=v1"]);
      if (status.code !== 0) throw gitError("inspect checked-out target", status);
      if (status.stdout.trim()) {
        throw Object.assign(new Error("checked-out target branch has owner modifications"), {
          code: "target_worktree_dirty",
          targetWorktree: targetEntry.worktree,
        });
      }
      const advanced = await runGit(targetEntry.worktree, ["merge", "--ff-only", result.resultRevision]);
      if (advanced.code !== 0) throw gitError("publish integration to checked-out target", advanced);
    } else {
      const advanced = await runGit(this.repositoryPath, [
        "update-ref",
        `refs/heads/${result.targetBranch}`,
        result.resultRevision,
        result.targetRevision,
      ]);
      if (advanced.code !== 0) throw gitError("publish integration target", advanced);
    }
    return {
      ...result,
      publishedRevision: await this.resolveRef(`refs/heads/${result.targetBranch}`),
      publication: "local_branch",
    };
  }

  async pushIntegration({ remoteName, targetBranch, expectedRemoteRevision = null }) {
    const targetRevision = await this.resolveRef(`refs/heads/${targetBranch}`);
    if (expectedRemoteRevision) {
      const remote = await runGit(this.repositoryPath, [
        "ls-remote", "--heads", remoteName, `refs/heads/${targetBranch}`,
      ]);
      if (remote.code !== 0) throw gitError("inspect remote target", remote);
      const actual = remote.stdout.trim().split(/\s+/)[0] || null;
      if (actual !== expectedRemoteRevision) {
        throw Object.assign(new Error("remote target moved before push"), {
          code: "integration_stale",
          expectedRemoteRevision,
          currentRemoteRevision: actual,
        });
      }
    }
    const pushed = await runGit(this.repositoryPath, [
      "push", "--porcelain", remoteName,
      `refs/heads/${targetBranch}:refs/heads/${targetBranch}`,
    ]);
    if (pushed.code !== 0) throw gitError("push integrated target", pushed);
    return { remoteName, targetBranch, targetRevision, output: pushed.stdout.trim() };
  }

  async publishPullRequest({
    branch,
    remoteName,
    targetBranch,
    title,
    body,
  }) {
    const pushed = await runGit(this.repositoryPath, [
      "push", "--porcelain", "--set-upstream", remoteName,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ]);
    if (pushed.code !== 0) throw gitError("push pull-request branch", pushed);
    const created = await runFile("gh", [
      "pr", "create",
      "--base", targetBranch,
      "--head", branch,
      "--title", title,
      "--body", body,
    ], {
      cwd: this.repositoryPath,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    if (created.code !== 0) {
      throw Object.assign(new Error(
        `pull-request creation outcome requires reconciliation: ${created.stderr || created.stdout}`,
      ), {
        code: "side_effect_uncertain",
        branch,
        remoteName,
      });
    }
    return {
      publication: "pull_request",
      branch,
      remoteName,
      targetBranch,
      url: created.stdout.trim().split("\n").at(-1) || null,
      pushed: pushed.stdout.trim(),
    };
  }

  async retireWorkspace(workspace) {
    if (workspace.state === "retired") return { replayed: true, workspaceId: workspace.id };
    const managedBranch = workspace.branch.startsWith("pink-guy/")
      || workspace.branch.startsWith("boss-man/");
    if (!managedBranch) {
      throw Object.assign(new Error("workspace branch is not Pink Guy-managed"), {
        code: "workspace_tampered",
      });
    }
    if (await exists(workspace.workspace_path)) await this.assertWorkspace(workspace);
    await this.removeManagedWorktree(workspace.workspace_path, workspace.branch);
    return {
      replayed: false,
      workspaceId: workspace.id,
      branch: workspace.branch,
      path: workspace.workspace_path,
    };
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
      return { replayed: true, operation: prior, revisionReceipt: this.store.recordHostGitRevision(prior) };
    }
    const status = await this.status(workspace);
    if (!status.dirty) throw Object.assign(new Error("workspace has no changes to checkpoint"), { code: "git_no_changes" });
    const priorRevision = await this.revision(workspace);
    const subject = cleanMessage(message, kind === "checkpoint" ? "chore: Pink Guy checkpoint" : "chore: Pink Guy commit");
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
        if (operation) {
          return { replayed: true, operation, revisionReceipt: this.store.recordHostGitRevision(operation) };
        }
      }
      throw Object.assign(new Error("prior Git side effect requires reconciliation before retry"), {
        code: "reconciliation_required",
        sideEffectId: journal.effect.id,
      });
    }
    const staged = await runGit(workspace.workspace_path, ["add", "--all", "--", "."]);
    if (staged.code !== 0) throw gitError("stage workspace", staged);
    const trailers = [
      `Pink-Guy-Task: ${workspace.task_id}`,
      `Pink-Guy-Run: ${workspace.run_id}`,
      `Pink-Guy-Workspace: ${workspace.id}`,
      ...evidence.map((item) => `Pink-Guy-Evidence: ${String(item).replace(/[\r\n]/g, " ")}`),
    ].join("\n");
    const committed = await runGit(workspace.workspace_path, [
      "-c", "user.name=Pink Guy", "-c", "user.email=pink-guy@localhost.invalid",
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
    const revisionReceipt = this.store.recordHostGitRevision(operation);
    return { replayed: false, operation, revisionReceipt };
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
    const pinkProvenance = message.code === 0
      && message.stdout.includes(`Pink-Guy-Task: ${workspace.task_id}`)
      && message.stdout.includes(`Pink-Guy-Run: ${workspace.run_id}`)
      && message.stdout.includes(`Pink-Guy-Workspace: ${workspace.id}`);
    const legacyProvenance = message.code === 0
      && message.stdout.includes(`Boss-Man-Task: ${workspace.task_id}`)
      && message.stdout.includes(`Boss-Man-Run: ${workspace.run_id}`)
      && message.stdout.includes(`Boss-Man-Workspace: ${workspace.id}`);
    const provenance = pinkProvenance || legacyProvenance;
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
    this.store.recordHostGitRevision(operation);
    return { state: "completed", operation, source: "git_provenance" };
  }
}
