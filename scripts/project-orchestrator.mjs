#!/usr/bin/env node

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConversationOrchestratorRuntime } from "../src/server/conversation-runtime.mjs";

function usage() {
  console.error(`usage: node scripts/project-orchestrator.mjs --api http://127.0.0.1:4310
  (--project-id PROJECT_ID | --repo /absolute/repository)
  [--state-root /absolute/state] [--credential-source /absolute/pi-auth.json]
  [--pi-command pi] [--lease-seconds 90] [--poll-ms 1000]`);
  process.exit(64);
}

let api;
let projectId;
let repositoryPath;
const pinkStateRoot = join(homedir(), ".local", "share", "pink-guy", "dev");
const legacyStateRoot = join(homedir(), ".local", "share", "boss-man", "dev");
let stateRoot = pinkStateRoot;
let stateExplicit = false;
let credentialSource;
let piCommand = "pi";
let leaseSeconds = 90;
let pollMs = 1000;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--api") api = process.argv[++index];
  else if (argument === "--project-id") projectId = process.argv[++index];
  else if (argument === "--repo") repositoryPath = resolve(process.argv[++index] ?? usage());
  else if (argument === "--state-root") {
    stateRoot = resolve(process.argv[++index] ?? usage());
    stateExplicit = true;
  }
  else if (argument === "--credential-source") credentialSource = resolve(process.argv[++index] ?? usage());
  else if (argument === "--pi-command") piCommand = process.argv[++index];
  else if (argument === "--lease-seconds") leaseSeconds = Number(process.argv[++index]);
  else if (argument === "--poll-ms") pollMs = Number(process.argv[++index]);
  else usage();
}
if (
  !api || (!projectId && !repositoryPath) || !Number.isInteger(leaseSeconds)
  || !Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000
) usage();
if (!stateExplicit) {
  try {
    await access(pinkStateRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await access(legacyStateRoot);
      stateRoot = legacyStateRoot;
    } catch (legacyError) {
      if (legacyError?.code !== "ENOENT") throw legacyError;
    }
  }
}
api = api.replace(/\/$/, "");

const sleep = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration));

async function responseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

if (!projectId) {
  const response = await fetch(`${api}/api/projects`);
  if (!response.ok) throw new Error(`failed to list projects: HTTP ${response.status}`);
  const projects = (await response.json()).projects;
  const project = projects.find((candidate) => resolve(candidate.repository_path) === repositoryPath);
  if (!project) throw new Error(`central API does not manage repository: ${repositoryPath}`);
  projectId = project.id;
}

const transport = process.env.TMUX ? "tmux" : "daemon";
const endpoint = process.env.TMUX_PANE ? `tmux-pane:${process.env.TMUX_PANE}` : `pid:${process.pid}`;
const register = await fetch(`${api}/api/orchestrators`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    projectId,
    transport,
    endpoint,
    leaseSeconds,
    metadata: { host: process.env.HOST ?? "local", tmux: Boolean(process.env.TMUX) },
  }),
});
const registration = await register.json();
if (!register.ok) throw new Error(`${registration.error}: ${registration.message}`);
const token = registration.token;
process.stdout.write(`Project orchestrator registered
Project: ${projectId}
Lease: ${registration.id}
Transport: ${transport}
Endpoint: ${endpoint}
Central API: ${api}
Command polling: ${pollMs}ms
`);

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const conversationRuntime = new ConversationOrchestratorRuntime({
  api,
  scopeType: "project",
  scopeId: projectId,
  stateRoot,
  piCommand,
  piExtension: resolve(moduleDirectory, "../src/pi/orchestrator-extension.ts"),
  credentialSource,
  leaseSeconds,
  pollMs,
});
try {
  await conversationRuntime.register();
} catch (error) {
  await fetch(`${api}/api/orchestrators/lease`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => undefined);
  throw error;
}
process.stdout.write("Conversation polling: persistent Pi RPC (same project daemon)\n");

