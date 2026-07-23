#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import {
  assistantText,
  PinkGuyClient,
  matchingLease,
  mutationSummary,
} from "../src/client/pink-client.mjs";

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(`usage:
  pink status [--api URL] [--json]
  pink topics [--api URL] [--json]
  pink profiles [--api URL] [--json]
  pink models [--refresh] [--api URL] [--json]
  pink profile --key KEY [--prompt TEXT | --prompt-file PATH]
    [--expected-version N] [--api URL] [--json]
  pink model --topic ID --provider PROVIDER --model MODEL_ID --thinking LEVEL
    [--expected-version N] [--api URL] [--json]
  pink bind --topic ID --project ID [--expected-version N] [--api URL] [--json]
  pink import --repo-url URL [--name NAME] [--description TEXT]
    [--api URL] [--json]
  pink delete-project --project ID --confirm EXACT_NAME --reason TEXT
    [--api URL] [--json]
  pink dispatch --task ID --policy automatic|manual|paused [--priority -100..100]
    [--provider PROVIDER --model MODEL_ID --thinking LEVEL] [--expected-version N]
    [--api URL] [--json]
  pink attention [--project ID] [--api URL] [--json]
  pink recover --execution ID --action stop|pause|resume|retry|cancel --reason TEXT
    [--expected-version N] [--api URL] [--json]
  pink candidate --candidate ID --action accept|reject --reason TEXT
    [--expected-version N] [--api URL] [--json]
  pink git-policy --project ID [--mode prepare_only|local_integrate|pull_request
    --history merge_commit|squash|rebase --target BRANCH --remote NAME
    --allow-push [--allow-pr] --reason TEXT]
  pink integrate (--task ID --action prepare |
    --integration ID --action execute|cancel --reason TEXT)
  pink storage [--api URL] [--json]
  pink cleanup --task ID [--execute --reason TEXT] [--api URL] [--json]
  pink hold --project ID --scope-type TYPE --scope-id ID --reason TEXT
  pink hold --hold ID --action release --reason TEXT
  pink delete-session --session ID [--execute --confirm ID --reason TEXT]
  pink chat (--topic ID | --project ID | --repo PATH | --new-topic TITLE)
    [--description TEXT] [--message TEXT | --message-file PATH]
    [--no-wait] [--poll-ms 750] [--timeout-seconds 600] [--api URL] [--json]

With no --message, chat opens an interactive prompt in a terminal. Piped stdin
is submitted as one message. Use /refresh, /status, /help, or /exit while
interactive.
`);
  process.exit(message ? 64 : 0);
}

