import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { access, chmod, copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { RtkArtifactIngestor } from "./artifacts.mjs";
import { ContextCustodyService } from "./context-service.mjs";
import { redactValue, RunCredentialVault } from "./credentials.mjs";
import { HostGitService } from "./git-service.mjs";
import {
  assertConfiguredModelSelection,
  createModelRoutePolicy,
  publicModelRoutePolicy,
  resolveModelRoute,
} from "./model-routes.mjs";
import { composeAgentSystemPrompt, phaseKickoffPrompt } from "./prompt-profiles.mjs";
import { PiRpcProcess, WorkspaceShell } from "./rpc.mjs";
import {
  canonicalSha256,
  deleteDeclaredPaths,
  inventoryStateRoot,
  sessionDeletionPaths,
  writeSessionDeletionManifest,
} from "./resource-lifecycle.mjs";
import { DockerTaskRuntime } from "./runtime.mjs";
import { Phase0Store } from "./store.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(moduleDirectory, "../pi");
const rtkConfiguration = resolve(moduleDirectory, "../../config/rtk-config.toml");
const execFileAsync = promisify(execFile);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
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

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function bearerToken(request) {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function clippedText(value, limit = 16_000) {
  if (typeof value !== "string") return null;
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function sanitizePiConversationEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") return null;
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update?.type === "text_delta") {
      return { type: "text_delta", payload: { delta: clippedText(update.delta) ?? "" } };
    }
    if (update?.type === "thinking_start" || update?.type === "thinking_end") {
      return { type: update.type, payload: {} };
    }
    if (update?.type === "toolcall_end") {
      return {
        type: "tool_call",
        payload: {
          toolCallId: update.toolCall?.id ?? null,
          toolName: update.toolCall?.name ?? null,
        },
      };
    }
    return null;
  }
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_start",
      payload: { toolCallId: event.toolCallId ?? null, toolName: event.toolName ?? null },
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool_end",
      payload: {
        toolCallId: event.toolCallId ?? null,
        toolName: event.toolName ?? null,
        isError: Boolean(event.isError),
      },
    };
  }
  if (event.type === "compaction_start") {
    return { type: "compaction_start", payload: { reason: event.reason ?? null } };
  }
  if (event.type === "compaction_end") {
    return {
      type: "compaction_end",
      payload: {
        reason: event.reason ?? null,
        aborted: Boolean(event.aborted),
        willRetry: Boolean(event.willRetry),
        tokensBefore: event.result?.tokensBefore ?? null,
        estimatedTokensAfter: event.result?.estimatedTokensAfter ?? null,
      },
    };
  }
  if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
    return {
      type: event.type,
      payload: {
        attempt: event.attempt ?? null,
        maxAttempts: event.maxAttempts ?? null,
        success: event.success ?? null,
      },
    };
  }
  if (["agent_start", "agent_end", "agent_settled", "turn_start", "turn_end"].includes(event.type)) {
    return { type: event.type, payload: {} };
  }
  if (event.type === "extension_error") {
    return {
      type: "extension_error",
      payload: {
        event: event.event ?? null,
        error: clippedText(event.error, 2_000),
      },
    };
  }
  return null;
}

export function sanitizePiTaskEvent(event) {
  const projected = sanitizePiConversationEvent(event);
  if (projected) return projected;
  if (event?.type === "response") {
    return {
      type: "response",
      payload: {
        id: event.id ?? null,
        command: event.command ?? null,
        success: Boolean(event.success),
        error: clippedText(event.error, 2_000),
        ...(event.command === "get_state" ? {
          state: {
            sessionId: event.data?.sessionId ?? null,
            sessionFile: event.data?.sessionFile ?? null,
            modelProvider: event.data?.model?.provider ?? null,
            modelId: event.data?.model?.id ?? null,
            thinkingLevel: event.data?.thinkingLevel ?? null,
          },
        } : {}),
      },
    };
  }
  if (event?.type === "extension_ui_request") {
    return {
      type: "extension_ui_request",
      payload: {
        method: event.method ?? null,
        message: clippedText(event.message, 2_000),
        notifyType: event.notifyType ?? null,
      },
    };
  }
  return null;
}

export function taskStateAllowsPhase(status, phase) {
  if (phase === "implementation") return status === "in_progress";
  return ["in_progress", "review"].includes(status);
}

async function repositoryRevision(repositoryPath) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repositoryPath, "rev-parse", "HEAD"], {
      encoding: "utf8",
    });
    return stdout.trim();
  } catch (error) {
    throw Object.assign(new Error(`cannot resolve project Git revision: ${error.stderr ?? error.message}`), {
      code: "git_operation_failed",
    });
  }
}

function repositorySource(value) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || source.includes("\0") || source.length > 2_000) {
    throw Object.assign(new Error("repository URL is required"), { code: "invalid_request" });
  }
  if (
    source.startsWith("https://")
    || source.startsWith("ssh://")
    || source.startsWith("file://")
    || /^git@[A-Za-z0-9._-]+:.+/.test(source)
  ) return source;
  if (source.startsWith("/")) return resolve(source);
  throw Object.assign(
    new Error("repository URL must use HTTPS, SSH, file, or an absolute local path"),
    { code: "invalid_request" },
  );
}

function repositoryDisplayName(source) {
  const tail = source.replace(/\/+$/, "").split(/[/:]/).at(-1) ?? "";
  const name = tail.replace(/\.git$/, "").trim();
  if (!name) throw Object.assign(new Error("cannot derive a project name from repository URL"), { code: "invalid_request" });
  return name;
}

const BOARD_HTML = await readFile(resolve(moduleDirectory, "../ui/cockpit.html"), "utf8");
const LEASE_VIEW_MODULE = await readFile(resolve(moduleDirectory, "../ui/lease-view.mjs"), "utf8");

export class DirectControlPlane {
  constructor({
    databasePath, stateRoot, fixturePath, environment = process.env,
    runtimeImage = "pink-guy:pi-0.80.9-rtk-0.42.3",
    dockerCommand = "docker", credentialProfile = null,
    runtimeProvider = "boss-man-phase0", runtimeModel = "complete", runtimeThinking = "medium",
    modelRoutePolicy = null,
    runtimeOffline = true,
    faultInjector = async () => undefined, enforceOrchestratorLease = false,
    schedulerProjectCapacity = 1, schedulerGlobalCapacity = 1,
    storageWarningBytes = null, storageHardBytes = null,
  }) {
    this.store = new Phase0Store(databasePath);
    this.stateRoot = stateRoot;
    this.fixturePath = fixturePath;
    this.environment = environment;
    this.runtimeImage = runtimeImage;
    this.dockerCommand = dockerCommand;
    this.runtimeProvider = runtimeProvider;
    this.runtimeModel = runtimeModel;
    this.runtimeThinking = runtimeThinking;
    this.modelRoutePolicy = modelRoutePolicy ?? createModelRoutePolicy({
      provider: runtimeProvider,
      model: runtimeModel,
      thinking: runtimeThinking,
    });
    this.runtimeOffline = runtimeOffline;
    this.faultInjector = faultInjector;
    this.enforceOrchestratorLease = enforceOrchestratorLease;
    this.schedulerProjectCapacity = schedulerProjectCapacity;
    this.schedulerGlobalCapacity = schedulerGlobalCapacity;
    const configuredWarning = storageWarningBytes
      ?? Number(environment.PINK_GUY_STORAGE_WARN_BYTES || 0);
    const configuredHard = storageHardBytes
      ?? Number(environment.PINK_GUY_STORAGE_HARD_BYTES || 0);
    this.storageWarningBytes = Number.isFinite(configuredWarning) && configuredWarning > 0
      ? configuredWarning : null;
    this.storageHardBytes = Number.isFinite(configuredHard) && configuredHard > 0
      ? configuredHard : null;
    this.credentialVault = new RunCredentialVault({ stateRoot, profile: credentialProfile });
    this.gitServices = new Map();
    this.git = fixturePath ? this.gitService(fixturePath) : null;
    this.context = new ContextCustodyService({ store: this.store, stateRoot });
    this.sessions = new Map();
    this.executionPromises = new Map();
    this.server = null;
    this.reconciledRunIds = [];
    this.recoveryResults = [];
    this.recoveryChecked = false;
    this.exposureProfile = null;
  }

  resolveModelRoute(phase, route = null) {
    return resolveModelRoute(this.modelRoutePolicy, phase, route);
  }

  reconcileAutomaticPipelines(orchestratorToken) {
    const orchestrator = this.store.authorizeActiveProjectOrchestrator(orchestratorToken);
    return this.reconcileAutomaticProject(orchestrator.project_id);
  }

  reconcileAutomaticProject(projectId) {
    const directives = this.store.automaticPipelineDirectives(projectId);
    const receipts = [];
    for (const directive of directives) {
      if (directive.action !== "schedule") {
        receipts.push({ ...directive, scheduled: false });
        continue;
      }
      const modelRoute = {
        ...this.resolveModelRoute(directive.phase),
        policySource: "automatic_phase_continuation",
      };
      const result = this.store.scheduleOwnerTaskRun({
        taskId: directive.taskId,
        phase: directive.phase,
        modelRoute,
        actor: "pipeline-coordinator",
        source: "automatic_phase_continuation",
        idempotencyKey: [
          "automatic-phase",
          directive.taskId,
          directive.revision,
          directive.phase,
        ].join(":"),
      });
      receipts.push({
        ...directive,
        scheduled: true,
        replayed: result.replayed,
        commandId: result.command.id,
        modelRoute,
      });
    }
    return receipts;
  }

  async reconcileReadyDispatch(orchestratorToken) {
    const orchestrator = this.store.authorizeActiveProjectOrchestrator(orchestratorToken);
    return this.reconcileReadyProject(orchestrator.project_id);
  }

  async reconcileReadyProject(projectId) {
    if (this.storageWarningBytes || this.storageHardBytes) {
      await this.storageInventory();
    }
    return this.store.dispatchNextReadyTask({
      projectId,
      modelRoute: {
        ...this.resolveModelRoute("implementation"),
        policySource: "automatic_dispatch_default",
      },
      projectCapacity: this.schedulerProjectCapacity,
      globalCapacity: this.schedulerGlobalCapacity,
    });
  }

  assertLocalOwnerProfile() {
    if (this.exposureProfile !== "local_smoke") {
      throw Object.assign(new Error("local owner mutations require the loopback local-smoke profile"), {
        code: "local_operator_denied",
      });
    }
  }

  projectDeletionProjection(project) {
    const expectedPath = resolve(join(this.stateRoot, "repositories", project.id));
    const managedPath = resolve(project.repository_path) === expectedPath;
    const blockers = [
      ...(project.deletion_blockers ?? []),
      ...(managedPath ? [] : ["unmanaged_repository_path"]),
    ];
    return {
      ...project,
      deletion_eligible: blockers.length === 0,
      deletion_blockers: blockers,
    };
  }

  async deleteProject({
    projectId,
    confirmName,
    reason,
    idempotencyKey,
    actor = "local-owner",
  }) {
    const project = this.store.getProject(projectId, { includeDeleted: true });
    if (!project) {
      throw Object.assign(new Error(`unknown project: ${projectId}`), { code: "not_found" });
    }
    const expectedPath = resolve(join(this.stateRoot, "repositories", projectId));
    if (resolve(project.repository_path) !== expectedPath) {
      throw Object.assign(
        new Error("project deletion blocked: unmanaged_repository_path"),
        { code: "deletion_blocked", blockers: ["unmanaged_repository_path"] },
      );
    }
    const prior = this.store.projectDeletionReceiptByIdempotency(idempotencyKey);
    const receiptId = prior?.id ?? randomUUID();
    const quarantinePath = prior?.quarantine_path
      ?? resolve(join(this.stateRoot, "project-trash", receiptId));
    const begun = this.store.beginProjectDeletion({
      receiptId,
      projectId,
      confirmName,
      reason,
      originalPath: expectedPath,
      quarantinePath,
      idempotencyKey,
      actor,
    });
    let receipt = begun.receipt;
    if (receipt.state === "complete") {
      return { replayed: true, cleanupPending: false, receipt };
    }

    if (receipt.state === "prepared") {
      await mkdir(dirname(receipt.quarantine_path), { recursive: true, mode: 0o700 });
      const [originalExists, quarantineExists] = await Promise.all([
        exists(receipt.original_path),
        exists(receipt.quarantine_path),
      ]);
      if (originalExists === quarantineExists) {
        throw Object.assign(
          new Error("project checkout paths require reconciliation before deletion can continue"),
          { code: "reconciliation_required" },
        );
      }
      if (originalExists) await rename(receipt.original_path, receipt.quarantine_path);
      try {
        await this.faultInjector("project_delete_after_quarantine", { projectId, receiptId });
        receipt = this.store.tombstoneProjectDeletion(receiptId);
      } catch (error) {
        if (
          await exists(receipt.quarantine_path)
          && !(await exists(receipt.original_path))
        ) {
          await rename(receipt.quarantine_path, receipt.original_path);
        }
        throw error;
      }
    }

    if (receipt.state !== "tombstoned") {
      throw Object.assign(
        new Error(`project deletion requires reconciliation from state ${receipt.state}`),
        { code: "reconciliation_required" },
      );
    }
    const [originalExists, quarantineExists] = await Promise.all([
      exists(receipt.original_path),
      exists(receipt.quarantine_path),
    ]);
    if (originalExists) {
      throw Object.assign(
        new Error("tombstoned project checkout paths require reconciliation"),
        { code: "reconciliation_required" },
      );
    }
    if (quarantineExists) {
      try {
        await this.faultInjector("project_delete_before_cleanup", { projectId, receiptId });
        await rm(receipt.quarantine_path, { recursive: true, force: true });
      } catch (error) {
        return {
          replayed: begun.replayed,
          cleanupPending: true,
          receipt,
          cleanupError: error.message,
        };
      }
    }
    receipt = this.store.completeProjectDeletion(receiptId);
    return {
      replayed: begun.replayed,
      cleanupPending: false,
      receipt,
    };
  }

