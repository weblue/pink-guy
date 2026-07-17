import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export class PiRpcProcess {
  constructor({ child = null, command = "pi", args, cwd, env, onEvent = () => {} }) {
    this.child = child ?? spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.onEvent = onEvent;
    this.messages = [];
    this.waiters = [];
    this.stderr = "";
    this.buffer = "";
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => (this.stderr += chunk));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer += chunk;
    while (true) {
      const boundary = this.buffer.indexOf("\n");
      if (boundary < 0) return;
      const line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      this.messages.push(message);
      this.onEvent(message);
      for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waiters[index];
        if (this.messages.length - 1 >= waiter.from && waiter.predicate(message)) {
          this.waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    }
  }

  waitFor(predicate, description, from = 0, timeoutMs = 30_000) {
    for (let index = from; index < this.messages.length; index += 1) {
      if (predicate(this.messages[index])) return Promise.resolve(this.messages[index]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${description}`)), timeoutMs);
      this.waiters.push({ predicate, description, from, resolve, reject, timer });
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
    if (!response.success) throw new Error(`${payload.type}: ${response.error}`);
    return response.data;
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