function parseArguments(argv) {
  const command = argv[0];
  if (command === "--help" || command === "-h") usage();
  if (
    !command
    || !["status", "topics", "profiles", "models", "profile", "model", "bind", "import", "delete-project", "dispatch", "attention", "recover", "candidate", "git-policy", "integrate", "storage", "cleanup", "hold", "delete-session", "chat"].includes(command)
  ) {
    usage(command ? `unknown command: ${command}` : null);
  }
  const options = {
    command,
    api: process.env.PINK_GUY_API_URL ?? process.env.BOSS_MAN_API_URL ?? "http://127.0.0.1:4310",
    pollMs: 750,
    timeoutMs: 10 * 60 * 1_000,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index] ?? usage(`missing value for ${argument}`);
    if (argument === "--api") options.api = value();
    else if (argument === "--json") options.json = true;
    else if (argument === "--topic") options.topicId = value();
    else if (argument === "--project") options.projectId = value();
    else if (argument === "--repo") options.repositoryPath = value();
    else if (argument === "--new-topic") options.newTopicTitle = value();
    else if (argument === "--description") options.description = value();
    else if (argument === "--message") options.message = value();
    else if (argument === "--message-file") options.messageFile = value();
    else if (argument === "--key") options.profileKey = value();
    else if (argument === "--prompt") options.prompt = value();
    else if (argument === "--prompt-file") options.promptFile = value();
    else if (argument === "--expected-version") options.expectedVersion = Number(value());
    else if (argument === "--provider") options.modelProvider = value();
    else if (argument === "--model") options.modelId = value();
    else if (argument === "--thinking") options.thinkingLevel = value();
    else if (argument === "--repo-url") options.repositoryUrl = value();
    else if (argument === "--name") options.projectName = value();
    else if (argument === "--confirm") options.confirmName = value();
    else if (argument === "--reason") options.reason = value();
    else if (argument === "--task") options.taskId = value();
    else if (argument === "--execution") options.executionId = value();
    else if (argument === "--candidate") options.candidateId = value();
    else if (argument === "--integration") options.integrationId = value();
    else if (argument === "--session") options.sessionId = value();
    else if (argument === "--hold") options.holdId = value();
    else if (argument === "--scope-type") options.scopeType = value();
    else if (argument === "--scope-id") options.scopeId = value();
    else if (argument === "--action") options.action = value();
    else if (argument === "--policy") options.dispatchPolicy = value();
    else if (argument === "--priority") options.priority = Number(value());
    else if (argument === "--mode") options.integrationMode = value();
    else if (argument === "--history") options.historyPolicy = value();
    else if (argument === "--target") options.targetBranch = value();
    else if (argument === "--remote") options.remoteName = value();
    else if (argument === "--allow-push") options.allowPush = true;
    else if (argument === "--allow-pr") options.allowPullRequest = true;
    else if (argument === "--execute") options.execute = true;
    else if (argument === "--refresh") options.refresh = true;
    else if (argument === "--no-wait") options.noWait = true;
    else if (argument === "--poll-ms") options.pollMs = Number(value());
    else if (argument === "--timeout-seconds") options.timeoutMs = Number(value()) * 1_000;
    else if (argument === "--help" || argument === "-h") usage();
    else usage(`unknown option: ${argument}`);
  }
  if (
    !Number.isInteger(options.pollMs) || options.pollMs < 100 || options.pollMs > 60_000
    || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000
  ) usage("poll and timeout values are outside their supported range");
  if (command === "profile" && !options.profileKey) usage("profile requires --key");
  if (
    command === "model"
    && (!options.topicId || !options.modelProvider || !options.modelId || !options.thinkingLevel)
  ) usage("model requires --topic, --provider, --model, and --thinking");
  if (command === "bind" && (!options.topicId || !options.projectId)) {
    usage("bind requires --topic and --project");
  }
  if (command === "import" && !options.repositoryUrl) usage("import requires --repo-url");
  if (
    command === "delete-project"
    && (!options.projectId || !options.confirmName || !options.reason)
  ) usage("delete-project requires --project, --confirm, and --reason");
  if (
    command === "dispatch"
    && (!options.taskId || !["automatic", "manual", "paused"].includes(options.dispatchPolicy))
  ) usage("dispatch requires --task and --policy automatic, manual, or paused");
  if (
    command === "dispatch"
    && options.priority !== undefined
    && (!Number.isInteger(options.priority) || options.priority < -100 || options.priority > 100)
  ) usage("dispatch priority must be an integer from -100 to 100");
  if (
    command === "dispatch"
    && [options.modelProvider, options.modelId, options.thinkingLevel].some(Boolean)
    && ![options.modelProvider, options.modelId, options.thinkingLevel].every(Boolean)
  ) usage("dispatch model override requires --provider, --model, and --thinking together");
  if (
    command === "recover"
    && (
      !options.executionId
      || !["stop", "pause", "resume", "retry", "cancel"].includes(options.action)
      || !options.reason
    )
  ) usage("recover requires --execution, a valid --action, and --reason");
  if (
    command === "candidate"
    && (
      !options.candidateId
      || !["accept", "reject"].includes(options.action)
      || !options.reason
    )
  ) usage("candidate requires --candidate, accept|reject --action, and --reason");
  if (
    command === "integrate"
    && !(
      (options.action === "prepare" && options.taskId && !options.integrationId)
      || (["execute", "cancel"].includes(options.action)
        && options.integrationId && !options.taskId && options.reason)
    )
  ) usage("integrate requires --task with prepare, or --integration with execute|cancel and --reason");
  if (command === "git-policy" && !options.projectId) usage("git-policy requires --project");
  if (
    command === "git-policy"
    && options.integrationMode
    && (
      !["prepare_only", "local_integrate", "pull_request"].includes(options.integrationMode)
      || !["merge_commit", "squash", "rebase"].includes(options.historyPolicy)
      || !options.targetBranch
      || !options.reason
    )
  ) usage("updating git-policy requires valid --mode, --history, --target, and --reason");
  if (command === "cleanup" && (!options.taskId || (options.execute && !options.reason))) {
    usage("cleanup requires --task; --execute also requires --reason");
  }
  if (
    command === "hold"
    && !(
      (options.holdId && options.action === "release" && options.reason)
      || (options.projectId && options.scopeType && options.scopeId && options.reason)
    )
  ) usage("hold requires a project/scope/reason, or --hold ID --action release --reason");
  if (
    command === "delete-session"
    && (!options.sessionId || (options.execute && (!options.confirmName || !options.reason)))
  ) usage("delete-session requires --session; --execute also requires --confirm and --reason");
  if (options.prompt && options.promptFile) usage("choose --prompt or --prompt-file");
  if (
    options.expectedVersion !== undefined
    && (!Number.isInteger(options.expectedVersion) || options.expectedVersion < 1)
  ) usage("expected version must be a positive integer");
  return options;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeFleet(fleet, api) {
  process.stdout.write(`Pink Guy central API · ${api}
Exposure: ${fleet.health.exposure}
Projects: ${fleet.projects.length}
Topics: ${fleet.topics.length}
Active conversation orchestrators: ${fleet.leases.filter((lease) => lease.status === "active").length}
`);
  for (const lease of fleet.leases) {
    process.stdout.write(
      `  ${lease.scope_type}:${lease.scope_id} · ${lease.status} · ${lease.transport} · ${lease.endpoint}\n`,
    );
  }
}

