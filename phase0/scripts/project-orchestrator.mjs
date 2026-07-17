#!/usr/bin/env node

import { resolve } from "node:path";

function usage() {
  console.error(`usage: node phase0/scripts/project-orchestrator.mjs --api http://127.0.0.1:4310
  (--project-id PROJECT_ID | --repo /absolute/repository) [--lease-seconds 90]`);
  process.exit(64);
}

let api;
let projectId;
let repositoryPath;
let leaseSeconds = 90;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--api") api = process.argv[++index];
  else if (argument === "--project-id") projectId = process.argv[++index];
  else if (argument === "--repo") repositoryPath = resolve(process.argv[++index] ?? usage());
  else if (argument === "--lease-seconds") leaseSeconds = Number(process.argv[++index]);
  else usage();
}
if (!api || (!projectId && !repositoryPath) || !Number.isInteger(leaseSeconds)) usage();
api = api.replace(/\/$/, "");

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
