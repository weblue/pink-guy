#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "../..");
const MEMORY_DIR = path.join(ROOT_DIR, "tests", "fixtures", "memory");
const SCHEMA_PATH = path.join(MEMORY_DIR, "schema.sql");
const BENCHMARK_PATH = path.join(MEMORY_DIR, "benchmark-fixture.json");
const DEFAULT_DECOY = path.join(ROOT_DIR, "tests", "fixtures", "decoy-project", "README.md");
const INDEX_VERSION = "boss-man-memory-fts-v1";
const TRUST_CLASSES = new Set(["owner", "verified"]);
const K = 5;

if (!process.argv[2] || !path.isAbsolute(process.argv[2])) {
  console.error("usage: probe-memory-fts.mjs /absolute/path/to/generated/fixture [absolute-decoy-path]");
  process.exit(64);
}
const taskFixture = path.resolve(process.argv[2]);
const decoyPath = path.resolve(process.argv[3] ?? DEFAULT_DECOY);
const startedAt = new Date().toISOString();
const scratch = await mkdtemp(path.join(tmpdir(), "boss-man-memory-fts-"));
const databasePath = path.join(scratch, "memory.sqlite3");
const importedDatabasePath = path.join(scratch, "memory-import.sqlite3");
const exportPath = path.join(scratch, "canonical-export.json");
const receiptsPath = path.join(scratch, "context-receipts.json");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(match, "fixture memory document must have frontmatter");
  const metadata = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { metadata, body: match[2].trim() };
}

function normalizeRecord(input, benchmark, overrides = {}) {
  const record = {
    id: input.id,
    schema_version: "1.0.0",
    type: input.type,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    project_id: input.project_id ?? benchmark.project.id,
    repository_id: input.repository_id ?? benchmark.project.repository_id,
    task_id: input.scope_type === "task" ? input.scope_id : (input.task_id ?? null),
    status: input.status,
    title: input.title,
    body: input.body,
    confidence: input.confidence,
    trust_class: input.trust_class,
    author_type: input.author_type,
    author_id: input.author_id,
    source_refs: input.source_refs,
    created_at: input.created_at ?? benchmark.clock,
    updated_at: input.updated_at ?? benchmark.clock,
    valid_from: input.valid_from ?? benchmark.clock,
    expires_at: input.expires_at ?? null,
    supersedes_id: input.supersedes_id ?? null,
    contested_by: input.contested_by ?? [],
    tags: input.tags ?? [],
    revision: input.revision ?? 1,
    projection_version: input.projection_version ?? 1,
    ...overrides,
  };
  record.content_hash = sha256(stableJson({
    type: record.type,
    scope_type: record.scope_type,
    scope_id: record.scope_id,
    title: record.title,
    body: record.body,
  }));
  return record;
}

function createSchema(db, schemaSql) {
  db.exec(schemaSql);
}

function insertTaskFixture(db, benchmark) {
  const { project, task } = benchmark;
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(project.id, project.name);
  db.prepare(`
    INSERT INTO tasks (id, project_id, state, projection_version, acceptance_criteria)
    VALUES (?, ?, ?, ?, ?)
  `).run(task.id, project.id, task.state, task.projection_version, task.acceptance_criteria);
  db.prepare(`
    INSERT INTO task_dependencies (task_id, dependency_id, satisfied) VALUES (?, ?, ?)
  `).run(task.id, task.dependency.id, Number(task.dependency.satisfied));
  db.prepare(`
    INSERT INTO task_assignments (task_id, actor_id, role) VALUES (?, ?, ?)
  `).run(task.id, task.assignment.actor_id, task.assignment.role);
  db.prepare(`
    INSERT INTO task_reviewers (task_id, actor_id, revision) VALUES (?, ?, ?)
  `).run(task.id, task.reviewer.actor_id, task.reviewer.revision);
  db.prepare(`
    INSERT INTO decision_gates (id, task_id, category, status, question) VALUES (?, ?, ?, ?, ?)
  `).run(
    task.decision_gate.id,
    task.id,
    task.decision_gate.category,
    task.decision_gate.status,
    task.decision_gate.question,
  );
}