function writeTopics(topics, api) {
  if (!topics.length) {
    process.stdout.write("No topics. Start one with: npm run pink -- chat --new-topic \"Topic title\"\n");
    return;
  }
  for (const topic of topics) {
    process.stdout.write(`${topic.id}  ${topic.title}
  ${topic.project_id ? `project:${topic.project_id}` : "system-intake"} · ${topic.conversation.state} · ${topic.turn_count} turns
  ${api}/#${topic.id}
`);
  }
}

function writeProfiles(profiles) {
  for (const profile of profiles) {
    process.stdout.write(
      `${profile.profile_key}  ${profile.display_name} · ${profile.role} · v${profile.active_version}`
      + ` · ${profile.prompt_sha256.slice(0, 12)}…\n`,
    );
  }
}

function writeModels(catalog) {
  if (catalog.status !== "available") {
    process.stdout.write(
      `Model catalog: ${catalog.status}\n`
      + `${catalog.error?.message || "No configured models were discovered."}\n`,
    );
  }
  for (const provider of catalog.providers) {
    process.stdout.write(
      `${provider.id} · ${provider.model_count} models · ${provider.auth_type}\n`,
    );
    for (const model of catalog.models.filter((item) => item.provider === provider.id)) {
      process.stdout.write(
        `  ${model.id} · ${model.context_window} context · ${model.max_output} max output`
        + `${model.supports_thinking ? " · thinking" : ""}`
        + `${model.supports_images ? " · images" : ""}\n`,
      );
    }
  }
  process.stdout.write(
    `\nTo add a subscription or API-key provider on the Pink Guy host:\n`
    + `  ${catalog.authentication.command}\n`
    + "  /login\n"
    + "Then run: npm run pink -- models --refresh\n",
  );
}