let stopping = false;
let heartbeatInFlight = false;
let lastHeartbeatSuccess = Date.now();
const heartbeatIntervalMs = Math.max(5, Math.floor(leaseSeconds / 3)) * 1000;

async function sendHeartbeat() {
  if (stopping || heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
    const response = await fetch(`${api}/api/orchestrators/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ leaseSeconds }),
      signal: AbortSignal.timeout(Math.min(5_000, heartbeatIntervalMs)),
    });
    if (!response.ok) {
      if ([401, 403, 409].includes(response.status)) {
        process.stderr.write(`Project orchestrator lease is no longer active (HTTP ${response.status}); exiting for supervised restart.\n`);
        void stop("LEASE_LOST", 1);
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    lastHeartbeatSuccess = Date.now();
  } catch (error) {
    process.stderr.write(`orchestrator heartbeat failed: ${error.message}\n`);
    if (Date.now() - lastHeartbeatSuccess >= leaseSeconds * 1000) {
      process.stderr.write("Project orchestrator could not renew within its lease window; exiting for supervised restart.\n");
      void stop("HEARTBEAT_DEADLINE", 1);
    }
  } finally {
    heartbeatInFlight = false;
  }
}

const heartbeat = setInterval(() => void sendHeartbeat(), heartbeatIntervalMs);

async function acceptCommandExecution(command) {
  if (command.kind !== "start_task") throw new Error(`unsupported command kind: ${command.kind}`);
  const response = await fetch(`${api}/api/orchestrators/commands/${command.id}/executions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": `execute-command:${command.id}`,
    },
    body: "{}",
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(`${body?.error ?? `HTTP ${response.status}`}: ${body?.message ?? "execution acceptance failed"}`);
  }
  return {
    executionId: body.execution.id,
    state: body.execution.state,
    replayed: Boolean(body.replayed),
  };
}

async function pollCommands() {
  while (!stopping) {
    try {
      const response = await fetch(`${api}/api/orchestrators/commands/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      if (response.status === 204) {
        await sleep(pollMs);
        continue;
      }
      const body = await responseJson(response);
      if (!response.ok) throw new Error(`${body?.error ?? `HTTP ${response.status}`}: ${body?.message ?? "claim failed"}`);
      const command = body.command;
      process.stdout.write(`Claimed command ${command.id}: ${command.kind} ${command.task_id} (${command.phase})\n`);
      while (!stopping) {
        try {
          const accepted = await acceptCommandExecution(command);
          process.stdout.write(
            `Accepted execution ${accepted.executionId} for command ${command.id}`
            + `${accepted.replayed ? " (replayed)" : ""}\n`,
          );
          break;
        } catch (error) {
          process.stderr.write(
            `Command ${command.id} acceptance uncertain: ${String(error.message ?? error).slice(0, 2048)}; `
            + "the central API remains settlement authority and the same acceptance key will be retried.\n",
          );
          await sleep(pollMs);
        }
      }
    } catch (error) {
      if (!stopping) {
        process.stderr.write(`orchestrator command poll failed: ${error.message}\n`);
        await sleep(pollMs);
      }
    }
  }
}

async function pollConversations() {
  while (!stopping) {
    try {
      const result = await conversationRuntime.runOnce();
      if (!result) await sleep(pollMs);
    } catch (error) {
      if (!stopping) {
        process.stderr.write(`orchestrator conversation poll failed: ${error.message}\n`);
        await sleep(pollMs);
      }
    }
  }
}

void pollCommands();
void pollConversations();

async function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  await conversationRuntime.close();
  await fetch(`${api}/api/orchestrators/lease`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => undefined);
  process.stdout.write(`Released project orchestrator lease after ${signal}.\n`);
  process.exit(exitCode);
}
process.on("SIGINT", () => void stop("SIGINT", 0));
process.on("SIGTERM", () => void stop("SIGTERM", 0));