let eventSequence = 0;
function appendEvent(db, benchmark, { recordId = null, eventType, actorType, actorId, payload = {} }) {
  eventSequence += 1;
  const eventId = `memory-event-${String(eventSequence).padStart(4, "0")}`;
  db.prepare(`
    INSERT INTO memory_events
      (event_id, record_id, event_type, actor_type, actor_id, occurred_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    recordId,
    eventType,
    actorType,
    actorId,
    benchmark.clock,
    stableJson(payload),
  );
  return eventId;
}

const insertRecordStatement = `
  INSERT INTO memory_records (
    id, schema_version, type, scope_type, scope_id, project_id, repository_id, task_id,
    status, title, body, confidence, trust_class, author_type, author_id, source_refs_json,
    created_at, updated_at, valid_from, expires_at, supersedes_id, contested_by_json,
    tags_json, revision, content_hash, projection_version
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`;

function insertRecord(db, record) {
  db.prepare(insertRecordStatement).run(
    record.id,
    record.schema_version,
    record.type,
    record.scope_type,
    record.scope_id,
    record.project_id,
    record.repository_id,
    record.task_id,
    record.status,
    record.title,
    record.body,
    record.confidence,
    record.trust_class,
    record.author_type,
    record.author_id,
    stableJson(record.source_refs),
    record.created_at,
    record.updated_at,
    record.valid_from,
    record.expires_at,
    record.supersedes_id,
    stableJson(record.contested_by),
    stableJson(record.tags),
    record.revision,
    record.content_hash,
    record.projection_version,
  );
}

function insertEvidence(db, evidence, benchmark, overrides = {}) {
  const record = {
    project_id: benchmark.project.id,
    repository_id: benchmark.project.repository_id,
    task_id: evidence.scope_type === "task" ? evidence.scope_id : null,
    expires_at: null,
    ...evidence,
    ...overrides,
  };
  const contentHash = sha256(stableJson({
    title: record.title,
    body: record.body,
    scope_type: record.scope_type,
    scope_id: record.scope_id,
  }));
  db.prepare(`
    INSERT INTO normalized_evidence (
      id, project_id, repository_id, task_id, scope_type, scope_id, status, trust_class,
      title, body, tags_json, revision, source_refs_json, content_hash, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.project_id,
    record.repository_id,
    record.task_id,
    record.scope_type,
    record.scope_id,
    record.status,
    record.trust_class,
    record.title,
    record.body,
    stableJson(record.tags),
    record.revision,
    stableJson(record.source_refs),
    contentHash,
    record.expires_at,
  );
}

function getRecord(db, id) {
  const row = db.prepare("SELECT * FROM memory_records WHERE id = ?").get(id);
  assert(row, `unknown memory record: ${id}`);
  return row;
}

function actorCanWriteScope(actor, scopeType, scopeId, benchmark) {
  if (actor.type === "orchestrator" || actor.type === "reviewer") return true;
  if (actor.type !== "worker") return false;
  if (scopeType === "project") return scopeId === benchmark.project.id;
  if (scopeType === "repository") return scopeId === benchmark.project.repository_id;
  if (scopeType === "task") return scopeId === benchmark.task.id;
  return false;
}

function looksLikePromptInjection(body) {
  return /ignore\s+previous\s+instructions|mark\s+the\s+task\s+done|declare\s+merge\s+eligible/i.test(body);
}

function containsSecret(body, secretCanary) {
  return Boolean(secretCanary) && body.includes(secretCanary);
}

function proposeCandidate(db, benchmark, actor, input, secretCanary) {
  if (!actorCanWriteScope(actor, input.scope_type, input.scope_id, benchmark)) {
    appendEvent(db, benchmark, {
      recordId: input.id,
      eventType: "candidate_rejected",
      actorType: actor.type,
      actorId: actor.id,
      payload: { reason: "scope_capability_denied", content_persisted: false },
    });
    return { accepted: false, reason: "scope_capability_denied" };
  }
  if (containsSecret(input.body, secretCanary)) {
    appendEvent(db, benchmark, {
      recordId: input.id,
      eventType: "candidate_rejected",
      actorType: actor.type,
      actorId: actor.id,
      payload: { reason: "secret_canary", content_persisted: false, redacted: true },
    });
    return { accepted: false, reason: "secret_canary" };
  }
  if (looksLikePromptInjection(input.body)) {
    appendEvent(db, benchmark, {
      recordId: input.id,
      eventType: "candidate_rejected",
      actorType: actor.type,
      actorId: actor.id,
      payload: { reason: "prompt_injection", content_persisted: false },
    });
    return { accepted: false, reason: "prompt_injection" };
  }
  const candidate = normalizeRecord({
    ...input,
    status: "proposed",
    confidence: input.confidence ?? 0.8,
    trust_class: input.trust_class ?? "verified",
    author_type: actor.type,
    author_id: actor.id,
    source_refs: input.source_refs ?? ["task:BM-P0-FIXTURE-001"],
  }, benchmark);
  const tombstone = db.prepare("SELECT record_id FROM memory_tombstones WHERE content_hash = ?").get(candidate.content_hash);
  if (tombstone) {
    appendEvent(db, benchmark, {
      recordId: input.id,
      eventType: "candidate_rejected",
      actorType: actor.type,
      actorId: actor.id,
      payload: { reason: "tombstoned_content", content_persisted: false, tombstone_id: tombstone.record_id },
    });
    return { accepted: false, reason: "tombstoned_content" };
  }
  insertRecord(db, candidate);
  appendEvent(db, benchmark, {
    recordId: candidate.id,
    eventType: "candidate_proposed",
    actorType: actor.type,
    actorId: actor.id,
    payload: { scope_type: candidate.scope_type, scope_id: candidate.scope_id, revision: candidate.revision },
  });
  return { accepted: true, record: candidate };
}

function transitionRecord(db, benchmark, actor, id, expectedStatus, nextStatus, eventType, payload = {}) {
  assert(actor.type === "reviewer" || actor.type === "orchestrator" || (eventType === "memory_contested" && actor.type === "worker"),
    `${actor.type} cannot perform ${eventType}`);
  const record = getRecord(db, id);
  assert.equal(record.status, expectedStatus, `${id} expected ${expectedStatus}`);
  const contested = nextStatus === "contested"
    ? stableJson([...JSON.parse(record.contested_by_json), actor.id])
    : record.contested_by_json;
  db.prepare(`
    UPDATE memory_records
    SET status = ?, contested_by_json = ?, updated_at = ?, projection_version = projection_version + 1
    WHERE id = ? AND status = ?
  `).run(nextStatus, contested, benchmark.clock, id, expectedStatus);
  appendEvent(db, benchmark, {
    recordId: id,
    eventType,
    actorType: actor.type,
    actorId: actor.id,
    payload: { from: expectedStatus, to: nextStatus, ...payload },
  });
}

function promoteCandidate(db, benchmark, actor, id) {
  const record = getRecord(db, id);
  if (record.trust_class === "repository_untrusted" || looksLikePromptInjection(record.body)) {
    db.prepare(`
      UPDATE memory_records SET status = 'rejected', updated_at = ?, projection_version = projection_version + 1
      WHERE id = ? AND status = 'proposed'
    `).run(benchmark.clock, id);
    appendEvent(db, benchmark, {
      recordId: id,
      eventType: "candidate_rejected",
      actorType: actor.type,
      actorId: actor.id,
      payload: { reason: "low_trust_or_prompt_injection", content_persisted_as_candidate_only: true },
    });
    return { promoted: false, reason: "low_trust_or_prompt_injection" };
  }
  transitionRecord(db, benchmark, actor, id, "proposed", "active", "candidate_promoted");
  return { promoted: true };
}

function deleteWithTombstone(db, benchmark, actor, id) {
  const record = getRecord(db, id);
  assert.equal(record.status, "active");
  db.prepare(`
    INSERT INTO memory_tombstones (record_id, content_hash, deleted_at, reason, source_refs_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, record.content_hash, benchmark.clock, "explicit_phase0_deletion", record.source_refs_json);
  transitionRecord(db, benchmark, actor, id, "active", "deleted", "memory_tombstoned", {
    underlying_evidence_deleted: false,
  });
}

function authoritativeTaskSnapshot(db, taskId) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  assert(task, `unknown task: ${taskId}`);
  const dependencies = db.prepare(`
    SELECT dependency_id, satisfied FROM task_dependencies WHERE task_id = ? ORDER BY dependency_id
  `).all(taskId).map((row) => ({ id: row.dependency_id, satisfied: Boolean(row.satisfied) }));
  const assignment = db.prepare(`SELECT actor_id, role FROM task_assignments WHERE task_id = ?`).get(taskId);
  const reviewer = db.prepare(`SELECT actor_id, revision FROM task_reviewers WHERE task_id = ?`).get(taskId);
  const gates = db.prepare(`
    SELECT id, category, status, question FROM decision_gates WHERE task_id = ? ORDER BY id
  `).all(taskId);
  const mergeEligible = (
    ["review", "done"].includes(task.state)
    && dependencies.every((item) => item.satisfied)
    && Boolean(reviewer)
    && gates.every((gate) => gate.status === "resolved")
  );
  return stable({
    id: task.id,
    state: task.state,
    projection_version: task.projection_version,
    dependencies,
    assignment,
    reviewer,
    decision_gates: gates,
    merge_eligible: mergeEligible,
  });
}

function createFtsIndex(db) {
  db.exec("DROP TABLE IF EXISTS memory_fts");
  db.exec(`
    CREATE VIRTUAL TABLE memory_fts USING fts5(
      source_key UNINDEXED,
      title,
      body,
      tags,
      tokenize = 'porter unicode61'
    )
  `);
  const insert = db.prepare(`INSERT INTO memory_fts (source_key, title, body, tags) VALUES (?, ?, ?, ?)`);
  const memoryRows = db.prepare(`
    SELECT id, title, body, tags_json FROM memory_records ORDER BY id
  `).all();
  for (const row of memoryRows) {
    insert.run(`memory:${row.id}`, row.title, row.body, JSON.parse(row.tags_json).join(" "));
  }
  const evidenceRows = db.prepare(`
    SELECT id, title, body, tags_json FROM normalized_evidence ORDER BY id
  `).all();
  for (const row of evidenceRows) {
    insert.run(`evidence:${row.id}`, row.title, row.body, JSON.parse(row.tags_json).join(" "));
  }
  return { memory_rows: memoryRows.length, evidence_rows: evidenceRows.length };
}

function ftsExpression(query) {
  const ignored = new Set(["a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is", "it", "no", "of", "on", "or", "the", "to", "was"]);
  const tokens = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length > 1 && !ignored.has(token));
  assert(tokens.length > 0, `query has no searchable terms: ${query}`);
  return tokens.map((token) => `"${token}"`).join(" OR ");
}

function sourceDetails(db, sourceKey) {
  const [kind, id] = sourceKey.split(":", 2);
  if (kind === "memory") {
    const row = db.prepare("SELECT * FROM memory_records WHERE id = ?").get(id);
    return {
      kind,
      id,
      revision: row.revision,
      project_id: row.project_id,
      repository_id: row.repository_id,
      task_id: row.task_id,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      status: row.status,
      trust_class: row.trust_class,
      expires_at: row.expires_at,
      title: row.title,
      body: row.body,
      tags: JSON.parse(row.tags_json),
      source_refs: JSON.parse(row.source_refs_json),
      content_hash: row.content_hash,
    };
  }
  assert.equal(kind, "evidence");
  const row = db.prepare("SELECT * FROM normalized_evidence WHERE id = ?").get(id);
  return {
    kind,
    id,
    revision: row.revision,
    project_id: row.project_id,
    repository_id: row.repository_id,
    task_id: row.task_id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    status: row.status,
    trust_class: row.trust_class,
    expires_at: row.expires_at,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags_json),
    source_refs: JSON.parse(row.source_refs_json),
    content_hash: row.content_hash,
  };
}

function exclusionReasons(source, filters) {
  const reasons = [];
  if (source.status !== "active") reasons.push(`status:${source.status}`);
  if (!TRUST_CLASSES.has(source.trust_class)) reasons.push(`trust:${source.trust_class}`);
  if (source.expires_at && source.expires_at <= filters.as_of) reasons.push("expired");
  if (source.project_id !== filters.project_id) reasons.push("project_scope_mismatch");
  if (source.repository_id && source.repository_id !== filters.repository_id) reasons.push("repository_scope_mismatch");
  if (source.task_id && source.task_id !== filters.task_id) reasons.push("task_scope_mismatch");
  const allowedScope = (
    (source.scope_type === "project" && source.scope_id === filters.project_id)
    || (source.scope_type === "repository" && source.scope_id === filters.repository_id)
    || (source.scope_type === "task" && source.scope_id === filters.task_id)
  );
  if (!allowedScope) reasons.push(`capability_scope:${source.scope_type}`);
  return [...new Set(reasons)].sort();
}

function retrieve(db, benchmark, querySpec, sqliteVersion) {
  const filters = {
    project_id: benchmark.project.id,
    repository_id: benchmark.project.repository_id,
    task_id: benchmark.task.id,
    allowed_scope_types: ["project", "repository", "task"],
    allowed_trust_classes: [...TRUST_CLASSES].sort(),
    allowed_statuses: ["active"],
    as_of: benchmark.clock,
    token_budget: 500,
    limit: K,
    filter_stage: "eligible_source_cte_before_ranked_selection",
  };
  const expression = ftsExpression(querySpec.text);
  const eligibleSql = `
    WITH eligible_sources AS (
      SELECT 'memory:' || id AS source_key
      FROM memory_records
      WHERE status = 'active'
        AND trust_class IN ('owner', 'verified')
        AND (expires_at IS NULL OR expires_at > @as_of)
        AND project_id = @project_id
        AND (repository_id IS NULL OR repository_id = @repository_id)
        AND (task_id IS NULL OR task_id = @task_id)
        AND (
          (scope_type = 'project' AND scope_id = @project_id)
          OR (scope_type = 'repository' AND scope_id = @repository_id)
          OR (scope_type = 'task' AND scope_id = @task_id)
        )
      UNION ALL
      SELECT 'evidence:' || id AS source_key
      FROM normalized_evidence
      WHERE status = 'active'
        AND trust_class IN ('owner', 'verified')
        AND (expires_at IS NULL OR expires_at > @as_of)
        AND project_id = @project_id
        AND (repository_id IS NULL OR repository_id = @repository_id)
        AND (task_id IS NULL OR task_id = @task_id)
        AND (
          (scope_type = 'project' AND scope_id = @project_id)
          OR (scope_type = 'repository' AND scope_id = @repository_id)
          OR (scope_type = 'task' AND scope_id = @task_id)
        )
    )
    SELECT memory_fts.source_key, bm25(memory_fts, 0.0, 10.0, 3.0, 2.0) AS rank
    FROM eligible_sources
    JOIN memory_fts ON memory_fts.source_key = eligible_sources.source_key
    WHERE memory_fts MATCH @expression
    ORDER BY rank ASC, memory_fts.source_key ASC
    LIMIT @limit
  `;
  const parameters = {
    as_of: filters.as_of,
    project_id: filters.project_id,
    repository_id: filters.repository_id,
    task_id: filters.task_id,
    expression,
    limit: K,
  };
  const rows = db.prepare(eligibleSql).all(parameters);
  const rawMatches = db.prepare(`
    SELECT source_key, bm25(memory_fts, 0.0, 10.0, 3.0, 2.0) AS rank
    FROM memory_fts
    WHERE memory_fts MATCH ?
    ORDER BY rank ASC, source_key ASC
    LIMIT 100
  `).all(expression);

  const rankedSources = rows.map((row, index) => {
    const source = sourceDetails(db, row.source_key);
    return {
      rank: index + 1,
      source_id: source.id,
      source_kind: source.kind,
      revision: source.revision,
      score: Number((-row.rank).toFixed(12)),
      selection_reason: "fts5_bm25_after_scope_status_trust_filter",
      source_refs: source.source_refs,
      content_hash: source.content_hash,
      status: source.status,
      scope_type: source.scope_type,
      scope_id: source.scope_id,
    };
  });
  const injectedExcerpts = rows.map((row) => {
    const source = sourceDetails(db, row.source_key);
    const excerpt = source.body.length <= 240 ? source.body : `${source.body.slice(0, 237)}...`;
    return {
      source_id: source.id,
      revision: source.revision,
      delimiter: "BEGIN_BOSS_MAN_EVIDENCE / END_BOSS_MAN_EVIDENCE",
      excerpt_sha256: sha256(excerpt),
      source_refs: source.source_refs,
      estimated_tokens: Math.ceil(excerpt.length / 4),
    };
  });
  const selectedKeys = new Set(rows.map((row) => row.source_key));
  const exclusions = rawMatches
    .filter((row) => !selectedKeys.has(row.source_key))
    .map((row) => {
      const source = sourceDetails(db, row.source_key);
      const reasons = exclusionReasons(source, filters);
      return {
        source_id: source.id,
        revision: source.revision,
        reasons: reasons.length > 0 ? reasons : ["outside_top_k"],
      };
    })
    .sort((a, b) => a.source_id.localeCompare(b.source_id));
  const receiptBody = {
    receipt_schema_version: "1.0.0",
    query_id: querySpec.id,
    query_text: querySpec.text,
    filters,
    retrieval_method: {
      name: "sqlite_fts5_bm25",
      sqlite_version: sqliteVersion,
      index_version: INDEX_VERSION,
      query_expression: expression,
      semantic_or_vector_index_used: false,
    },
    ranked_sources: rankedSources,
    exclusions,
    injected_excerpts: injectedExcerpts,
  };
  const receiptSha = sha256(stableJson(receiptBody));
  const receipt = { receipt_id: `receipt-${receiptSha.slice(0, 20)}`, ...receiptBody };
  db.prepare(`
    INSERT OR REPLACE INTO context_receipts (
      receipt_id, task_id, query_text, filters_json, method_json, ranked_sources_json,
      exclusions_json, injected_excerpts_json, receipt_json, receipt_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.receipt_id,
    benchmark.task.id,
    querySpec.text,
    stableJson(filters),
    stableJson(receipt.retrieval_method),
    stableJson(rankedSources),
    stableJson(exclusions),
    stableJson(injectedExcerpts),
    stableJson(receipt),
    receiptSha,
  );
  return receipt;
}

function runBenchmark(db, benchmark, sqliteVersion) {
  return benchmark.queries.map((query) => ({ query, receipt: retrieve(db, benchmark, query, sqliteVersion) }));
}

function comparableResults(results) {
  return results.map(({ query, receipt }) => ({
    query_id: query.id,
    results: receipt.ranked_sources.map((source) => ({
      source_id: source.source_id,
      revision: source.revision,
      score: source.score,
    })),
  }));
}

function tableRows(db, table, orderBy) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

function canonicalExport(db) {
  return stable({
    export_schema_version: "1.0.0",
    projects: tableRows(db, "projects", "id"),
    tasks: tableRows(db, "tasks", "id"),
    task_dependencies: tableRows(db, "task_dependencies", "task_id, dependency_id"),
    task_assignments: tableRows(db, "task_assignments", "task_id"),
    task_reviewers: tableRows(db, "task_reviewers", "task_id"),
    decision_gates: tableRows(db, "decision_gates", "id"),
    memory_events: tableRows(db, "memory_events", "sequence"),
    memory_records: tableRows(db, "memory_records", "id"),
    memory_tombstones: tableRows(db, "memory_tombstones", "record_id"),
    normalized_evidence: tableRows(db, "normalized_evidence", "id"),
  });
}

function importCanonical(db, exported) {
  const tables = [
    "projects",
    "tasks",
    "task_dependencies",
    "task_assignments",
    "task_reviewers",
    "decision_gates",
    "memory_events",
    "memory_records",
    "memory_tombstones",
    "normalized_evidence",
  ];
  for (const table of tables) {
    const rows = exported[table];
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => "?").join(", ");
      db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...columns.map((key) => row[key]));
    }
  }
}

