#!/usr/bin/env node

import { resolve } from "node:path";

function usage() {
  console.error(`usage: node phase0/scripts/project-orchestrator.mjs --api http://127.0.0.1:4310
  (--project-id PROJECT_ID | --repo /absolute/repository) [--lease-seconds 90] [--poll-ms 1000]`);
  process.exit(64);
}

let api;
let projectId;
let repositoryPath;
let leaseSeconds = 90;
let pollMs = 1000;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--api") api = process.argv[++index];
  else if (argument === "--project-id") projectId = process.argv[++index];
  else if (argument === "--repo") repositoryPath = resolve(process.argv[++index] ?? usage());
  else if (argument === "--lease-seconds") leaseSeconds = Number(process.argv[++index]);
  else if (argument === "--poll-ms") pollMs = Number(process.argv[++index]);
  else usage();
}
if (
  !api || (!projectId && !repositoryPath) || !Number.isInteger(leaseSeconds)
  || !Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000
) usage();
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

let stopping = false;
const heartbeat = setInterval(async () => {
  try {
    const response = await fetch(`${api}/api/orchestrators/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ leaseSeconds }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    process.stderr.write(`orchestrator heartbeat failed: ${error.message}\n`);
  }
}, Math.max(5, Math.floor(leaseSeconds / 3)) * 1000);

async function completeCommand(command, state, result) {
  const response = await fetch(`${api}/api/orchestrators/commands/${command.id}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state, result }),
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`${body?.error ?? `HTTP ${response.status}`}: ${body?.message ?? "command completion failed"}`);
}

async function executeCommand(command) {
  if (command.kind !== "start_task") throw new Error(`unsupported command kind: ${command.kind}`);
  const response = await fetch(`${api}/api/tasks/${command.task_id}/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ phase: command.phase }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(`${body?.error ?? `HTTP ${response.status}`}: ${body?.message ?? "task session start failed"}`);
  }
  return {
    sessionId: body?.session?.id ?? null,
    runId: body?.run?.id ?? null,
    phase: command.phase,
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
      try {
        const result = await executeCommand(command);
        await completeCommand(command, "succeeded", result);
        process.stdout.write(`Completed command ${command.id}: succeeded\n`);
      } catch (error) {
        const result = { name: error.name ?? "Error", message: String(error.message ?? error).slice(0, 2048) };
        await completeCommand(command, "failed", result);
        process.stderr.write(`Completed command ${command.id}: failed: ${result.message}\n`);
      }
    } catch (error) {
      if (!stopping) {
        process.stderr.write(`orchestrator command poll failed: ${error.message}\n`);
        await sleep(pollMs);
      }
    }
  }
}

void pollCommands();

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  await fetch(`${api}/api/orchestrators/lease`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => undefined);
  process.stdout.write(`Released project orchestrator lease after ${signal}.\n`);
  process.exit(0);
}
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