  gitService(repositoryPath) {
    const path = resolve(repositoryPath);
    if (!this.gitServices.has(path)) {
      this.gitServices.set(path, new HostGitService({
        store: this.store,
        repositoryPath: path,
        workspaceRoot: join(this.stateRoot, "workspaces"),
        faultInjector: this.faultInjector,
      }));
    }
    return this.gitServices.get(path);
  }

  async ensureProjectGitPolicy(projectId) {
    const project = this.store.getProject(projectId);
    if (!project) {
      throw Object.assign(new Error(`unknown project: ${projectId}`), { code: "not_found" });
    }
    const existing = this.store.projectGitPolicy(projectId);
    if (existing) return existing;
    const identity = await this.gitService(project.repository_path).repositoryIdentity();
    return this.store.ensureProjectGitPolicy({
      projectId,
      targetBranch: identity.defaultBranch,
    });
  }

  async prepareGitIntegration({
    taskId,
    idempotencyKey,
  }) {
    if (!idempotencyKey?.trim()) {
      throw Object.assign(new Error("Git integration idempotency key is required"), {
        code: "invalid_request",
      });
    }
    const replay = this.store.gitIntegrationPreparationByIdempotency({
      taskId,
      idempotencyKey,
    });
    if (replay) return { replayed: true, integration: replay };
    const task = this.store.getTaskDetails(taskId);
    if (!task) throw Object.assign(new Error(`unknown task: ${taskId}`), { code: "not_found" });
    const policy = await this.ensureProjectGitPolicy(task.project_id);
    const gates = this.store.integrationGateEvaluation(taskId);
    if (!gates.allowed) {
      throw Object.assign(
        new Error(`integration blocked: ${gates.reasons.join(",")}`),
        { code: "integration_blocked", reasons: gates.reasons },
      );
    }
    const project = this.store.getProject(task.project_id);
    const git = this.gitService(project.repository_path);
    const identity = await git.repositoryIdentity();
    const preview = await git.simulateIntegration({
      integrationId: sha256(`${taskId}:${idempotencyKey}`).slice(0, 24),
      sourceRevision: task.revision,
      targetBranch: policy.target_branch,
      historyPolicy: policy.history_policy,
    });
    return this.store.recordGitIntegrationPreparation({
      taskId,
      state: preview.clean ? "prepared" : "conflict",
      sourceRevision: task.revision,
      targetBranch: policy.target_branch,
      targetRevision: preview.targetRevision,
      plan: {
        ...preview,
        repositoryIdentity: identity,
        policy,
        forcePush: false,
      },
      idempotencyKey,
    });
  }

  async actOnGitIntegration({
    integrationId,
    action,
    expectedVersion,
    reason,
    idempotencyKey,
  }) {
    const current = this.store.gitIntegration(integrationId);
    if (!current) {
      throw Object.assign(new Error(`unknown Git integration: ${integrationId}`), {
        code: "not_found",
      });
    }
    if (
      action === "cancel"
      && !["prepared", "conflict", "failed", "reconciliation_required"].includes(current.state)
    ) {
      throw Object.assign(
        new Error(`integration cannot be cancelled while ${current.state}`),
        { code: "transition_denied" },
      );
    }
    let gates = null;
    let policy = null;
    let task = null;
    let git = null;
    if (action === "execute") {
      if (current.state !== "prepared") {
        throw Object.assign(
          new Error(`only a prepared integration can execute; current state is ${current.state}`),
          { code: "transition_denied" },
        );
      }
      gates = this.store.integrationGateEvaluation(current.task_id);
      if (!gates.allowed) {
        throw Object.assign(
          new Error(`integration blocked: ${gates.reasons.join(",")}`),
          { code: "integration_blocked", reasons: gates.reasons },
        );
      }
      policy = await this.ensureProjectGitPolicy(current.project_id);
      if (
        policy.version !== current.policy_version
        || policy.mode !== current.mode
        || policy.history_policy !== current.history_policy
        || policy.target_branch !== current.target_branch
      ) {
        throw Object.assign(new Error("integration policy changed after preparation"), {
          code: "integration_stale",
        });
      }
      if (policy.mode === "prepare_only") {
        throw Object.assign(new Error("project policy is prepare-only"), {
          code: "integration_execution_disabled",
        });
      }
      task = gates.task;
      const project = this.store.getProject(current.project_id);
      git = this.gitService(project.repository_path);
      const currentIdentity = await git.repositoryIdentity();
      const preparedIdentity = current.plan?.repositoryIdentity;
      if (
        !preparedIdentity
        || currentIdentity.repositorySha256 !== preparedIdentity.repositorySha256
        || currentIdentity.defaultBranch !== preparedIdentity.defaultBranch
        || currentIdentity.remoteUrl !== preparedIdentity.remoteUrl
      ) {
        throw Object.assign(new Error("repository identity changed after preparation"), {
          code: "integration_stale",
          preparedIdentity,
          currentIdentity,
        });
      }
      const currentTarget = await git.resolveRef(`refs/heads/${current.target_branch}`);
      if (
        currentTarget !== current.target_revision
        || task.revision !== current.source_revision
      ) {
        throw Object.assign(new Error("integration evidence is stale"), {
          code: "integration_stale",
          expectedTargetRevision: current.target_revision,
          currentTargetRevision: currentTarget,
        });
      }
    }
    const receipt = this.store.recordGitIntegrationAction({
      integrationId,
      action,
      expectedVersion,
      reason,
      idempotencyKey,
    });
    if (receipt.replayed && (action !== "cancel" || receipt.integration.state === "cancelled")) {
      return receipt;
    }
    let integration = receipt.integration;
    if (action === "cancel") {
      const project = this.store.getProject(current.project_id);
      await this.gitService(project.repository_path).cleanupIntegration(integrationId);
      integration = this.store.transitionGitIntegration({
        integrationId,
        expectedVersion: integration.version,
        state: "cancelled",
        result: { reason, actionReceiptId: receipt.receipt.id },
      });
      this.store.completeGitIntegrationAction(receipt.receipt.id, {
        state: "cancelled",
      });
      return { ...receipt, integration };
    }
    integration = this.store.transitionGitIntegration({
      integrationId,
      expectedVersion: integration.version,
      state: "integrating",
      result: { actionReceiptId: receipt.receipt.id },
    });
    try {
      const result = await git.createIntegrationResult({
        integrationId,
        sourceRevision: integration.source_revision,
        targetBranch: integration.target_branch,
        targetRevision: integration.target_revision,
        historyPolicy: integration.history_policy,
        taskId: integration.task_id,
      });
      let publication;
      let finalState;
      if (policy.mode === "local_integrate") {
        publication = await git.publishLocalIntegration(result);
        if (policy.allow_push) {
          publication.push = await git.pushIntegration({
            remoteName: policy.remote_name,
            targetBranch: policy.target_branch,
            expectedRemoteRevision: integration.plan?.remoteTargetRevision ?? null,
          });
          finalState = "published";
        } else {
          finalState = "integrated";
        }
      } else {
        publication = await git.publishPullRequest({
          branch: result.branch,
          remoteName: policy.remote_name,
          targetBranch: policy.target_branch,
          title: task.title,
          body: [
            `Pink Guy task: ${task.id}`,
            `Validated revision: ${task.revision}`,
            `Integration receipt: ${integration.id}`,
          ].join("\n\n"),
        });
        finalState = "published";
      }
      await git.cleanupIntegration(integrationId);
      integration = this.store.transitionGitIntegration({
        integrationId,
        expectedVersion: integration.version,
        state: finalState,
        resultRevision: publication.publishedRevision ?? result.resultRevision,
        result: { ...result, publication, actionReceiptId: receipt.receipt.id },
      });
      this.store.completeGitIntegrationAction(receipt.receipt.id, {
        state: finalState,
        resultRevision: integration.result_revision,
      });
      return { ...receipt, integration };
    } catch (error) {
      const state = error.code === "integration_conflict"
        ? "conflict"
        : ["integration_stale", "target_worktree_dirty"].includes(error.code)
          ? "failed"
          : "reconciliation_required";
      integration = this.store.transitionGitIntegration({
        integrationId,
        expectedVersion: integration.version,
        state,
        failure: {
          code: error.code ?? "git_operation_failed",
          message: clippedText(error.message, 4_000),
          conflicts: error.conflicts ?? [],
          branch: error.branch ?? null,
          path: error.path ?? null,
        },
      });
      this.store.completeGitIntegrationAction(receipt.receipt.id, {
        state,
        failure: integration.failure,
      });
      return { ...receipt, integration };
    }
  }

  async storageInventory() {
    const inventory = await inventoryStateRoot({
      stateRoot: this.stateRoot,
      warningBytes: this.storageWarningBytes,
      hardBytes: this.storageHardBytes,
    });
    this.store.setRuntimeFlag("storage_pressure", {
      hardBlocked: inventory.hardBlocked,
      warning: inventory.warning,
      totalBytes: inventory.totalBytes,
      hardBytes: inventory.limits.hardBytes,
      warningBytes: inventory.limits.warningBytes,
      measuredAt: inventory.generatedAt,
    });
    return inventory;
  }

  async taskCleanupPreview(taskId) {
    const projection = this.store.resourceCleanupProjection(taskId);
    const resources = [];
    for (const workspace of projection.workspaces) {
      const blockers = [...workspace.blockers];
      let container = { state: "absent", id: workspace.container_id ?? null };
      if (workspace.container_id) {
        try {
          const runtime = new DockerTaskRuntime({
            dockerCommand: this.dockerCommand,
            containerId: workspace.container_id,
          });
          const inspected = await runtime.inspect();
          container = inspected
            ? { state: inspected.running ? "running" : "stopped", id: inspected.id }
            : { state: "absent", id: workspace.container_id };
          if (inspected?.running) blockers.push("container_running");
        } catch (error) {
          container = {
            state: "unknown",
            id: workspace.container_id,
            error: { code: error.code ?? "container_runtime_failed", message: error.message },
          };
          blockers.push("container_identity_unknown");
        }
      }
      resources.push({
        kind: "workspace_runtime",
        workspaceId: workspace.id,
        runId: workspace.run_id,
        sessionId: workspace.session_id,
        phase: workspace.phase,
        path: workspace.workspace_path,
        branch: workspace.branch,
        container,
        eligible: blockers.length === 0,
        blockers: [...new Set(blockers)],
      });
    }
    const canonical = {
      projectId: projection.task.project_id,
      taskId,
      resources,
    };
    return {
      ...canonical,
      holds: projection.holds,
      previewSha256: canonicalSha256(canonical),
      generatedAt: new Date().toISOString(),
    };
  }

  async executeTaskCleanup({
    taskId,
    previewSha256,
    reason,
    idempotencyKey,
  }) {
    const prior = this.store.resourceCleanupByIdempotency(idempotencyKey);
    const preview = await this.taskCleanupPreview(taskId);
    if (!prior && preview.previewSha256 !== previewSha256) {
      throw Object.assign(new Error("cleanup eligibility changed; review the fresh preview"), {
        code: "preview_stale",
        preview,
      });
    }
    const selected = prior?.resources
      ?? preview.resources.filter((resource) => resource.eligible);
    const begun = this.store.beginResourceCleanup({
      projectId: prior?.project_id ?? preview.projectId,
      taskId,
      previewSha256,
      resources: selected,
      reason,
      idempotencyKey,
    });
    if (begun.replayed && begun.operation.state === "complete") return begun;
    const results = [];
    for (const resource of selected) {
      const workspace = this.store.getWorkspace(resource.workspaceId);
      if (workspace?.state === "retired") {
        results.push({ ...resource, state: "retired", replayed: true });
        continue;
      }
      const current = preview.resources.find(
        (candidate) => candidate.workspaceId === resource.workspaceId,
      );
      if (!workspace || !current) {
        results.push({
          ...resource,
          state: "failed",
          error: { code: "cleanup_resource_missing", message: "workspace resource is missing" },
        });
        continue;
      }
      if (!current.eligible) {
        results.push({
          ...current,
          state: "failed",
          error: {
            code: "cleanup_safety_changed",
            message: `cleanup is now blocked: ${current.blockers.join(",")}`,
          },
        });
        continue;
      }
      try {
        if (current.container.state === "stopped") {
          await new DockerTaskRuntime({
            dockerCommand: this.dockerCommand,
            containerId: current.container.id,
          }).remove();
        }
        await this.gitService(workspace.repository_path).retireWorkspace(workspace);
        this.store.markWorkspaceRetired(resource.workspaceId, { reason });
        results.push({ ...current, state: "retired" });
      } catch (error) {
        results.push({
          ...current,
          state: "failed",
          error: { code: error.code ?? "cleanup_failed", message: error.message },
        });
      }
    }
    const state = results.every((result) => result.state === "retired")
      ? "complete" : "cleanup_pending";
    const operation = this.store.completeResourceCleanup(begun.operation.id, {
      state,
      result: { results },
    });
    return { replayed: begun.replayed, operation };
  }

