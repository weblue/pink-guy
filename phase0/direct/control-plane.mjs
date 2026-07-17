import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PiRpcProcess, WorkspaceShell } from "./rpc.mjs";
import { Phase0Store } from "./store.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const lifecycleExtension = resolve(moduleDirectory, "../pi/lifecycle-probe.ts");
const taskCapabilityExtension = resolve(moduleDirectory, "../pi/boss-man-extension.ts");

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
  constructor({ databasePath, stateRoot, fixturePath, environment = process.env }) {
    this.store = new Phase0Store(databasePath);
    this.stateRoot = stateRoot;
    this.fixturePath = fixturePath;
    this.environment = environment;
    this.sessions = new Map();
    this.server = null;
    this.reconciledRunIds = this.store.reconcileRunningRuns();
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

    const instanceRoot = join(this.stateRoot, randomUUID());
    const home = join(instanceRoot, "home");
    const config = join(instanceRoot, "pi-config");
    const sessionDirectory = join(instanceRoot, "sessions");
    const snapshotDirectory = join(instanceRoot, "snapshots");
    await Promise.all([home, config, sessionDirectory, snapshotDirectory].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));

    if (!this.internalOrigin) throw new Error("control plane must listen before starting Pi");
    const runId = randomUUID();
    const capability = this.store.issueCapability({
      role: "worker",
      actorId: task.assigned_worker,
      taskId,
      runId,
      expiresAt: new Date(Date.parse(this.store.clock()) + 8 * 60 * 60 * 1000).toISOString(),
    });
    const env = {
      HOME: home,
      LANG: this.environment.LANG ?? "en_US.UTF-8",
      PATH: this.environment.PATH,
      SHELL: "/bin/sh",
      TMPDIR: this.environment.TMPDIR ?? tmpdir(),
      PI_CODING_AGENT_DIR: config,
      PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      BOSS_MAN_PHASE0_LIFECYCLE_DIR: snapshotDirectory,
      BOSS_MAN_API_URL: this.internalOrigin,
      BOSS_MAN_TASK_ID: taskId,
      BOSS_MAN_CAPABILITY_TOKEN: capability.token,
      BOSS_MAN_EXTENSION_EVIDENCE_PATH: join(instanceRoot, "boss-man-tools.json"),
    };
    const pending = [];
    let active = null;
    const rpc = new PiRpcProcess({
      args: [
        "--mode", "rpc", "--session-dir", sessionDirectory,
        "--extension", lifecycleExtension, "--extension", taskCapabilityExtension, "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-context-files", "--no-approve", "--offline",
        "--provider", "boss-man-phase0", "--model", "complete",
      ],
      cwd: this.fixturePath,
      env,
      onEvent: (event) => {
        if (active) {
          active.sequence += 1;
          this.store.appendRunEvent(active.runId, active.sequence, event.type ?? "unknown", event);
        } else pending.push(event);
      },
    });
    const state = await rpc.command({ type: "get_state" });
    const shell = new WorkspaceShell({ cwd: this.fixturePath, env: { ...env, HOME: home } });
    this.store.createSession({
      id: state.sessionId,
      taskId,
      nativePath: state.sessionFile,
      provider: state.model?.provider,
      model: state.model?.id,
    });
    const run = this.store.createRun({
      id: runId,
      sessionId: state.sessionId,
      processId: rpc.child.pid,
      shellProcessId: shell.child.pid,
    });
    active = { runId: run.id, sequence: 0 };
    for (const event of pending) {
      active.sequence += 1;
      this.store.appendRunEvent(run.id, active.sequence, event.type ?? "unknown", event);
    }
    const managed = { taskId, state, run, rpc, shell, env, snapshotDirectory, active, capability };
    this.sessions.set(state.sessionId, managed);
    return { session: this.store.getSession(state.sessionId), run };
  }

  async prompt(sessionId, message) {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`session is not active: ${sessionId}`);
    const from = managed.rpc.messages.length;
    await managed.rpc.command({ type: "prompt", message });
    await managed.rpc.waitFor((event) => event.type === "agent_settled", "agent settlement", from);
    await this.ingestSnapshots(managed);
    return { run: this.store.getRun(managed.run.id), events: this.store.runEvents(managed.run.id) };
  }

  async shell(sessionId, command) {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`session is not active: ${sessionId}`);
    const result = await managed.shell.exec(command);
    managed.active.sequence += 1;
    this.store.appendRunEvent(managed.run.id, managed.active.sequence, "workspace_shell_result", {
      command,
      status: result.status,
      output: result.output,
    });
    return result;
  }

  async ingestSnapshots(managed) {
    for (const name of await readdir(managed.snapshotDirectory)) {
      if (!name.startsWith("snapshot-") || !name.endsWith(".json")) continue;
      const path = join(managed.snapshotDirectory, name);
      const content = await readFile(path);
      const manifest = JSON.parse(content);
      this.store.recordArtifact({
        sessionId: managed.state.sessionId,
        kind: "context_manifest",
        path,
        sha256: sha256(content),
        metadata: { trigger: manifest.trigger, native: manifest.native },
      });
    }
  }

  async stopSession(sessionId, { record = true } = {}) {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    await Promise.all([managed.rpc.terminate(), managed.shell.terminate()]);
    if (record) this.store.finishRun(managed.run.id, "stopped");
    this.sessions.delete(sessionId);
  }

  async close({ record = true } = {}) {
    await Promise.all([...this.sessions.keys()].map((id) => this.stopSession(id, { record })));
    if (this.server) await new Promise((resolvePromise) => this.server.close(resolvePromise));
    this.store.close();
  }

  async listen(port = 0, host = "127.0.0.1") {
    this.server = createServer((request, response) => this.route(request, response));
    await new Promise((resolvePromise, rejectPromise) => {
      this.server.once("error", rejectPromise);
      this.server.listen(port, host, resolvePromise);
    });
    const address = this.server.address();
    this.internalOrigin = `http://${address.address === "::" ? "127.0.0.1" : address.address}:${address.port}`;
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
        return json(response, 200, await this.shell(shell[1], body.command));
      }

      const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && events) return json(response, 200, { events: this.store.runEvents(events[1]) });
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error.code === "not_found" ? 404
        : ["capability_denied", "self_approval_denied"].includes(error.code) ? 403
          : ["version_conflict", "revision_conflict", "idempotency_conflict", "transition_denied", "completion_blocked"].includes(error.code) ? 409
            : 400;
      return json(response, status, { error: error.code ?? "request_failed", message: error.message });
    }
  }
}