function writeProfile(profile) {
  process.stdout.write(`${profile.display_name}
Key: ${profile.profile_key}
Role: ${profile.role}
Active revision: v${profile.active_version}
SHA-256: ${profile.prompt_sha256}
Updated: ${profile.updated_at}

${profile.prompt_text}

New or restarted Pi processes use this revision; running processes keep their pinned prompt.
`);
}

async function runProfile(client, options) {
  const current = await client.agentProfile(options.profileKey);
  let prompt = options.prompt;
  if (options.promptFile) prompt = await readFile(options.promptFile, "utf8");
  if (prompt === undefined) {
    if (options.json) writeJson(current);
    else writeProfile(current);
    return;
  }
  const result = await client.updateAgentProfile(
    options.profileKey,
    prompt,
    options.expectedVersion ?? current.active_version,
  );
  if (options.json) writeJson(result);
  else {
    process.stdout.write(
      `Saved ${result.profile.profile_key} v${result.profile.active_version}`
      + ` (${result.profile.prompt_sha256.slice(0, 12)}…).\n`
      + "It applies at the next Pi process start.\n",
    );
  }
}

async function runModelSwitch(client, options) {
  const detail = await client.topicDetail(options.topicId);
  const result = await client.switchConversationModel(detail.conversation.id, {
    modelProvider: options.modelProvider,
    modelId: options.modelId,
    thinkingLevel: options.thinkingLevel,
    expectedVersion: options.expectedVersion ?? detail.conversation.version,
  });
  if (options.json) {
    writeJson(result);
    return;
  }
  process.stdout.write(
    `Saved custody snapshot ${result.change.custody_snapshot_id}.\n`
    + `Conversation now uses ${result.change.new_route.modelProvider}/`
    + `${result.change.new_route.modelId} (${result.change.new_route.thinkingLevel}).\n`
    + "The orchestrator restarts the durable Pi session before processing the next turn.\n",
  );
}

async function runTopicBind(client, options) {
  const detail = await client.topicDetail(options.topicId);
  const result = await client.bindTopicToProject(options.topicId, {
    projectId: options.projectId,
    expectedVersion: options.expectedVersion ?? detail.conversation.version,
  });
  if (options.json) {
    writeJson(result);
    return;
  }
  process.stdout.write(
    `Saved custody snapshot ${result.binding.custody_snapshot_id}.\n`
    + `Topic now belongs to project ${result.binding.project_id}.\n`
    + "The project orchestrator resumes the same native Pi session on its next turn.\n",
  );
}

async function runImport(client, options) {
  const imported = await client.importProject(options.repositoryUrl, { name: options.projectName });
  const detail = await client.resolveTopic({
    projectId: imported.project.id,
    description: options.description ?? null,
  });
  const result = {
    project: imported.project,
    topic: detail.topic,
    conversation: detail.conversation,
    browserUrl: `${client.api}/#${detail.topic.id}`,
    reused: Boolean(imported.replayed),
  };
  if (options.json) {
    writeJson(result);
    return;
  }
  process.stdout.write(`Project: ${result.project.name}
Repository: ${result.project.repository_path}
Topic: ${result.topic.id}
Browser: ${result.browserUrl}
Terminal: npm run pink -- chat --topic ${result.topic.id}
`);
}

async function runProjectDelete(client, options) {
  const result = await client.deleteProject(options.projectId, {
    confirmName: options.confirmName,
    reason: options.reason,
  });
  if (options.json) {
    writeJson(result);
    return;
  }
  process.stdout.write(
    result.cleanupPending
      ? `Project tombstoned; checkout cleanup remains pending (${result.receipt.id}).\n`
      : `Project deleted safely; retained receipt ${result.receipt.id}.\n`,
  );
}

