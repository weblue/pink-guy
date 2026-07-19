import { createHash } from "node:crypto";
import { access, appendFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

let snapshotSequence = 0;

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path: string, content: Buffer | string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporary, path);
  await syncDirectory(dirname(path));
}

async function snapshot(trigger: string, ctx: ExtensionContext): Promise<void> {
  const outputDirectory =
    process.env.PINK_GUY_LIFECYCLE_DIR ?? process.env.BOSS_MAN_PHASE0_LIFECYCLE_DIR;
  if (!outputDirectory) throw new Error("PINK_GUY_LIFECYCLE_DIR is required");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  const sessionManager = ctx.sessionManager;
  const sessionFile = sessionManager.getSessionFile();
  let fileExisted = false;
  let nativeContent: Buffer;
  if (sessionFile) {
    try {
      await access(sessionFile);
      nativeContent = await readFile(sessionFile);
      fileExisted = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const records = [sessionManager.getHeader(), ...sessionManager.getEntries()];
      nativeContent = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    }
  } else {
    const records = [sessionManager.getHeader(), ...sessionManager.getEntries()];
    nativeContent = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  }

  const nativeSha256 = sha256(nativeContent);
  const nativeName = `native-${nativeSha256}.jsonl`;
  try {
    await access(join(outputDirectory, nativeName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await atomicWrite(join(outputDirectory, nativeName), nativeContent);
  }

  snapshotSequence += 1;
  const entries = sessionManager.getEntries();
  const manifest = {
    schema_version: "phase0-lifecycle-0.1.0",
    committed: true,
    trigger,
    sequence: snapshotSequence,
    session_id: sessionManager.getSessionId(),
    session_file: sessionFile ? basename(sessionFile) : null,
    source_file_existed: fileExisted,
    entry_count: entries.length,
    message_roles: entries
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message.role),
    native: { path: nativeName, sha256: nativeSha256 },
  };
  const manifestName = `snapshot-${safeName(sessionManager.getSessionId())}-${String(snapshotSequence).padStart(3, "0")}-${safeName(trigger)}.json`;
  await atomicWrite(join(outputDirectory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
}

function emptyAssistant(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function waitForAbort(signal: AbortSignal | undefined, timeoutMs: number): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(false);
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function streamLocal(
  model: Model<any>,
  _context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    const output = emptyAssistant(model);
    try {
      const outputDirectory =
        process.env.PINK_GUY_LIFECYCLE_DIR ?? process.env.BOSS_MAN_PHASE0_LIFECYCLE_DIR;
      if (!outputDirectory) throw new Error("PINK_GUY_LIFECYCLE_DIR is required");
      await appendFile(
        join(outputDirectory, "local-provider-invocations.jsonl"),
        `${JSON.stringify({ provider: model.provider, model: model.id, transport: "in-process" })}\n`,
        { mode: 0o600 },
      );
      stream.push({ type: "start", partial: output });
      output.content.push({ type: "text", text: "" });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });

      const prefix = model.id === "slow" ? "phase0-abort-pending" : "phase0-deterministic-completion";
      const block = output.content[0];
      if (block.type !== "text") throw new Error("unexpected content block");
      block.text = prefix;
      stream.push({ type: "text_delta", contentIndex: 0, delta: prefix, partial: output });

      if (model.id === "complete") {
        const filler = " context".repeat(4_000);
        block.text += filler;
        stream.push({ type: "text_delta", contentIndex: 0, delta: filler, partial: output });
      }

      if (model.id === "slow") {
        const aborted = await waitForAbort(options?.signal, 15_000);
        if (aborted) {
          output.stopReason = "aborted";
          output.errorMessage = "Phase 0 deterministic abort";
          stream.push({ type: "error", reason: "aborted", error: output });
          stream.end();
          return;
        }
      }

      stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial: output });
      output.stopReason = "stop";
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
}

export default function lifecycleProbe(pi: ExtensionAPI): void {
  pi.registerProvider("boss-man-phase0", {
    name: "Pink Guy Phase 0 local provider",
    baseUrl: "http://127.0.0.1:9/phase0-no-network",
    apiKey: "phase0-local-provider",
    api: "openai-completions",
    streamSimple: streamLocal,
    models: [
      {
        id: "complete",
        name: "Phase 0 deterministic completion",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 1_024,
      },
      {
        id: "slow",
        name: "Phase 0 deterministic abort",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 1_024,
      },
    ],
  });

  pi.on("session_start", async (_event, ctx) => {
    await snapshot("session_start", ctx);
    ctx.ui.notify(`phase0-session-start:${ctx.sessionManager.getSessionId()}`, "info");
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    await snapshot("before_agent_start", ctx);
  });
  pi.on("turn_start", async (_event, ctx) => {
    await snapshot("turn_start", ctx);
  });
  pi.on("context", async (_event, ctx) => {
    await snapshot("context", ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    await snapshot("turn_end", ctx);
    ctx.ui.notify(`phase0-turn-end:${ctx.sessionManager.getSessionId()}`, "info");
  });
  pi.on("session_before_compact", async (_event, ctx) => {
    await snapshot("before_compact", ctx);
  });
  pi.on("session_before_switch", async (event, ctx) => {
    await snapshot(`before_switch_${event.reason}`, ctx);
  });
}