function calculateMetrics(results, benchmark) {
  let relevantCount = 0;
  let hitCount = 0;
  let resultCount = 0;
  let provenanceCount = 0;
  let staleCount = 0;
  let scopeViolationCount = 0;
  let exactMandatoryHits = 0;
  let exactMandatoryCount = 0;
  const perQuery = [];
  for (const { query, receipt } of results) {
    const ids = receipt.ranked_sources.map((source) => source.source_id);
    const expected = new Set(query.expected);
    const hits = ids.filter((id) => expected.has(id));
    relevantCount += expected.size;
    hitCount += hits.length;
    resultCount += ids.length;
    provenanceCount += receipt.injected_excerpts.filter((excerpt) => (
      excerpt.source_refs.length > 0 && /^[0-9a-f]{64}$/.test(excerpt.excerpt_sha256)
    )).length;
    staleCount += receipt.ranked_sources.filter((source) => source.status !== "active").length;
    scopeViolationCount += receipt.ranked_sources.filter((source) => (
      !receipt.filters.allowed_scope_types.includes(source.scope_type)
      || (source.scope_type === "project" && source.scope_id !== receipt.filters.project_id)
      || (source.scope_type === "repository" && source.scope_id !== receipt.filters.repository_id)
      || (source.scope_type === "task" && source.scope_id !== receipt.filters.task_id)
    )).length;
    if (query.mandatory_exact_constraint) {
      exactMandatoryCount += expected.size;
      exactMandatoryHits += hits.length;
    }
    perQuery.push({
      query_id: query.id,
      expected: [...expected],
      returned: ids,
      hits,
      recall_at_5: expected.size === 0 ? 1 : hits.length / expected.size,
      precision_at_5: hits.length / K,
    });
  }
  return {
    recall_at_5: hitCount / relevantCount,
    precision_at_5: hitCount / (benchmark.queries.length * K),
    returned_result_precision: hitCount / resultCount,
    provenance_completeness: resultCount === 0 ? 1 : provenanceCount / resultCount,
    stale_result_rate: resultCount === 0 ? 0 : staleCount / resultCount,
    scope_violation_rate: resultCount === 0 ? 0 : scopeViolationCount / resultCount,
    mandatory_exact_constraint_recall: exactMandatoryHits / exactMandatoryCount,
    result_count: resultCount,
    expected_relevant_count: relevantCount,
    relevant_hit_count: hitCount,
    per_query: perQuery,
  };
}