  async sessionDeletionPreview(sessionId) {
    const projection = this.store.sessionDeletionProjection(sessionId);
    const paths = sessionDeletionPaths(this.stateRoot, projection);
    const canonical = {
      sessionId,
      taskId: projection.task.id,
      eligible: projection.eligible,
      blockers: projection.blockers,
      paths,
      artifacts: projection.artifacts.map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        sha256: artifact.sha256,
      })),
      runIds: projection.runs.map((run) => run.id),
    };
    return {
      ...canonical,
      previewSha256: canonicalSha256(canonical),
      generatedAt: new Date().toISOString(),
    };
  }

  async deleteSessionArtifacts({
    sessionId,
    confirmSessionId,
    previewSha256,
    reason,
    idempotencyKey,
  }) {
    const prior = this.store.sessionDeletionByIdempotency(idempotencyKey);
    const preview = prior?.preview ?? await this.sessionDeletionPreview(sessionId);
    if (!prior && preview.previewSha256 !== previewSha256) {
      throw Object.assign(new Error("session deletion preview changed"), {
        code: "preview_stale",
        preview,
      });
    }
    const begun = this.store.beginSessionDeletion({
      sessionId,
      confirmSessionId,
      previewSha256,
      preview,
      reason,
      idempotencyKey,
    });
    if (begun.replayed && begun.receipt.state === "complete") return begun;
    const declaredPreview = begun.receipt.preview;
    const manifest = begun.receipt.manifest_path
      ? { manifestPath: begun.receipt.manifest_path }
      : await writeSessionDeletionManifest({
        stateRoot: this.stateRoot,
        receiptId: begun.receipt.id,
        sessionId,
        paths: declaredPreview.paths,
        reason,
      });
    const cleanup = await deleteDeclaredPaths(this.stateRoot, declaredPreview.paths);
    const receipt = this.store.settleSessionDeletion(begun.receipt.id, {
      state: cleanup.complete ? "complete" : "cleanup_pending",
      manifestPath: manifest.manifestPath,
      result: cleanup,
    });
    return { replayed: begun.replayed, receipt };
  }

  seed(options = {}) {
    const repositoryPath = options.repositoryPath ?? this.fixturePath;
    const revision = options.revision ?? execFileSync(
      "git",
      ["-C", repositoryPath, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    return this.store.seedProjectTask({
      repositoryPath,
      revision,
      title: options.title ?? "Correct deterministic slug normalization",
      ...options,
    });
  }

  async applyConversationTaskMutation({ token, turnId, body, idempotencyKey }) {
    if (body.operation === "create") {
      const active = this.store.activeConversationTurnForLease(token, turnId);
      if (!active.conversation.project_id) {
        throw Object.assign(new Error("an unbound topic cannot create executable tasks"), {
          code: "project_required",
        });
      }
      const project = this.store.getProject(active.conversation.project_id);
      return this.store.createConversationTask({
        token,
        turnId,
        title: body.title,
        acceptanceCriteria: body.acceptanceCriteria ?? [],
        taskKind: body.taskKind ?? "executable",
        tags: body.tags ?? [],
        revision: await repositoryRevision(project.repository_path),
        idempotencyKey,
      });
    }
    if (["release", "pause_dispatch", "manualize_dispatch", "set_priority"].includes(body.operation)) {
      const active = this.store.activeConversationTurnForLease(token, turnId);
      const task = this.store.getTask(body.taskId);
      if (!task || task.project_id !== active.conversation.project_id) {
        throw Object.assign(new Error("task is outside the active conversation project"), {
          code: "orchestrator_denied",
        });
      }
      const modelRoute = body.operation === "release"
        ? this.resolveModelRoute("implementation", {
          provider: body.modelProvider ?? undefined,
          model: body.modelId ?? undefined,
          thinking: body.thinkingLevel ?? undefined,
          billingClass: body.billingClass ?? undefined,
          policySource: "orchestrator_release",
        })
        : null;
      if (modelRoute) {
        assertConfiguredModelSelection(this.modelRoutePolicy, "implementation", modelRoute);
      }
      const result = this.store.setTaskDispatch({
        taskId: task.id,
        operation: body.operation,
        expectedVersion: body.expectedVersion,
        priority: body.priority ?? null,
        modelRoute,
        idempotencyKey,
        actor: `orchestrator:${active.conversation.id}`,
        actorRole: "orchestrator",
      });
      if (!result.replayed) {
        this.store.appendConversationEvent(
          active.conversation.id,
          active.turn.id,
          "task_mutation_applied",
          "orchestrator",
          {
            operation: body.operation,
            taskId: task.id,
            taskVersion: result.task.version,
            dispatchPolicy: result.task.dispatch_policy,
            priority: result.task.priority,
          },
        );
      }
      const dispatch = body.operation === "release"
        ? await this.reconcileReadyProject(task.project_id)
        : null;
      return {
        ...result,
        task: this.store.getTaskDetails(task.id),
        operation: body.operation,
        childTask: null,
        dispatch,
        queue: this.store.taskDispatchProjection(task.id),
      };
    }
    return this.store.mutateConversationTask({
      token,
      turnId,
      operation: body.operation,
      taskId: body.taskId,
      expectedVersion: body.expectedVersion,
      title: body.title,
      acceptanceCriteria: body.acceptanceCriteria,
      taskKind: body.taskKind,
      tags: body.tags,
      dependsOnTaskId: body.dependsOnTaskId,
      body: body.body,
      category: body.category,
      question: body.question,
      reason: body.reason,
      idempotencyKey,
    });
  }

  async startTask(taskId, {
    orchestratorToken = null,
    phase = "implementation",
    modelRoute = null,
    executionId = null,
    executionGeneration = null,
  } = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    if (task.archived_at || task.task_kind !== "executable") {
      throw Object.assign(new Error("only active executable tasks can start a session"), {
        code: "transition_denied",
      });
    }
    if (phase === "implementation" && !task.assigned_worker) {
      throw new Error(`implementation task must be assigned before starting a session: ${taskId}`);
    }
    if (!taskStateAllowsPhase(task.status, phase)) {
      throw new Error("task must be in the active state required by its agent phase");
    }
    const project = this.store.getProject(task.project_id);
    const acceptedExecution = executionId
      ? this.store.assertExecutionGeneration(executionId, executionGeneration)
      : null;
    if (
      acceptedExecution
      && (
        acceptedExecution.task_id !== taskId
        || acceptedExecution.phase !== phase
        || acceptedExecution.base_revision !== task.revision
      )
    ) {
      throw Object.assign(new Error("accepted execution scope no longer matches the task"), {
        code: "execution_scope_conflict",
      });
    }
    const orchestrator = acceptedExecution
      ? null
      : this.enforceOrchestratorLease || orchestratorToken
        ? this.store.authorizeProjectOrchestrator(orchestratorToken, task.project_id)
        : null;
    const promptProfile = this.store.getAgentPromptProfile(phase);
    const capabilityRole = phase === "review" ? "reviewer" : phase === "test" ? "validator" : "worker";
    const resolvedModelRoute = this.resolveModelRoute(phase, modelRoute);

    const runId = randomUUID();
    const instanceRoot = join(this.stateRoot, "runs", runId);
    const home = join(instanceRoot, "home");
    const config = join(instanceRoot, "pi-config");
    const sessionDirectory = join(instanceRoot, "sessions");
    const artifactDirectory = join(instanceRoot, "artifacts");
    const snapshotDirectory = join(artifactDirectory, "snapshots");
    const rtkConfigDirectory = join(home, ".config", "rtk");
    await Promise.all([home, config, sessionDirectory, artifactDirectory, snapshotDirectory, rtkConfigDirectory]
      .map((path) => mkdir(path, { recursive: true, mode: 0o777 })));
    await copyFile(rtkConfiguration, join(rtkConfigDirectory, "config.toml"));
    await chmod(join(rtkConfigDirectory, "config.toml"), 0o644);
    const acceptedCommand = acceptedExecution
      ? this.store.orchestratorCommand(acceptedExecution.command_id)
      : null;
    const parentSession = acceptedCommand?.payload?.parentSessionId
      ? this.store.getSession(acceptedCommand.payload.parentSessionId)
      : null;
    let resumedSessionFile = null;
    if (parentSession) {
      resumedSessionFile = join(sessionDirectory, basename(parentSession.native_path));
      await copyFile(parentSession.native_path, resumedSessionFile);
    }

    if (!this.internalOrigin) throw new Error("control plane must listen before starting Pi");
    const git = this.gitService(project.repository_path);
    const workspace = await git.createWorkspace({ taskId, runId });
    if (acceptedExecution) {
      try {
        this.store.bindExecutionResources({
          executionId,
          generation: executionGeneration,
          workspaceId: workspace.id,
          runId,
        });
      } catch (error) {
        this.store.attachExecutionEvidenceResources({
          executionId,
          runId,
          workspaceId: workspace.id,
          reason: "workspace_completed_after_fence",
        });
        throw Object.assign(error, {
          code: "side_effect_uncertain",
          workspaceId: workspace.id,
          runId,
        });
      }
    }
    const credential = await this.credentialVault.materialize(runId);
    this.store.recordCredentialRun({
      runId, profileId: credential.profileId, authType: credential.authType, billingMode: credential.billingMode,
    });
    if (acceptedExecution) {
      try {
        this.store.assertExecutionGeneration(executionId, executionGeneration);
      } catch (error) {
        const canonicalUnchanged = await this.credentialVault.verifySourceUnchanged(credential)
          .catch(() => false);
        this.store.verifyCredentialRun(runId, canonicalUnchanged);
        await this.credentialVault.release(runId);
        throw error;
      }
    }
    const capability = this.store.issueCapability({
      role: capabilityRole,
      actorId: phase === "implementation" ? task.assigned_worker : `task-agent:${phase}:${runId}`,
      taskId,
      runId,
      executionId,
      executionGeneration,
      expiresAt: new Date(Date.parse(this.store.clock()) + 8 * 60 * 60 * 1000).toISOString(),
    });
    const containerEnvironment = {
      HOME: "/home/bossman",
      LANG: "C.UTF-8",
      SHELL: "/bin/sh",
      TMPDIR: "/tmp",
      PI_CODING_AGENT_DIR: "/config",
      PI_CODING_AGENT_SESSION_DIR: "/sessions",
      PI_TELEMETRY: "0",
      RTK_TELEMETRY_DISABLED: "1",
      RTK_TEE_DIR: "/artifacts/rtk-tee",
      PINK_GUY_LIFECYCLE_DIR: "/artifacts/snapshots",
      PINK_GUY_API_URL: this.containerOrigin,
      PINK_GUY_TASK_ID: taskId,
      PINK_GUY_CAPABILITY_TOKEN: capability.token,
      PINK_GUY_EXTENSION_EVIDENCE_PATH: "/artifacts/pink-guy-tools.json",
      BOSS_MAN_PHASE0_LIFECYCLE_DIR: "/artifacts/snapshots",
      BOSS_MAN_API_URL: this.containerOrigin,
      BOSS_MAN_TASK_ID: taskId,
      BOSS_MAN_CAPABILITY_TOKEN: capability.token,
      BOSS_MAN_EXTENSION_EVIDENCE_PATH: "/artifacts/pink-guy-tools.json",
      ...(this.runtimeOffline ? { PI_OFFLINE: "1" } : {}),
    };
    let runtime = null;
    let containerEffect = null;
    try {
      if (acceptedExecution) {
        this.store.assertExecutionGeneration(executionId, executionGeneration);
      }
      runtime = new DockerTaskRuntime({ image: this.runtimeImage, dockerCommand: this.dockerCommand });
      containerEffect = this.store.beginSideEffect({
        runId,
        kind: "container_start",
        idempotencyKey: `container-start:${runId}`,
        intent: { taskId, image: this.runtimeImage, workspaceId: workspace.id },
      }).effect;
      const runtimeState = await runtime.start({
        runId, workspacePath: workspace.workspace_path, artifactPath: artifactDirectory,
        homePath: home, configPath: config, sessionPath: sessionDirectory,
        extensionPath: extensionDirectory, credentialPath: credential.path, environment: containerEnvironment,
      });
      if (acceptedExecution) {
        this.store.assertExecutionGeneration(executionId, executionGeneration);
      }
      this.store.completeSideEffect(containerEffect.id, {
        containerId: runtimeState.containerId,
        imageId: runtimeState.imageId,
        name: runtimeState.name,
        network: runtimeState.network,
      });
      const credentialCopy = await runtime.exec("sh", ["-lc", "umask 077; cp /run/secrets/pi-auth.json /config/auth.json"]);
      if (credentialCopy.code !== 0) throw new Error(`failed to initialize private Pi auth: ${credentialCopy.stderr}`);
      const pending = [];
      let active = null;
      const sanitize = (value) => redactValue(value, credential.redactionValues);
      const rpc = new PiRpcProcess({
        child: runtime.spawn("pi", [
          "--mode", "rpc", "--session-dir", "/sessions",
          ...(resumedSessionFile ? ["--session", `/sessions/${basename(resumedSessionFile)}`] : []),
          "--extension", "/pink-guy/extensions/lifecycle-probe.ts",
          "--extension", "/pink-guy/extensions/boss-man-extension.ts",
          "--extension", "/pink-guy/extensions/rtk-managed-extension.ts",
          "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
          ...(this.runtimeOffline ? ["--offline"] : []),
          "--provider", resolvedModelRoute.provider, "--model", resolvedModelRoute.model,
          "--thinking", resolvedModelRoute.thinking,
          "--system-prompt", composeAgentSystemPrompt(phase, promptProfile.prompt_text),
        ]),
        onEvent: (event) => {
          const projected = sanitizePiTaskEvent(event);
          if (!projected) return;
          const safeEvent = sanitize(projected);
          if (acceptedExecution) {
            this.store.touchExecution(executionId, executionGeneration, {
              type: safeEvent.type ?? "unknown",
            });
          }
          if (active) {
            active.sequence += 1;
            this.store.appendRunEvent(
              active.runId,
              active.sequence,
              safeEvent.type ?? "unknown",
              safeEvent.payload ?? {},
            );
          } else pending.push(safeEvent);
        },
      });
      const state = await rpc.command({ type: "get_state" });
      if (
        state.model?.provider !== resolvedModelRoute.provider
        || state.model?.id !== resolvedModelRoute.model
        || state.thinkingLevel !== resolvedModelRoute.thinking
      ) {
        throw Object.assign(new Error(
          `Pi effective route ${state.model?.provider}/${state.model?.id} (${state.thinkingLevel}) `
          + `does not match ${resolvedModelRoute.provider}/${resolvedModelRoute.model} (${resolvedModelRoute.thinking})`,
        ), { code: "model_route_mismatch" });
      }
      const shell = new WorkspaceShell({ child: runtime.spawn("sh") });
      const nativePath = state.sessionFile?.startsWith("/sessions/")
        ? join(sessionDirectory, basename(state.sessionFile)) : state.sessionFile;
      this.store.createSession({
        id: state.sessionId,
        taskId,
        nativePath,
        provider: state.model?.provider,
        model: state.model?.id,
        parentSessionId: parentSession && parentSession.id !== state.sessionId
          ? parentSession.id
          : null,
      });
      const run = this.store.createRun({
        id: runId,
        sessionId: state.sessionId,
        processId: rpc.child.pid,
        shellProcessId: shell.child.pid,
        containerId: runtimeState.containerId,
        imageId: runtimeState.imageId,
        workspaceId: workspace.id,
        credentialProfile: credential.profileId,
        orchestratorId: orchestrator?.id ?? null,
        phase,
        executionId,
        promptProfileKey: promptProfile.profile_key,
        promptProfileVersion: promptProfile.active_version,
        promptSha256: promptProfile.prompt_sha256,
        modelProvider: resolvedModelRoute.provider,
        modelId: resolvedModelRoute.model,
        thinkingLevel: resolvedModelRoute.thinking,
        modelPolicySource: resolvedModelRoute.policySource,
        billingClass: resolvedModelRoute.billingClass,
      });
      if (acceptedExecution) {
        this.store.bindExecutionResources({
          executionId,
          generation: executionGeneration,
          sessionId: state.sessionId,
          runId: run.id,
          workspaceId: workspace.id,
        });
      }
      active = { runId: run.id, sequence: 0 };
      for (const event of pending) {
        active.sequence += 1;
        this.store.appendRunEvent(
          run.id,
          active.sequence,
          event.type ?? "unknown",
          event.payload ?? {},
        );
      }
      const artifacts = new RtkArtifactIngestor({
        store: this.store, sessionId: state.sessionId, runId, artifactRoot: artifactDirectory,
        secrets: credential.redactionValues,
      });
      const managed = {
        taskId, state, run, rpc, shell, runtime, runtimeState, workspace, credential, git,
        artifactDirectory, snapshotDirectory, configDirectory: config, active, capability, artifacts, sanitize,
        promptProfile, modelRoute: resolvedModelRoute,
        executionId, executionGeneration,
        extensionEvidencePath: join(artifactDirectory, "pink-guy-tools.json"),
      };
      this.sessions.set(state.sessionId, managed);
      return { session: this.store.getSession(state.sessionId), run };
    } catch (error) {
      await runtime?.stop().catch(() => undefined);
      const canonicalUnchanged = await this.credentialVault.verifySourceUnchanged(credential).catch(() => false);
      this.store.verifyCredentialRun(runId, canonicalUnchanged);
      await rm(join(config, "auth.json"), { force: true });
      await this.credentialVault.release(runId);
      this.store.revokeCapability(capability.id);
      throw error;
    }
  }

  async prompt(sessionId, message) {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`session is not active: ${sessionId}`);
    const operationId = randomUUID();
    const journal = this.store.beginSideEffect({
      runId: managed.run.id,
      kind: "provider_response",
      idempotencyKey: `provider-response:${operationId}`,
      intent: {
        sessionId,
        provider: managed.state.model?.provider ?? managed.modelRoute.provider,
        model: managed.state.model?.id ?? managed.modelRoute.model,
        promptSha256: sha256(message),
      },
    }).effect;
    const from = managed.rpc.messages.length;
    await managed.rpc.command({ type: "prompt", message });
    await managed.rpc.waitFor(
      (event) => event.type === "agent_settled",
      "agent settlement",
      from,
      10 * 60 * 1_000,
      90 * 1_000,
    );
    await this.faultInjector("provider_after_settled", { sideEffectId: journal.id, runId: managed.run.id, sessionId });
    await this.ingestSnapshots(managed);
    const rtkReceipts = await managed.artifacts.ingestPiArtifacts();
    for (const receipt of rtkReceipts) {
      managed.active.sequence += 1;
      this.store.appendRunEvent(managed.run.id, managed.active.sequence, "rtk_artifact_ingested", managed.sanitize(receipt));
    }
    const task = this.store.getTask(managed.taskId);
    const context = await this.context.exportSession({
      sessionId,
      query: `${task.title} ${message}`,
      queryId: `turn-${operationId}`,
      trigger: "turn_end",
    });
    managed.active.sequence += 1;
    this.store.appendRunEvent(managed.run.id, managed.active.sequence, "context_exported", managed.sanitize(context));
    const nativeContent = await readFile(this.store.getSession(sessionId).native_path);
    this.store.completeSideEffect(journal.id, {
      eventCount: this.store.runEvents(managed.run.id).length,
      nativeSessionSha256: sha256(nativeContent),
      rtkReceiptCount: rtkReceipts.length,
      contextSnapshotId: context.snapshot_id,
    });
    return { run: this.store.getRun(managed.run.id), events: this.store.runEvents(managed.run.id) };
  }

  phaseKickoff(phase) {
    return phaseKickoffPrompt(phase);
  }

  async executeTaskPhase(taskId, {
    orchestratorToken = null,
    phase,
    modelRoute = null,
    executionId = null,
    executionGeneration = null,
  }) {
    const started = await this.startTask(taskId, {
      orchestratorToken,
      phase,
      modelRoute,
      executionId,
      executionGeneration,
    });
    try {
      const execution = await this.prompt(started.session.id, this.phaseKickoff(phase));
      const phaseOutcome = this.store.taskPhaseOutcome(taskId, phase);
      if (!phaseOutcome.recorded) {
        throw Object.assign(new Error(
          `${phase} phase settled without recording its required authoritative outcome`,
        ), {
          code: "phase_protocol_violation",
          phase,
          taskId,
          revision: phaseOutcome.revision,
        });
      }
      let completion = null;
      const evaluation = this.store.evaluateCompletion(taskId);
      if (phase === "review" && evaluation.allowed && (orchestratorToken || executionId)) {
        const task = this.store.getTask(taskId);
        const orchestrator = orchestratorToken
          ? this.store.authorizeProjectOrchestrator(orchestratorToken, task.project_id)
          : null;
        const capability = this.store.issueCapability({
          role: "orchestrator",
          actorId: orchestrator
            ? `project-orchestrator:${orchestrator.id}`
            : `control-plane:${executionId}`,
          taskId,
          runId: started.run.id,
          executionId,
          executionGeneration,
          expiresAt: new Date(Date.parse(this.store.clock()) + 60_000).toISOString(),
        });
        try {
          completion = this.store.actOnTask({
            token: capability.token,
            taskId,
            action: "complete",
            idempotencyKey: `phase-auto-complete:${started.run.id}`,
            expectedVersion: task.version,
            payload: {},
          });
        } finally {
          this.store.revokeCapability(capability.id);
        }
      }
      return {
        ...started,
        execution,
        phaseOutcome,
        completion,
        task: this.store.getTaskDetails(taskId),
      };
    } finally {
      if (!executionId) await this.stopSession(started.session.id);
    }
  }

  classifyExecutionFailure(error) {
    if (error?.code === "owner_stop") return "owner_stop";
    if (error?.code === "side_effect_uncertain") return "side_effect_uncertain";
    if (error?.code === "phase_protocol_violation") return "phase_protocol_violation";
    if (error?.code === "provider_rejected") return "provider_rejected";
    if (error?.code === "protocol_error") return "protocol_error";
    if (error?.code === "rpc_inactive") return "rpc_inactive";
    if (error?.code === "hard_deadline") return "hard_deadline";
    if (/without RPC activity/.test(error?.message ?? "")) return "rpc_inactive";
    if (/Pi RPC exited/.test(error?.message ?? "")) return "pi_process_exited";
    return "setup_failed";
  }

  launchCommandExecution(executionId) {
    if (this.executionPromises.has(executionId)) return this.executionPromises.get(executionId);
    const promise = this.runCommandExecution(executionId)
      .catch((error) => {
        process.stderr.write(
          `execution ${executionId} settlement failed: ${error.stack ?? error.message}\n`,
        );
      })
      .finally(() => this.executionPromises.delete(executionId));
    this.executionPromises.set(executionId, promise);
    return promise;
  }

  async runCommandExecution(executionId) {
    let execution = this.store.commandExecution(executionId);
    if (!execution || !["starting", "running"].includes(execution.state)) return execution;
    const generation = execution.generation;
    let started = null;
    let result = null;
    let failure = null;
    let desiredState = "succeeded";
    try {
      result = await this.executeTaskPhase(execution.task_id, {
        phase: execution.phase,
        modelRoute: execution.model_route,
        executionId,
        executionGeneration: generation,
      });
      started = result;
    } catch (error) {
      failure = error;
      desiredState = error?.code === "side_effect_uncertain"
        ? "reconciliation_required"
        : "failed";
    }

    execution = this.store.commandExecution(executionId);
    const priorAction = this.store.database.prepare(`SELECT action,reason FROM execution_action_receipts
      WHERE execution_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(executionId);
    if (execution && ["starting", "running"].includes(execution.state)) {
      this.store.fenceExecution({
        executionId,
        expectedVersion: execution.version,
        reason: failure ? "execution_failure" : "phase_outcome_recorded",
        failureClass: failure ? this.classifyExecutionFailure(failure) : null,
        failure: failure ? {
          code: failure.code ?? null,
          message: clippedText(failure.message, 2_000),
        } : null,
      });
    }
    execution = this.store.commandExecution(executionId);
    if (priorAction?.action === "pause" && desiredState !== "reconciliation_required") {
      desiredState = "paused";
    } else if (priorAction?.action === "cancel" && desiredState !== "reconciliation_required") {
      desiredState = "cancelled";
    }
    else if (priorAction?.action === "stop" && !failure) {
      desiredState = "failed";
      failure = Object.assign(new Error(priorAction.reason), { code: "owner_stop" });
    }

    let cleanupFailure = null;
    const sessionId = execution?.session_id ?? started?.session?.id ?? null;
    if (sessionId) {
      try {
        const stopped = await this.stopSession(sessionId);
        if (!stopped.stopped) {
          throw Object.assign(new Error("managed runtime identity was unavailable during stop"), {
            code: "side_effect_uncertain",
          });
        }
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure) {
      desiredState = "reconciliation_required";
      failure = cleanupFailure;
    }
    const unsettledSideEffects = execution?.run_id
      ? this.store.sideEffectsForRun(execution.run_id).filter((effect) =>
        effect.state !== "completed"
      )
      : [];
    if (unsettledSideEffects.length) {
      desiredState = "reconciliation_required";
      failure = Object.assign(
        new Error(`${unsettledSideEffects.length} side effect(s) require reconciliation`),
        {
          code: "side_effect_uncertain",
          sideEffectIds: unsettledSideEffects.map((effect) => effect.id),
        },
      );
    }
    const failureClass = failure
      ? cleanupFailure || unsettledSideEffects.length
        ? "side_effect_uncertain"
        : this.classifyExecutionFailure(failure)
      : null;
    const settled = this.store.settleExecution({
      executionId,
      state: desiredState,
      failureClass,
      failure: failure ? {
        code: failure.code ?? null,
        message: clippedText(failure.message, 2_000),
      } : null,
      result: result ? {
        sessionId: result.session.id,
        runId: result.run.id,
        phaseOutcome: result.phaseOutcome,
        taskVersion: result.task.version,
        revision: result.task.revision,
      } : {},
    });
    if (desiredState === "succeeded") {
      this.reconcileAutomaticProject(settled.execution.project_id);
      await this.reconcileReadyProject(settled.execution.project_id);
    }
    return settled.execution;
  }

  async actOnExecution({
    executionId,
    action,
    expectedVersion,
    reason,
    idempotencyKey,
    modelRoute = null,
  }) {
    if (["retry", "resume"].includes(action)) {
      return this.store.queueExecutionReplacement({
        executionId,
        action,
        expectedVersion,
        reason,
        idempotencyKey,
        modelRoute,
      });
    }
    if (!["stop", "pause", "cancel"].includes(action)) {
      throw Object.assign(new Error(`unsupported execution action: ${action}`), {
        code: "invalid_request",
      });
    }
    const execution = this.store.commandExecution(executionId);
    if (!execution) {
      throw Object.assign(new Error(`unknown execution: ${executionId}`), { code: "not_found" });
    }
    if (!this.store.allowedExecutionActions(execution).includes(action)) {
      throw Object.assign(
        new Error(`${action} is not valid while execution is ${execution.state}`),
        { code: "transition_denied" },
      );
    }
    const receipt = this.store.recordExecutionAction({
      executionId,
      action,
      expectedVersion,
      reason,
      idempotencyKey,
      result: { requestedState: action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "failed" },
    });
    if (receipt.replayed) return receipt;
    if (receipt.execution.state === "cancelled") {
      return receipt;
    }
    const fenced = { execution: receipt.execution };
    const activePromise = this.executionPromises.get(executionId);
    if (activePromise) {
      const managed = fenced.execution.session_id
        ? this.sessions.get(fenced.execution.session_id)
        : null;
      if (managed) {
        await Promise.allSettled([managed.rpc.terminate(), managed.shell.terminate()]);
      }
      await activePromise;
      return {
        ...receipt,
        execution: this.store.commandExecution(executionId),
      };
    }
    let cleanupError = null;
    if (fenced.execution.session_id) {
      try {
        const stopped = await this.stopSession(fenced.execution.session_id);
        if (!stopped.stopped) {
          throw Object.assign(new Error("managed runtime identity was unavailable during owner stop"), {
            code: "side_effect_uncertain",
          });
        }
      } catch (error) {
        cleanupError = error;
      }
    }
    const state = cleanupError
      ? "reconciliation_required"
      : action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "failed";
    const settled = this.store.settleExecution({
      executionId,
      state,
      failureClass: cleanupError ? "side_effect_uncertain" : action === "stop" ? "owner_stop" : null,
      failure: cleanupError
        ? { message: clippedText(cleanupError.message, 2_000) }
        : action === "stop" ? { message: reason } : null,
      result: { ownerAction: action, actionReceiptId: receipt.receipt.id },
    });
    return {
      ...receipt,
      execution: settled.execution,
    };
  }

  async shell(sessionId, command, { rtkFilter = null } = {}) {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`session is not active: ${sessionId}`);
    if (rtkFilter !== null && rtkFilter !== "log") {
      throw Object.assign(new Error("unsupported RTK filter"), { code: "invalid_request" });
    }
    const operationId = randomUUID();
    const journal = this.store.beginSideEffect({
      runId: managed.run.id,
      kind: "tool",
      idempotencyKey: `workspace-shell:${operationId}`,
      intent: {
        sessionId,
        tool: "workspace_shell",
        commandSha256: sha256(command),
        rtkFilter,
      },
    }).effect;
    let effectiveCommand = command;
    if (rtkFilter) {
      const rawPath = `/artifacts/rtk-tee/supervisor-${randomUUID()}.log`;
      const encoded = Buffer.from(command).toString("base64");
      effectiveCommand = [
        "mkdir -p /artifacts/rtk-tee",
        `printf '%s' '${encoded}' | base64 -d | sh > '${rawPath}' 2>&1`,
        "__boss_rtk_status=$?",
        `rtk ${rtkFilter} '${rawPath}'`,
        "exit \"$__boss_rtk_status\"",
      ].join("; ");
    }
    const startedAt = Date.now();
    const result = await managed.shell.exec(effectiveCommand);
    const durationMs = Date.now() - startedAt;
    await this.faultInjector("tool_after_execute", {
      sideEffectId: journal.id,
      runId: managed.run.id,
      sessionId,
      status: result.status,
    });
    const safeResult = managed.sanitize(result);
    const receipt = await managed.artifacts.ingestCommand({
      command, output: result.output, status: result.status, durationMs, filter: rtkFilter,
    });
    managed.active.sequence += 1;
    this.store.appendRunEvent(managed.run.id, managed.active.sequence, "workspace_shell_result", {
      command: managed.sanitize(command),
      status: safeResult.status,
      output: safeResult.output,
      rtkReceipt: receipt.receipt_path,
      rtkFilter,
    });
    this.store.completeSideEffect(journal.id, {
      status: result.status,
      durationMs,
      rtkReceipt: receipt.receipt_path,
    });
    return { ...safeResult, rtkReceipt: receipt };
  }

  async ingestSnapshots(managed) {
    for (const name of await readdir(managed.snapshotDirectory)) {
      if (!name.startsWith("snapshot-") || !name.endsWith(".json")) continue;
      const path = join(managed.snapshotDirectory, name);
      const content = await readFile(path);
      const manifest = JSON.parse(content);
      const contentSha256 = sha256(content);
      const journal = this.store.beginSideEffect({
        runId: managed.run.id,
        kind: "snapshot",
        idempotencyKey: `snapshot:${contentSha256}`,
        intent: {
          sessionId: managed.state.sessionId,
          path,
          sha256: contentSha256,
          metadata: { trigger: manifest.trigger, native: manifest.native },
        },
      });
      if (journal.effect.state === "completed") continue;
      this.store.recordArtifact({
        sessionId: managed.state.sessionId,
        kind: "context_manifest",
        path,
        sha256: contentSha256,
        metadata: { trigger: manifest.trigger, native: manifest.native },
      });
      if (manifest.trigger === "before_compact") {
        const capturedNativePath = join(managed.snapshotDirectory, manifest.native.path);
        const task = this.store.getTask(managed.taskId);
        const unified = await this.context.exportSession({
          sessionId: managed.state.sessionId,
          query: `${task.title} pre-compaction context`,
          queryId: `pre-compaction-${contentSha256}`,
          trigger: "pre_compaction",
          nativePathOverride: capturedNativePath,
          triggerManifest: {
            path,
            sha256: contentSha256,
            native_sha256: manifest.native.sha256,
          },
        });
        managed.active.sequence += 1;
        this.store.appendRunEvent(
          managed.run.id,
          managed.active.sequence,
          "pre_compaction_context_exported",
          managed.sanitize(unified),
        );
      }
      await this.faultInjector("snapshot_after_record", {
        sideEffectId: journal.effect.id,
        runId: managed.run.id,
        sessionId: managed.state.sessionId,
        path,
      });
      this.store.completeSideEffect(journal.effect.id, { path, sha256: contentSha256 });
    }
  }

  async stopSession(sessionId, { record = true } = {}) {
    const managed = this.sessions.get(sessionId);
    if (!managed) return { stopped: false, reason: "not_managed" };
    await Promise.all([managed.rpc.terminate(), managed.shell.terminate()]);
    const journal = this.store.beginSideEffect({
      runId: managed.run.id,
      kind: "container_stop",
      idempotencyKey: `container-stop:${managed.run.id}`,
      intent: { containerId: managed.run.container_id, imageId: managed.run.image_id },
    }).effect;
    await managed.runtime.stop();
    this.store.completeSideEffect(journal.id, { containerRemoved: true });
    const canonicalUnchanged = await this.credentialVault.verifySourceUnchanged(managed.credential);
    this.store.verifyCredentialRun(managed.run.id, canonicalUnchanged);
    await rm(join(managed.configDirectory, "auth.json"), { force: true });
    await this.credentialVault.release(managed.run.id);
    this.store.revokeCapability(managed.capability.id);
    if (record) this.store.finishRun(managed.run.id, "stopped");
    this.sessions.delete(sessionId);
    return { stopped: true, sessionId, runId: managed.run.id };
  }

  async close({ record = true } = {}) {
    await Promise.all([...this.sessions.keys()].map((id) => this.stopSession(id, { record })));
    await Promise.allSettled([...this.executionPromises.values()]);
    if (this.server) {
      const server = this.server;
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => error ? rejectPromise(error) : resolvePromise());
        server.closeIdleConnections?.();
        const force = setTimeout(() => server.closeAllConnections?.(), 250);
        force.unref();
      });
    }
    this.store.close();
  }

  async crashForProbe() {
    await Promise.all([...this.sessions.values()].flatMap((managed) => [
      managed.rpc.terminate(),
      managed.shell.terminate(),
    ]));
    this.sessions.clear();
    if (this.server) await new Promise((resolvePromise) => this.server.close(resolvePromise));
    this.server = null;
    this.store.close();
  }

  async reconcileAfterRestart() {
    if (this.recoveryChecked) return [];
    const results = [];
    const interruptedIntegrations = this.store.reconcileGitIntegrationsAfterRestart();
    const legacyCommands = this.store.reconcileLegacyClaimedCommands();
    const restartingExecutions = this.store.commandExecutions({ nonterminalOnly: true });
    for (const prior of restartingExecutions) {
      if (!["starting", "running"].includes(prior.state)) continue;
      this.store.fenceExecution({
        executionId: prior.id,
        expectedVersion: prior.version,
        reason: "control_plane_restart",
        failureClass: "control_plane_restart",
        failure: { automaticReplay: false },
      });
    }
    for (const run of this.store.runningRuns()) {
      const runtime = new DockerTaskRuntime({
        image: this.runtimeImage,
        dockerCommand: this.dockerCommand,
        containerId: run.container_id,
      });
      let inspection = null;
      let inspectionError = null;
      try {
        inspection = await runtime.inspect();
      } catch (error) {
        inspectionError = error;
      }
      const containerIdentityProven = Boolean(
        inspection?.running
        && inspection.id === run.container_id
        && inspection.imageId === run.image_id
        && (
          inspection.labels?.["pink-guy.run"] === run.id
          || inspection.labels?.["boss-man.run"] === run.id
        ),
      );
      const effects = this.store.sideEffectsForRun(run.id);
      const stoppedContainerProven = !inspection && !inspectionError
        && effects.some((effect) => effect.kind === "container_stop");
      const reconciledEffects = [];
      let ambiguous = !(containerIdentityProven || stoppedContainerProven);
      for (const effect of effects) {
        if (effect.state === "completed") continue;
        if (effect.state === "reconciliation_required") {
          ambiguous = true;
          reconciledEffects.push({ id: effect.id, kind: effect.kind, state: effect.state });
          continue;
        }
        if (effect.kind === "container_start" && containerIdentityProven) {
          this.store.completeSideEffect(effect.id, {
            containerId: inspection.id,
            imageId: inspection.imageId,
            recoveredIdentity: true,
          }, { reconciled: true });
          reconciledEffects.push({ id: effect.id, kind: effect.kind, state: "completed" });
        } else if (effect.kind === "container_stop" && !inspection) {
          this.store.completeSideEffect(effect.id, { containerRemoved: true }, { reconciled: true });
          reconciledEffects.push({ id: effect.id, kind: effect.kind, state: "completed" });
        } else if (effect.kind === "snapshot") {
          const snapshot = await this.reconcileSnapshot(effect);
          if (snapshot.state !== "completed") ambiguous = true;
          reconciledEffects.push({ id: effect.id, kind: effect.kind, ...snapshot });
        } else if (effect.kind === "git") {
          const workspace = this.store.getWorkspace(effect.intent.workspaceId);
          const gitService = workspace ? this.gitService(workspace.repository_path) : null;
          const git = workspace
            ? await gitService.reconcileSideEffect(effect, workspace)
            : { state: "reconciliation_required", reason: "workspace_missing" };
          if (!workspace) this.store.requireSideEffectReconciliation(effect.id, git.reason);
          if (git.state !== "completed") ambiguous = true;
          reconciledEffects.push({ id: effect.id, kind: effect.kind, state: git.state, reason: git.reason });
        } else {
          this.store.requireSideEffectReconciliation(effect.id, "completion_uncertain_after_restart", {
            kind: effect.kind,
            automaticReplay: false,
          });
          ambiguous = true;
          reconciledEffects.push({ id: effect.id, kind: effect.kind, state: "reconciliation_required" });
        }
      }

      if (containerIdentityProven) await runtime.stop();
      await rm(join(this.stateRoot, "runs", run.id, "pi-config", "auth.json"), { force: true });
      await this.credentialVault.release(run.id);
      const state = ambiguous ? "reconciliation_required" : "paused";
      const containerRemoved = containerIdentityProven || stoppedContainerProven;
      this.store.appendRunEvent(run.id, this.store.nextRunEventSequence(run.id), state === "paused"
        ? "run_reconciled_paused" : "run_reconciliation_required", {
        priorState: "running",
        reason: "control_plane_restart",
        containerIdentityProven,
        containerInspectionAvailable: !inspectionError,
        containerRemoved,
        automaticReplay: false,
        sideEffects: reconciledEffects,
      });
      this.store.finishRun(run.id, state);
      this.reconciledRunIds.push(run.id);
      results.push({
        runId: run.id,
        state,
        containerIdentityProven,
        containerInspectionAvailable: !inspectionError,
        containerRemoved,
        sideEffects: reconciledEffects,
      });
    }
    for (const prior of restartingExecutions) {
      let execution = this.store.commandExecution(prior.id);
      const run = execution.run_id ? this.store.getRun(execution.run_id) : null;
      const terminalState = !run
        ? "failed"
        : run.state === "paused"
          ? "paused"
          : "reconciliation_required";
      const settled = this.store.settleExecution({
        executionId: execution.id,
        state: terminalState,
        failureClass: terminalState === "paused"
          ? "control_plane_restart"
          : run ? "side_effect_uncertain" : "control_plane_restart",
        failure: {
          automaticReplay: false,
          runState: run?.state ?? null,
          custodyRetained: Boolean(execution.session_id),
        },
        result: { restartReconciled: true },
      });
      results.push({
        executionId: execution.id,
        runId: execution.run_id,
        state: settled.execution.state,
        automaticReplay: false,
      });
    }
    if (legacyCommands.length) {
      results.push({
        legacyClaimedCommands: legacyCommands,
        state: "reconciliation_required",
        automaticReplay: false,
      });
    }
    for (const integrationId of interruptedIntegrations) {
      results.push({
        integrationId,
        state: "reconciliation_required",
        automaticReplay: false,
      });
    }
    this.recoveryResults = results;
    this.recoveryChecked = true;
    return results;
  }

  async reconcileSnapshot(effect) {
    const root = `${resolve(this.stateRoot)}${sep}`;
    const path = resolve(effect.intent.path);
    if (!path.startsWith(root) || !(await exists(path))) {
      this.store.requireSideEffectReconciliation(effect.id, "snapshot_missing_or_outside_state_root", { path });
      return { state: "reconciliation_required", reason: "snapshot_missing_or_outside_state_root" };
    }
    const content = await readFile(path);
    const observedSha256 = sha256(content);
    if (observedSha256 !== effect.intent.sha256) {
      this.store.requireSideEffectReconciliation(effect.id, "snapshot_checksum_mismatch", {
        expectedSha256: effect.intent.sha256,
        observedSha256,
      });
      return { state: "reconciliation_required", reason: "snapshot_checksum_mismatch" };
    }
    this.store.recordArtifact({
      sessionId: effect.intent.sessionId,
      kind: "context_manifest",
      path,
      sha256: observedSha256,
      metadata: { ...effect.intent.metadata, recoveredAfterRestart: true },
    });
    this.store.completeSideEffect(effect.id, { path, sha256: observedSha256 }, { reconciled: true });
    return { state: "completed", source: "artifact_checksum" };
  }

  async listen(port = 0, host = "127.0.0.1") {
    await this.reconcileAfterRestart();
    await this.storageInventory();
    this.server = createServer((request, response) => this.route(request, response));
    await new Promise((resolvePromise, rejectPromise) => {
      this.server.once("error", rejectPromise);
      this.server.listen(port, host, resolvePromise);
    });
    const address = this.server.address();
    this.exposureProfile = ["127.0.0.1", "::1", "localhost"].includes(host) ? "local_smoke" : "unsupported";
    this.internalOrigin = `http://${address.address === "::" ? "127.0.0.1" : address.address}:${address.port}`;
    this.containerOrigin = `http://host.docker.internal:${address.port}`;
    return this.server.address();
  }

  async route(request, response) {
    try {
      const url = new URL(request.url, "http://phase0.invalid");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(BOARD_HTML);
      }
      if (request.method === "GET" && url.pathname === "/ui/lease-view.mjs") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        return response.end(LEASE_VIEW_MODULE);
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, {
          ok: true,
          authority: "pink_guy_central_api",
          compatibility_authority: "boss_man_central_api",
          exposure: "localhost_only",
          orchestrator_policy: "one_active_lease_per_project",
        });
      }
      if (request.method === "GET" && url.pathname === "/api/board") return json(response, 200, this.store.board());
      if (request.method === "GET" && url.pathname === "/api/projects") {
        return json(response, 200, {
          projects: this.store.projects().map((project) => this.projectDeletionProjection(project)),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/projects/import") {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const sourceUrl = repositorySource(body.repositoryUrl);
        const name = typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : repositoryDisplayName(sourceUrl);
        const idempotencyKey = request.headers["idempotency-key"];
        const existing = this.store.projectBySourceUrl(sourceUrl);
        if (existing) return json(response, 200, { replayed: true, project: existing });
        const prior = this.store.importedProjectByRequest({ sourceUrl, name, idempotencyKey });
        if (prior) return json(response, 200, { replayed: true, ...prior });
        const projectId = randomUUID();
        const repositoryPath = join(this.stateRoot, "repositories", projectId);
        await mkdir(dirname(repositoryPath), { recursive: true, mode: 0o700 });
        try {
          await execFileAsync(
            "git",
            ["clone", "--origin", "origin", "--", sourceUrl, repositoryPath],
            {
              encoding: "utf8",
              timeout: 2 * 60 * 1_000,
              maxBuffer: 4 * 1024 * 1024,
              env: { ...this.environment, GIT_TERMINAL_PROMPT: "0" },
            },
          );
          await repositoryRevision(repositoryPath);
          const result = this.store.createImportedProject({
            projectId,
            repositoryId: `repository-${projectId}`,
            name,
            repositoryPath,
            sourceUrl,
            idempotencyKey,
          });
          return json(response, 201, result);
        } catch (error) {
          await rm(repositoryPath, { recursive: true, force: true });
          if (["invalid_request", "idempotency_conflict"].includes(error.code)) throw error;
          throw Object.assign(
            new Error(`repository import failed: ${error.stderr ?? error.message}`),
            { code: "git_operation_failed" },
          );
        }
      }
      const deleteProject = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (request.method === "DELETE" && deleteProject) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = await this.deleteProject({
          projectId: deleteProject[1],
          confirmName: body.confirmName,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.cleanupPending ? 202 : 200, result);
      }
      const projectSources = url.pathname.match(/^\/api\/projects\/([^/]+)\/sources$/);
      if (request.method === "GET" && projectSources) {
        return json(response, 200, { snapshots: this.store.sourceSnapshots(projectSources[1]) });
      }
      if (request.method === "POST" && projectSources) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.createSourceSnapshot({
          projectId: projectSources[1],
          kind: body.kind,
          sourceRef: body.sourceRef ?? null,
          content: body.content,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      const projectGitPolicy = url.pathname.match(/^\/api\/projects\/([^/]+)\/git-policy$/);
      if (request.method === "GET" && projectGitPolicy) {
        this.assertLocalOwnerProfile();
        return json(response, 200, {
          policy: await this.ensureProjectGitPolicy(projectGitPolicy[1]),
        });
      }
      if (request.method === "PUT" && projectGitPolicy) {
        this.assertLocalOwnerProfile();
        await this.ensureProjectGitPolicy(projectGitPolicy[1]);
        const body = await readBody(request);
        const result = this.store.updateProjectGitPolicy({
          projectId: projectGitPolicy[1],
          mode: body.mode,
          historyPolicy: body.historyPolicy,
          targetBranch: body.targetBranch,
          remoteName: body.remoteName ?? "origin",
          allowPush: Boolean(body.allowPush),
          allowPullRequest: Boolean(body.allowPullRequest),
          allowedTargetBranches: body.allowedTargetBranches ?? [],
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      if (request.method === "GET" && url.pathname === "/api/storage") {
        this.assertLocalOwnerProfile();
        return json(response, 200, { inventory: await this.storageInventory() });
      }
      if (request.method === "GET" && url.pathname === "/api/retention/holds") {
        this.assertLocalOwnerProfile();
        const projectId = url.searchParams.get("projectId");
        if (!projectId) {
          throw Object.assign(new Error("projectId is required"), { code: "invalid_request" });
        }
        return json(response, 200, {
          holds: this.store.retentionHolds(projectId, {
            activeOnly: url.searchParams.get("active") !== "false",
          }),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/retention/holds") {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.createRetentionHold({
          projectId: body.projectId,
          scopeType: body.scopeType,
          scopeId: body.scopeId,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      const releaseHold = url.pathname.match(/^\/api\/retention\/holds\/([^/]+)\/release$/);
      if (request.method === "POST" && releaseHold) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.releaseRetentionHold({
          holdId: releaseHold[1],
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      if (request.method === "GET" && url.pathname === "/api/agent-profiles") {
        return json(response, 200, { profiles: this.store.agentPromptProfiles() });
      }
      if (request.method === "GET" && url.pathname === "/api/model-routes") {
        return json(response, 200, publicModelRoutePolicy(this.modelRoutePolicy));
      }
      const agentPromptProfile = url.pathname.match(/^\/api\/agent-profiles\/([^/]+)$/);
      if (request.method === "GET" && agentPromptProfile) {
        return json(
          response,
          200,
          { profile: this.store.getAgentPromptProfile(agentPromptProfile[1]) },
        );
      }
      if (request.method === "PUT" && agentPromptProfile) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.updateAgentPromptProfile({
          profileKey: agentPromptProfile[1],
          prompt: body.prompt,
          expectedVersion: body.expectedVersion,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      if (request.method === "GET" && url.pathname === "/api/topics") {
        return json(response, 200, {
          topics: this.store.topics({ includeArchived: url.searchParams.get("archived") === "true" }),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/topics") {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const route = this.resolveModelRoute("orchestrator", {
          provider: body.modelProvider,
          model: body.modelId,
          thinking: body.thinkingLevel,
          billingClass: body.billingClass,
          policySource: "topic_override",
        });
        const result = this.store.createTopic({
          title: body.title,
          ownerDescription: body.ownerDescription ?? null,
          projectId: body.projectId ?? null,
          idempotencyKey: request.headers["idempotency-key"],
          modelProvider: route.provider,
          modelId: route.model,
          thinkingLevel: route.thinking,
          modelPolicy: {
            source: route.policySource,
            billingClass: route.billingClass,
          },
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      if (request.method === "GET" && url.pathname === "/api/sessions") {
        return json(response, 200, { sessions: this.store.sessions() });
      }
      if (request.method === "GET" && url.pathname === "/api/orchestrators") {
        return json(response, 200, { orchestrators: this.store.projectOrchestrators() });
      }
      if (request.method === "GET" && url.pathname === "/api/commands") {
        const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 100;
        return json(response, 200, {
          commands: this.store.orchestratorCommands({
            projectId: url.searchParams.get("projectId"),
            limit,
          }),
        });
      }
      const commandDetail = url.pathname.match(/^\/api\/commands\/([^/]+)$/);
      if (request.method === "GET" && commandDetail) {
        const command = this.store.orchestratorCommand(commandDetail[1]);
        if (!command) throw Object.assign(new Error(`unknown command: ${commandDetail[1]}`), { code: "not_found" });
        return json(response, 200, {
          command,
          events: this.store.orchestratorCommandEvents(command.id),
          execution: this.store.commandExecutionForCommand(command.id),
        });
      }
      if (request.method === "GET" && url.pathname === "/api/recovery/attention") {
        this.assertLocalOwnerProfile();
        return json(response, 200, {
          attention: this.store.recoveryAttention({
            projectId: url.searchParams.get("projectId"),
          }),
        });
      }
      if (request.method === "GET" && url.pathname === "/api/integrations/attention") {
        this.assertLocalOwnerProfile();
        return json(response, 200, {
          attention: this.store.integrationAttention(url.searchParams.get("projectId")),
        });
      }
      const integrationDetail = url.pathname.match(/^\/api\/integrations\/([^/]+)$/);
      if (request.method === "GET" && integrationDetail) {
        this.assertLocalOwnerProfile();
        const integration = this.store.gitIntegration(integrationDetail[1]);
        if (!integration) {
          throw Object.assign(
            new Error(`unknown Git integration: ${integrationDetail[1]}`),
            { code: "not_found" },
          );
        }
        return json(response, 200, { integration });
      }
      const integrationAction = url.pathname.match(/^\/api\/integrations\/([^/]+)\/actions\/(execute|cancel)$/);
      if (request.method === "POST" && integrationAction) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = await this.actOnGitIntegration({
          integrationId: integrationAction[1],
          action: integrationAction[2],
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      const executionDetail = url.pathname.match(/^\/api\/executions\/([^/]+)$/);
      if (request.method === "GET" && executionDetail) {
        this.assertLocalOwnerProfile();
        const execution = this.store.commandExecution(executionDetail[1]);
        if (!execution) {
          throw Object.assign(new Error(`unknown execution: ${executionDetail[1]}`), {
            code: "not_found",
          });
        }
        return json(response, 200, {
          execution,
          events: this.store.executionEvents(execution.id),
          attention: this.store.recoveryAttention()
            .find((item) => item.execution.id === execution.id) ?? null,
        });
      }
      const executionAction = url.pathname.match(/^\/api\/executions\/([^/]+)\/actions$/);
      if (request.method === "POST" && executionAction) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = await this.actOnExecution({
          executionId: executionAction[1],
          action: body.action,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
          modelRoute: body.modelRoute ?? null,
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      const candidateAction = url.pathname.match(
        /^\/api\/recovery-candidates\/([^/]+)\/actions$/,
      );
      if (request.method === "POST" && candidateAction) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.resolveRecoveryCandidate({
          candidateId: candidateAction[1],
          action: body.action,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        const candidate = result.candidate;
        const continuation = !result.replayed && body.action === "accept"
          ? this.reconcileAutomaticProject(
            this.store.getTask(candidate.task_id).project_id,
          )
          : [];
        return json(response, result.replayed ? 200 : 201, {
          ...result,
          continuation,
        });
      }
      const reconcileCommand = url.pathname.match(/^\/api\/commands\/([^/]+)\/reconcile$/);
      if (request.method === "POST" && reconcileCommand) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.reconcileOrchestratorCommand({
          commandId: reconcileCommand[1],
          action: body.action,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      if (request.method === "GET" && url.pathname === "/api/orchestration/leases") {
        return json(response, 200, { leases: this.store.orchestrationLeases() });
      }
      if (request.method === "POST" && url.pathname === "/api/orchestration/leases") {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        return json(response, 201, this.store.registerOrchestrationLease({
          scopeType: body.scopeType,
          scopeId: body.scopeId ?? null,
          transport: body.transport,
          endpoint: body.endpoint,
          metadata: body.metadata ?? {},
          leaseSeconds: body.leaseSeconds,
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/orchestration/leases/heartbeat") {
        const body = await readBody(request);
        return json(response, 200, this.store.heartbeatOrchestrationLease({
          token: bearerToken(request),
          leaseSeconds: body.leaseSeconds,
        }));
      }
      if (request.method === "DELETE" && url.pathname === "/api/orchestration/leases/current") {
        return json(response, 200, {
          lease: this.store.releaseOrchestrationLease(bearerToken(request)),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/orchestration/turns/claim") {
        const turn = this.store.claimConversationTurn(bearerToken(request));
        if (!turn) {
          response.writeHead(204);
          return response.end();
        }
        return json(response, 200, {
          turn,
          context: this.store.conversationContext(turn.conversation_id),
        });
      }

      const startConversationRun = url.pathname.match(/^\/api\/orchestration\/turns\/([^/]+)\/runtime$/);
      if (request.method === "POST" && startConversationRun) {
        const body = await readBody(request);
        const result = this.store.startConversationRun({
          token: bearerToken(request),
          turnId: startConversationRun[1],
          runId: body.runId,
          processId: body.processId ?? null,
          nativeSessionPath: body.nativeSessionPath,
          metadata: body.metadata ?? {},
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const conversationRuntimeEvent = url.pathname.match(/^\/api\/orchestration\/turns\/([^/]+)\/events$/);
      if (request.method === "POST" && conversationRuntimeEvent) {
        const body = await readBody(request);
        const event = sanitizePiConversationEvent(body.event);
        if (!event) {
          return json(response, 202, { retained: false, reason: "event_not_projected" });
        }
        const result = this.store.appendConversationRuntimeEvent({
          token: bearerToken(request),
          turnId: conversationRuntimeEvent[1],
          runId: body.runId,
          eventKey: body.eventKey,
          type: event.type,
          payload: event.payload,
        });
        return json(response, result.replayed ? 200 : 201, { retained: true, ...result });
      }

      const conversationTaskMutation = url.pathname.match(
        /^\/api\/orchestration\/turns\/([^/]+)\/task-mutations$/,
      );
      if (request.method === "POST" && conversationTaskMutation) {
        const body = await readBody(request);
        const result = await this.applyConversationTaskMutation({
          token: bearerToken(request),
          turnId: conversationTaskMutation[1],
          body,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const activeConversationTaskMutation = url.pathname.match(
        /^\/api\/orchestration\/conversations\/([^/]+)\/task-mutations$/,
      );
      if (request.method === "POST" && activeConversationTaskMutation) {
        const body = await readBody(request);
        const active = this.store.activeConversationTurnForConversation(
          bearerToken(request),
          activeConversationTaskMutation[1],
        );
        const result = await this.applyConversationTaskMutation({
          token: bearerToken(request),
          turnId: active.turn.id,
          body,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const activeConversationTaskSchedule = url.pathname.match(
        /^\/api\/orchestration\/conversations\/([^/]+)\/task-schedules$/,
      );
      if (request.method === "POST" && activeConversationTaskSchedule) {
        const body = await readBody(request);
        const active = this.store.activeConversationTurnForConversation(
          bearerToken(request),
          activeConversationTaskSchedule[1],
        );
        const task = this.store.getTask(body.taskId);
        if (!task || task.project_id !== active.conversation.project_id) {
          throw Object.assign(new Error("task is outside the active conversation project"), {
            code: "orchestrator_denied",
          });
        }
        const phase = body.phase ?? "implementation";
        const modelRoute = this.resolveModelRoute(phase, {
          provider: body.modelProvider,
          model: body.modelId,
          thinking: body.thinkingLevel,
          billingClass: body.billingClass,
          policySource: "orchestrator_selection",
        });
        assertConfiguredModelSelection(this.modelRoutePolicy, phase, modelRoute);
        const result = this.store.scheduleOwnerTaskRun({
          taskId: task.id,
          phase,
          modelRoute,
          actor: `orchestrator:${active.conversation.id}`,
          source: "orchestrator_conversation",
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const orchestratorConversationCustody = url.pathname.match(
        /^\/api\/orchestration\/conversations\/([^/]+)\/custody$/,
      );
      if (request.method === "POST" && orchestratorConversationCustody) {
        const body = await readBody(request);
        if (body.trigger !== "before_compact") {
          throw Object.assign(new Error("orchestrator custody trigger must be before_compact"), {
            code: "invalid_request",
          });
        }
        const authorized = this.store.authorizeOrchestrationConversation(
          bearerToken(request),
          orchestratorConversationCustody[1],
        );
        const snapshot = await this.context.exportConversation({
          conversationId: authorized.conversation.id,
          trigger: "before_compact",
        });
        this.store.appendConversationEvent(
          authorized.conversation.id,
          authorized.conversation.current_turn_id,
          "pre_compaction_custody_exported",
          "control_plane",
          { snapshotId: snapshot.snapshot_id, manifestSha256: snapshot.manifest_sha256 },
        );
        return json(response, 201, { snapshot });
      }

      const completeTurn = url.pathname.match(/^\/api\/orchestration\/turns\/([^/]+)\/complete$/);
      if (request.method === "POST" && completeTurn) {
        const body = await readBody(request);
        return json(response, 200, {
          turn: this.store.completeConversationTurn({
            token: bearerToken(request),
            turnId: completeTurn[1],
            state: body.state,
            result: body.result ?? {},
          }),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/orchestrators") {
        const body = await readBody(request);
        return json(response, 201, this.store.registerProjectOrchestrator({
          projectId: body.projectId,
          transport: body.transport,
          endpoint: body.endpoint,
          metadata: body.metadata,
          leaseSeconds: body.leaseSeconds,
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/orchestrators/heartbeat") {
        const body = await readBody(request);
        return json(response, 200, this.store.heartbeatProjectOrchestrator({
          token: bearerToken(request),
          leaseSeconds: body.leaseSeconds,
        }));
      }
      if (request.method === "DELETE" && url.pathname === "/api/orchestrators/lease") {
        this.store.releaseProjectOrchestrator(bearerToken(request));
        return json(response, 200, { released: true });
      }
      if (request.method === "POST" && url.pathname === "/api/orchestrators/commands/claim") {
        const token = bearerToken(request);
        this.reconcileAutomaticPipelines(token);
        await this.reconcileReadyDispatch(token);
        const command = this.store.claimOrchestratorCommand(token);
        if (!command) {
          response.writeHead(204);
          return response.end();
        }
        return json(response, 200, { command });
      }

      const acceptExecution = url.pathname.match(
        /^\/api\/orchestrators\/commands\/([^/]+)\/executions$/,
      );
      if (request.method === "POST" && acceptExecution) {
        const result = this.store.acceptCommandExecution({
          token: bearerToken(request),
          commandId: acceptExecution[1],
          idempotencyKey: request.headers["idempotency-key"],
        });
        this.launchCommandExecution(result.execution.id);
        return json(response, 202, result);
      }

      const completeCommand = url.pathname.match(/^\/api\/orchestrators\/commands\/([^/]+)\/complete$/);
      if (request.method === "POST" && completeCommand) {
        const body = await readBody(request);
        const token = bearerToken(request);
        const command = this.store.completeOrchestratorCommand({
          token,
          commandId: completeCommand[1],
          state: body.state,
          result: body.result ?? {},
        });
        const continuation = body.state === "succeeded"
          ? this.reconcileAutomaticPipelines(token)
          : [];
        const readyDispatch = body.state === "succeeded"
          ? await this.reconcileReadyDispatch(token)
          : { scheduled: false, reason: "prior_command_failed" };
        return json(response, 200, {
          command,
          continuation,
          readyDispatch,
        });
      }

      const queueCommand = url.pathname.match(/^\/api\/projects\/([^/]+)\/commands$/);
      if (request.method === "POST" && queueCommand) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.enqueueOrchestratorCommand({
          projectId: queueCommand[1],
          taskId: body.taskId,
          kind: body.kind ?? "start_task",
          phase: body.phase,
          payload: body.payload ?? {},
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const topicDetail = url.pathname.match(/^\/api\/topics\/([^/]+)$/);
      if (request.method === "GET" && topicDetail) {
        const result = this.store.topicDetails(topicDetail[1]);
        return result ? json(response, 200, result) : json(response, 404, { error: "not_found" });
      }

      const bindTopicProject = url.pathname.match(/^\/api\/topics\/([^/]+)\/project$/);
      if (request.method === "POST" && bindTopicProject) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const idempotencyKey = request.headers["idempotency-key"];
        const prior = this.store.topicProjectBindingByIdempotency(idempotencyKey);
        const topic = this.store.topicDetails(bindTopicProject[1]);
        if (!topic) {
          throw Object.assign(new Error(`unknown topic: ${bindTopicProject[1]}`), { code: "not_found" });
        }
        const snapshot = prior
          ? { snapshot_id: prior.custody_snapshot_id }
          : await this.context.exportConversation({
            conversationId: topic.conversation.id,
            trigger: "scope_transfer",
          });
        const result = this.store.bindTopicToProject({
          topicId: bindTopicProject[1],
          projectId: body.projectId,
          expectedVersion: body.expectedVersion,
          custodySnapshotId: snapshot.snapshot_id,
          idempotencyKey,
        });
        return json(response, result.replayed ? 200 : 201, {
          ...result,
          custodySnapshot: snapshot,
        });
      }

      const archiveTopic = url.pathname.match(/^\/api\/topics\/([^/]+)\/archive$/);
      if (request.method === "POST" && archiveTopic) {
        this.assertLocalOwnerProfile();
        const result = this.store.archiveTopic({
          topicId: archiveTopic[1],
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const conversationTurns = url.pathname.match(/^\/api\/conversations\/([^/]+)\/turns$/);
      if (request.method === "GET" && conversationTurns) {
        if (!this.store.getConversation(conversationTurns[1])) {
          return json(response, 404, { error: "not_found" });
        }
        return json(response, 200, { turns: this.store.conversationTurns(conversationTurns[1]) });
      }
      if (request.method === "POST" && conversationTurns) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.submitConversationTurn({
          conversationId: conversationTurns[1],
          message: body.message,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const conversationEvents = url.pathname.match(/^\/api\/conversations\/([^/]+)\/events$/);
      if (request.method === "GET" && conversationEvents) {
        const after = url.searchParams.has("after") ? Number(url.searchParams.get("after")) : 0;
        if (!Number.isInteger(after) || after < 0) {
          throw Object.assign(new Error("event cursor must be a non-negative integer"), { code: "invalid_request" });
        }
        return json(response, 200, {
          events: this.store.conversationEvents(conversationEvents[1], { after }),
        });
      }

      const conversationCustody = url.pathname.match(/^\/api\/conversations\/([^/]+)\/custody$/);
      if (request.method === "GET" && conversationCustody) {
        return json(response, 200, {
          snapshots: this.store.conversationCustodySnapshots(conversationCustody[1]),
        });
      }
      if (request.method === "POST" && conversationCustody) {
        this.assertLocalOwnerProfile();
        return json(response, 201, {
          snapshot: await this.context.exportConversation({
            conversationId: conversationCustody[1],
            trigger: "manual",
          }),
        });
      }

      const conversationModel = url.pathname.match(/^\/api\/conversations\/([^/]+)\/model$/);
      if (request.method === "POST" && conversationModel) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const idempotencyKey = request.headers["idempotency-key"];
        const prior = this.store.conversationModelChangeByIdempotency(idempotencyKey);
        const snapshot = prior
          ? { snapshot_id: prior.custody_snapshot_id }
          : await this.context.exportConversation({
            conversationId: conversationModel[1],
            trigger: "model_switch",
          });
        const result = this.store.switchConversationModel({
          conversationId: conversationModel[1],
          modelProvider: body.modelProvider,
          modelId: body.modelId,
          thinkingLevel: body.thinkingLevel,
          expectedVersion: body.expectedVersion,
          custodySnapshotId: snapshot.snapshot_id,
          idempotencyKey,
        });
        return json(response, result.replayed ? 200 : 201, {
          ...result,
          custodySnapshot: snapshot,
        });
      }

      const conversationContext = url.pathname.match(/^\/api\/conversations\/([^/]+)\/context$/);
      if (request.method === "GET" && conversationContext) {
        const token = bearerToken(request);
        if (token) this.store.authorizeOrchestrationConversation(token, conversationContext[1]);
        return json(response, 200, this.store.conversationContext(conversationContext[1]));
      }

      const createTask = url.pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
      if (request.method === "POST" && createTask) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const project = this.store.getProject(createTask[1]);
        if (!project) throw Object.assign(new Error(`unknown project: ${createTask[1]}`), { code: "not_found" });
        const result = this.store.createOwnerTask({
          projectId: project.id,
          title: body.title,
          acceptanceCriteria: body.acceptanceCriteria ?? [],
          taskKind: body.taskKind,
          tags: body.tags,
          revision: await repositoryRevision(project.repository_path),
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const scheduleTask = url.pathname.match(/^\/api\/tasks\/([^/]+)\/schedule$/);
      if (request.method === "POST" && scheduleTask) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const phase = body.phase ?? "implementation";
        const modelRoute = this.resolveModelRoute(phase, {
          provider: body.modelProvider,
          model: body.modelId,
          thinking: body.thinkingLevel,
          billingClass: body.billingClass,
          policySource: "owner_schedule",
        });
        const result = this.store.scheduleOwnerTaskRun({
          taskId: scheduleTask[1],
          phase,
          modelRoute,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }
      const dispatchTask = url.pathname.match(/^\/api\/tasks\/([^/]+)\/dispatch$/);
      if (request.method === "POST" && dispatchTask) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const task = this.store.getTask(dispatchTask[1]);
        if (!task) {
          throw Object.assign(new Error(`unknown task: ${dispatchTask[1]}`), { code: "not_found" });
        }
        const modelRoute = body.operation === "release"
          ? this.resolveModelRoute("implementation", {
            provider: body.modelProvider ?? undefined,
            model: body.modelId ?? undefined,
            thinking: body.thinkingLevel ?? undefined,
            billingClass: body.billingClass ?? undefined,
            policySource: "owner_release",
          })
          : null;
        if (modelRoute) {
          assertConfiguredModelSelection(this.modelRoutePolicy, "implementation", modelRoute);
        }
        const result = this.store.setTaskDispatch({
          taskId: task.id,
          operation: body.operation,
          expectedVersion: body.expectedVersion,
          priority: body.priority ?? null,
          modelRoute,
          idempotencyKey: request.headers["idempotency-key"],
        });
        const dispatch = body.operation === "release"
          ? await this.reconcileReadyProject(task.project_id)
          : null;
        return json(response, result.replayed ? 200 : 201, {
          ...result,
          task: this.store.getTaskDetails(task.id),
          dispatch,
          queue: this.store.taskDispatchProjection(task.id),
        });
      }
      const resumeTask = url.pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/);
      if (request.method === "POST" && resumeTask) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const phase = body.phase ?? "implementation";
        const result = this.store.resumeOwnerTaskRun({
          taskId: resumeTask[1],
          phase,
          modelRoute: this.resolveModelRoute(phase, {
            provider: body.modelProvider,
            model: body.modelId,
            thinking: body.thinkingLevel,
            billingClass: body.billingClass,
            policySource: "owner_resume",
          }),
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const taskIntegration = url.pathname.match(/^\/api\/tasks\/([^/]+)\/integrations$/);
      if (request.method === "POST" && taskIntegration) {
        this.assertLocalOwnerProfile();
        const result = await this.prepareGitIntegration({
          taskId: taskIntegration[1],
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const taskCleanup = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cleanup$/);
      if (request.method === "GET" && taskCleanup) {
        this.assertLocalOwnerProfile();
        return json(response, 200, {
          preview: await this.taskCleanupPreview(taskCleanup[1]),
        });
      }
      if (request.method === "POST" && taskCleanup) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = await this.executeTaskCleanup({
          taskId: taskCleanup[1],
          previewSha256: body.previewSha256,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(
          response,
          result.operation.state === "cleanup_pending" ? 202 : result.replayed ? 200 : 201,
          result,
        );
      }

      const sessionDeletion = url.pathname.match(/^\/api\/sessions\/([^/]+)\/artifacts$/);
      if (request.method === "GET" && sessionDeletion) {
        this.assertLocalOwnerProfile();
        return json(response, 200, {
          preview: await this.sessionDeletionPreview(sessionDeletion[1]),
        });
      }
      if (request.method === "DELETE" && sessionDeletion) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = await this.deleteSessionArtifacts({
          sessionId: sessionDeletion[1],
          confirmSessionId: body.confirmSessionId,
          previewSha256: body.previewSha256,
          reason: body.reason,
          idempotencyKey: request.headers["idempotency-key"],
        });
        return json(
          response,
          result.receipt.state === "cleanup_pending" ? 202 : result.replayed ? 200 : 201,
          result,
        );
      }

      const taskDetail = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskDetail) {
        const token = bearerToken(request);
        if (token) this.store.authorizeCapability(token, "read", taskDetail[1]);
        else this.assertLocalOwnerProfile();
        const task = this.store.getTaskDetails(taskDetail[1]);
        return task
          ? json(response, 200, {
            ...task,
            dispatch: this.store.taskDispatchProjection(task.id),
            activity: this.store.taskAudit(task.id),
          })
          : json(response, 404, { error: "not_found" });
      }
      if (request.method === "PUT" && taskDetail) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.updateOwnerTask({
          taskId: taskDetail[1],
          title: body.title,
          description: body.description ?? null,
          acceptanceCriteria: body.acceptanceCriteria ?? [],
          taskKind: body.taskKind,
          tags: body.tags,
          expectedVersion: body.expectedVersion,
          idempotencyKey: request.headers["idempotency-key"],
        });
        result.task = { ...result.task, activity: this.store.taskAudit(taskDetail[1]) };
        return json(response, result.replayed ? 200 : 201, result);
      }

      const taskLifecycle = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(archive|restore)$/);
      if (request.method === "POST" && taskLifecycle) {
        this.assertLocalOwnerProfile();
        const body = await readBody(request);
        const result = this.store.setTaskArchived({
          taskId: taskLifecycle[1],
          archived: taskLifecycle[2] === "archive",
          reason: body.reason,
          expectedVersion: body.expectedVersion,
          idempotencyKey: request.headers["idempotency-key"],
        });
        result.task = { ...result.task, activity: this.store.taskAudit(taskLifecycle[1]) };
        return json(response, result.replayed ? 200 : 201, result);
      }

      const taskAction = url.pathname.match(/^\/api\/tasks\/([^/]+)\/actions\/([^/]+)$/);
      if (request.method === "POST" && taskAction) {
        const body = await readBody(request);
        let token = bearerToken(request);
        let ownerCapability = null;
        if (!token) {
          this.assertLocalOwnerProfile();
          ownerCapability = this.store.issueCapability({
            role: "owner",
            actorId: "local-owner",
            taskId: taskAction[1],
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          });
          token = ownerCapability.token;
        }
        try {
          const result = this.store.actOnTask({
            token, taskId: taskAction[1], action: taskAction[2],
            idempotencyKey: request.headers["idempotency-key"], expectedVersion: body.expectedVersion,
            payload: body.payload ?? {},
          });
          result.task = { ...result.task, activity: this.store.taskAudit(taskAction[1]) };
          return json(response, result.replayed ? 200 : 201, result);
        } finally {
          if (ownerCapability) this.store.revokeCapability(ownerCapability.id);
        }
      }

      const audit = url.pathname.match(/^\/api\/tasks\/([^/]+)\/audit$/);
      if (request.method === "GET" && audit) {
        const token = bearerToken(request);
        if (token) this.store.authorizeCapability(token, "read", audit[1]);
        else this.assertLocalOwnerProfile();
        return json(response, 200, { events: this.store.taskAudit(audit[1]) });
      }

      const workspaceInspector = url.pathname.match(/^\/api\/tasks\/([^/]+)\/workspace$/);
      if (request.method === "GET" && workspaceInspector) {
        this.assertLocalOwnerProfile();
        const projection = this.store.taskWorkspaceProjection(workspaceInspector[1]);
        for (const run of projection.runs) {
          if (!run.workspace) continue;
          try {
            const service = this.gitService(run.workspace.repository_path);
            const [status, diff, revision] = await Promise.all([
              service.status(run.workspace),
              service.comparisonDiff(run.workspace),
              service.revision(run.workspace),
            ]);
            run.workspace = { ...run.workspace, status_detail: status, diff: diff.diff, current_revision: revision };
          } catch (error) {
            run.workspace = {
              ...run.workspace,
              inspector_error: { code: error.code ?? "workspace_unavailable", message: error.message },
            };
          }
        }
        return json(response, 200, projection);
      }

      const git = url.pathname.match(/^\/api\/tasks\/([^/]+)\/git\/(status|diff|checkpoint|commit)$/);
      if (git && ((request.method === "GET" && ["status", "diff"].includes(git[2]))
        || (request.method === "POST" && ["checkpoint", "commit"].includes(git[2])))) {
        const action = `git_${git[2]}${["checkpoint", "commit"].includes(git[2]) ? "_request" : ""}`;
        const capability = this.store.authorizeCapability(bearerToken(request), action, git[1]);
        const managed = [...this.sessions.values()].find((item) => item.run.id === capability.run_id && item.taskId === git[1]);
        if (!managed) throw Object.assign(new Error("capability run has no active workspace"), { code: "run_not_active" });
        let result;
        if (git[2] === "status") result = await managed.git.status(managed.workspace);
        else if (git[2] === "diff") result = await managed.git.diff(managed.workspace);
        else {
          const body = await readBody(request);
          result = await managed.git.checkpoint({
            workspace: managed.workspace, capability, kind: git[2],
            idempotencyKey: request.headers["idempotency-key"], message: body.message, evidence: body.evidence ?? [],
          });
          managed.active.sequence += 1;
          const eventType = `git_${git[2]}_${result.replayed ? "replayed" : "committed"}`;
          this.store.appendRunEvent(managed.run.id, managed.active.sequence, eventType, managed.sanitize(result));
        }
        return json(response, result.replayed ? 200 : ["checkpoint", "commit"].includes(git[2]) ? 201 : 200, result);
      }

      const start = url.pathname.match(/^\/api\/tasks\/([^/]+)\/sessions$/);
      if (request.method === "POST" && start) {
        const body = await readBody(request);
        const phase = body.phase ?? "implementation";
        const options = {
          orchestratorToken: bearerToken(request),
          phase,
          modelRoute: this.resolveModelRoute(phase, {
            provider: body.modelProvider,
            model: body.modelId,
            thinking: body.thinkingLevel,
            billingClass: body.billingClass,
            policySource: body.modelPolicySource ?? "scheduled_run",
          }),
        };
        return json(response, 201, body.execute
          ? await this.executeTaskPhase(start[1], options)
          : await this.startTask(start[1], options));
      }

      const prompt = url.pathname.match(/^\/api\/sessions\/([^/]+)\/prompt$/);
      if (request.method === "POST" && prompt) {
        const body = await readBody(request);
        return json(response, 200, await this.prompt(prompt[1], body.message));
      }

      const stopSession = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (request.method === "DELETE" && stopSession) {
        this.assertLocalOwnerProfile();
        if (!this.store.getSession(stopSession[1])) {
          throw Object.assign(new Error(`unknown session: ${stopSession[1]}`), { code: "not_found" });
        }
        const stopped = await this.stopSession(stopSession[1]);
        if (!stopped.stopped) {
          throw Object.assign(new Error("session has no active managed runtime"), {
            code: "transition_denied",
          });
        }
        return json(response, 200, { stopped: true, sessionId: stopSession[1] });
      }

      const shell = url.pathname.match(/^\/api\/sessions\/([^/]+)\/shell$/);
      if (request.method === "POST" && shell) {
        const body = await readBody(request);
        return json(response, 200, await this.shell(shell[1], body.command, { rtkFilter: body.rtkFilter ?? null }));
      }

      const contextExport = url.pathname.match(/^\/api\/sessions\/([^/]+)\/context\/exports$/);
      if (request.method === "POST" && contextExport) {
        const body = await readBody(request);
        return json(response, 201, await this.context.exportSession({
          sessionId: contextExport[1],
          query: body.query,
          queryId: body.queryId,
          trigger: body.trigger ?? "manual",
          tokenBudget: body.tokenBudget,
        }));
      }

      const contextChild = url.pathname.match(/^\/api\/sessions\/([^/]+)\/context\/([^/]+)\/children$/);
      if (request.method === "POST" && contextChild) {
        const body = await readBody(request);
        const session = this.store.getSession(contextChild[1]);
        if (!session) throw Object.assign(new Error("source session not found"), { code: "not_found" });
        const project = this.store.getProject(this.store.getTask(session.task_id).project_id);
        const bundlePath = join(this.stateRoot, "context", contextChild[1], contextChild[2]);
        return json(response, 201, await this.context.createBundleChild(bundlePath, {
          cwd: project.repository_path,
          sessionDirectory: join(this.stateRoot, "child-sessions", project.id),
          instruction: body.instruction,
          phase: body.phase ?? "implementation",
        }));
      }

      const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && events) return json(response, 200, { events: this.store.runEvents(events[1]) });
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error.code === "not_found" ? 404
        : ["capability_denied", "self_approval_denied", "orchestrator_denied", "local_operator_denied"].includes(error.code) ? 403
          : ["version_conflict", "revision_conflict", "idempotency_conflict", "transition_denied", "completion_blocked", "git_no_changes", "workspace_tampered", "orchestrator_conflict", "orchestrator_unavailable", "command_conflict", "project_required", "custody_required", "confirmation_mismatch", "deletion_blocked", "reconciliation_required", "execution_managed", "execution_fenced", "execution_scope_conflict", "revision_required"].includes(error.code) ? 409
            : 400;
      return json(response, status, { error: error.code ?? "request_failed", message: error.message });
    }
  }
}
