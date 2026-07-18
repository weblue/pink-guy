#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConversationOrchestratorRuntime } from "../direct/conversation-runtime.mjs";

function usage() {
  console.error(`usage: node phase0/scripts/conversation-orchestrator.mjs
  --api http://127.0.0.1:4310
  --state-root /absolute/state
  (--system-intake | --project-id PROJECT_ID)
  [--pi-command pi] [--credential-source /absolute/pi-auth.json]
  [--lease-seconds 90] [--poll-ms 1000]`);
  process.exit(64);
}

let api;
let stateRoot;
let scopeType;
let scopeId;
let piCommand = "pi";
let credentialSource;
let leaseSeconds = 90;
let pollMs = 1_000;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--api") api = process.argv[++index];
  else if (argument === "--state-root") stateRoot = resolve(process.argv[++index] ?? usage());
  else if (argument === "--system-intake") scopeType = "system_intake";
  else if (argument === "--project-id") {
    scopeType = "project";
    scopeId = process.argv[++index];
  } else if (argument === "--pi-command") piCommand = process.argv[++index];
  else if (argument === "--credential-source") credentialSource = resolve(process.argv[++index] ?? usage());
  else if (argument === "--lease-seconds") leaseSeconds = Number(process.argv[++index]);
  else if (argument === "--poll-ms") pollMs = Number(process.argv[++index]);
  else usage();
}
if (
  !api || !stateRoot || !scopeType || (scopeType === "project" && !scopeId)
  || !Number.isInteger(leaseSeconds) || !Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000
) usage();

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const runtime = new ConversationOrchestratorRuntime({
  api,
  scopeType,
  scopeId,
  stateRoot,
  piCommand,
  credentialSource,
  piExtension: resolve(moduleDirectory, "../pi/orchestrator-extension.ts"),
  leaseSeconds,
  pollMs,
});
let stopping = false;

async function loop() {
  await runtime.register();
  process.stdout.write(
    `Conversation orchestrator registered: ${scopeType}${scopeId ? `:${scopeId}` : ""} via Pi RPC\n`,
  );
  while (!stopping) {
    try {
      const result = await runtime.runOnce();
      if (!result) await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    } catch (error) {
      if (!stopping) {
        process.stderr.write(`conversation turn failed: ${error.message}\n`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
      }
    }
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await runtime.close();
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
await loop();
await runtime.close();
