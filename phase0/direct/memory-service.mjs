import { createHash, randomUUID } from "node:crypto";

const INDEX_VERSION = "boss-man-memory-fts-v1";
const ALLOWED_TRUST = new Set(["owner", "verified"]);
const IGNORED_TERMS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is", "it", "no", "of", "on", "or", "the", "to", "was",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function stableJson(value, spacing = 0) {
  return JSON.stringify(stable(value), null, spacing);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value, fallback) {
  return value ? JSON.parse(value) : fallback;
}

function expressionFor(query) {
  const tokens = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length > 1 && !IGNORED_TERMS.has(token));
  if (tokens.length === 0) {
    throw Object.assign(new Error("context query has no searchable terms"), { code: "invalid_request" });
  }
  return tokens.map((token) => `"${token}"`).join(" OR ");
}

function normalizeMemory(input, clock) {
  const now = input.updated_at ?? input.created_at ?? clock();
  const record = {
    id: input.id ?? randomUUID(),
    schema_version: input.schema_version ?? "1.0.0",
    type: input.type,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    project_id: input.project_id ?? null,
    repository_id: input.repository_id ?? null,
    task_id: input.task_id ?? null,
    status: input.status ?? "active",
    title: input.title,
    body: input.body,
    confidence: input.confidence ?? 1,
    trust_class: input.trust_class ?? "verified",
    author_type: input.author_type ?? "orchestrator",
    author_id: input.author_id ?? "boss-man",
    source_refs: input.source_refs ?? [],
    created_at: input.created_at ?? now,
    updated_at: now,
    valid_from: input.valid_from ?? now,
    expires_at: input.expires_at ?? null,
    supersedes_id: input.supersedes_id ?? null,
    contested_by: input.contested_by ?? [],
    tags: input.tags ?? [],
    revision: input.revision ?? 1,
    projection_version: input.projection_version ?? 1,
  };
  record.content_hash = input.content_hash ?? sha256(stableJson({
    type: record.type,
    scope_type: record.scope_type,
    scope_id: record.scope_id,
    title: record.title,
    body: record.body,
  }));
  return record;
}

function normalizeEvidence(input) {
  const record = {
    id: input.id ?? randomUUID(),
    project_id: input.project_id,
    repository_id: input.repository_id ?? null,
    task_id: input.task_id ?? null,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    status: input.status ?? "active",
    trust_class: input.trust_class ?? "verified",
    title: input.title,
    body: input.body,
    tags: input.tags ?? [],
    revision: input.revision ?? 1,
    source_refs: input.source_refs ?? [],
    expires_at: input.expires_at ?? null,
  };
  record.content_hash = input.content_hash ?? sha256(stableJson({
    scope_type: record.scope_type,
    scope_id: record.scope_id,
    title: record.title,
    body: record.body,
  }));
  return record;
}

export class GovernedMemoryService {
  constructor({ store }) {
    this.store = store;
    this.database = store.database;
  }

  upsertMemory(input) {
    const record = normalizeMemory(input, this.store.clock);
    if (!record.type || !record.scope_type || !record.scope_id || !record.title || !record.body) {
      throw Object.assign(new Error("memory type, scope, title, and body are required"), { code: "invalid_request" });
    }
    this.database.prepare(`INSERT INTO memory_records(
      id,schema_version,type,scope_type,scope_id,project_id,repository_id,task_id,status,title,body,
      confidence,trust_class,author_type,author_id,source_refs_json,created_at,updated_at,valid_from,
      expires_at,supersedes_id,contested_by_json,tags_json,revision,content_hash,projection_version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,title=excluded.title,body=excluded.body,confidence=excluded.confidence,
      trust_class=excluded.trust_class,source_refs_json=excluded.source_refs_json,updated_at=excluded.updated_at,
      expires_at=excluded.expires_at,supersedes_id=excluded.supersedes_id,
      contested_by_json=excluded.contested_by_json,tags_json=excluded.tags_json,revision=excluded.revision,
      content_hash=excluded.content_hash,projection_version=excluded.projection_version`).run(
      record.id, record.schema_version, record.type, record.scope_type, record.scope_id,
      record.project_id, record.repository_id, record.task_id, record.status, record.title, record.body,
      record.confidence, record.trust_class, record.author_type, record.author_id,
      stableJson(record.source_refs), record.created_at, record.updated_at, record.valid_from,
      record.expires_at, record.supersedes_id, stableJson(record.contested_by), stableJson(record.tags),
      record.revision, record.content_hash, record.projection_version,
    );
    this.database.prepare(`INSERT INTO memory_events(
      event_id,record_id,event_type,actor_type,actor_id,occurred_at,payload_json
    ) VALUES(?,?,?,?,?,?,?)`).run(
      randomUUID(), record.id, "memory_upserted", record.author_type, record.author_id,
      this.store.clock(), stableJson({ revision: record.revision, status: record.status }),
    );
    return record;
  }

