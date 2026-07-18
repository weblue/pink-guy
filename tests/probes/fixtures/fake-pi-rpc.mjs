#!/usr/bin/env node

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const sessionDirectory = argument("--session-dir") ?? process.cwd();
const sessionId = argument("--session-id") ?? "resumed-session";
const suppliedSession = argument("--session");
mkdirSync(sessionDirectory, { recursive: true });
const sessionFile = suppliedSession ?? join(sessionDirectory, `${sessionId}.jsonl`);
writeFileSync(sessionFile, "", { flag: "a" });
appendFileSync(sessionFile, `${JSON.stringify({
  type: "startup",
  provider: argument("--provider"),
  model: argument("--model"),
  thinking: argument("--thinking"),
  systemPrompt: argument("--system-prompt"),
})}\n`);
let promptCount = 0;
let buffer = "";

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function response(command, id, data = undefined) {
  send({ type: "response", command, success: true, ...(id ? { id } : {}), ...(data === undefined ? {} : { data }) });
}

function consume(command) {
  if (command.type === "get_state") {
    return response("get_state", command.id, {
      model: { provider: argument("--provider"), id: argument("--model") },
      thinkingLevel: argument("--thinking"),
      isStreaming: false,
      sessionFile,
      sessionId,
      messageCount: promptCount * 2,
      pendingMessageCount: 0,
    });
  }
  if (command.type === "prompt") {
    promptCount += 1;
    appendFileSync(sessionFile, `${JSON.stringify({ type: "received_prompt", message: command.message })}\n`);
    response("prompt", command.id);
    const text = `Planned owner turn ${promptCount}: ${command.message}`;
    send({ type: "agent_start" });
    send({ type: "turn_start" });
    send({ type: "message_start", message: { role: "assistant", content: [] } });
    send({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text }] },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
    });
    send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
    send({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text }] }, toolResults: [] });
    send({ type: "agent_end", messages: [], willRetry: false });
    send({ type: "agent_settled" });
    return;
  }
  if (command.type === "get_last_assistant_text") {
    return response("get_last_assistant_text", command.id, {
      text: `Planned owner turn ${promptCount}`,
    });
  }
  if (command.type === "get_session_stats") {
    return response("get_session_stats", command.id, {
      sessionFile,
      sessionId,
      tokens: { input: promptCount * 10, output: promptCount * 5, total: promptCount * 15 },
      cost: 0,
      contextUsage: { tokens: promptCount * 15, contextWindow: 1000, percent: promptCount * 1.5 },
    });
  }
  response(command.type, command.id);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const boundary = buffer.indexOf("\n");
    if (boundary < 0) break;
    const line = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 1);
    if (line.trim()) consume(JSON.parse(line));
  }
});