async function runDispatch(client, options) {
  const current = await client.taskDetail(options.taskId);
  let operation;
  if (options.dispatchPolicy === "automatic") operation = "release";
  else if (options.dispatchPolicy === "paused") operation = "pause_dispatch";
  else operation = "manualize_dispatch";
  const result = await client.setTaskDispatch(options.taskId, {
    operation,
    expectedVersion: options.expectedVersion ?? current.version,
    priority: options.priority ?? null,
    modelProvider: options.modelProvider ?? null,
    modelId: options.modelId ?? null,
    thinkingLevel: options.thinkingLevel ?? null,
  });
  if (options.json) {
    writeJson(result);
    return;
  }
  const task = result.task;
  const dispatch = result.dispatch;
  const queue = result.queue;
  process.stdout.write(
    `${task.title}\n`
    + `Dispatch: ${task.dispatch_policy} · priority ${task.priority}\n`
    + (queue?.rank ? `Queue: #${queue.rank}\n` : "")
    + (queue?.blockers?.length
      ? `Blockers: ${queue.blockers.map((value) => value.replaceAll("_", " ")).join(", ")}\n`
      : "")
    + (dispatch?.scheduled
      ? `Scheduled implementation command ${dispatch.command.id}.\n`
      : dispatch
        ? `Waiting: ${String(dispatch.reason).replaceAll("_", " ")}.\n`
        : ""),
  );
}

function writeAttention(attention, integrations = []) {
  if (!attention.length && !integrations.length) {
    process.stdout.write("No execution or Git integration requires attention.\n");
    return;
  }
  for (const item of attention) {
    const execution = item.execution;
    process.stdout.write(
      `${item.task?.title ?? execution.task_id}\n`
      + `  ${execution.state} · ${execution.phase} · ${execution.id}\n`
      + `  last activity ${execution.last_activity_at}`
      + `${execution.failure_class ? ` · ${execution.failure_class}` : ""}\n`
      + `  actions: ${item.allowed_actions.join(", ") || "none"}`
      + ` · candidates: ${item.recovery_candidates.length}\n`,
    );
  }
  for (const item of integrations) {
    const integration = item.integration;
    process.stdout.write(
      `${item.task?.title ?? integration.task_id}\n`
      + `  Git ${integration.state} · ${integration.history_policy} · ${integration.id}\n`
      + `  ${integration.target_branch}@${integration.target_revision}\n`
      + `  blockers: ${item.gate_evaluation?.reasons?.join(", ") || "none"}`
      + ` · receipts: ${item.action_receipts?.length ?? 0}\n`
      + `  actions: ${item.allowed_actions.join(", ") || "none"}\n`,
    );
  }
}

async function runRecovery(client, options) {
  const attention = await client.recoveryAttention(options.projectId ?? null);
  const item = attention.find((candidate) => candidate.execution.id === options.executionId);
  if (!item) throw new Error(`execution is not in recovery attention: ${options.executionId}`);
  const result = await client.actOnExecution(options.executionId, {
    action: options.action,
    expectedVersion: options.expectedVersion ?? item.execution.version,
    reason: options.reason,
  });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Execution ${options.executionId}: ${result.execution.state} (${options.action}).\n`,
  );
}

async function runCandidateResolution(client, options) {
  const attention = await client.recoveryAttention(options.projectId ?? null);
  const candidate = attention.flatMap((item) => item.recovery_candidates)
    .find((item) => item.id === options.candidateId);
  if (!candidate) throw new Error(`candidate is not in recovery attention: ${options.candidateId}`);
  const result = await client.resolveRecoveryCandidate(options.candidateId, {
    action: options.action,
    expectedVersion: options.expectedVersion ?? candidate.version,
    reason: options.reason,
  });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Recovery candidate ${options.candidateId}: ${result.candidate.state}.\n`,
  );
}

