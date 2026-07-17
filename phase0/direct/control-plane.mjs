import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { access, chmod, copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { RtkArtifactIngestor } from "./artifacts.mjs";
import { redactValue, RunCredentialVault } from "./credentials.mjs";
import { HostGitService } from "./git-service.mjs";
import { PiRpcProcess, WorkspaceShell } from "./rpc.mjs";
import { DockerTaskRuntime } from "./runtime.mjs";
import { Phase0Store } from "./store.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(moduleDirectory, "../pi");
const rtkConfiguration = resolve(moduleDirectory, "../runtime/rtk-config.toml");

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

const BOARD_HTML = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Boss Man Phase 0</title>
<style>body{font:14px system-ui;margin:2rem;background:#101317;color:#e8edf2}main{max-width:72rem;margin:auto}#board{display:grid;grid-template-columns:repeat(6,minmax(10rem,1fr));gap:.75rem}.column{border:1px solid #38424d;border-radius:.5rem;padding:.75rem}.task{background:#1d242c;padding:.65rem;border-radius:.35rem}@media(max-width:700px){#board{display:block}.column{margin:.5rem 0}}</style>
<main><h1>Boss Man Phase 0 board</h1><p>Minimal task-first route; chat is intentionally absent.</p><div id="board"></div></main>
<script>fetch('/api/board').then(r=>r.json()).then(({columns})=>{for(const [state,tasks] of Object.entries(columns)){const c=document.createElement('section');c.className='column';c.innerHTML='<h2>'+state.replaceAll('_',' ')+'</h2>';for(const task of tasks){const t=document.createElement('article');t.className='task';t.textContent=task.title+' · v'+task.version;c.append(t)}document.querySelector('#board').append(c)}})</script></html>`;

export class DirectControlPlane {
  constructor({
    databasePath, stateRoot, fixturePath, environment = process.env,
    runtimeImage = "boss-man-phase0:pi-0.80.9-rtk-0.42.3",
    dockerCommand = "docker", credentialProfile = null,
    runtimeProvider = "boss-man-phase0", runtimeModel = "complete", runtimeOffline = true,
    faultInjector = async () => undefined,
  }) {
    this.store = new Phase0Store(databasePath);
    this.stateRoot = stateRoot;
    this.fixturePath = fixturePath;
    this.environment = environment;
    this.runtimeImage = runtimeImage;
    this.dockerCommand = dockerCommand;
    this.runtimeProvider = runtimeProvider;
    this.runtimeModel = runtimeModel;
    this.runtimeOffline = runtimeOffline;
    this.faultInjector = faultInjector;
    this.credentialVault = new RunCredentialVault({ stateRoot, profile: credentialProfile });
    this.git = new HostGitService({
      store: this.store,
      repositoryPath: fixturePath,
      workspaceRoot: join(stateRoot, "workspaces"),
      faultInjector,
    });
    this.sessions = new Map();
    this.server = null;
    this.reconciledRunIds = [];
    this.recoveryResults = [];
    this.recoveryChecked = false;
  }

  seed() {
    return this.store.seedProjectTask({
      repositoryPath: this.fixturePath,
      title: "Correct deterministic slug normalization",
    });
  }

  async startTask(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    if (!task.assigned_worker) throw new Error(`task must be assigned before starting a session: ${taskId}`);
    if (task.status !== "in_progress") throw new Error("task must be claimed before starting a session");

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

    if (!this.internalOrigin) throw new Error("control plane must listen before starting Pi");
    const workspace = await this.git.createWorkspace({ taskId, runId });
    const credential = await this.credentialVault.materialize(runId);
    this.store.recordCredentialRun({
      runId, profileId: credential.profileId, authType: credential.authType, billingMode: credential.billingMode,
    });
    const capability = this.store.issueCapability({
      role: "worker",
      actorId: task.assigned_worker,
      taskId,
      runId,
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
      BOSS_MAN_PHASE0_LIFECYCLE_DIR: "/artifacts/snapshots",
      BOSS_MAN_API_URL: this.containerOrigin,
      BOSS_MAN_TASK_ID: taskId,
      BOSS_MAN_CAPABILITY_TOKEN: capability.token,
      BOSS_MAN_EXTENSION_EVIDENCE_PATH: "/artifacts/boss-man-tools.json",
      ...(this.runtimeOffline ? { PI_OFFLINE: "1" } : {}),
    };
    let runtime = null;
    let containerEffect = null;
    try {
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
          "--extension", "/boss-man/extensions/lifecycle-probe.ts",
          "--extension", "/boss-man/extensions/boss-man-extension.ts",
          "--extension", "/boss-man/extensions/rtk-managed-extension.ts",
          "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
          ...(this.runtimeOffline ? ["--offline"] : []),
          "--provider", this.runtimeProvider, "--model", this.runtimeModel,
        ]),
        onEvent: (event) => {
          const safeEvent = sanitize(event);
          if (active) {
            active.sequence += 1;
            this.store.appendRunEvent(active.runId, active.sequence, safeEvent.type ?? "unknown", safeEvent);
          } else pending.push(safeEvent);
        },
      });
      const state = await rpc.command({ type: "get_state" });
      const shell = new WorkspaceShell({ child: runtime.spawn("sh") });
      const nativePath = state.sessionFile?.startsWith("/sessions/")
        ? join(sessionDirectory, basename(state.sessionFile)) : state.sessionFile;
      this.store.createSession({
        id: state.sessionId,
        taskId,
        nativePath,
        provider: state.model?.provider,
        model: state.model?.id,
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
      });
      active = { runId: run.id, sequence: 0 };
      for (const event of pending) {
        active.sequence += 1;
        this.store.appendRunEvent(run.id, active.sequence, event.type ?? "unknown", event);
      }
      const artifacts = new RtkArtifactIngestor({
        store: this.store, sessionId: state.sessionId, runId, artifactRoot: artifactDirectory,
        secrets: credential.redactionValues,
      });
      const managed = {
        taskId, state, run, rpc, shell, runtime, runtimeState, workspace, credential,
        artifactDirectory, snapshotDirectory, configDirectory: config, active, capability, artifacts, sanitize,
        extensionEvidencePath: join(artifactDirectory, "boss-man-tools.json"),
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
        provider: managed.state.model?.provider ?? this.runtimeProvider,
        model: managed.state.model?.id ?? this.runtimeModel,
        promptSha256: sha256(message),
      },
    }).effect;
    const from = managed.rpc.messages.length;
    await managed.rpc.command({ type: "prompt", message });
    await managed.rpc.waitFor((event) => event.type === "agent_settled", "agent settlement", from);
    await this.faultInjector("provider_after_settled", { sideEffectId: journal.id, runId: managed.run.id, sessionId });
    await this.ingestSnapshots(managed);
    const rtkReceipts = await managed.artifacts.ingestPiArtifacts();
    for (const receipt of rtkReceipts) {
      managed.active.sequence += 1;
      this.store.appendRunEvent(managed.run.id, managed.active.sequence, "rtk_artifact_ingested", managed.sanitize(receipt));
    }
    const nativeContent = await readFile(this.store.getSession(sessionId).native_path);
    this.store.completeSideEffect(journal.id, {
      eventCount: this.store.runEvents(managed.run.id).length,
      nativeSessionSha256: sha256(nativeContent),
      rtkReceiptCount: rtkReceipts.length,
    });
    return { run: this.store.getRun(managed.run.id), events: this.store.runEvents(managed.run.id) };
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
    if (!managed) return;
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
    if (record) this.store.finishRun(managed.run.id, "stopped");
    this.sessions.delete(sessionId);
  }

  async close({ record = true } = {}) {
    await Promise.all([...this.sessions.keys()].map((id) => this.stopSession(id, { record })));
    if (this.server) await new Promise((resolvePromise) => this.server.close(resolvePromise));
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
        && inspection.labels?.["boss-man.run"] === run.id,
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
          const git = workspace
            ? await this.git.reconcileSideEffect(effect, workspace)
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
    this.server = createServer((request, response) => this.route(request, response));
    await new Promise((resolvePromise, rejectPromise) => {
      this.server.once("error", rejectPromise);
      this.server.listen(port, host, resolvePromise);
    });
    const address = this.server.address();
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
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, { ok: true, authority: "direct_pi_daemon" });
      }
      if (request.method === "GET" && url.pathname === "/api/board") return json(response, 200, this.store.board());

      const taskDetail = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskDetail) {
        this.store.authorizeCapability(bearerToken(request), "read", taskDetail[1]);
        const task = this.store.getTaskDetails(taskDetail[1]);
        return task ? json(response, 200, task) : json(response, 404, { error: "not_found" });
      }

      const taskAction = url.pathname.match(/^\/api\/tasks\/([^/]+)\/actions\/([^/]+)$/);
      if (request.method === "POST" && taskAction) {
        const body = await readBody(request);
        const result = this.store.actOnTask({
          token: bearerToken(request), taskId: taskAction[1], action: taskAction[2],
          idempotencyKey: request.headers["idempotency-key"], expectedVersion: body.expectedVersion,
          payload: body.payload ?? {},
        });
        return json(response, result.replayed ? 200 : 201, result);
      }

      const audit = url.pathname.match(/^\/api\/tasks\/([^/]+)\/audit$/);
      if (request.method === "GET" && audit) {
        this.store.authorizeCapability(bearerToken(request), "read", audit[1]);
        return json(response, 200, { events: this.store.taskAudit(audit[1]) });
      }

      const git = url.pathname.match(/^\/api\/tasks\/([^/]+)\/git\/(status|diff|checkpoint|commit)$/);
      if (git && ((request.method === "GET" && ["status", "diff"].includes(git[2]))
        || (request.method === "POST" && ["checkpoint", "commit"].includes(git[2])))) {
        const action = `git_${git[2]}${["checkpoint", "commit"].includes(git[2]) ? "_request" : ""}`;
        const capability = this.store.authorizeCapability(bearerToken(request), action, git[1]);
        const managed = [...this.sessions.values()].find((item) => item.run.id === capability.run_id && item.taskId === git[1]);
        if (!managed) throw Object.assign(new Error("capability run has no active workspace"), { code: "run_not_active" });
        let result;
        if (git[2] === "status") result = await this.git.status(managed.workspace);
        else if (git[2] === "diff") result = await this.git.diff(managed.workspace);
        else {
          const body = await readBody(request);
          result = await this.git.checkpoint({
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
      if (request.method === "POST" && start) return json(response, 201, await this.startTask(start[1]));

      const prompt = url.pathname.match(/^\/api\/sessions\/([^/]+)\/prompt$/);
      if (request.method === "POST" && prompt) {
        const body = await readBody(request);
        return json(response, 200, await this.prompt(prompt[1], body.message));
      }

      const shell = url.pathname.match(/^\/api\/sessions\/([^/]+)\/shell$/);
      if (request.method === "POST" && shell) {
        const body = await readBody(request);
        return json(response, 200, await this.shell(shell[1], body.command, { rtkFilter: body.rtkFilter ?? null }));
      }

      const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && events) return json(response, 200, { events: this.store.runEvents(events[1]) });
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error.code === "not_found" ? 404
        : ["capability_denied", "self_approval_denied"].includes(error.code) ? 403
          : ["version_conflict", "revision_conflict", "idempotency_conflict", "transition_denied", "completion_blocked", "git_no_changes", "workspace_tampered"].includes(error.code) ? 409
            : 400;
      return json(response, status, { error: error.code ?? "request_failed", message: error.message });
    }
  }
}