try {
  const schemaSql = await readFile(SCHEMA_PATH, "utf8");
  const benchmark = JSON.parse(await readFile(BENCHMARK_PATH, "utf8"));
  const decoyRaw = await readFile(decoyPath, "utf8");
  const decoy = parseFrontmatter(decoyRaw);
  const secretCanaryMatch = decoy.body.match(/Synthetic canary placeholder:\s*(`?)([^`\s]+)\1/);
  assert(secretCanaryMatch, "decoy fixture must contain a synthetic secret canary");
  const secretCanary = secretCanaryMatch[2];
  const fixtureCommit = run("git", ["-C", taskFixture, "rev-parse", "HEAD"]);
  assert.match(fixtureCommit, /^[0-9a-f]{40}$/);

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  createSchema(db, schemaSql);
  const sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;
  insertTaskFixture(db, benchmark);

  const fixtureMemoryDir = path.join(taskFixture, "memory");
  const fixtureFiles = ["decision-active.md", "decision-superseded.md", "failure-report.md", "runbook.md"];
  const fixtureRecords = [];
  for (const filename of fixtureFiles) {
    const absolute = path.join(fixtureMemoryDir, filename);
    const raw = await readFile(absolute, "utf8");
    const parsed = parseFrontmatter(raw);
    const title = parsed.body.split(/[.!?]/, 1)[0];
    fixtureRecords.push(normalizeRecord({
      id: parsed.metadata.id,
      type: parsed.metadata.type,
      scope_type: "project",
      scope_id: parsed.metadata.project,
      status: parsed.metadata.status,
      title,
      body: parsed.body,
      confidence: 1,
      trust_class: "verified",
      author_type: "fixture",
      author_id: "phase0-fixture",
      source_refs: [`fixture:memory/${filename}#sha256:${sha256(raw)}`],
      supersedes_id: null,
      contested_by: [],
      tags: [parsed.metadata.type, parsed.metadata.status, ...filename.replace(".md", "").split("-")],
      revision: Number(parsed.metadata.revision),
    }, benchmark));
  }
  const activeGit = fixtureRecords.find((record) => record.id === "memory-active-git-custody");
  activeGit.supersedes_id = "memory-superseded-agent-commit";
  for (const record of fixtureRecords) {
    insertRecord(db, record);
    appendEvent(db, benchmark, {
      recordId: record.id,
      eventType: "canonical_fixture_imported",
      actorType: "system",
      actorId: "phase0-loader",
      payload: { revision: record.revision, source_refs: record.source_refs },
    });
  }
  for (const input of benchmark.records) {
    const record = normalizeRecord(input, benchmark);
    insertRecord(db, record);
    appendEvent(db, benchmark, {
      recordId: record.id,
      eventType: "canonical_benchmark_recorded",
      actorType: "system",
      actorId: "phase0-loader",
      payload: { status: record.status, trust_class: record.trust_class, revision: record.revision },
    });
  }
  for (const evidence of benchmark.evidence) insertEvidence(db, evidence, benchmark);

  const decoySanitizedBody = decoy.body
    .replace(/Synthetic canary placeholder:[^\n]*/g, "[REDACTED_SECRET_CANARY]")
    .trim();
  assert(!decoySanitizedBody.includes(secretCanary));
  insertEvidence(db, {
    id: decoy.metadata.id,
    scope_type: "project",
    scope_id: decoy.metadata.project,
    status: decoy.metadata.status,
    trust_class: "verified",
    title: "Cross-project session resume decoy",
    body: decoySanitizedBody,
    tags: ["decoy", "session", "resume", "worktree", "context"],
    revision: Number(decoy.metadata.revision),
    source_refs: [`fixture:decoy-project/README.md#sha256:${sha256(decoyRaw)}`],
  }, benchmark, {
    project_id: decoy.metadata.project,
    repository_id: "unrelated-decoy-repository",
  });
  appendEvent(db, benchmark, {
    recordId: decoy.metadata.id,
    eventType: "evidence_redacted_before_normalization",
    actorType: "system",
    actorId: "phase0-loader",
    payload: { redaction_class: "secret_canary", redaction_count: 1, secret_persisted: false },
  });

  const actors = {
    worker: { type: "worker", id: "worker-phase0" },
    reviewer: { type: "reviewer", id: "reviewer-phase0" },
    orchestrator: { type: "orchestrator", id: "orchestrator-phase0" },
  };
  const unauthorizedGlobal = proposeCandidate(db, benchmark, actors.worker, {
    id: "memory-unauthorized-global",
    type: "preference",
    scope_type: "global_owner",
    scope_id: "human-owner",
    title: "Unauthorized global preference",
    body: "Workers should control all future checkpoint decisions.",
  }, secretCanary);
  const secretAttempt = proposeCandidate(db, benchmark, actors.worker, {
    id: "memory-secret-attempt",
    type: "fact",
    scope_type: "project",
    scope_id: benchmark.project.id,
    title: "Secret-bearing candidate",
    body: `Synthetic credential ${secretCanary}`,
  }, secretCanary);
  const promptAttempt = promoteCandidate(db, benchmark, actors.reviewer, "memory-repository-prompt-injection");

  const lifecycleCandidate = proposeCandidate(db, benchmark, actors.worker, {
    id: "memory-candidate-agent-checkpoint",
    type: "convention",
    scope_type: "project",
    scope_id: benchmark.project.id,
    title: "Agent checkpoint terminology candidate",
    body: "The worker may request a platform checkpoint after its validation completes.",
    tags: ["checkpoint", "candidate"],
    source_refs: ["task:BM-P0-FIXTURE-001", "event:worker-progress"],
  }, secretCanary);
  assert(lifecycleCandidate.accepted);
  assert(promoteCandidate(db, benchmark, actors.reviewer, lifecycleCandidate.record.id).promoted);
  transitionRecord(db, benchmark, actors.worker, lifecycleCandidate.record.id, "active", "contested", "memory_contested", {
    reason: "terminology changed",
  });
  transitionRecord(db, benchmark, actors.orchestrator, lifecycleCandidate.record.id, "contested", "superseded", "memory_superseded", {
    superseded_by: "memory-active-checkpoint-terminology",
  });

  const deleteCandidateInput = {
    id: "memory-delete-me",
    type: "fact",
    scope_type: "task",
    scope_id: benchmark.task.id,
    title: "Disposable lifecycle fact",
    body: "This fact exists only to prove deletion and tombstone behavior.",
    tags: ["deletion", "tombstone"],
    source_refs: ["task:BM-P0-FIXTURE-001"],
  };
  const deleteCandidate = proposeCandidate(db, benchmark, actors.worker, deleteCandidateInput, secretCanary);
  assert(deleteCandidate.accepted);
  assert(promoteCandidate(db, benchmark, actors.reviewer, deleteCandidate.record.id).promoted);
  deleteWithTombstone(db, benchmark, actors.orchestrator, deleteCandidate.record.id);
  const recreateAttempt = proposeCandidate(db, benchmark, actors.worker, {
    ...deleteCandidateInput,
    id: "memory-delete-me-recreated",
  }, secretCanary);

  const canonicalTaskBefore = authoritativeTaskSnapshot(db, benchmark.task.id);
  const initialIndexCounts = createFtsIndex(db);
  const baselineResults = runBenchmark(db, benchmark, sqliteVersion);
  const baselineComparable = comparableResults(baselineResults);
  const metrics = calculateMetrics(baselineResults, benchmark);
  const canonicalTaskAfterRetrieval = authoritativeTaskSnapshot(db, benchmark.task.id);

  db.exec("DROP TABLE memory_fts");
  const rebuiltIndexCounts = createFtsIndex(db);
  const rebuiltResults = runBenchmark(db, benchmark, sqliteVersion);
  const rebuiltComparable = comparableResults(rebuiltResults);

  const exported = canonicalExport(db);
  const exportJson = `${stableJson(exported)}\n`;
  await writeFile(exportPath, exportJson);
  const importedDb = new DatabaseSync(importedDatabasePath);
  createSchema(importedDb, schemaSql);
  importCanonical(importedDb, exported);
  createFtsIndex(importedDb);
  const importedResults = runBenchmark(importedDb, benchmark, sqliteVersion);
  const importedComparable = comparableResults(importedResults);
  const canonicalTaskAfterImport = authoritativeTaskSnapshot(importedDb, benchmark.task.id);

  const receipts = baselineResults.map(({ receipt }) => receipt);
  const receiptsJson = `${stableJson(receipts)}\n`;
  await writeFile(receiptsPath, receiptsJson);

  assert.deepEqual(canonicalTaskAfterRetrieval, canonicalTaskBefore);
  assert.deepEqual(canonicalTaskAfterImport, canonicalTaskBefore);
  assert.deepEqual(rebuiltComparable, baselineComparable);
  assert.deepEqual(importedComparable, baselineComparable);
  assert.equal(canonicalTaskBefore.state, "in_progress");
  assert.equal(canonicalTaskBefore.merge_eligible, false);
  assert.equal(canonicalTaskBefore.decision_gates[0].status, "decision_required");
  assert.equal(unauthorizedGlobal.reason, "scope_capability_denied");
  assert.equal(secretAttempt.reason, "secret_canary");
  assert.equal(promptAttempt.reason, "low_trust_or_prompt_injection");
  assert.equal(recreateAttempt.reason, "tombstoned_content");
  assert.equal(metrics.mandatory_exact_constraint_recall, 1);
  assert.equal(metrics.provenance_completeness, 1);
  assert.equal(metrics.stale_result_rate, 0);
  assert.equal(metrics.scope_violation_rate, 0);

  const everyReturnedId = baselineResults.flatMap(({ receipt }) => receipt.ranked_sources.map((source) => source.source_id));
  assert(!everyReturnedId.includes(decoy.metadata.id));
  assert(!everyReturnedId.includes("memory-repository-prompt-injection"));
  assert(!everyReturnedId.includes("memory-superseded-agent-commit"));
  assert(!everyReturnedId.includes("memory-contested-runtime-choice"));
  assert(!everyReturnedId.includes("memory-delete-me"));
  assert(!exportJson.includes(secretCanary));
  assert(!receiptsJson.includes(secretCanary));
  const persistedText = stableJson({
    events: tableRows(db, "memory_events", "sequence"),
    records: tableRows(db, "memory_records", "id"),
    evidence: tableRows(db, "normalized_evidence", "id"),
    receipts: tableRows(db, "context_receipts", "receipt_id"),
  });
  assert(!persistedText.includes(secretCanary));
  const lifecycleRecordStatus = getRecord(db, lifecycleCandidate.record.id).status;

  importedDb.close();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const databaseBytes = await readFile(databasePath);
  assert(!databaseBytes.includes(Buffer.from(secretCanary)));

  const result = {
    test_id: "P0-MEMORY-FTS",
    status: "pass",
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    fixture_commit: fixtureCommit,
    sqlite_version: sqliteVersion,
    fts5_enabled: true,
    external_network_request_made: false,
    model_or_embedding_request_made: false,
    vector_index_created: false,
    canonical_task: canonicalTaskBefore,
    lifecycle: {
      candidate_created: lifecycleCandidate.accepted,
      promoted: true,
      contested: true,
      superseded: lifecycleRecordStatus === "superseded",
      tombstoned: true,
      recreation_blocked: recreateAttempt.reason === "tombstoned_content",
      unauthorized_global_write_blocked: unauthorizedGlobal.reason === "scope_capability_denied",
      prompt_injection_promotion_blocked: promptAttempt.reason === "low_trust_or_prompt_injection",
      secret_candidate_rejected_before_persistence: secretAttempt.reason === "secret_canary",
    },
    retrieval: {
      index_version: INDEX_VERSION,
      initial_index_counts: initialIndexCounts,
      rebuilt_index_counts: rebuiltIndexCounts,
      query_count: benchmark.queries.length,
      metrics,
      context_receipt_count: receipts.length,
      result_ids_by_query: Object.fromEntries(baselineResults.map(({ query, receipt }) => [
        query.id,
        receipt.ranked_sources.map((source) => source.source_id),
      ])),
    },
    reproducibility: {
      index_delete_rebuild_byte_equivalent_results: true,
      canonical_export_import_equivalent_results: true,
      canonical_task_answers_unchanged: true,
      canonical_export_sha256: sha256(exportJson),
      context_receipts_sha256: sha256(receiptsJson),
      database_sha256: sha256(databaseBytes),
    },
    defenses: {
      secret_canary_violations: 0,
      cross_project_decoy_violations: 0,
      prompt_injection_violations: 0,
      stale_or_superseded_violations: 0,
      scope_violations: 0,
    },
    limitations: [
      "This benchmark measures deterministic lexical retrieval on a deliberately small Phase 0 corpus; production ranking and token budgets still require workload calibration.",
      "The pi-persistent-intelligence comparison is a boundary inspection based on the pinned research record, not an installed-package conformance run.",
      "No vector or semantic experiment was run because P0-06 requires the FTS5 baseline to be recorded first.",
      "SQLite BM25 scores are reproducible for the pinned corpus and SQLite version; cross-version score stability is not assumed.",
    ],
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