async function runGitPolicy(client, options) {
  const current = await client.gitPolicy(options.projectId);
  if (!options.integrationMode) {
    if (options.json) writeJson({ policy: current });
    else {
      process.stdout.write(
        `Project ${options.projectId}\n`
        + `Mode: ${current.mode}\n`
        + `History: ${current.history_policy}\n`
        + `Target: ${current.target_branch}\n`
        + `Remote: ${current.remote_name}\n`
        + `Push: ${current.allow_push ? "enabled" : "disabled"} · PR: ${current.allow_pull_request ? "enabled" : "disabled"}\n`
        + `Policy version: ${current.version}\n`,
      );
    }
    return;
  }
  const result = await client.updateGitPolicy(options.projectId, {
    mode: options.integrationMode,
    historyPolicy: options.historyPolicy,
    targetBranch: options.targetBranch,
    remoteName: options.remoteName ?? current.remote_name,
    allowPush: Boolean(options.allowPush),
    allowPullRequest: Boolean(options.allowPullRequest),
    allowedTargetBranches: [options.targetBranch],
    expectedVersion: options.expectedVersion ?? current.version,
    reason: options.reason,
  });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Git policy updated to ${result.policy.mode}/${result.policy.history_policy} `
    + `for ${result.policy.target_branch} (v${result.policy.version}).\n`,
  );
}

async function runIntegration(client, options) {
  if (options.action === "prepare") {
    const result = await client.prepareIntegration(options.taskId);
    if (options.json) writeJson(result);
    else process.stdout.write(
      `Integration ${result.integration.id}: ${result.integration.state}\n`
      + `Source: ${result.integration.source_revision}\n`
      + `Target: ${result.integration.target_branch}@${result.integration.target_revision}\n`
      + `Mode: ${result.integration.mode} · history: ${result.integration.history_policy}\n`,
    );
    return;
  }
  const current = await client.integration(options.integrationId);
  const expectedVersion = options.expectedVersion
    ?? current.version;
  const result = await client.actOnIntegration(options.integrationId, {
    action: options.action,
    expectedVersion,
    reason: options.reason,
  });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Integration ${options.integrationId}: ${result.integration.state}`
    + `${result.integration.result_revision ? ` · ${result.integration.result_revision}` : ""}\n`,
  );
}

async function runStorage(client, options) {
  const inventory = await client.storageInventory();
  if (options.json) {
    writeJson({ inventory });
    return;
  }
  process.stdout.write(
    `Pink Guy state: ${inventory.totalBytes} bytes across ${inventory.fileCount} files\n`
    + `${Object.entries(inventory.categories)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, bytes]) => `  ${category}: ${bytes} bytes`)
      .join("\n")}\n`
    + `Pressure: ${inventory.hardBlocked ? "hard limit" : inventory.warning ? "warning" : "normal"}\n`,
  );
}

async function runCleanup(client, options) {
  const preview = await client.taskCleanupPreview(options.taskId);
  if (!options.execute) {
    if (options.json) writeJson({ preview });
    else {
      process.stdout.write(
        `Cleanup preview ${preview.previewSha256}\n`
        + `${preview.resources.map((resource) =>
          `  ${resource.workspaceId} · ${resource.phase} · `
          + `${resource.eligible ? "eligible" : `blocked: ${resource.blockers.join(", ")}`}`
        ).join("\n")}\n`,
      );
    }
    return;
  }
  const result = await client.executeTaskCleanup(options.taskId, {
    previewSha256: preview.previewSha256,
    reason: options.reason,
  });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Cleanup ${result.operation.id}: ${result.operation.state}\n`,
  );
}

async function runHold(client, options) {
  const result = options.holdId
    ? await client.releaseRetentionHold(options.holdId, options.reason)
    : await client.createRetentionHold({
      projectId: options.projectId,
      scopeType: options.scopeType,
      scopeId: options.scopeId,
      reason: options.reason,
    });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Retention hold ${result.hold.id}: ${result.hold.active ? "active" : "released"}.\n`,
  );
}

async function runSessionDelete(client, options) {
  const preview = await client.sessionDeletionPreview(options.sessionId);
  if (!options.execute) {
    if (options.json) writeJson({ preview });
    else process.stdout.write(
      `Session ${options.sessionId}: ${preview.eligible ? "eligible" : "blocked"}\n`
      + `${preview.blockers.length ? `Blockers: ${preview.blockers.join(", ")}\n` : ""}`
      + `Paths: ${preview.paths.length}\n`
      + `Preview: ${preview.previewSha256}\n`,
    );
    return;
  }
  const result = await client.deleteSessionArtifacts(options.sessionId, {
    confirmSessionId: options.confirmName,
    previewSha256: preview.previewSha256,
    reason: options.reason,
  });
  if (options.json) writeJson(result);
  else process.stdout.write(
    `Session deletion ${result.receipt.id}: ${result.receipt.state}; `
    + `manifest ${result.receipt.manifest_path ?? "pending"}.\n`,
  );
}

