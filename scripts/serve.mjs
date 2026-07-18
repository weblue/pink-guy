#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DirectControlPlane } from "../src/server/control-plane.mjs";
import { loadModelRoutePolicy, publicModelRoutePolicy } from "../src/server/model-routes.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error(`usage: node scripts/serve.mjs --repo /absolute/repository [--repo /another/repository]
  [--state /absolute/state-directory] [--port 4310]
  [--model-config /absolute/model-routes.json]
  [--provider openai-codex] [--model gpt-5.4-mini] [--thinking medium]
  [--credential-source /absolute/pi-auth.json]`);
  process.exit(64);
}

function identifier(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

const repositories = [];
let stateRoot = join(homedir(), ".local", "share", "boss-man", "dev");
let port = 4310;
let modelConfig = resolve(moduleDirectory, "../config/model-routes.json");
let runtimeProvider;
let runtimeModel;
let runtimeThinking;
let credentialSource;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--repo") repositories.push(resolve(process.argv[++index] ?? usage()));
  else if (argument === "--state") stateRoot = resolve(process.argv[++index] ?? usage());
  else if (argument === "--port") port = Number(process.argv[++index] ?? usage());
  else if (argument === "--model-config") modelConfig = resolve(process.argv[++index] ?? usage());
  else if (argument === "--provider") runtimeProvider = process.argv[++index] ?? usage();
  else if (argument === "--model") runtimeModel = process.argv[++index] ?? usage();
  else if (argument === "--thinking") runtimeThinking = process.argv[++index] ?? usage();
  else if (argument === "--credential-source") credentialSource = resolve(process.argv[++index] ?? usage());
  else usage();
}
if (
  repositories.length === 0 || !Number.isInteger(port) || port < 1 || port > 65535
  || (runtimeThinking && !["off", "minimal", "low", "medium", "high", "xhigh"].includes(runtimeThinking))
) usage();
const modelRoutePolicy = await loadModelRoutePolicy(modelConfig, {
  provider: runtimeProvider,
  model: runtimeModel,
  thinking: runtimeThinking,
});
const configuredRoutes = publicModelRoutePolicy(modelRoutePolicy);

for (const repository of repositories) {
  const topLevel = execFileSync("git", ["-C", repository, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (resolve(topLevel) !== repository) {
    throw new Error(`--repo must name a Git worktree root: ${repository}`);
  }
}

await mkdir(stateRoot, { recursive: true, mode: 0o700 });
const authority = new DirectControlPlane({
  databasePath: join(stateRoot, "boss-man.sqlite"),
  stateRoot,
  fixturePath: repositories[0],
  enforceOrchestratorLease: true,
  runtimeProvider: modelRoutePolicy.default.provider,
  runtimeModel: modelRoutePolicy.default.model,
  runtimeThinking: modelRoutePolicy.default.thinking,
  modelRoutePolicy,
  runtimeOffline: false,
  credentialProfile: credentialSource ? {
    id: "task-agent-default",
    authType: "oauth_snapshot",
    billingMode: modelRoutePolicy.default.billingClass,
    sourcePath: credentialSource,
    maxConcurrentRuns: 1,
  } : null,
});
for (const repositoryPath of repositories) {
  const projectId = identifier("project", repositoryPath);
  authority.seed({
    projectId,
    repositoryId: identifier("repository", repositoryPath),
    projectName: basename(repositoryPath),
    taskId: identifier("intake", repositoryPath),
    taskKind: "intake",
    tags: ["intake", "bootstrap"],
    repositoryPath,
    title: `Audit ${basename(repositoryPath)} and define the next task`,
    revision: execFileSync("git", ["-C", repositoryPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    acceptanceCriteria: [
      "Human approves any high-risk or hard-to-change architectural decision.",
      "Task agent runs are phase-scoped to implementation, test, or review.",
    ],
  });
}

const address = await authority.listen(port, "127.0.0.1");
const url = `http://127.0.0.1:${address.port}`;
process.stdout.write(`Boss Man central API is serving at ${url}
State: ${stateRoot}
Projects: ${repositories.length}
Default model: ${configuredRoutes.default.provider}/${configuredRoutes.default.model} (${configuredRoutes.default.thinking})
Model routes: ${modelConfig}
Task credentials: ${credentialSource ?? "none (local/no-auth routes only)"}
Exposure: localhost only (local smoke profile; no application authentication)
Execution: register one project-orchestrator lease through the central API before starting a task session
Stop: Ctrl-C
`);

let closing = false;
async function close(signal) {
  if (closing) return;
  closing = true;
  process.stdout.write(`Received ${signal}; closing Boss Man.\n`);
  await authority.close();
  process.exit(0);
}
process.on("SIGINT", () => void close("SIGINT"));
process.on("SIGTERM", () => void close("SIGTERM"));
