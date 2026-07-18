import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { GovernedMemoryService, sha256, stableJson } from "./memory-service.mjs";

function parseJsonl(content) {
  return content.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function selectedBranch(records) {
  const header = records.find((record) => record.type === "session");
  const entries = records.filter((record) => record.type !== "session");
  if (entries.length === 0) return header ? [header] : [];
  const byId = new Map(entries.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  const chain = [];
  let current = entries.at(-1);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return [...(header ? [header] : []), ...chain.reverse()];
}

async function checksumFile(path) {
  return sha256(await readFile(path));
}

async function piSessionManager() {
  const executable = await realpath(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
  const packageRoot = dirname(dirname(executable));
  return (await import(pathToFileURL(join(packageRoot, "dist/index.js")))).SessionManager;
}

async function persistManager(manager) {
  const path = manager.getSessionFile();
  if (!path) throw new Error("Pi SessionManager did not allocate a session file");
  const content = `${[manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await writeFile(path, content, { mode: 0o600, flag: "wx" });
  return path;
}

export class ContextCustodyService {
  constructor({ store, stateRoot }) {
    this.store = store;
    this.stateRoot = stateRoot;
    this.memory = new GovernedMemoryService({ store });
  }

  async exportSession({
    sessionId,
    query,
    queryId = "context-export",
    trigger = "manual",
    tokenBudget = 800,
    nativePathOverride = null,
    triggerManifest = null,
  }) {
    const session = this.store.getSession(sessionId);
    if (!session) throw Object.assign(new Error(`unknown session: ${sessionId}`), { code: "not_found" });
    const task = this.store.getTaskDetails(session.task_id);
    const project = this.store.getProject(task.project_id);
    const run = this.store.database.prepare(
      "SELECT * FROM runs WHERE session_id=? ORDER BY started_at DESC,id DESC LIMIT 1",
    ).get(sessionId) ?? null;
    const nativeSourcePath = nativePathOverride ?? session.native_path;
    const nativeContent = await readFile(nativeSourcePath);
    const nativeRecords = parseJsonl(nativeContent);
    const branch = selectedBranch(nativeRecords);
    const retrieval = this.memory.retrieve({
      projectId: project.id,
      repositoryId: project.repository_id,
      taskId: task.id,
      sessionId,
      runId: run?.id ?? null,
      query: query || `${task.title} ${task.acceptance_criteria.join(" ")}`,
      queryId,
      tokenBudget,
    });
    const canonicalMemory = this.memory.canonicalScope({
      projectId: project.id,
      repositoryId: project.repository_id,
      taskId: task.id,
    });
    const artifacts = this.store.artifacts(sessionId).map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
      sha256: artifact.sha256,
      metadata: JSON.parse(artifact.metadata_json),
      created_at: artifact.created_at,
    }));
    const workspace = run ? this.store.workspaceForRun(run.id) : null;
    const taskValue = {
      ...task,
      context_items: this.store.taskContextItems(task.id),
      audit: this.store.taskAudit(task.id),
    };
    const decisions = taskValue.decision_gates;
    const git = {
      workspace,
      repository_path: project.repository_path,
      revision: task.revision,
    };
    const payloads = new Map([
      ["native.pi-session.jsonl", nativeContent],
      ["branch.messages.jsonl", `${branch.map((entry) => stableJson(entry)).join("\n")}\n`],
      ["task.json", `${stableJson(taskValue, 2)}\n`],
      ["decisions.json", `${stableJson(decisions, 2)}\n`],
      ["memory.canonical.json", `${stableJson(canonicalMemory, 2)}\n`],
      ["memory.records.jsonl", `${retrieval.selectedRecords.map((record) => stableJson(record)).join("\n")}\n`],
      ["context-receipt.json", `${stableJson(retrieval.receipt, 2)}\n`],
      ["artifacts.json", `${stableJson(artifacts, 2)}\n`],
      ["git.json", `${stableJson(git, 2)}\n`],
    ]);
    const payloadChecksums = Object.fromEntries([...payloads].map(([name, content]) => [name, sha256(content)]));
    const identity = {
      schema_version: "boss-man-context-identity-v1",
      trigger,
      trigger_manifest: triggerManifest,
      session_id: sessionId,
      parent_session_id: session.parent_session_id,
      task_id: task.id,
      project_id: project.id,
      run: run ? { id: run.id, phase: run.phase, orchestrator_id: run.orchestrator_id } : null,
      native_sha256: payloadChecksums["native.pi-session.jsonl"],
      receipt_sha256: retrieval.receiptSha256,
      payload_checksums: payloadChecksums,
    };
    const snapshotId = `ctx-${sha256(stableJson(identity)).slice(0, 24)}`;
    const parent = join(this.stateRoot, "context", sessionId);
    const target = join(parent, snapshotId);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(parent, `.pending-${snapshotId}-`));
    const createdAt = this.store.clock();
    try {
      for (const [name, content] of payloads) await writeFile(join(temporary, name), content, { mode: 0o600 });
      const manifest = {
        schema_version: "boss-man-context-manifest-v1",
        snapshot_id: snapshotId,
        created_at: createdAt,
        trigger,
        authority: "boss-man-central-api",
        session: {
          id: sessionId,
          parent_session_id: session.parent_session_id,
          native_source_path: nativeSourcePath,
          model_provider: session.model_provider,
          model_id: session.model_id,
        },
        trigger_manifest: triggerManifest,
        project: { id: project.id, repository_id: project.repository_id, name: project.name },
        task: { id: task.id, revision: task.revision, status: task.status },
        run: run ? { id: run.id, phase: run.phase, orchestrator_id: run.orchestrator_id } : null,
        context_receipt_sha256: retrieval.receiptSha256,
        branch_entry_ids: branch.filter((entry) => entry.type !== "session").map((entry) => entry.id),
        unknown_native_entry_types: [...new Set(branch
          .filter((entry) => !["session", "message", "model_change", "thinking_level_change", "compaction", "branch_summary", "custom", "custom_message", "label", "session_info"].includes(entry.type))
          .map((entry) => entry.type))].sort(),
        files: payloadChecksums,
      };
      const manifestContent = `${stableJson(manifest, 2)}\n`;
      await writeFile(join(temporary, "manifest.json"), manifestContent, { mode: 0o600 });
      const allChecksums = { ...payloadChecksums, "manifest.json": sha256(manifestContent) };
      const checksumContent = `${Object.entries(allChecksums).sort()
        .map(([name, digest]) => `${digest}  ${name}`).join("\n")}\n`;
      await writeFile(join(temporary, "checksums.sha256"), checksumContent, { mode: 0o600 });
      try {
        await rename(temporary, target);
      } catch (error) {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
        await rm(temporary, { recursive: true, force: true });
      }
      const manifestSha256 = await checksumFile(join(target, "manifest.json"));
      this.store.recordArtifact({
        sessionId,
        kind: "unified_context_bundle",
        path: target,
        sha256: manifestSha256,
        metadata: {
          snapshotId,
          trigger,
          receiptSha256: retrieval.receiptSha256,
          nativeSha256: payloadChecksums["native.pi-session.jsonl"],
        },
      });
      return {
        snapshot_id: snapshotId,
        path: target,
        manifest_sha256: manifestSha256,
        context_receipt_sha256: retrieval.receiptSha256,
        selected_source_count: retrieval.selectedRecords.length,
      };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async exportConversation({
    conversationId,
    trigger = "manual",
  }) {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw Object.assign(new Error(`unknown conversation: ${conversationId}`), { code: "not_found" });
    }
    const topic = this.store.database.prepare(
      "SELECT * FROM topics WHERE id=?",
    ).get(conversation.topic_id);
    const turns = this.store.conversationTurns(conversationId);
    const events = this.store.conversationEvents(conversationId);
    const runs = this.store.conversationRuns(conversationId);
    const tasks = conversation.project_id
      ? this.store.database.prepare("SELECT id FROM tasks WHERE project_id=? ORDER BY id")
        .all(conversation.project_id)
        .map((row) => ({
          ...this.store.getTaskDetails(row.id),
          activity: this.store.taskAudit(row.id),
        }))
      : [];
    const origins = this.store.database.prepare(`SELECT o.* FROM task_origins o
      WHERE o.conversation_id=? OR o.task_id IN (
        SELECT id FROM tasks WHERE project_id=?
      ) ORDER BY o.task_id,o.task_version`).all(conversationId, conversation.project_id);
    const promptVersions = new Set([this.store.getAgentPromptProfile("orchestrator").active_version]);
    for (const run of runs) {
      const version = run.metadata?.promptProfileVersion;
      if (Number.isInteger(version)) promptVersions.add(version);
    }
    const promptRevisions = [...promptVersions].sort((left, right) => left - right)
      .map((version) => this.store.getAgentPromptRevision("orchestrator", version));
    const payloads = new Map([
      ["topic.json", `${stableJson(topic, 2)}\n`],
      ["conversation.json", `${stableJson(conversation, 2)}\n`],
      ["turns.json", `${stableJson(turns, 2)}\n`],
      ["events.json", `${stableJson(events, 2)}\n`],
      ["runs.json", `${stableJson(runs, 2)}\n`],
      ["tasks.json", `${stableJson(tasks, 2)}\n`],
      ["task-origins.json", `${stableJson(origins, 2)}\n`],
      ["prompt-revisions.json", `${stableJson(promptRevisions, 2)}\n`],
    ]);
    if (conversation.native_session_path) {
      payloads.set("native.pi-session.jsonl", await readFile(conversation.native_session_path));
    }
    const payloadChecksums = Object.fromEntries(
      [...payloads].map(([name, content]) => [name, sha256(content)]),
    );
    const identity = {
      schema_version: "boss-man-conversation-custody-identity-v1",
      conversation_id: conversationId,
      conversation_version: conversation.version,
      trigger,
      payload_checksums: payloadChecksums,
    };
    const snapshotId = `conversation-${sha256(stableJson(identity)).slice(0, 24)}`;
    const parent = join(this.stateRoot, "conversation-context", conversationId);
    const target = join(parent, snapshotId);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(parent, `.pending-${snapshotId}-`));
    try {
      for (const [name, content] of payloads) {
        await writeFile(join(temporary, name), content, { mode: 0o600 });
      }
      const manifest = {
        schema_version: "boss-man-conversation-custody-manifest-v1",
        snapshot_id: snapshotId,
        created_at: this.store.clock(),
        trigger,
        authority: "boss-man-central-api",
        topic: { id: topic.id, project_id: topic.project_id, version: topic.version },
        conversation: {
          id: conversation.id,
          version: conversation.version,
          scope_type: conversation.scope_type,
          scope_id: conversation.scope_id,
          model_provider: conversation.model_provider,
          model_id: conversation.model_id,
          thinking_level: conversation.thinking_level,
          native_session_path: conversation.native_session_path,
        },
        record_counts: {
          turns: turns.length,
          events: events.length,
          runs: runs.length,
          tasks: tasks.length,
          task_origins: origins.length,
          prompt_revisions: promptRevisions.length,
        },
        files: payloadChecksums,
      };
      const manifestContent = `${stableJson(manifest, 2)}\n`;
      await writeFile(join(temporary, "manifest.json"), manifestContent, { mode: 0o600 });
      const allChecksums = { ...payloadChecksums, "manifest.json": sha256(manifestContent) };
      await writeFile(
        join(temporary, "checksums.sha256"),
        `${Object.entries(allChecksums).sort()
          .map(([name, digest]) => `${digest}  ${name}`).join("\n")}\n`,
        { mode: 0o600 },
      );
      try {
        await rename(temporary, target);
      } catch (error) {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
        await rm(temporary, { recursive: true, force: true });
      }
      const verified = await this.verifyBundle(target);
      const manifestSha256 = verified.checksums["manifest.json"];
      this.store.recordConversationCustodySnapshot({
        snapshotId,
        conversationId,
        trigger,
        path: target,
        manifestSha256,
        nativeSha256: payloadChecksums["native.pi-session.jsonl"] ?? null,
        conversationVersion: conversation.version,
      });
      return {
        snapshot_id: snapshotId,
        path: target,
        manifest_sha256: manifestSha256,
        native_sha256: payloadChecksums["native.pi-session.jsonl"] ?? null,
        conversation_version: conversation.version,
      };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async verifyBundle(bundlePath) {
    const checksumLines = (await readFile(join(bundlePath, "checksums.sha256"), "utf8")).trim().split("\n");
    const checksums = Object.fromEntries(checksumLines.map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) throw new Error(`invalid checksum line: ${line}`);
      return [match[2], match[1]];
    }));
    for (const [name, expected] of Object.entries(checksums)) {
      const observed = await checksumFile(join(bundlePath, name));
      if (observed !== expected) {
        throw Object.assign(new Error(`context checksum mismatch: ${name}`), { code: "checksum_mismatch" });
      }
    }
    const manifest = JSON.parse(await readFile(join(bundlePath, "manifest.json"), "utf8"));
    return { manifest, checksums };
  }

  async importBundle(bundlePath, { destinationRoot, store = null } = {}) {
    const verified = await this.verifyBundle(bundlePath);
    const root = destinationRoot ?? await mkdtemp(join(tmpdir(), "boss-man-context-import-"));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const target = join(root, verified.manifest.snapshot_id);
    await cp(bundlePath, target, { recursive: true, errorOnExist: true, force: false });
    if (store) {
      const memory = new GovernedMemoryService({ store });
      const canonical = JSON.parse(await readFile(join(target, "memory.canonical.json"), "utf8"));
      memory.importCanonical(canonical);
    }
    return {
      path: target,
      native_session_path: join(target, "native.pi-session.jsonl"),
      manifest: verified.manifest,
    };
  }

  async createBundleChild(bundlePath, {
    cwd,
    sessionDirectory,
    instruction = "Continue the assigned phase using only the verified context receipt and referenced artifacts.",
    phase = "implementation",
  }) {
    if (!["implementation", "test", "review"].includes(phase)) {
      throw Object.assign(new Error(`unsupported child phase: ${phase}`), { code: "invalid_request" });
    }
    const { manifest, checksums } = await this.verifyBundle(bundlePath);
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    const SessionManager = await piSessionManager();
    const manager = SessionManager.create(cwd, sessionDirectory, {
      id: randomUUID(),
      parentSession: join(bundlePath, "native.pi-session.jsonl"),
    });
    manager.appendCustomEntry("boss-man.child-provenance", {
      mode: "bundle",
      phase,
      source_session_id: manifest.session.id,
      context_snapshot_id: manifest.snapshot_id,
      manifest_sha256: checksums["manifest.json"],
      context_receipt_sha256: manifest.context_receipt_sha256,
    });
    manager.appendCustomMessageEntry(
      "boss-man.child-context",
      `${instruction}\nVerified Boss Man context manifest sha256:${checksums["manifest.json"]}; receipt sha256:${manifest.context_receipt_sha256}. The source transcript is retained in the bundle but is not injected into this child context.`,
      false,
      {
        mode: "bundle",
        phase,
        snapshot_id: manifest.snapshot_id,
        manifest_sha256: checksums["manifest.json"],
        context_receipt_sha256: manifest.context_receipt_sha256,
      },
    );
    const path = await persistManager(manager);
    return { session_id: manager.getSessionId(), path, phase, source_snapshot_id: manifest.snapshot_id };
  }
}