function writeConversationHeader(state) {
  const { detail, lease, browserUrl } = state;
  process.stdout.write(`
Pink Guy orchestrator conversation
Topic: ${detail.topic.title}
Scope: ${detail.conversation.scope_type}:${detail.conversation.scope_id}
Model: ${detail.conversation.model_provider}/${detail.conversation.model_id} (${detail.conversation.thinking_level})
Conversation: ${detail.conversation.id}
Orchestrator: ${lease ? `online · ${lease.transport} · ${lease.endpoint}` : "offline · messages remain queued"}
Browser: ${browserUrl}
`);
}

function writeHistory(detail, events) {
  if (!detail.turns.length) {
    process.stdout.write("\nNo turns yet.\n");
    return;
  }
  process.stdout.write("\nDurable history\n");
  for (const turn of detail.turns) {
    process.stdout.write(`\nowner [${turn.sequence}]> ${turn.owner_message}\n`);
    const text = assistantText(turn, events);
    process.stdout.write(text ? `pi [${turn.state}]> ${text}\n` : `pi [${turn.state}]>\n`);
  }
  const mutations = events.filter((event) => event.type === "task_mutation_applied");
  if (mutations.length) {
    process.stdout.write("\nStructured task changes\n");
    for (const event of mutations) process.stdout.write(`  - ${mutationSummary(event)}\n`);
  }
}

async function submitAndFollow(client, detail, message, options) {
  const before = await client.topicEvents(detail.conversation.id);
  const after = before.at(-1)?.sequence ?? 0;
  const submitted = await client.submit(detail.conversation.id, message);
  if (options.noWait || !options.lease) {
    if (options.json) {
      writeJson({ ...submitted, orchestratorOnline: Boolean(options.lease) });
      return submitted.turn;
    }
    process.stdout.write(`owner [${submitted.turn.sequence}]> ${message}\n`);
    process.stdout.write(
      `pi [queued]> message retained${options.lease ? "" : "; orchestrator is offline"}\n`,
    );
    return submitted.turn;
  }
  if (options.json) {
    const followed = await client.followTurn(detail, submitted.turn.id, {
      after,
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs,
    });
    writeJson({ turn: followed.turn, orchestratorOnline: true });
    if (["failed", "reconciliation_required"].includes(followed.turn.state)) {
      process.exitCode = 1;
    }
    return followed.turn;
  }
  process.stdout.write(`owner [${submitted.turn.sequence}]> ${message}\n`);

  let printedText = false;
  const printedMutations = [];
  process.stdout.write("pi> ");
  const followed = await client.followTurn(detail, submitted.turn.id, {
    after,
    pollMs: options.pollMs,
    timeoutMs: options.timeoutMs,
    onEvent(event) {
      if (event.type === "pi_text_delta") {
        printedText = true;
        process.stdout.write(event.payload?.delta ?? "");
      } else if (event.type === "task_mutation_applied") {
        printedMutations.push(mutationSummary(event));
      }
    },
  });
  if (!printedText && followed.turn.result?.assistantText) {
    process.stdout.write(followed.turn.result.assistantText);
  }
  process.stdout.write(`\n[${followed.turn.state}]\n`);
  for (const mutation of printedMutations) process.stdout.write(`  task change · ${mutation}\n`);
  if (followed.turn.state === "failed" || followed.turn.state === "reconciliation_required") {
    process.exitCode = 1;
  }
  return followed.turn;
}

