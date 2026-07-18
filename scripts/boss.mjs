#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import {
  assistantText,
  BossManClient,
  matchingLease,
  mutationSummary,
} from "../src/client/boss-client.mjs";

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(`usage:
  boss status [--api URL] [--json]
  boss topics [--api URL] [--json]
  boss chat (--topic ID | --project ID | --repo PATH | --new-topic TITLE)
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
  if (!command || command === "--help" || command === "-h" || !["status", "topics", "chat"].includes(command)) {
    usage(command ? `unknown command: ${command}` : null);
  }
  const options = {
    command,
    api: process.env.BOSS_MAN_API_URL ?? "http://127.0.0.1:4310",
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
  return options;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeFleet(fleet, api) {
  process.stdout.write(`Boss Man central API · ${api}
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
    process.stdout.write("No topics. Start one with: npm run boss -- chat --new-topic \"Topic title\"\n");
    return;
  }
  for (const topic of topics) {
    process.stdout.write(`${topic.id}  ${topic.title}
  ${topic.project_id ? `project:${topic.project_id}` : "system-intake"} · ${topic.conversation.state} · ${topic.turn_count} turns
  ${api}/#${topic.id}
`);
  }
}

function writeConversationHeader(state) {
  const { detail, lease, browserUrl } = state;
  process.stdout.write(`
Boss Man orchestrator conversation
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
const client = new BossManClient({ api: options.api });
try {
  if (options.command === "status") {
    const fleet = await client.fleet();
    if (options.json) writeJson(fleet);
    else writeFleet(fleet, client.api);
  } else if (options.command === "topics") {
    const fleet = await client.fleet();
    if (options.json) writeJson({ topics: fleet.topics });
    else writeTopics(fleet.topics, client.api);
  } else {
    await runChat(client, options);
  }
} catch (error) {
  process.stderr.write(`boss: ${error.message}\n`);
  process.exitCode = 1;
}
