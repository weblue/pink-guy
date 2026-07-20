import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export const DEFAULT_PI_SUPERVISION = Object.freeze({
  hardDeadlineMs: 60 * 60 * 1_000,
  inactivityTimeoutMs: 3 * 60 * 1_000,
  settlementGraceMs: 30 * 1_000,
});

function duration(environment, name, fallback) {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw Object.assign(new Error(`${name} must be a positive integer number of milliseconds`), {
      code: "invalid_configuration",
    });
  }
  return value;
}

export function piSupervisionPolicy(environment = process.env) {
  const policy = {
    hardDeadlineMs: duration(
      environment,
      "PINK_GUY_PI_HARD_DEADLINE_MS",
      DEFAULT_PI_SUPERVISION.hardDeadlineMs,
    ),
    inactivityTimeoutMs: duration(
      environment,
      "PINK_GUY_PI_INACTIVITY_TIMEOUT_MS",
      DEFAULT_PI_SUPERVISION.inactivityTimeoutMs,
    ),
    settlementGraceMs: duration(
      environment,
      "PINK_GUY_PI_SETTLEMENT_GRACE_MS",
      DEFAULT_PI_SUPERVISION.settlementGraceMs,
    ),
  };
  if (policy.inactivityTimeoutMs >= policy.hardDeadlineMs + policy.settlementGraceMs) {
    throw Object.assign(
      new Error("Pi inactivity timeout must be shorter than the hard deadline plus settlement grace"),
      { code: "invalid_configuration" },
    );
  }
  return Object.freeze(policy);
}

export class PiRpcProcess {
  constructor({
    child = null,
    command = "pi",
    args,
    cwd,
    env,
    onEvent = () => {},
    onProtocolError = () => {},
  }) {
    this.child = child ?? spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.onEvent = onEvent;
    this.onProtocolError = onProtocolError;
    this.messages = [];
    this.waiters = [];
    this.stderr = "";
    this.buffer = "";
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => (this.stderr += chunk));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.once("exit", (code, signal) => {
      const error = Object.assign(new Error(
        `Pi RPC exited before completing pending work (code=${code ?? "none"}, signal=${signal ?? "none"})`,
      ), { code: "pi_process_exited", exitCode: code, signal });
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        clearTimeout(waiter.inactivityTimer);
        waiter.reject(error);
      }
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    while (true) {
      const boundary = this.buffer.indexOf("\n");
      if (boundary < 0) return;
      const line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line);
      } catch (error) {
        const protocolError = Object.assign(new Error(`invalid Pi RPC JSON: ${error.message}`), {
          code: "protocol_error",
          line: line.slice(0, 2_000),
        });
        this.onProtocolError(protocolError);
        for (const waiter of this.waiters.splice(0)) {
          clearTimeout(waiter.timer);
          clearTimeout(waiter.inactivityTimer);
          waiter.reject(protocolError);
        }
        continue;
      }
      this.messages.push(message);
      this.onEvent(message);
      for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waiters[index];
        if (this.messages.length - 1 < waiter.from) continue;
        if (waiter.inactivityTimeoutMs) {
          clearTimeout(waiter.inactivityTimer);
          waiter.inactivityTimer = setTimeout(() => {
            const waiterIndex = this.waiters.indexOf(waiter);
            if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1);
            clearTimeout(waiter.timer);
            waiter.reject(Object.assign(new Error(
              `timed out waiting for ${waiter.description} after ${waiter.inactivityTimeoutMs}ms without RPC activity`,
            ), { code: "rpc_inactive" }));
          }, waiter.inactivityTimeoutMs);
        }
        if (waiter.predicate(message)) {
          this.waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          clearTimeout(waiter.inactivityTimer);
          waiter.resolve(message);
        }
      }
    }
  }

  waitFor(
    predicate,
    description,
    from = 0,
    timeoutMs = 30_000,
    inactivityTimeoutMs = null,
    settlementGraceMs = 0,
  ) {
    for (let index = from; index < this.messages.length; index += 1) {
      if (predicate(this.messages[index])) return Promise.resolve(this.messages[index]);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        description,
        from,
        resolve,
        reject,
        timer: null,
        inactivityTimer: null,
        inactivityTimeoutMs,
        settlementGraceMs,
        hardDeadlineReached: false,
      };
      const rejectHardDeadline = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        clearTimeout(waiter.inactivityTimer);
        reject(Object.assign(new Error(
          `timed out waiting for ${description} after ${timeoutMs}ms`
          + (settlementGraceMs ? ` plus ${settlementGraceMs}ms settlement grace` : ""),
        ), {
          code: "hard_deadline",
          hardDeadlineMs: timeoutMs,
          settlementGraceMs,
        }));
      };
      waiter.timer = setTimeout(() => {
        waiter.hardDeadlineReached = true;
        if (settlementGraceMs > 0) {
          waiter.timer = setTimeout(rejectHardDeadline, settlementGraceMs);
        } else {
          rejectHardDeadline();
        }
      }, timeoutMs);
      if (inactivityTimeoutMs) {
        waiter.inactivityTimer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          reject(Object.assign(new Error(
            `timed out waiting for ${description} after ${inactivityTimeoutMs}ms without RPC activity`,
          ), { code: "rpc_inactive" }));
        }, inactivityTimeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  async command(payload) {
    const id = randomUUID();
    const from = this.messages.length;
    this.child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    const response = await this.waitFor(
      (message) => message.type === "response" && message.id === id,
      `${payload.type} response`,
      from,
    );
    if (!response.success) {
      throw Object.assign(new Error(`${payload.type}: ${response.error}`), {
        code: "provider_rejected",
      });
    }
    return response.data;
  }

  setEventHandler(onEvent) {
    this.onEvent = onEvent;
  }

  async terminate() {
    if (this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export class WorkspaceShell {
  constructor({ child = null, command = "/bin/sh", args = [], cwd, env }) {
    this.child = child ?? spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.buffer = "";
    this.waiters = new Map();
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.on("data", (chunk) => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer += chunk;
    for (const [marker, waiter] of this.waiters) {
      const index = this.buffer.indexOf(marker);
      if (index < 0) continue;
      const output = this.buffer.slice(0, index);
      const remainder = this.buffer.slice(index + marker.length);
      const newline = remainder.indexOf("\n");
      const status = Number(remainder.slice(0, newline));
      this.buffer = remainder.slice(newline + 1);
      this.waiters.delete(marker);
      waiter.resolve({ output, status });
    }
  }

  exec(command) {
    const marker = `__BOSS_MAN_${randomUUID()}__`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(marker);
        reject(new Error("workspace shell command timed out"));
      }, 15_000);
      this.waiters.set(marker, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
      this.child.stdin.write(`(\n${command}\n)\n__boss_man_status=$?\nprintf '${marker}%s\\n' "$__boss_man_status"\n`);
    });
  }

  async terminate() {
    if (this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    await new Promise((resolve) => this.child.once("exit", resolve));
  }
}