async function readPipedStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function runChat(client, options) {
  const selectors = [options.topicId, options.projectId, options.repositoryPath, options.newTopicTitle]
    .filter(Boolean);
  if (selectors.length !== 1) usage("chat requires exactly one topic/project/repository selector");
  if (options.message && options.messageFile) usage("choose --message or --message-file");

  const detail = await client.resolveTopic(options);
  let state = await client.conversationState(detail);
  options.lease = state.lease;
  if (!options.json) {
    writeConversationHeader(state);
    writeHistory(state.detail, state.events);
  }

  let message = options.message;
  if (options.messageFile) message = (await readFile(options.messageFile, "utf8")).trim();
  if (!message && !process.stdin.isTTY) {
    message = await readPipedStdin();
    if (!message) {
      throw new Error("interactive chat requires a terminal; provide --message, --message-file, or piped input");
    }
  }
  if (message) {
    if (message.length > 32_000) throw new Error("owner message exceeds 32000 characters");
    return submitAndFollow(client, state.detail, message, options);
  }
  if (options.json) usage("--json chat requires a one-shot message");

  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const line = (await input.question("\nyou> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") {
        process.stdout.write("/refresh  reload durable history\n/status   show scope and orchestrator lease\n/exit     leave the client without stopping Pi\n");
        continue;
      }
      if (line === "/refresh") {
        state = await client.conversationState(await client.topicDetail(detail.topic.id));
        writeHistory(state.detail, state.events);
        continue;
      }
      if (line === "/status") {
        state = await client.conversationState(await client.topicDetail(detail.topic.id));
        writeConversationHeader(state);
        continue;
      }
      state = await client.conversationState(await client.topicDetail(detail.topic.id));
      options.lease = matchingLease(state.detail.conversation, state.lease ? [state.lease] : []);
      await submitAndFollow(client, state.detail, line, options);
    }
  } finally {
    input.close();
  }
}

const options = parseArguments(process.argv.slice(2));
const client = new PinkGuyClient({ api: options.api });
try {
  if (options.command === "status") {
    const fleet = await client.fleet();
    if (options.json) writeJson(fleet);
    else writeFleet(fleet, client.api);
  } else if (options.command === "topics") {
    const fleet = await client.fleet();
    if (options.json) writeJson({ topics: fleet.topics });
    else writeTopics(fleet.topics, client.api);
  } else if (options.command === "profiles") {
    const profiles = await client.agentProfiles();
    if (options.json) writeJson({ profiles });
    else writeProfiles(profiles);
  } else if (options.command === "models") {
    const catalog = await client.providerCatalog({ refresh: Boolean(options.refresh) });
    if (options.json) writeJson(catalog);
    else writeModels(catalog);
  } else if (options.command === "profile") {
    await runProfile(client, options);
  } else if (options.command === "model") {
    await runModelSwitch(client, options);
  } else if (options.command === "bind") {
    await runTopicBind(client, options);
  } else if (options.command === "import") {
    await runImport(client, options);
  } else if (options.command === "delete-project") {
    await runProjectDelete(client, options);
  } else if (options.command === "dispatch") {
    await runDispatch(client, options);
  } else if (options.command === "attention") {
    const [attention, integrations] = await Promise.all([
      client.recoveryAttention(options.projectId ?? null),
      client.integrationAttention(options.projectId ?? null),
    ]);
    if (options.json) writeJson({ attention, integrations });
    else writeAttention(attention, integrations);
  } else if (options.command === "recover") {
    await runRecovery(client, options);
  } else if (options.command === "candidate") {
    await runCandidateResolution(client, options);
  } else if (options.command === "git-policy") {
    await runGitPolicy(client, options);
  } else if (options.command === "integrate") {
    await runIntegration(client, options);
  } else if (options.command === "storage") {
    await runStorage(client, options);
  } else if (options.command === "cleanup") {
    await runCleanup(client, options);
  } else if (options.command === "hold") {
    await runHold(client, options);
  } else if (options.command === "delete-session") {
    await runSessionDelete(client, options);
  } else {
    await runChat(client, options);
  }
} catch (error) {
  process.stderr.write(`pink: ${error.message}\n`);
  process.exitCode = 1;
}