  upsertEvidence(input) {
    const record = normalizeEvidence(input);
    if (!record.project_id || !record.scope_type || !record.scope_id || !record.title || !record.body) {
      throw Object.assign(new Error("evidence project, scope, title, and body are required"), { code: "invalid_request" });
    }
    this.database.prepare(`INSERT INTO normalized_evidence(
      id,project_id,repository_id,task_id,scope_type,scope_id,status,trust_class,title,body,
      tags_json,revision,source_refs_json,content_hash,expires_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,trust_class=excluded.trust_class,title=excluded.title,body=excluded.body,
      tags_json=excluded.tags_json,revision=excluded.revision,source_refs_json=excluded.source_refs_json,
      content_hash=excluded.content_hash,expires_at=excluded.expires_at`).run(
      record.id, record.project_id, record.repository_id, record.task_id, record.scope_type,
      record.scope_id, record.status, record.trust_class, record.title, record.body,
      stableJson(record.tags), record.revision, stableJson(record.source_refs),
      record.content_hash, record.expires_at,
    );
    return record;
  }

  rebuildIndex() {
    this.database.exec("DROP TABLE IF EXISTS memory_fts");
    this.database.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(
      source_key UNINDEXED,title,body,tags,tokenize='porter unicode61'
    )`);
    const insert = this.database.prepare("INSERT INTO memory_fts(source_key,title,body,tags) VALUES(?,?,?,?)");
    const memories = this.database.prepare("SELECT id,title,body,tags_json FROM memory_records ORDER BY id").all();
    const evidence = this.database.prepare("SELECT id,title,body,tags_json FROM normalized_evidence ORDER BY id").all();
    for (const row of memories) insert.run(`memory:${row.id}`, row.title, row.body, parseJson(row.tags_json, []).join(" "));
    for (const row of evidence) insert.run(`evidence:${row.id}`, row.title, row.body, parseJson(row.tags_json, []).join(" "));
    return { index_version: INDEX_VERSION, memory_rows: memories.length, evidence_rows: evidence.length };
  }

  sourceDetails(sourceKey) {
    const [kind, id] = sourceKey.split(":", 2);
    const row = kind === "memory"
      ? this.database.prepare("SELECT * FROM memory_records WHERE id=?").get(id)
      : this.database.prepare("SELECT * FROM normalized_evidence WHERE id=?").get(id);
    if (!row) throw new Error(`missing retrieval source: ${sourceKey}`);
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
      tags: parseJson(row.tags_json, []),
      source_refs: parseJson(row.source_refs_json, []),
      content_hash: row.content_hash,
      ...(kind === "memory" ? {
        schema_version: row.schema_version,
        type: row.type,
        confidence: row.confidence,
        author_type: row.author_type,
        author_id: row.author_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        valid_from: row.valid_from,
        supersedes_id: row.supersedes_id,
        contested_by: parseJson(row.contested_by_json, []),
        projection_version: row.projection_version,
      } : {}),
    };
  }

  canonicalScope({ projectId, repositoryId, taskId }) {
    const memory = this.database.prepare(`SELECT * FROM memory_records
      WHERE project_id=? AND (repository_id IS NULL OR repository_id=?)
      AND (task_id IS NULL OR task_id=?) ORDER BY id`).all(projectId, repositoryId, taskId)
      .map((row) => ({
        ...row,
        source_refs: parseJson(row.source_refs_json, []),
        contested_by: parseJson(row.contested_by_json, []),
        tags: parseJson(row.tags_json, []),
      }));
    const evidence = this.database.prepare(`SELECT * FROM normalized_evidence
      WHERE project_id=? AND (repository_id IS NULL OR repository_id=?)
      AND (task_id IS NULL OR task_id=?) ORDER BY id`).all(projectId, repositoryId, taskId)
      .map((row) => ({
        ...row,
        source_refs: parseJson(row.source_refs_json, []),
        tags: parseJson(row.tags_json, []),
      }));
    return { schema_version: "boss-man-canonical-memory-v1", memory_records: memory, normalized_evidence: evidence };
  }

  importCanonical(canonical) {
    for (const row of canonical.memory_records ?? []) this.upsertMemory(row);
    for (const row of canonical.normalized_evidence ?? []) this.upsertEvidence(row);
    return this.rebuildIndex();
  }

  retrieve({
    projectId, repositoryId, taskId, sessionId = null, runId = null,
    query, queryId = "context-export", tokenBudget = 800, limit = 12,
  }) {
    const expression = expressionFor(query);
    const asOf = this.store.clock();
    const filters = {
      project_id: projectId,
      repository_id: repositoryId,
      task_id: taskId,
      allowed_scope_types: ["project", "repository", "task"],
      allowed_statuses: ["active"],
      allowed_trust_classes: [...ALLOWED_TRUST].sort(),
      as_of: asOf,
      token_budget: tokenBudget,
      limit,
      filter_stage: "eligible_source_cte_before_ranked_selection",
    };
    const eligible = this.database.prepare(`
      WITH eligible_sources AS (
        SELECT 'memory:' || id source_key FROM memory_records
        WHERE status='active' AND trust_class IN ('owner','verified')
          AND (expires_at IS NULL OR expires_at>@as_of) AND project_id=@project_id
          AND (repository_id IS NULL OR repository_id=@repository_id)
          AND (task_id IS NULL OR task_id=@task_id)
          AND ((scope_type='project' AND scope_id=@project_id)
            OR (scope_type='repository' AND scope_id=@repository_id)
            OR (scope_type='task' AND scope_id=@task_id))
        UNION ALL
        SELECT 'evidence:' || id source_key FROM normalized_evidence
        WHERE status='active' AND trust_class IN ('owner','verified')
          AND (expires_at IS NULL OR expires_at>@as_of) AND project_id=@project_id
          AND (repository_id IS NULL OR repository_id=@repository_id)
          AND (task_id IS NULL OR task_id=@task_id)
          AND ((scope_type='project' AND scope_id=@project_id)
            OR (scope_type='repository' AND scope_id=@repository_id)
            OR (scope_type='task' AND scope_id=@task_id))
      )
      SELECT memory_fts.source_key,bm25(memory_fts,0.0,10.0,3.0,2.0) rank
      FROM eligible_sources JOIN memory_fts USING(source_key)
      WHERE memory_fts MATCH @expression
      ORDER BY rank,source_key LIMIT @limit
    `).all({
      as_of: asOf, project_id: projectId, repository_id: repositoryId,
      task_id: taskId, expression, limit,
    });
    const raw = this.database.prepare(`SELECT source_key,bm25(memory_fts,0.0,10.0,3.0,2.0) rank
      FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank,source_key LIMIT 100`).all(expression);
    let usedTokens = 0;
    const selected = [];
    for (const row of eligible) {
      const source = this.sourceDetails(row.source_key);
      const excerpt = source.body.length <= 360 ? source.body : `${source.body.slice(0, 357)}...`;
      const estimatedTokens = Math.ceil(excerpt.length / 4);
      if (usedTokens + estimatedTokens > tokenBudget) continue;
      usedTokens += estimatedTokens;
      selected.push({ row, source, excerpt, estimatedTokens });
    }
    const selectedKeys = new Set(selected.map((item) => item.row.source_key));
    const rankedSources = selected.map(({ row, source }, index) => ({
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
    }));
    const injectedExcerpts = selected.map(({ source, excerpt, estimatedTokens }) => ({
      source_id: source.id,
      revision: source.revision,
      delimiter: "BEGIN_BOSS_MAN_EVIDENCE / END_BOSS_MAN_EVIDENCE",
      excerpt,
      excerpt_sha256: sha256(excerpt),
      source_refs: source.source_refs,
      estimated_tokens: estimatedTokens,
    }));
    const exclusions = raw.filter((row) => !selectedKeys.has(row.source_key)).map((row) => {
      const source = this.sourceDetails(row.source_key);
      const reasons = [];
      if (source.status !== "active") reasons.push(`status:${source.status}`);
      if (!ALLOWED_TRUST.has(source.trust_class)) reasons.push(`trust:${source.trust_class}`);
      if (source.expires_at && source.expires_at <= asOf) reasons.push("expired");
      if (source.project_id !== projectId) reasons.push("project_scope_mismatch");
      if (source.repository_id && source.repository_id !== repositoryId) reasons.push("repository_scope_mismatch");
      if (source.task_id && source.task_id !== taskId) reasons.push("task_scope_mismatch");
      if (reasons.length === 0) reasons.push("outside_limit_or_token_budget");
      return { source_id: source.id, revision: source.revision, reasons: [...new Set(reasons)].sort() };
    }).sort((a, b) => a.source_id.localeCompare(b.source_id));
    const body = {
      receipt_schema_version: "1.0.0",
      query_id: queryId,
      query_text: query,
      filters,
      retrieval_method: {
        name: "sqlite_fts5_bm25",
        sqlite_version: this.database.prepare("SELECT sqlite_version() version").get().version,
        index_version: INDEX_VERSION,
        query_expression: expression,
        semantic_or_vector_index_used: false,
      },
      ranked_sources: rankedSources,
      exclusions,
      injected_excerpts: injectedExcerpts,
      used_tokens: usedTokens,
    };
    const receiptSha256 = sha256(stableJson(body));
    const receipt = { receipt_id: `receipt-${receiptSha256.slice(0, 20)}`, ...body };
    this.database.prepare(`INSERT OR REPLACE INTO context_receipts(
      receipt_id,task_id,session_id,run_id,query_text,filters_json,method_json,ranked_sources_json,
      exclusions_json,injected_excerpts_json,receipt_json,receipt_sha256,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      receipt.receipt_id, taskId, sessionId, runId, query, stableJson(filters),
      stableJson(receipt.retrieval_method), stableJson(rankedSources), stableJson(exclusions),
      stableJson(injectedExcerpts), stableJson(receipt), receiptSha256, this.store.clock(),
    );
    return {
      receipt,
      receiptSha256,
      selectedRecords: selected.map(({ source }) => source),
    };
  }
}
