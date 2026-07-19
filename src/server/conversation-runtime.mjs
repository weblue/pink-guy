import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { PiRpcProcess } from "./rpc.mjs";
import { composeAgentSystemPrompt } from "./prompt-profiles.mjs";

async function responseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export class ConversationOrchestratorRuntime {
  constructor({
    api,
    scopeType,
    scopeId = null,
    stateRoot,
    piCommand = "pi",
    piExtension,
    credentialSource = null,
    environment = process.env,
    leaseSeconds = 90,
    pollMs = 1_000,
  }) {
    this.api = api.replace(/\/$/, "");
    this.scopeType = scopeType;
    this.scopeId = scopeId;
    this.stateRoot = resolve(stateRoot);
    this.piCommand = piCommand;
    this.piExtension = resolve(piExtension);
    this.credentialSource = credentialSource ? resolve(credentialSource) : null;
    this.environment = environment;
    this.leaseSeconds = leaseSeconds;
    this.pollMs = pollMs;
    this.sessions = new Map();
    this.token = null;
    this.lease = null;
    this.heartbeat = null;
    this.privateAgentDirectory = join(
      this.stateRoot,
      "orchestrator-config",
      `${this.scopeType}-${this.scopeId ?? "system-intake"}`,
    );
    this.credentialsInitialized = false;
  }

  async request(path, { method = "GET", body, idempotencyKey } = {}) {
    const response = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await responseJson(response);
    if (!response.ok) {
      throw Object.assign(new Error(`${value?.error ?? `HTTP ${response.status}`}: ${value?.message ?? "request failed"}`), {
        code: value?.error ?? "request_failed",
        status: response.status,
      });
    }
    return value;
  }

  async register() {
    if (this.token) return this.lease;
    const registration = await this.request("/api/orchestration/leases", {
      method: "POST",
      body: {
        scopeType: this.scopeType,
        scopeId: this.scopeId,
        transport: process.env.TMUX ? "tmux" : "daemon",
        endpoint: process.env.TMUX_PANE ? `tmux-pane:${process.env.TMUX_PANE}` : `pid:${process.pid}`,
        leaseSeconds: this.leaseSeconds,
        metadata: { runtime: "pi-rpc", host: this.environment.HOST ?? "local" },
      },
    });
    this.token = registration.token;
    this.lease = registration;
    this.heartbeat = setInterval(() => {
      void this.request("/api/orchestration/leases/heartbeat", {
        method: "POST",
        body: { leaseSeconds: this.leaseSeconds },
      }).catch((error) => process.stderr.write(`conversation orchestrator heartbeat failed: ${error.message}\n`));
    }, Math.max(5, Math.floor(this.leaseSeconds / 3)) * 1_000);
    this.heartbeat.unref?.();
    return registration;
  }

  async claim() {
    await this.register();
    const response = await fetch(`${this.api}/api/orchestration/turns/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (response.status === 204) return null;
    const value = await responseJson(response);
    if (!response.ok) throw new Error(`${value?.error ?? `HTTP ${response.status}`}: ${value?.message ?? "claim failed"}`);
    return value;
  }

  async openSession(context) {
    const conversation = context.conversation;
    const existing = this.sessions.get(conversation.id);
    if (
      existing
      && existing.rpc.child.exitCode === null
      && existing.conversationVersion === conversation.version
    ) return existing;
    if (existing) {
      await existing.rpc.terminate();
      this.sessions.delete(conversation.id);
    }
    const promptProfile = context.prompt_profile;
    if (!promptProfile || promptProfile.profile_key !== "orchestrator") {
      throw new Error("orchestrator claim context omitted its active prompt profile");
    }
    const sessionRoot = join(this.stateRoot, "orchestrator-sessions", conversation.id);
    await Promise.all([
      mkdir(sessionRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.privateAgentDirectory, { recursive: true, mode: 0o700 }),
    ]);
    if (!this.credentialsInitialized) {
      if (this.credentialSource) {
        const privateAuth = join(this.privateAgentDirectory, "auth.json");
        await copyFile(this.credentialSource, privateAuth);
        await chmod(privateAuth, 0o600);
      } else if (basename(this.piCommand) === "pi") {
        throw new Error("real Pi orchestration requires an explicit owner-managed credential source");
      }
      this.credentialsInitialized = true;
    }
    const args = [
      "--mode", "rpc",
      "--provider", conversation.model_provider,
      "--model", conversation.model_id,
      "--thinking", conversation.thinking_level,
      "--name", `Pink Guy: ${context.topic.title}`,
      "--no-builtin-tools",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-extensions",
      "--extension", this.piExtension,
      "--system-prompt", composeAgentSystemPrompt("orchestrator", promptProfile.prompt_text),
      ...(conversation.native_session_path
        ? ["--session", conversation.native_session_path]
        : ["--session-id", conversation.id, "--session-dir", sessionRoot]),
    ];
    const rpc = new PiRpcProcess({
      command: this.piCommand,
      args,
      cwd: context.project?.repository_path ?? this.stateRoot,
      env: {
        ...this.environment,
        PI_CODING_AGENT_DIR: this.privateAgentDirectory,
        PI_TELEMETRY: "0",
        PINK_GUY_API_URL: this.api,
        PINK_GUY_CONVERSATION_ID: conversation.id,
        PINK_GUY_ORCHESTRATION_TOKEN: this.token,
        BOSS_MAN_API_URL: this.api,
        BOSS_MAN_CONVERSATION_ID: conversation.id,
        BOSS_MAN_ORCHESTRATION_TOKEN: this.token,
      },
      onProtocolError: (error) => process.stderr.write(`${error.message}\n`),
    });
    const state = await rpc.command({ type: "get_state" });
    if (!state?.sessionFile) {
      await rpc.terminate();
      throw new Error("Pi RPC did not provide a native session file");
    }
    if (
      state.model?.provider !== conversation.model_provider
      || state.model?.id !== conversation.model_id
      || state.thinkingLevel !== conversation.thinking_level
    ) {
      await rpc.terminate();
      throw new Error(
        `Pi effective route ${state.model?.provider}/${state.model?.id} (${state.thinkingLevel}) `
        + `does not match ${conversation.model_provider}/${conversation.model_id} (${conversation.thinking_level})`,
      );
    }
    const managed = {
      rpc,
      nativeSessionPath: state.sessionFile,
      conversationId: conversation.id,
      conversationVersion: conversation.version,
      promptProfile,
    };
    this.sessions.set(conversation.id, managed);
    return managed;
  }

  async projectEvent(turnId, runId, eventKey, event) {
    return this.request(`/api/orchestration/turns/${encodeURIComponent(turnId)}/events`, {
      method: "POST",
      body: { runId, eventKey, event },
    });
  }

  async execute(claimed) {
    const { turn, context } = claimed;
    const runId = randomUUID();
    let managed;
    try {
      managed = await this.openSession(context);
      await this.request(`/api/orchestration/turns/${encodeURIComponent(turn.id)}/runtime`, {
        method: "POST",
        body: {
          runId,
          processId: managed.rpc.child.pid ?? null,
          nativeSessionPath: managed.nativeSessionPath,
          metadata: {
            transport: "pi-rpc",
            contextResend: false,
            promptProfileKey: managed.promptProfile.profile_key,
            promptProfileVersion: managed.promptProfile.active_version,
            promptSha256: managed.promptProfile.prompt_sha256,
          },
        },
      });
      let eventSequence = 0;
      let eventChain = Promise.resolve();
      managed.rpc.setEventHandler((event) => {
        if (event.type === "response") return;
        eventSequence += 1;
        const eventKey = `rpc:${eventSequence}`;
        eventChain = eventChain.then(() => this.projectEvent(turn.id, runId, eventKey, event));
      });
      const from = managed.rpc.messages.length;
      await managed.rpc.command({ type: "prompt", message: turn.owner_message });
      await managed.rpc.waitFor(
        (message) => message.type === "agent_settled",
        "Pi agent to settle",
        from,
        10 * 60 * 1_000,
      );
      await eventChain;
      const [last, stats, state] = await Promise.all([
        managed.rpc.command({ type: "get_last_assistant_text" }),
        managed.rpc.command({ type: "get_session_stats" }),
        managed.rpc.command({ type: "get_state" }),
      ]);
      return this.request(`/api/orchestration/turns/${encodeURIComponent(turn.id)}/complete`, {
        method: "POST",
        body: {
          state: "completed",
          result: {
            assistantText: last?.text ?? null,
            sessionFile: state?.sessionFile ?? managed.nativeSessionPath,
            sessionId: state?.sessionId ?? null,
            usage: stats?.tokens ?? null,
            cost: stats?.cost ?? null,
            contextUsage: stats?.contextUsage ?? null,
            contextResend: false,
          },
        },
      });
    } catch (error) {
      await this.request(`/api/orchestration/turns/${encodeURIComponent(turn.id)}/complete`, {
        method: "POST",
        body: {
          state: "failed",
          result: { error: String(error.message ?? error).slice(0, 2_000), contextResend: false },
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  async runOnce() {
    await this.retireOutOfScopeSessions();
    const claimed = await this.claim();
    if (!claimed) return null;
    return this.execute(claimed);
  }

  async retireOutOfScopeSessions() {
    if (!this.token || this.sessions.size === 0) return;
    for (const [conversationId, managed] of this.sessions) {
      try {
        await this.request(`/api/conversations/${encodeURIComponent(conversationId)}/context`);
      } catch (error) {
        if (!["orchestrator_denied", "not_found"].includes(error.code)) throw error;
        await managed.rpc.terminate();
        this.sessions.delete(conversationId);
      }
    }
  }

  async close({ release = true } = {}) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all([...this.sessions.values()].map(({ rpc }) => rpc.terminate()));
    this.sessions.clear();
    await rm(join(this.privateAgentDirectory, "auth.json"), { force: true });
    this.credentialsInitialized = false;
    if (release && this.token) {
      await this.request("/api/orchestration/leases/current", { method: "DELETE" }).catch(() => undefined);
    }
    this.token = null;
    this.lease = null;
  }
}
