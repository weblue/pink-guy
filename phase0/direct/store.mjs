import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TASK_STATES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
const RUN_PHASES = new Set(["implementation", "test", "review"]);
const ORCHESTRATOR_COMMAND_KINDS = new Set(["start_task"]);
const ORCHESTRATOR_COMMAND_TERMINAL_STATES = new Set([
  "succeeded", "failed", "reconciliation_required", "cancelled",
]);
const CAPABILITY_ACTIONS = {
  worker: new Set([
    "read", "claim", "release", "progress", "block", "create_child", "request_review", "propose_complete",
    "git_status", "git_diff", "git_checkpoint_request", "git_commit_request",
  ]),
  reviewer: new Set(["read", "submit_review", "git_status", "git_diff"]),
  orchestrator: new Set([
    "read", "set_revision", "record_validation", "add_decision_gate", "complete", "reopen",
    "git_status", "git_diff", "git_checkpoint_request", "git_commit_request",
  ]),
  owner: new Set([
    "read", "add_decision_gate", "resolve_decision", "complete", "reopen",
    "git_status", "git_diff", "git_checkpoint_request", "git_commit_request",
  ]),
};

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function publicOrchestrator(row) {
  if (!row) return null;
  const { token_sha256: ignoredTokenHash, metadata_json: ignoredMetadataJson, ...visible } = row;
  return { ...visible, metadata: parseJson(row.metadata_json) ?? {} };
}

function publicOrchestratorCommand(row) {
  if (!row) return null;
  const {
    request_sha256: ignoredRequestHash,
    payload_json: ignoredPayloadJson,
    result_json: ignoredResultJson,
    ...visible
  } = row;
  return {
    ...visible,
    payload: parseJson(row.payload_json) ?? {},
    result: parseJson(row.result_json),
  };
}

function publicConversation(row) {
  if (!row) return null;
  return {
    ...row,
    model_policy: parseJson(row.model_policy_json) ?? {},
  };
}

function publicConversationTurn(row) {
  if (!row) return null;
  return {
    ...row,
    result: parseJson(row.result_json),
  };
}

function publicConversationRun(row) {
  if (!row) return null;
  const { metadata_json: ignoredMetadataJson, ...visible } = row;
  return { ...visible, metadata: parseJson(row.metadata_json) ?? {} };
}

function publicOrchestrationLease(row) {
  if (!row) return null;
  const { token_sha256: ignoredTokenHash, metadata_json: ignoredMetadataJson, ...visible } = row;
  return { ...visible, metadata: parseJson(row.metadata_json) ?? {} };
}

export class Phase0Store {
  constructor(path, { clock = () => new Date().toISOString() } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.clock = clock;
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repository_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        kind TEXT NOT NULL,
        actor TEXT NOT NULL,
        prior_status TEXT,
        new_status TEXT,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        native_path TEXT NOT NULL,
        state TEXT NOT NULL,
        model_provider TEXT,
        model_id TEXT,
        parent_session_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        state TEXT NOT NULL,
        process_id INTEGER,
        shell_process_id INTEGER,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS project_orchestrators (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        transport TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        token_sha256 TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orchestrator_commands (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL REFERENCES projects(id),
        task_id TEXT REFERENCES tasks(id),
        orchestrator_id TEXT REFERENCES project_orchestrators(id),
        kind TEXT NOT NULL,
        phase TEXT NOT NULL,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orchestrator_command_events (
        command_id TEXT NOT NULL REFERENCES orchestrator_commands(id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        orchestrator_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (command_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_description TEXT,
        state TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id),
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS topic_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT NOT NULL REFERENCES topics(id),
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orchestrator_conversations (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id),
        project_id TEXT REFERENCES projects(id),
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        native_session_path TEXT,
        state TEXT NOT NULL,
        current_turn_id TEXT,
        model_provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        model_policy_json TEXT NOT NULL,
        last_processed_owner_sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES orchestrator_conversations(id),
        sequence INTEGER NOT NULL,
        owner_message TEXT NOT NULL,
        state TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        claimed_by TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(conversation_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS conversation_events (
        conversation_id TEXT NOT NULL REFERENCES orchestrator_conversations(id),
        sequence INTEGER NOT NULL,
        turn_id TEXT REFERENCES conversation_turns(id),
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS conversation_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES orchestrator_conversations(id),
        turn_id TEXT NOT NULL REFERENCES conversation_turns(id),
        orchestration_lease_id TEXT NOT NULL REFERENCES orchestration_leases(id),
        process_id INTEGER,
        native_session_path TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        state TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS conversation_event_receipts (
        run_id TEXT NOT NULL REFERENCES conversation_runs(id),
        event_key TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        conversation_event_sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, event_key)
      );
      CREATE TABLE IF NOT EXISTS orchestration_leases (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        transport TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        token_sha256 TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_origins (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        task_version INTEGER NOT NULL,
        topic_id TEXT REFERENCES topics(id),
        conversation_id TEXT REFERENCES orchestrator_conversations(id),
        turn_id TEXT REFERENCES conversation_turns(id),
        source_snapshot_id TEXT,
        parent_task_id TEXT REFERENCES tasks(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, task_version)
      );
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
        conversation_id TEXT REFERENCES orchestrator_conversations(id),
        turn_id TEXT REFERENCES conversation_turns(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_task_id),
        CHECK (task_id <> depends_on_task_id)
      );
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL REFERENCES runs(id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, path, sha256)
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        run_id TEXT NOT NULL UNIQUE,
        repository_path TEXT NOT NULL,
        workspace_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        git_marker_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS git_operations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        run_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        prior_revision TEXT NOT NULL,
        new_revision TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credential_runs (
        run_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        billing_mode TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        canonical_unchanged INTEGER,
        created_at TEXT NOT NULL,
        verified_at TEXT
      );
      CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT PRIMARY KEY,
        token_sha256 TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        run_id TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capability_actions (
        capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        PRIMARY KEY (capability_id, action)
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        reviewer_id TEXT NOT NULL,
        run_id TEXT,
        revision TEXT NOT NULL,
        disposition TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decision_gates (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        category TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL,
        resolution_json TEXT,
        resolved_by TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS validations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        revision TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, revision)
      );
      CREATE TABLE IF NOT EXISTS merge_requests (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        revision TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, revision)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        capability_id TEXT,
        run_id TEXT,
        prior_json TEXT NOT NULL,
        new_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_context_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        source_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        record_id TEXT,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        type TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        project_id TEXT,
        repository_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        confidence REAL NOT NULL,
        trust_class TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        valid_from TEXT,
        expires_at TEXT,
        supersedes_id TEXT,
        contested_by_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        projection_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_tombstones (
        record_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL UNIQUE,
        deleted_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_refs_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS normalized_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        repository_id TEXT,
        task_id TEXT,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        status TEXT NOT NULL,
        trust_class TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        source_refs_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS context_receipts (
        receipt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        session_id TEXT,
        run_id TEXT,
        query_text TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        method_json TEXT NOT NULL,
        ranked_sources_json TEXT NOT NULL,
        exclusions_json TEXT NOT NULL,
        injected_excerpts_json TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        receipt_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS side_effects (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        state TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        result_json TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        reconciled_at TEXT,
        UNIQUE(run_id, kind, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS side_effect_receipts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        side_effect_id TEXT NOT NULL REFERENCES side_effects(id),
        phase TEXT NOT NULL,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        receipt_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("tasks", "parent_task_id", "TEXT");
    this.ensureColumn("tasks", "assigned_worker", "TEXT");
    this.ensureColumn("tasks", "revision", "TEXT");
    this.ensureColumn("tasks", "validation_passed", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "requested_review_revision", "TEXT");
    this.ensureColumn("tasks", "merge_requested", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "acceptance_criteria_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("projects", "repository_id", "TEXT");
    this.ensureColumn("task_events", "actor_role", "TEXT");
    this.ensureColumn("task_events", "run_id", "TEXT");
    this.ensureColumn("task_events", "task_version", "INTEGER");
    this.ensureColumn("runs", "container_id", "TEXT");
    this.ensureColumn("runs", "image_id", "TEXT");
    this.ensureColumn("runs", "workspace_id", "TEXT");
    this.ensureColumn("runs", "credential_profile", "TEXT");
    this.ensureColumn("runs", "orchestrator_id", "TEXT");
    this.ensureColumn("runs", "phase", "TEXT");
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS memory_records_scope_status
        ON memory_records(project_id,repository_id,task_id,scope_type,scope_id,status,trust_class);
      CREATE INDEX IF NOT EXISTS normalized_evidence_scope_status
        ON normalized_evidence(project_id,repository_id,task_id,scope_type,scope_id,status,trust_class);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source_key UNINDEXED,
        title,
        body,
        tags,
        tokenize='porter unicode61'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_orchestrator_per_project
        ON project_orchestrators(project_id) WHERE status='active';
      CREATE INDEX IF NOT EXISTS orchestrator_commands_project_state
        ON orchestrator_commands(project_id,state,sequence);
      CREATE INDEX IF NOT EXISTS topics_project_state
        ON topics(project_id,state,updated_at);
      CREATE INDEX IF NOT EXISTS conversation_turns_state
        ON conversation_turns(state,created_at,conversation_id,sequence);
      CREATE INDEX IF NOT EXISTS conversation_runs_turn_state
        ON conversation_runs(turn_id,state,started_at);
      CREATE INDEX IF NOT EXISTS task_dependencies_reverse
        ON task_dependencies(depends_on_task_id,task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_orchestration_lease_per_scope
        ON orchestration_leases(scope_type,scope_id) WHERE status='active';
    `);
  }

  ensureColumn(table, column, definition) {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close() {
    this.database.close();
  }

  seedProjectTask({
    projectId = "phase0-project",
    repositoryId = `${projectId}-repository`,
    projectName = "Phase 0 fixture",
    taskId = "phase0-task",
    repositoryPath,
    title,
    revision = "fixture-revision-1",
    acceptanceCriteria = [],
  }) {
    const now = this.clock();
    this.database
      .prepare("INSERT OR IGNORE INTO projects(id,name,repository_path,created_at,repository_id) VALUES(?,?,?,?,?)")
      .run(projectId, projectName, repositoryPath, now, repositoryId);
    this.database.prepare("UPDATE projects SET repository_id=COALESCE(repository_id,?) WHERE id=?").run(repositoryId, projectId);
    this.database
      .prepare(`INSERT OR IGNORE INTO tasks(
        id,project_id,title,status,version,updated_at,revision,validation_passed,merge_requested,acceptance_criteria_json
      ) VALUES(?,?,?,?,1,?,?,0,0,?)`)
      .run(taskId, projectId, title, "ready", now, revision, JSON.stringify(acceptanceCriteria));
    this.database.prepare("UPDATE tasks SET revision=COALESCE(revision,?) WHERE id=?").run(revision, taskId);
    return this.getTask(taskId);
  }

  createOwnerTask({
    projectId,
    title,
    acceptanceCriteria = [],
    revision,
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    if (!normalizedTitle || normalizedTitle.length > 500 || normalizedTitle.includes("\0")) {
      throw codedError("invalid_request", "task title must be between 1 and 500 characters");
    }
    if (
      !Array.isArray(acceptanceCriteria) || acceptanceCriteria.length > 100
      || acceptanceCriteria.some((item) => typeof item !== "string" || !item.trim() || item.length > 2000)
    ) {
      throw codedError("invalid_request", "acceptance criteria must be a list of non-empty strings");
    }
    if (!revision) throw codedError("invalid_request", "task repository revision is required");
    if (!this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    const normalizedCriteria = acceptanceCriteria.map((item) => item.trim());
    const requestSha256 = sha256(JSON.stringify({
      action: "create_task", projectId, title: normalizedTitle, acceptanceCriteria: normalizedCriteria,
    }));
    const prior = this.database.prepare("SELECT * FROM audit_events WHERE idempotency_key=?").get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.type !== "task_created") {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different owner mutation");
      }
      return { replayed: true, task: this.parseAuditEvent(prior).current };
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO tasks(
        id,project_id,title,status,version,updated_at,revision,validation_passed,
        merge_requested,acceptance_criteria_json
      ) VALUES(?,?,?,'ready',1,?,?,0,0,?)`).run(
        id, projectId, normalizedTitle, now, revision, JSON.stringify(normalizedCriteria),
      );
      const current = this.getTaskDetails(id);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, "task_created", "local-owner", null, "ready",
        JSON.stringify({ title: normalizedTitle, acceptanceCriteria: normalizedCriteria }),
        idempotencyKey, now, "owner", null, 1,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, "task_created", "local-owner", "owner", null, null, "null", JSON.stringify(current),
        JSON.stringify({ title: normalizedTitle, acceptanceCriteria: normalizedCriteria }),
        idempotencyKey, requestSha256, now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, task: this.getTaskDetails(id) };
  }

  scheduleOwnerTaskRun({ taskId, phase, idempotencyKey }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!RUN_PHASES.has(phase)) throw codedError("invalid_request", `unsupported run phase: ${phase}`);
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const payload = { source: "local_owner" };
    const commandRequest = {
      projectId: task.project_id, taskId, kind: "start_task", phase, payload,
    };
    const commandRequestSha256 = sha256(JSON.stringify(commandRequest));
    const priorCommand = this.database.prepare(
      "SELECT * FROM orchestrator_commands WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (priorCommand) {
      const priorAudit = this.database.prepare(
        "SELECT * FROM audit_events WHERE idempotency_key=? AND type='task_scheduled'",
      ).get(idempotencyKey);
      if (priorCommand.request_sha256 !== commandRequestSha256 || !priorAudit) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different scheduling request");
      }
      return {
        replayed: true,
        task: this.parseAuditEvent(priorAudit).current,
        command: publicOrchestratorCommand(priorCommand),
      };
    }
    const unresolvedDependency = this.database.prepare(`SELECT t.id,t.title,t.status
      FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_task_id
      WHERE d.task_id=? AND t.status<>'done' ORDER BY t.id LIMIT 1`).get(taskId);
    if (unresolvedDependency) {
      throw codedError(
        "transition_denied",
        `task dependency is not complete: ${unresolvedDependency.id}`,
      );
    }
    const orchestrator = this.activeProjectOrchestrator(task.project_id);
    if (!orchestrator) {
      throw codedError("orchestrator_unavailable", "project has no active orchestrator lease");
    }
    if (!["ready", "backlog"].includes(task.status) || task.assigned_worker) {
      throw codedError("transition_denied", "only an unassigned ready or backlog task can be scheduled");
    }
    const commandId = randomUUID();
    const actorId = `task-agent:${phase}:${commandId}`;
    const now = this.clock();
    const prior = this.getTaskDetails(taskId);
    const auditRequestSha256 = sha256(JSON.stringify({ action: "schedule_task", taskId, phase }));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO orchestrator_commands(
        id,project_id,task_id,orchestrator_id,kind,phase,state,payload_json,request_sha256,
        idempotency_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?)`).run(
        commandId, task.project_id, taskId, orchestrator.id, "start_task", phase,
        JSON.stringify(payload), commandRequestSha256, idempotencyKey, now, now,
      );
      const nextVersion = task.version + 1;
      const changed = this.database.prepare(`UPDATE tasks SET
        status='in_progress',assigned_worker=?,version=?,updated_at=?
        WHERE id=? AND version=? AND status IN ('ready','backlog') AND assigned_worker IS NULL`).run(
        actorId, nextVersion, now, taskId, task.version,
      );
      if (Number(changed.changes) !== 1) throw codedError("version_conflict", "task changed during scheduling");
      const current = this.getTaskDetails(taskId);
      this.appendOrchestratorCommandEvent(commandId, "queued", orchestrator.id, {
        projectId: task.project_id, taskId, kind: "start_task", phase, source: "local_owner",
      }, now);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, "task_scheduled", "local-owner", task.status, "in_progress",
        JSON.stringify({ phase, commandId, assignedWorker: actorId }),
        idempotencyKey, now, "owner", null, nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, "task_scheduled", "local-owner", "owner", null, null,
        JSON.stringify(prior), JSON.stringify(current),
        JSON.stringify({ phase, commandId, assignedWorker: actorId }),
        idempotencyKey, auditRequestSha256, now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      task: this.getTaskDetails(taskId),
      command: this.orchestratorCommand(commandId),
    };
  }

  getTask(taskId) {
    return this.database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) ?? null;
  }

  getProject(projectId) {
    return this.database.prepare("SELECT * FROM projects WHERE id=?").get(projectId) ?? null;
  }

  projects() {
    return this.database.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status IN ('in_progress','review','blocked')) AS active_task_count
      FROM projects p ORDER BY p.name,p.id`).all();
  }

  createTopic({
    title,
    ownerDescription = null,
    projectId = null,
    idempotencyKey,
    modelProvider,
    modelId,
    thinkingLevel = "medium",
    modelPolicy = {},
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    const normalizedDescription = typeof ownerDescription === "string" && ownerDescription.trim()
      ? ownerDescription.trim() : null;
    if (!normalizedTitle || normalizedTitle.length > 500 || normalizedTitle.includes("\0")) {
      throw codedError("invalid_request", "topic title must be between 1 and 500 characters");
    }
    if (normalizedDescription && (normalizedDescription.length > 20_000 || normalizedDescription.includes("\0"))) {
      throw codedError("invalid_request", "topic description must be at most 20000 characters");
    }
    if (projectId && !this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    if (!modelProvider || !modelId || !thinkingLevel) {
      throw codedError("invalid_request", "topic conversation requires an assigned provider, model, and thinking level");
    }
    const request = {
      action: "create_topic",
      title: normalizedTitle,
      ownerDescription: normalizedDescription,
      projectId,
      modelProvider,
      modelId,
      thinkingLevel,
      modelPolicy,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const prior = this.database.prepare("SELECT * FROM topic_events WHERE idempotency_key=?").get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.type !== "topic_created") {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different topic mutation");
      }
      const topicId = parseJson(prior.payload_json)?.topicId;
      return { replayed: true, ...this.topicDetails(topicId) };
    }
    const topicId = randomUUID();
    const conversationId = randomUUID();
    const now = this.clock();
    const scopeType = projectId ? "project" : "system_intake";
    const scopeId = projectId ?? "system-intake";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO topics(
        id,title,owner_description,state,project_id,version,created_at,updated_at
      ) VALUES(?,?,?,'open',?,1,?,?)`).run(
        topicId, normalizedTitle, normalizedDescription, projectId, now, now,
      );
      this.database.prepare(`INSERT INTO orchestrator_conversations(
        id,topic_id,project_id,scope_type,scope_id,state,model_provider,model_id,
        thinking_level,model_policy_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,'idle',?,?,?,?,?,?)`).run(
        conversationId, topicId, projectId, scopeType, scopeId, modelProvider, modelId,
        thinkingLevel, JSON.stringify(modelPolicy), now, now,
      );
      this.database.prepare(`INSERT INTO topic_events(
        topic_id,type,actor,payload_json,idempotency_key,request_sha256,created_at
      ) VALUES(?,'topic_created','local-owner',?,?,?,?)`).run(
        topicId,
        JSON.stringify({
          topicId,
          conversationId,
          projectId,
          title: normalizedTitle,
          ownerDescription: normalizedDescription,
          scopeType,
          scopeId,
          modelProvider,
          modelId,
          thinkingLevel,
        }),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.appendConversationEvent(conversationId, null, "conversation_created", "control_plane", {
        topicId, projectId, scopeType, scopeId, modelProvider, modelId, thinkingLevel,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, ...this.topicDetails(topicId) };
  }

  topics({ includeArchived = false } = {}) {
    const rows = includeArchived
      ? this.database.prepare("SELECT * FROM topics ORDER BY updated_at DESC,id").all()
      : this.database.prepare("SELECT * FROM topics WHERE state<>'archived' ORDER BY updated_at DESC,id").all();
    return rows.map((topic) => ({
      ...topic,
      conversation: publicConversation(this.database.prepare(
        "SELECT * FROM orchestrator_conversations WHERE topic_id=?",
      ).get(topic.id)),
      turn_count: Number(this.database.prepare(`SELECT COUNT(*) value FROM conversation_turns t
        JOIN orchestrator_conversations c ON c.id=t.conversation_id WHERE c.topic_id=?`).get(topic.id).value),
    }));
  }

  topicDetails(topicId) {
    const topic = this.database.prepare("SELECT * FROM topics WHERE id=?").get(topicId);
    if (!topic) return null;
    const conversation = publicConversation(this.database.prepare(
      "SELECT * FROM orchestrator_conversations WHERE topic_id=?",
    ).get(topicId));
    return {
      topic,
      conversation,
      events: this.database.prepare(
        "SELECT sequence,type,actor,payload_json,created_at FROM topic_events WHERE topic_id=? ORDER BY sequence",
      ).all(topicId).map((row) => ({ ...row, payload: parseJson(row.payload_json) ?? {} })),
      turns: conversation ? this.conversationTurns(conversation.id) : [],
    };
  }

  archiveTopic({ topicId, idempotencyKey }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const topic = this.database.prepare("SELECT * FROM topics WHERE id=?").get(topicId);
    if (!topic) throw codedError("not_found", `unknown topic: ${topicId}`);
    const requestSha256 = sha256(JSON.stringify({ action: "archive_topic", topicId }));
    const prior = this.database.prepare("SELECT * FROM topic_events WHERE idempotency_key=?").get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.type !== "topic_archived") {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different topic mutation");
      }
      return { replayed: true, ...this.topicDetails(topicId) };
    }
    if (topic.state === "archived") throw codedError("transition_denied", "topic is already archived");
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        "UPDATE topics SET state='archived',version=version+1,updated_at=? WHERE id=?",
      ).run(now, topicId);
      this.database.prepare(`UPDATE orchestrator_conversations SET
        state='archived',updated_at=? WHERE topic_id=? AND state NOT IN ('running','reconciliation_required')`).run(
        now, topicId,
      );
      this.database.prepare(`INSERT INTO topic_events(
        topic_id,type,actor,payload_json,idempotency_key,request_sha256,created_at
      ) VALUES(?,'topic_archived','local-owner','{}',?,?,?)`).run(
        topicId, idempotencyKey, requestSha256, now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, ...this.topicDetails(topicId) };
  }

  getConversation(conversationId) {
    return publicConversation(this.database.prepare(
      "SELECT * FROM orchestrator_conversations WHERE id=?",
    ).get(conversationId));
  }

  conversationTurns(conversationId) {
    return this.database.prepare(
      "SELECT * FROM conversation_turns WHERE conversation_id=? ORDER BY sequence",
    ).all(conversationId).map((row) => publicConversationTurn(row));
  }

  conversationEvents(conversationId, { after = 0 } = {}) {
    if (!this.getConversation(conversationId)) {
      throw codedError("not_found", `unknown conversation: ${conversationId}`);
    }
    return this.database.prepare(`SELECT * FROM conversation_events
      WHERE conversation_id=? AND sequence>? ORDER BY sequence`).all(conversationId, after)
      .map((row) => ({ ...row, payload: parseJson(row.payload_json) ?? {} }));
  }

  conversationContext(conversationId) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw codedError("not_found", `unknown conversation: ${conversationId}`);
    const topic = this.database.prepare("SELECT * FROM topics WHERE id=?").get(conversation.topic_id);
    const project = conversation.project_id ? this.getProject(conversation.project_id) : null;
    const tasks = conversation.project_id
      ? this.database.prepare("SELECT * FROM tasks WHERE project_id=? ORDER BY updated_at DESC,id")
        .all(conversation.project_id)
        .map((task) => this.getTaskDetails(task.id))
      : [];
    return { topic, conversation, project, tasks };
  }

  submitConversationTurn({ conversationId, message, idempotencyKey }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const normalizedMessage = typeof message === "string" ? message.trim() : "";
    if (!normalizedMessage || normalizedMessage.length > 32_000 || normalizedMessage.includes("\0")) {
      throw codedError("invalid_request", "owner message must be between 1 and 32000 characters");
    }
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw codedError("not_found", `unknown conversation: ${conversationId}`);
    const topic = this.database.prepare("SELECT state FROM topics WHERE id=?").get(conversation.topic_id);
    if (topic?.state === "archived" || conversation.state === "archived") {
      throw codedError("transition_denied", "archived conversations cannot accept new turns");
    }
    if (conversation.state === "reconciliation_required") {
      throw codedError("transition_denied", "conversation requires reconciliation before another turn");
    }
    const requestSha256 = sha256(JSON.stringify({
      action: "submit_conversation_turn", conversationId, message: normalizedMessage,
    }));
    const prior = this.database.prepare(
      "SELECT * FROM conversation_turns WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.conversation_id !== conversationId) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different conversation turn");
      }
      return { replayed: true, turn: publicConversationTurn(prior) };
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const next = this.database.prepare(`SELECT COALESCE(MAX(sequence),0)+1 value
        FROM conversation_turns WHERE conversation_id=?`).get(conversationId);
      this.database.prepare(`INSERT INTO conversation_turns(
        id,conversation_id,sequence,owner_message,state,idempotency_key,request_sha256,
        created_at,updated_at
      ) VALUES(?,?,?,?,'queued',?,?,?,?)`).run(
        id, conversationId, Number(next.value), normalizedMessage, idempotencyKey, requestSha256, now, now,
      );
      if (!["running", "queued"].includes(conversation.state)) {
        this.database.prepare(
          "UPDATE orchestrator_conversations SET state='queued',updated_at=? WHERE id=?",
        ).run(now, conversationId);
      }
      this.appendConversationEvent(conversationId, id, "owner_message_queued", "local-owner", {
        turnSequence: Number(next.value),
        messageSha256: sha256(normalizedMessage),
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      turn: publicConversationTurn(this.database.prepare("SELECT * FROM conversation_turns WHERE id=?").get(id)),
    };
  }

  appendConversationEvent(conversationId, turnId, type, actor, payload, now = this.clock()) {
    const next = this.database.prepare(`SELECT COALESCE(MAX(sequence),0)+1 value
      FROM conversation_events WHERE conversation_id=?`).get(conversationId);
    this.database.prepare(`INSERT INTO conversation_events(
      conversation_id,sequence,turn_id,type,actor,payload_json,created_at
    ) VALUES(?,?,?,?,?,?,?)`).run(
      conversationId, Number(next.value), turnId, type, actor, JSON.stringify(payload), now,
    );
    return Number(next.value);
  }

  registerOrchestrationLease({
    scopeType,
    scopeId = null,
    transport = "daemon",
    endpoint,
    metadata = {},
    leaseSeconds = 90,
  }) {
    if (!["system_intake", "project"].includes(scopeType)) {
      throw codedError("invalid_request", "orchestration scope must be system_intake or project");
    }
    const normalizedScopeId = scopeType === "system_intake" ? "system-intake" : scopeId;
    if (scopeType === "project" && !this.getProject(normalizedScopeId)) {
      throw codedError("not_found", `unknown project: ${normalizedScopeId}`);
    }
    if (!["daemon", "tmux"].includes(transport) || !endpoint) {
      throw codedError("invalid_request", "orchestrator transport and endpoint are required");
    }
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 3600) {
      throw codedError("invalid_request", "orchestrator lease must be between 15 and 3600 seconds");
    }
    this.expireOrchestrationLeases();
    const active = this.database.prepare(`SELECT id FROM orchestration_leases
      WHERE scope_type=? AND scope_id=? AND status='active'`).get(scopeType, normalizedScopeId);
    if (active) throw codedError("orchestrator_conflict", `scope already has an active lease: ${active.id}`);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const now = this.clock();
    const leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
    this.database.prepare(`INSERT INTO orchestration_leases(
      id,scope_type,scope_id,transport,endpoint,token_sha256,status,lease_expires_at,
      last_heartbeat_at,metadata_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,'active',?,?,?,?,?)`).run(
      id, scopeType, normalizedScopeId, transport, endpoint, sha256(token), leaseExpiresAt,
      now, JSON.stringify(metadata), now, now,
    );
    return { ...publicOrchestrationLease(this.orchestrationLease(id)), token };
  }

  orchestrationLease(id) {
    return publicOrchestrationLease(
      this.database.prepare("SELECT * FROM orchestration_leases WHERE id=?").get(id),
    );
  }

  orchestrationLeases() {
    this.expireOrchestrationLeases();
    return this.database.prepare("SELECT * FROM orchestration_leases ORDER BY scope_type,scope_id,created_at")
      .all().map((row) => publicOrchestrationLease(row));
  }

  authorizeOrchestrationLease(token) {
    if (!token) throw codedError("orchestrator_denied", "orchestrator bearer token is required");
    this.expireOrchestrationLeases();
    const row = this.database.prepare(`SELECT * FROM orchestration_leases
      WHERE token_sha256=? AND status='active'`).get(sha256(token));
    if (!row) throw codedError("orchestrator_denied", "orchestrator lease is missing or expired");
    return { ...row, metadata: parseJson(row.metadata_json) ?? {} };
  }

  heartbeatOrchestrationLease({ token, leaseSeconds = 90 }) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 3600) {
      throw codedError("invalid_request", "orchestrator lease must be between 15 and 3600 seconds");
    }
    const lease = this.authorizeOrchestrationLease(token);
    const now = this.clock();
    const leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
    this.database.prepare(`UPDATE orchestration_leases SET
      lease_expires_at=?,last_heartbeat_at=?,updated_at=? WHERE id=?`).run(
      leaseExpiresAt, now, now, lease.id,
    );
    return this.orchestrationLease(lease.id);
  }

  releaseOrchestrationLease(token) {
    const lease = this.authorizeOrchestrationLease(token);
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE orchestration_leases SET
        status='released',updated_at=? WHERE id=? AND status='active'`).run(now, lease.id);
      this.reconcileConversationTurns(lease.id, "orchestrator_lease_released", now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.orchestrationLease(lease.id);
  }

  expireOrchestrationLeases() {
    const now = this.clock();
    const expired = this.database.prepare(`SELECT id FROM orchestration_leases
      WHERE status='active' AND lease_expires_at<=? ORDER BY id`).all(now);
    if (expired.length === 0) return [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const { id } of expired) {
        this.database.prepare(`UPDATE orchestration_leases SET
          status='expired',updated_at=? WHERE id=? AND status='active'`).run(now, id);
        this.reconcileConversationTurns(id, "orchestrator_lease_expired", now);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return expired.map(({ id }) => id);
  }

  claimConversationTurn(token) {
    const lease = this.authorizeOrchestrationLease(token);
    const turn = this.database.prepare(`SELECT t.* FROM conversation_turns t
      JOIN orchestrator_conversations c ON c.id=t.conversation_id
      WHERE t.state='queued' AND c.scope_type=? AND c.scope_id=?
        AND c.state NOT IN ('running','reconciliation_required','archived')
      ORDER BY t.created_at,t.conversation_id,t.sequence LIMIT 1`).get(lease.scope_type, lease.scope_id);
    if (!turn) return null;
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`UPDATE conversation_turns SET
        state='running',claimed_by=?,claimed_at=?,updated_at=?
        WHERE id=? AND state='queued'`).run(lease.id, now, now, turn.id);
      if (Number(result.changes) !== 1) {
        throw codedError("command_conflict", "conversation turn was claimed concurrently");
      }
      this.database.prepare(`UPDATE orchestrator_conversations SET
        state='running',current_turn_id=?,updated_at=? WHERE id=?`).run(
        turn.id, now, turn.conversation_id,
      );
      this.appendConversationEvent(turn.conversation_id, turn.id, "turn_running", "orchestrator", {
        leaseId: lease.id,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return publicConversationTurn(
      this.database.prepare("SELECT * FROM conversation_turns WHERE id=?").get(turn.id),
    );
  }

  activeConversationTurnForLease(token, turnId) {
    const lease = this.authorizeOrchestrationLease(token);
    const turn = this.database.prepare("SELECT * FROM conversation_turns WHERE id=?").get(turnId);
    if (!turn) throw codedError("not_found", `unknown conversation turn: ${turnId}`);
    if (turn.state !== "running" || turn.claimed_by !== lease.id) {
      throw codedError("orchestrator_denied", "turn is not owned by this active orchestration lease");
    }
    const conversation = this.getConversation(turn.conversation_id);
    if (conversation.scope_type !== lease.scope_type || conversation.scope_id !== lease.scope_id) {
      throw codedError("orchestrator_denied", "turn is outside the active orchestration scope");
    }
    return { lease, turn, conversation };
  }

  authorizeOrchestrationConversation(token, conversationId) {
    const lease = this.authorizeOrchestrationLease(token);
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw codedError("not_found", `unknown conversation: ${conversationId}`);
    if (conversation.scope_type !== lease.scope_type || conversation.scope_id !== lease.scope_id) {
      throw codedError("orchestrator_denied", "conversation is outside the active orchestration scope");
    }
    return { lease, conversation };
  }

  activeConversationTurnForConversation(token, conversationId) {
    const lease = this.authorizeOrchestrationLease(token);
    const turn = this.database.prepare(`SELECT * FROM conversation_turns
      WHERE conversation_id=? AND state='running' AND claimed_by=?`).get(conversationId, lease.id);
    if (!turn) {
      throw codedError("orchestrator_denied", "conversation has no turn owned by this orchestration lease");
    }
    return this.activeConversationTurnForLease(token, turn.id);
  }

  startConversationRun({
    token,
    turnId,
    runId,
    processId = null,
    nativeSessionPath,
    metadata = {},
  }) {
    if (!runId || !nativeSessionPath) {
      throw codedError("invalid_request", "conversation run id and native session path are required");
    }
    const { lease, turn, conversation } = this.activeConversationTurnForLease(token, turnId);
    const prior = this.database.prepare("SELECT * FROM conversation_runs WHERE id=?").get(runId);
    if (prior) {
      if (
        prior.turn_id !== turnId
        || prior.orchestration_lease_id !== lease.id
        || prior.native_session_path !== nativeSessionPath
      ) {
        throw codedError("idempotency_conflict", "conversation run id was reused for a different runtime");
      }
      return { replayed: true, run: publicConversationRun(prior) };
    }
    const active = this.database.prepare(
      "SELECT id FROM conversation_runs WHERE turn_id=? AND state='running'",
    ).get(turnId);
    if (active) throw codedError("command_conflict", `turn already has an active run: ${active.id}`);
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO conversation_runs(
        id,conversation_id,turn_id,orchestration_lease_id,process_id,native_session_path,
        model_provider,model_id,thinking_level,state,metadata_json,started_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'running',?,?)`).run(
        runId,
        conversation.id,
        turnId,
        lease.id,
        processId,
        nativeSessionPath,
        conversation.model_provider,
        conversation.model_id,
        conversation.thinking_level,
        JSON.stringify(metadata),
        now,
      );
      this.database.prepare(`UPDATE orchestrator_conversations SET
        native_session_path=?,updated_at=? WHERE id=?`).run(nativeSessionPath, now, conversation.id);
      this.appendConversationEvent(conversation.id, turnId, "pi_run_started", "orchestrator", {
        runId,
        processId,
        nativeSessionPath,
        modelProvider: conversation.model_provider,
        modelId: conversation.model_id,
        thinkingLevel: conversation.thinking_level,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      run: publicConversationRun(this.database.prepare("SELECT * FROM conversation_runs WHERE id=?").get(runId)),
    };
  }

  appendConversationRuntimeEvent({ token, turnId, runId, eventKey, type, payload = {} }) {
    if (!eventKey || !type) throw codedError("invalid_request", "runtime event key and type are required");
    const { lease, turn } = this.activeConversationTurnForLease(token, turnId);
    const run = this.database.prepare("SELECT * FROM conversation_runs WHERE id=?").get(runId);
    if (!run || run.turn_id !== turnId || run.orchestration_lease_id !== lease.id || run.state !== "running") {
      throw codedError("orchestrator_denied", "runtime event is outside the active conversation run");
    }
    const requestSha256 = sha256(JSON.stringify({ turnId, runId, eventKey, type, payload }));
    const prior = this.database.prepare(`SELECT * FROM conversation_event_receipts
      WHERE run_id=? AND event_key=?`).get(runId, eventKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "runtime event key was reused with different content");
      }
      return { replayed: true, sequence: prior.conversation_event_sequence };
    }
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const sequence = this.appendConversationEvent(
        turn.conversation_id,
        turnId,
        `pi_${type}`,
        "pi",
        { runId, ...payload },
        now,
      );
      this.database.prepare(`INSERT INTO conversation_event_receipts(
        run_id,event_key,request_sha256,conversation_event_sequence,created_at
      ) VALUES(?,?,?,?,?)`).run(runId, eventKey, requestSha256, sequence, now);
      this.database.exec("COMMIT");
      return { replayed: false, sequence };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createConversationTask({
    token,
    turnId,
    title,
    acceptanceCriteria = [],
    revision,
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const { turn, conversation } = this.activeConversationTurnForLease(token, turnId);
    if (!conversation.project_id) {
      throw codedError("project_required", "an unbound topic cannot create executable tasks");
    }
    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    if (!normalizedTitle || normalizedTitle.length > 500 || normalizedTitle.includes("\0")) {
      throw codedError("invalid_request", "task title must be between 1 and 500 characters");
    }
    if (
      !Array.isArray(acceptanceCriteria) || acceptanceCriteria.length > 100
      || acceptanceCriteria.some((item) => typeof item !== "string" || !item.trim() || item.length > 2000)
    ) {
      throw codedError("invalid_request", "acceptance criteria must be a list of non-empty strings");
    }
    if (!revision) throw codedError("invalid_request", "task repository revision is required");
    const normalizedCriteria = acceptanceCriteria.map((item) => item.trim());
    const requestSha256 = sha256(JSON.stringify({
      action: "conversation_create_task",
      turnId,
      projectId: conversation.project_id,
      title: normalizedTitle,
      acceptanceCriteria: normalizedCriteria,
    }));
    const prior = this.database.prepare("SELECT * FROM audit_events WHERE idempotency_key=?").get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.type !== "task_created") {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different task mutation");
      }
      return { replayed: true, task: this.parseAuditEvent(prior).current };
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO tasks(
        id,project_id,title,status,version,updated_at,revision,validation_passed,
        merge_requested,acceptance_criteria_json
      ) VALUES(?,?,?,'ready',1,?,?,0,0,?)`).run(
        id, conversation.project_id, normalizedTitle, now, revision, JSON.stringify(normalizedCriteria),
      );
      const current = this.getTaskDetails(id);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        id,
        "task_created",
        `orchestrator:${conversation.id}`,
        null,
        "ready",
        JSON.stringify({
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
          conversationId: conversation.id,
          turnId,
        }),
        idempotencyKey,
        now,
        "orchestrator",
        null,
        1,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id,
        "task_created",
        `orchestrator:${conversation.id}`,
        "orchestrator",
        null,
        null,
        "null",
        JSON.stringify(current),
        JSON.stringify({ title: normalizedTitle, acceptanceCriteria: normalizedCriteria, turnId }),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.database.prepare(`INSERT INTO task_origins(
        task_id,task_version,topic_id,conversation_id,turn_id,created_at
      ) VALUES(?,?,?,?,?,?)`).run(id, 1, conversation.topic_id, conversation.id, turn.id, now);
      this.appendConversationEvent(conversation.id, turn.id, "task_mutation_applied", "orchestrator", {
        operation: "create",
        taskId: id,
        taskVersion: 1,
        title: normalizedTitle,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, task: this.getTaskDetails(id) };
  }

  mutateConversationTask({
    token,
    turnId,
    operation,
    taskId,
    expectedVersion,
    title = null,
    acceptanceCriteria = null,
    dependsOnTaskId = null,
    body = null,
    category = null,
    question = null,
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!["update", "split", "add_dependency", "record_assumption", "require_decision"].includes(operation)) {
      throw codedError("invalid_request", `unsupported conversation task mutation: ${operation}`);
    }
    const { turn, conversation } = this.activeConversationTurnForLease(token, turnId);
    if (!conversation.project_id) {
      throw codedError("project_required", "an unbound topic cannot mutate executable tasks");
    }
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (task.project_id !== conversation.project_id) {
      throw codedError("orchestrator_denied", "task mutation is outside the conversation project scope");
    }
    if (task.status === "done") {
      throw codedError("transition_denied", "completed tasks must be reopened before mutation");
    }
    if (!Number.isInteger(expectedVersion)) {
      throw codedError("invalid_request", "expected task version is required");
    }

    let normalizedTitle = null;
    let normalizedCriteria = null;
    let normalizedBody = null;
    let normalizedCategory = null;
    let normalizedQuestion = null;
    if (operation === "update" || operation === "split") {
      normalizedTitle = typeof title === "string" ? title.trim() : "";
      if (!normalizedTitle || normalizedTitle.length > 500 || normalizedTitle.includes("\0")) {
        throw codedError("invalid_request", "task title must be between 1 and 500 characters");
      }
      if (
        !Array.isArray(acceptanceCriteria) || acceptanceCriteria.length > 100
        || acceptanceCriteria.some(
          (item) => typeof item !== "string" || !item.trim() || item.length > 2000,
        )
      ) {
        throw codedError("invalid_request", "acceptance criteria must be a list of non-empty strings");
      }
      normalizedCriteria = acceptanceCriteria.map((item) => item.trim());
    } else if (operation === "add_dependency") {
      if (!dependsOnTaskId || dependsOnTaskId === taskId) {
        throw codedError("invalid_request", "a task must depend on a different task");
      }
      const dependency = this.getTask(dependsOnTaskId);
      if (!dependency) throw codedError("not_found", `unknown dependency task: ${dependsOnTaskId}`);
      if (dependency.project_id !== conversation.project_id) {
        throw codedError("orchestrator_denied", "dependency is outside the conversation project scope");
      }
      const cycle = this.database.prepare(`WITH RECURSIVE reachable(id) AS (
        VALUES(?)
        UNION
        SELECT d.depends_on_task_id FROM task_dependencies d JOIN reachable r ON d.task_id=r.id
      ) SELECT 1 value FROM reachable WHERE id=? LIMIT 1`).get(dependsOnTaskId, taskId);
      if (cycle) throw codedError("transition_denied", "task dependency would create a cycle");
    } else if (operation === "record_assumption") {
      normalizedBody = typeof body === "string" ? body.trim() : "";
      if (!normalizedBody || normalizedBody.length > 20_000 || normalizedBody.includes("\0")) {
        throw codedError("invalid_request", "assumption must be between 1 and 20000 characters");
      }
    } else if (operation === "require_decision") {
      normalizedCategory = typeof category === "string" ? category.trim() : "";
      normalizedQuestion = typeof question === "string" ? question.trim() : "";
      if (
        !normalizedCategory || normalizedCategory.length > 200 || normalizedCategory.includes("\0")
        || !normalizedQuestion || normalizedQuestion.length > 20_000 || normalizedQuestion.includes("\0")
      ) {
        throw codedError("invalid_request", "decision category and question are required");
      }
    }

    const request = {
      action: `conversation_${operation}`,
      conversationId: conversation.id,
      turnId,
      taskId,
      expectedVersion,
      title: normalizedTitle,
      acceptanceCriteria: normalizedCriteria,
      dependsOnTaskId,
      body: normalizedBody,
      category: normalizedCategory,
      question: normalizedQuestion,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const expectedType = {
      update: "task_updated",
      split: "task_split",
      add_dependency: "task_dependency_added",
      record_assumption: "task_assumption_recorded",
      require_decision: "decision_required",
    }[operation];
    const priorEvent = this.database.prepare(
      "SELECT * FROM audit_events WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (priorEvent) {
      if (priorEvent.request_sha256 !== requestSha256 || priorEvent.type !== expectedType) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different task mutation");
      }
      const prior = this.parseAuditEvent(priorEvent);
      const childTaskId = prior.payload?.childTaskId ?? null;
      return {
        replayed: true,
        operation,
        task: this.getTaskDetails(taskId),
        childTask: childTaskId ? this.getTaskDetails(childTaskId) : null,
      };
    }
    if (expectedVersion !== task.version) {
      throw codedError(
        "version_conflict",
        `task version conflict: expected ${expectedVersion}, current ${task.version}`,
      );
    }
    if (
      operation === "add_dependency"
      && this.database.prepare(
        "SELECT 1 value FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?",
      ).get(taskId, dependsOnTaskId)
    ) {
      throw codedError("transition_denied", "task dependency already exists");
    }

    const now = this.clock();
    const nextVersion = task.version + 1;
    const prior = this.getTaskDetails(taskId);
    const actor = `orchestrator:${conversation.id}`;
    let childTaskId = null;
    let contextItemId = null;
    let decisionId = null;
    const eventPayload = { operation, turnId };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (operation === "update") {
        this.database.prepare(`UPDATE tasks SET
          title=?,acceptance_criteria_json=?,version=?,updated_at=? WHERE id=? AND version=?`).run(
          normalizedTitle,
          JSON.stringify(normalizedCriteria),
          nextVersion,
          now,
          taskId,
          task.version,
        );
        Object.assign(eventPayload, { title: normalizedTitle, acceptanceCriteria: normalizedCriteria });
      } else if (operation === "split") {
        childTaskId = randomUUID();
        this.database.prepare(`INSERT INTO tasks(
          id,project_id,title,status,version,updated_at,parent_task_id,revision,
          validation_passed,merge_requested,acceptance_criteria_json
        ) VALUES(?,?,?,'ready',1,?,?,?,0,0,?)`).run(
          childTaskId,
          task.project_id,
          normalizedTitle,
          now,
          taskId,
          task.revision,
          JSON.stringify(normalizedCriteria),
        );
        this.database.prepare(
          "UPDATE tasks SET version=?,updated_at=? WHERE id=? AND version=?",
        ).run(nextVersion, now, taskId, task.version);
        Object.assign(eventPayload, {
          childTaskId,
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
        });
      } else if (operation === "add_dependency") {
        this.database.prepare(`INSERT INTO task_dependencies(
          task_id,depends_on_task_id,conversation_id,turn_id,created_at
        ) VALUES(?,?,?,?,?)`).run(taskId, dependsOnTaskId, conversation.id, turnId, now);
        this.database.prepare(
          "UPDATE tasks SET version=?,updated_at=? WHERE id=? AND version=?",
        ).run(nextVersion, now, taskId, task.version);
        Object.assign(eventPayload, { dependsOnTaskId });
      } else if (operation === "record_assumption") {
        contextItemId = randomUUID();
        this.database.prepare(`INSERT INTO task_context_items(
          id,task_id,kind,body,status,source_ref,created_at,updated_at
        ) VALUES(?,?,'assumption',?,'active',?,?,?)`).run(
          contextItemId,
          taskId,
          normalizedBody,
          `conversation:${conversation.id}:turn:${turnId}`,
          now,
          now,
        );
        this.database.prepare(
          "UPDATE tasks SET version=?,updated_at=? WHERE id=? AND version=?",
        ).run(nextVersion, now, taskId, task.version);
        Object.assign(eventPayload, { contextItemId, body: normalizedBody });
      } else {
        decisionId = randomUUID();
        this.database.prepare(`INSERT INTO decision_gates(
          id,task_id,category,question,status,created_at
        ) VALUES(?,?,?,?,'decision_required',?)`).run(
          decisionId,
          taskId,
          normalizedCategory,
          normalizedQuestion,
          now,
        );
        this.database.prepare(
          "UPDATE tasks SET version=?,updated_at=? WHERE id=? AND version=?",
        ).run(nextVersion, now, taskId, task.version);
        Object.assign(eventPayload, {
          decisionId,
          category: normalizedCategory,
          question: normalizedQuestion,
        });
      }

      const changed = this.database.prepare("SELECT changes() AS value").get();
      if (Number(changed.value) !== 1) throw codedError("version_conflict", "task changed during mutation");
      this.database.prepare(`INSERT INTO task_origins(
        task_id,task_version,topic_id,conversation_id,turn_id,parent_task_id,created_at
      ) VALUES(?,?,?,?,?,?,?)`).run(
        taskId,
        nextVersion,
        conversation.topic_id,
        conversation.id,
        turnId,
        task.parent_task_id,
        now,
      );
      if (childTaskId) {
        this.database.prepare(`INSERT INTO task_origins(
          task_id,task_version,topic_id,conversation_id,turn_id,parent_task_id,created_at
        ) VALUES(?,?,?,?,?,?,?)`).run(
          childTaskId,
          1,
          conversation.topic_id,
          conversation.id,
          turnId,
          taskId,
          now,
        );
      }
      const current = this.getTaskDetails(taskId);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        expectedType,
        actor,
        task.status,
        task.status,
        JSON.stringify(eventPayload),
        idempotencyKey,
        now,
        "orchestrator",
        null,
        nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        expectedType,
        actor,
        "orchestrator",
        null,
        null,
        JSON.stringify(prior),
        JSON.stringify(current),
        JSON.stringify(eventPayload),
        idempotencyKey,
        requestSha256,
        now,
      );
      if (childTaskId) {
        const child = this.getTaskDetails(childTaskId);
        const childPayload = {
          operation: "create_from_split",
          parentTaskId: taskId,
          turnId,
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
        };
        this.database.prepare(`INSERT INTO task_events(
          task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
          actor_role,run_id,task_version
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
          childTaskId,
          "task_created_from_split",
          actor,
          null,
          "ready",
          JSON.stringify(childPayload),
          `${idempotencyKey}:child`,
          now,
          "orchestrator",
          null,
          1,
        );
        this.database.prepare(`INSERT INTO audit_events(
          task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
          idempotency_key,request_sha256,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          childTaskId,
          "task_created_from_split",
          actor,
          "orchestrator",
          null,
          null,
          "null",
          JSON.stringify(child),
          JSON.stringify(childPayload),
          `${idempotencyKey}:child`,
          sha256(JSON.stringify({ ...request, childTaskId })),
          now,
        );
      }
      this.appendConversationEvent(conversation.id, turnId, "task_mutation_applied", "orchestrator", {
        operation,
        taskId,
        taskVersion: nextVersion,
        childTaskId,
        title: normalizedTitle ?? task.title,
        dependsOnTaskId,
        contextItemId,
        assumption: normalizedBody,
        decisionId,
        decisionCategory: normalizedCategory,
        decisionQuestion: normalizedQuestion,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      operation,
      task: this.getTaskDetails(taskId),
      childTask: childTaskId ? this.getTaskDetails(childTaskId) : null,
    };
  }

  completeConversationTurn({ token, turnId, state, result = {} }) {
    if (!["waiting_for_owner", "completed", "failed", "cancelled"].includes(state)) {
      throw codedError("invalid_request", "unsupported conversation turn completion state");
    }
    const { turn, conversation } = this.activeConversationTurnForLease(token, turnId);
    const now = this.clock();
    const conversationState = state === "waiting_for_owner" ? "waiting_for_owner"
      : state === "failed" ? "failed" : "idle";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE conversation_turns SET
        state=?,result_json=?,completed_at=?,updated_at=? WHERE id=? AND state='running'`).run(
        state, JSON.stringify(result), now, now, turnId,
      );
      this.database.prepare(`UPDATE orchestrator_conversations SET
        state=?,current_turn_id=NULL,last_processed_owner_sequence=?,updated_at=? WHERE id=?`).run(
        conversationState, turn.sequence, now, turn.conversation_id,
      );
      this.appendConversationEvent(turn.conversation_id, turnId, `turn_${state}`, "orchestrator", result, now);
      this.database.prepare(`UPDATE conversation_runs SET
        state=?,ended_at=? WHERE turn_id=? AND state='running'`).run(state, now, turnId);
      const next = this.database.prepare(`SELECT id FROM conversation_turns
        WHERE conversation_id=? AND state='queued' ORDER BY sequence LIMIT 1`).get(turn.conversation_id);
      if (next) {
        this.database.prepare(
          "UPDATE orchestrator_conversations SET state='queued',updated_at=? WHERE id=?",
        ).run(now, turn.conversation_id);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return publicConversationTurn(
      this.database.prepare("SELECT * FROM conversation_turns WHERE id=?").get(turnId),
    );
  }

  reconcileConversationTurns(leaseId, reason, now = this.clock()) {
    const turns = this.database.prepare(`SELECT * FROM conversation_turns
      WHERE claimed_by=? AND state='running' ORDER BY created_at,id`).all(leaseId);
    for (const turn of turns) {
      const result = { reason, automaticReplay: false };
      this.database.prepare(`UPDATE conversation_turns SET
        state='reconciliation_required',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND state='running'`).run(JSON.stringify(result), now, now, turn.id);
      this.database.prepare(`UPDATE orchestrator_conversations SET
        state='reconciliation_required',current_turn_id=?,updated_at=? WHERE id=?`).run(
        turn.id, now, turn.conversation_id,
      );
      this.database.prepare(`UPDATE conversation_runs SET
        state='reconciliation_required',ended_at=? WHERE turn_id=? AND state='running'`).run(now, turn.id);
      this.appendConversationEvent(
        turn.conversation_id, turn.id, "turn_reconciliation_required", "control_plane", result, now,
      );
    }
    return turns.map(({ id }) => id);
  }

  sessions() {
    return this.database.prepare(`SELECT s.*,t.project_id,
      (SELECT r.state FROM runs r WHERE r.session_id=s.id ORDER BY r.started_at DESC LIMIT 1) AS latest_run_state
      FROM sessions s JOIN tasks t ON t.id=s.task_id ORDER BY s.updated_at DESC,s.id`).all();
  }

  expireOrchestratorLeases() {
    const now = this.clock();
    const expired = this.database.prepare(
      "SELECT id FROM project_orchestrators WHERE status='active' AND lease_expires_at<=? ORDER BY id",
    ).all(now);
    if (expired.length === 0) return [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const { id } of expired) {
        this.database.prepare(`UPDATE project_orchestrators SET
          status='expired',updated_at=? WHERE id=? AND status='active'`).run(now, id);
        this.reconcileClaimedCommands(id, "orchestrator_lease_expired", now);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return expired.map(({ id }) => id);
  }

  registerProjectOrchestrator({
    projectId,
    transport = "daemon",
    endpoint,
    metadata = {},
    leaseSeconds = 90,
  }) {
    if (!this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    if (!["daemon", "tmux"].includes(transport) || !endpoint) {
      throw codedError("invalid_request", "orchestrator transport and endpoint are required");
    }
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 3600) {
      throw codedError("invalid_request", "orchestrator lease must be between 15 and 3600 seconds");
    }
    this.expireOrchestratorLeases();
    const active = this.activeProjectOrchestrator(projectId);
    if (active) {
      throw codedError("orchestrator_conflict", `project already has an active orchestrator lease: ${active.id}`);
    }
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const now = this.clock();
    const leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
    this.database.prepare(`INSERT INTO project_orchestrators(
      id,project_id,transport,endpoint,token_sha256,status,lease_expires_at,last_heartbeat_at,
      metadata_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,'active',?,?,?,?,?)`).run(
      id, projectId, transport, endpoint, sha256(token), leaseExpiresAt, now,
      JSON.stringify(metadata), now, now,
    );
    return { ...publicOrchestrator(this.projectOrchestrator(id)), token };
  }

  heartbeatProjectOrchestrator({ token, leaseSeconds = 90 }) {
    if (!token) throw codedError("orchestrator_denied", "orchestrator bearer token is required");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 3600) {
      throw codedError("invalid_request", "orchestrator lease must be between 15 and 3600 seconds");
    }
    this.expireOrchestratorLeases();
    const row = this.database.prepare(
      "SELECT * FROM project_orchestrators WHERE token_sha256=? AND status='active'",
    ).get(sha256(token));
    if (!row) throw codedError("orchestrator_denied", "orchestrator lease is missing or expired");
    const now = this.clock();
    const leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
    this.database.prepare(`UPDATE project_orchestrators SET
      lease_expires_at=?,last_heartbeat_at=?,updated_at=? WHERE id=?`).run(leaseExpiresAt, now, now, row.id);
    return publicOrchestrator(this.projectOrchestrator(row.id));
  }

  authorizeProjectOrchestrator(token, projectId) {
    const row = this.authorizeActiveProjectOrchestrator(token);
    if (row.project_id !== projectId) {
      throw codedError("orchestrator_denied", "orchestrator lease is missing, expired, or outside project scope");
    }
    return row;
  }

  authorizeActiveProjectOrchestrator(token) {
    if (!token) throw codedError("orchestrator_denied", "orchestrator bearer token is required");
    this.expireOrchestratorLeases();
    const row = this.database.prepare(`SELECT * FROM project_orchestrators
      WHERE token_sha256=? AND status='active'`).get(sha256(token));
    if (!row) throw codedError("orchestrator_denied", "orchestrator lease is missing or expired");
    return { ...row, metadata: parseJson(row.metadata_json) ?? {} };
  }

  releaseProjectOrchestrator(token) {
    if (!token) throw codedError("orchestrator_denied", "orchestrator bearer token is required");
    const now = this.clock();
    const row = this.database.prepare(
      "SELECT id FROM project_orchestrators WHERE token_sha256=? AND status='active'",
    ).get(sha256(token));
    if (!row) throw codedError("orchestrator_denied", "active orchestrator lease was not found");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE project_orchestrators SET
        status='released',updated_at=? WHERE id=? AND status='active'`).run(now, row.id);
      this.reconcileClaimedCommands(row.id, "orchestrator_lease_released", now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  projectOrchestrator(id) {
    const row = this.database.prepare("SELECT * FROM project_orchestrators WHERE id=?").get(id);
    return row ? { ...row, metadata: parseJson(row.metadata_json) ?? {} } : null;
  }

  activeProjectOrchestrator(projectId) {
    this.expireOrchestratorLeases();
    const row = this.database.prepare(
      "SELECT * FROM project_orchestrators WHERE project_id=? AND status='active'",
    ).get(projectId);
    return row ? { ...row, metadata: parseJson(row.metadata_json) ?? {} } : null;
  }

  projectOrchestrators() {
    this.expireOrchestratorLeases();
    return this.database.prepare(`SELECT o.*,p.name project_name FROM project_orchestrators o
      JOIN projects p ON p.id=o.project_id ORDER BY p.name,o.created_at`).all()
      .map((row) => publicOrchestrator(row));
  }

  enqueueOrchestratorCommand({
    projectId,
    taskId,
    kind = "start_task",
    phase,
    payload = {},
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!ORCHESTRATOR_COMMAND_KINDS.has(kind)) {
      throw codedError("invalid_request", `unsupported orchestrator command: ${kind}`);
    }
    if (!RUN_PHASES.has(phase)) throw codedError("invalid_request", `unsupported run phase: ${phase}`);
    const project = this.getProject(projectId);
    if (!project) throw codedError("not_found", `unknown project: ${projectId}`);
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (task.project_id !== projectId) {
      throw codedError("orchestrator_denied", "task is outside the command project");
    }
    const request = { projectId, taskId, kind, phase, payload };
    const requestSha256 = sha256(JSON.stringify(request));
    const prior = this.database.prepare(
      "SELECT * FROM orchestrator_commands WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different command");
      }
      return { replayed: true, command: publicOrchestratorCommand(prior) };
    }
    const orchestrator = this.activeProjectOrchestrator(projectId);
    if (!orchestrator) {
      throw codedError("orchestrator_unavailable", "project has no active orchestrator lease");
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO orchestrator_commands(
        id,project_id,task_id,orchestrator_id,kind,phase,state,payload_json,request_sha256,
        idempotency_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?)`).run(
        id, projectId, taskId, orchestrator.id, kind, phase, JSON.stringify(payload),
        requestSha256, idempotencyKey, now, now,
      );
      this.appendOrchestratorCommandEvent(id, "queued", orchestrator.id, {
        projectId, taskId, kind, phase,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, command: this.orchestratorCommand(id) };
  }

  claimOrchestratorCommand(token) {
    const orchestrator = this.authorizeActiveProjectOrchestrator(token);
    const command = this.database.prepare(`SELECT * FROM orchestrator_commands
      WHERE project_id=? AND state='queued' ORDER BY sequence LIMIT 1`).get(orchestrator.project_id);
    if (!command) return null;
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`UPDATE orchestrator_commands SET
        state='claimed',orchestrator_id=?,claimed_at=?,updated_at=?
        WHERE id=? AND state='queued'`).run(orchestrator.id, now, now, command.id);
      if (Number(result.changes) !== 1) {
        throw codedError("command_conflict", "orchestrator command was claimed concurrently");
      }
      this.appendOrchestratorCommandEvent(command.id, "claimed", orchestrator.id, {}, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.orchestratorCommand(command.id);
  }

  completeOrchestratorCommand({ token, commandId, state, result = {} }) {
    if (!["succeeded", "failed"].includes(state)) {
      throw codedError("invalid_request", "command completion state must be succeeded or failed");
    }
    const orchestrator = this.authorizeActiveProjectOrchestrator(token);
    const command = this.database.prepare("SELECT * FROM orchestrator_commands WHERE id=?").get(commandId);
    if (!command) throw codedError("not_found", `unknown orchestrator command: ${commandId}`);
    if (command.project_id !== orchestrator.project_id || command.orchestrator_id !== orchestrator.id) {
      throw codedError("orchestrator_denied", "orchestrator cannot complete a command outside its active lease");
    }
    if (command.state !== "claimed") {
      if (ORCHESTRATOR_COMMAND_TERMINAL_STATES.has(command.state)) {
        throw codedError("command_conflict", `orchestrator command is already ${command.state}`);
      }
      throw codedError("command_conflict", "orchestrator command must be claimed before completion");
    }
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE orchestrator_commands SET
        state=?,result_json=?,completed_at=?,updated_at=? WHERE id=? AND state='claimed'`).run(
        state, JSON.stringify(result), now, now, commandId,
      );
      this.appendOrchestratorCommandEvent(commandId, state, orchestrator.id, result, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.orchestratorCommand(commandId);
  }

  orchestratorCommand(id) {
    return publicOrchestratorCommand(
      this.database.prepare("SELECT * FROM orchestrator_commands WHERE id=?").get(id),
    );
  }

  orchestratorCommands({ projectId = null, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw codedError("invalid_request", "command limit must be between 1 and 500");
    }
    const rows = projectId
      ? this.database.prepare(`SELECT c.*,p.name project_name FROM orchestrator_commands c
        JOIN projects p ON p.id=c.project_id WHERE c.project_id=?
        ORDER BY c.sequence DESC LIMIT ?`).all(projectId, limit)
      : this.database.prepare(`SELECT c.*,p.name project_name FROM orchestrator_commands c
        JOIN projects p ON p.id=c.project_id ORDER BY c.sequence DESC LIMIT ?`).all(limit);
    return rows.map((row) => publicOrchestratorCommand(row));
  }

  orchestratorCommandEvents(commandId) {
    return this.database.prepare(`SELECT sequence,type,orchestrator_id,payload_json,created_at
      FROM orchestrator_command_events WHERE command_id=? ORDER BY sequence`).all(commandId)
      .map((row) => ({ ...row, payload: parseJson(row.payload_json) ?? {} }));
  }

  appendOrchestratorCommandEvent(commandId, type, orchestratorId, payload, now = this.clock()) {
    const next = this.database.prepare(`SELECT COALESCE(MAX(sequence),0)+1 value
      FROM orchestrator_command_events WHERE command_id=?`).get(commandId);
    this.database.prepare(`INSERT INTO orchestrator_command_events(
      command_id,sequence,type,orchestrator_id,payload_json,created_at
    ) VALUES(?,?,?,?,?,?)`).run(commandId, Number(next.value), type, orchestratorId, JSON.stringify(payload), now);
  }

  reconcileClaimedCommands(orchestratorId, reason, now = this.clock()) {
    const commands = this.database.prepare(`SELECT id FROM orchestrator_commands
      WHERE orchestrator_id=? AND state='claimed' ORDER BY sequence`).all(orchestratorId);
    for (const { id } of commands) {
      const result = { reason, automaticReplay: false };
      this.database.prepare(`UPDATE orchestrator_commands SET
        state='reconciliation_required',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND state='claimed'`).run(JSON.stringify(result), now, now, id);
      this.appendOrchestratorCommandEvent(id, "reconciliation_required", orchestratorId, result, now);
    }
    return commands.map(({ id }) => id);
  }

  getTaskDetails(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;
    return {
      ...task,
      validation_passed: Boolean(task.validation_passed),
      merge_requested: Boolean(task.merge_requested),
      acceptance_criteria: parseJson(task.acceptance_criteria_json) ?? [],
      origin: this.database.prepare(
        "SELECT * FROM task_origins WHERE task_id=? AND task_version=?",
      ).get(taskId, task.version) ?? null,
      children: this.database.prepare("SELECT id,title,status,version FROM tasks WHERE parent_task_id=? ORDER BY id").all(taskId),
      dependencies: this.database.prepare(`SELECT
        d.depends_on_task_id id,t.title,t.status,t.version,d.conversation_id,d.turn_id,d.created_at
        FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_task_id
        WHERE d.task_id=? ORDER BY d.created_at,d.depends_on_task_id`).all(taskId),
      dependents: this.database.prepare(`SELECT
        d.task_id id,t.title,t.status,t.version,d.conversation_id,d.turn_id,d.created_at
        FROM task_dependencies d JOIN tasks t ON t.id=d.task_id
        WHERE d.depends_on_task_id=? ORDER BY d.created_at,d.task_id`).all(taskId),
      context_items: this.taskContextItems(taskId),
      reviews: this.database.prepare("SELECT * FROM reviews WHERE task_id=? ORDER BY created_at,id").all(taskId)
        .map((row) => ({ ...row, findings: parseJson(row.findings_json) })),
      decision_gates: this.database.prepare("SELECT * FROM decision_gates WHERE task_id=? ORDER BY created_at,id").all(taskId)
        .map((row) => ({ ...row, resolution: parseJson(row.resolution_json) })),
      validations: this.database.prepare("SELECT * FROM validations WHERE task_id=? ORDER BY created_at,id").all(taskId)
        .map((row) => ({ ...row, evidence: parseJson(row.evidence_json) })),
      merge_requests: this.database.prepare("SELECT * FROM merge_requests WHERE task_id=? ORDER BY created_at,id").all(taskId),
    };
  }

  recordTaskContextItem({ id = randomUUID(), taskId, kind, body, status = "active", sourceRef = null }) {
    if (!["assumption", "open_question", "decision"].includes(kind)) {
      throw codedError("invalid_request", `unsupported task context kind: ${kind}`);
    }
    const now = this.clock();
    this.database.prepare(`INSERT INTO task_context_items(
      id,task_id,kind,body,status,source_ref,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(id, taskId, kind, body, status, sourceRef, now, now);
    return this.database.prepare("SELECT * FROM task_context_items WHERE id=?").get(id);
  }

  taskContextItems(taskId) {
    return this.database.prepare("SELECT * FROM task_context_items WHERE task_id=? ORDER BY created_at,id").all(taskId);
  }

  issueCapability({ role, actorId, taskId, runId = null, actions = [...(CAPABILITY_ACTIONS[role] ?? [])], expiresAt }) {
    if (!CAPABILITY_ACTIONS[role]) throw codedError("invalid_role", `unknown role: ${role}`);
    if (!this.getTask(taskId)) throw codedError("not_found", `unknown task: ${taskId}`);
    if (!actorId || !expiresAt || Date.parse(expiresAt) <= Date.parse(this.clock())) {
      throw codedError("invalid_capability", "capability actor and future expiry are required");
    }
    const invalid = actions.find((action) => !CAPABILITY_ACTIONS[role].has(action));
    if (invalid) throw codedError("invalid_capability", `action is not available to ${role}: ${invalid}`);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO capabilities(
        id,token_sha256,role,actor_id,task_id,run_id,expires_at,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(id, sha256(token), role, actorId, taskId, runId, expiresAt, this.clock());
      const insertAction = this.database.prepare("INSERT INTO capability_actions(capability_id,action) VALUES(?,?)");
      for (const action of actions) insertAction.run(id, action);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { id, token, role, actorId, taskId, runId, actions, expiresAt };
  }

  revokeCapability(id) {
    this.database.prepare("UPDATE capabilities SET revoked_at=? WHERE id=?").run(this.clock(), id);
  }

  authorizeCapability(token, action, taskId) {
    if (!token) throw codedError("capability_denied", "bearer capability is required");
    const capability = this.database.prepare(`SELECT c.* FROM capabilities c
      JOIN capability_actions a ON a.capability_id=c.id
      WHERE c.token_sha256=? AND c.task_id=? AND a.action=?`).get(sha256(token), taskId, action);
    if (!capability || capability.revoked_at || Date.parse(capability.expires_at) <= Date.parse(this.clock())) {
      throw codedError("capability_denied", "capability is missing, expired, revoked, or outside action scope");
    }
    return capability;
  }

  actOnTask({ token, taskId, action, idempotencyKey, expectedVersion, payload = {} }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const capability = this.authorizeCapability(token, action, taskId);
    const requestSha256 = sha256(JSON.stringify({ capabilityId: capability.id, taskId, action, expectedVersion, payload }));
    const priorEvent = this.database.prepare("SELECT * FROM audit_events WHERE idempotency_key=?").get(idempotencyKey);
    if (priorEvent) {
      if (priorEvent.request_sha256 !== requestSha256) throw codedError("idempotency_conflict", "idempotency key was reused for a different request");
      const event = this.parseAuditEvent(priorEvent);
      return { replayed: true, event, task: event.current };
    }
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (expectedVersion !== task.version) {
      throw codedError("version_conflict", `task version conflict: expected ${expectedVersion}, current ${task.version}`);
    }
    if (capability.role === "worker" && action !== "claim" && capability.actor_id !== task.assigned_worker) {
      throw codedError("capability_denied", "worker is not assigned to this task");
    }

    const now = this.clock();
    const prior = this.getTaskDetails(taskId);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const outcome = this.applyTaskAction({ capability, task, action, payload, now });
      const nextVersion = task.version + 1;
      this.database.prepare(`UPDATE tasks SET
        status=?, assigned_worker=?, revision=?, validation_passed=?, requested_review_revision=?,
        merge_requested=?, version=?, updated_at=? WHERE id=? AND version=?`).run(
        outcome.status, outcome.assignedWorker, outcome.revision, outcome.validationPassed ? 1 : 0,
        outcome.requestedReviewRevision, outcome.mergeRequested ? 1 : 0, nextVersion, now, taskId, task.version,
      );
      const changed = this.database.prepare("SELECT changes() AS value").get();
      if (Number(changed.value) !== 1) throw codedError("version_conflict", "task changed during mutation");
      const current = this.getTaskDetails(taskId);
      const eventResult = this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, outcome.eventType, capability.actor_id, task.status, outcome.status,
        JSON.stringify(payload), idempotencyKey, now, capability.role, capability.run_id, nextVersion,
      );
      const auditResult = this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, outcome.eventType, capability.actor_id, capability.role, capability.id, capability.run_id,
        JSON.stringify(prior), JSON.stringify(current), JSON.stringify(payload), idempotencyKey, requestSha256, now,
      );
      this.database.exec("COMMIT");
      return {
        replayed: false,
        event: this.parseAuditEvent(this.database.prepare("SELECT * FROM audit_events WHERE sequence=?").get(auditResult.lastInsertRowid)),
        taskEventSequence: Number(eventResult.lastInsertRowid),
        task: this.getTaskDetails(taskId),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  applyTaskAction({ capability, task, action, payload, now }) {
    const next = {
      status: task.status,
      assignedWorker: task.assigned_worker,
      revision: task.revision,
      validationPassed: Boolean(task.validation_passed),
      requestedReviewRevision: task.requested_review_revision,
      mergeRequested: Boolean(task.merge_requested),
      eventType: `task_${action}`,
    };
    if (action === "claim") {
      if (!["ready", "backlog"].includes(task.status) || (task.assigned_worker && task.assigned_worker !== capability.actor_id)) {
        throw codedError("transition_denied", "task cannot be claimed by this worker");
      }
      next.status = "in_progress";
      next.assignedWorker = capability.actor_id;
    } else if (action === "release") {
      if (capability.actor_id !== task.assigned_worker) throw codedError("capability_denied", "only the assigned worker may release the task");
      next.status = "ready";
      next.assignedWorker = null;
    } else if (action === "progress") {
      if (!payload.text) throw codedError("invalid_request", "progress text is required");
      next.eventType = "task_progress";
    } else if (action === "block") {
      if (!payload.reason) throw codedError("invalid_request", "block reason is required");
      next.status = "blocked";
      next.eventType = "task_blocked";
    } else if (action === "create_child") {
      if (!payload.id || !payload.title) throw codedError("invalid_request", "child id and title are required");
      this.database.prepare(`INSERT INTO tasks(
        id,project_id,title,status,version,updated_at,parent_task_id,assigned_worker,revision,validation_passed,merge_requested
      ) VALUES(?,?,?,?,1,?,?,?,?,0,0)`).run(
        payload.id, task.project_id, payload.title, "backlog", now, task.id, capability.actor_id, task.revision,
      );
      next.eventType = "child_task_created";
    } else if (action === "request_review") {
      if (!payload.revision || payload.revision !== task.revision) throw codedError("revision_conflict", "review must target the current revision");
      next.status = "review";
      next.requestedReviewRevision = payload.revision;
      next.eventType = "review_requested";
    } else if (action === "propose_complete") {
      next.eventType = "completion_proposed";
    } else if (action === "submit_review") {
      if (capability.actor_id === task.assigned_worker) throw codedError("self_approval_denied", "implementer cannot review its own work");
      if (!payload.revision || payload.revision !== task.revision || payload.revision !== task.requested_review_revision) {
        throw codedError("revision_conflict", "review must target the requested current revision");
      }
      if (!["approve", "request_changes", "blocked"].includes(payload.disposition)) throw codedError("invalid_request", "invalid review disposition");
      this.database.prepare(`INSERT INTO reviews(
        id,task_id,reviewer_id,run_id,revision,disposition,findings_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        randomUUID(), task.id, capability.actor_id, capability.run_id, payload.revision,
        payload.disposition, JSON.stringify(payload.findings ?? []), now,
      );
      next.status = payload.disposition === "request_changes" ? "in_progress" : payload.disposition === "blocked" ? "blocked" : "review";
      next.eventType = "review_submitted";
    } else if (action === "set_revision") {
      if (!payload.revision) throw codedError("invalid_request", "revision is required");
      next.revision = payload.revision;
      next.validationPassed = false;
      next.requestedReviewRevision = null;
      next.mergeRequested = false;
      next.eventType = "task_revision_updated";
    } else if (action === "record_validation") {
      if (!payload.revision || payload.revision !== task.revision || !["passed", "failed"].includes(payload.status)) {
        throw codedError("revision_conflict", "validation must target the current revision with passed or failed status");
      }
      this.database.prepare(`INSERT INTO validations(id,task_id,revision,status,evidence_json,created_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(task_id,revision) DO UPDATE SET
        status=excluded.status,evidence_json=excluded.evidence_json,created_at=excluded.created_at`).run(
        randomUUID(), task.id, payload.revision, payload.status, JSON.stringify(payload.evidence ?? []), now,
      );
      next.validationPassed = payload.status === "passed";
      next.eventType = "validation_recorded";
    } else if (action === "add_decision_gate") {
      if (!payload.id || !payload.category || !payload.question) throw codedError("invalid_request", "decision id, category, and question are required");
      this.database.prepare(`INSERT INTO decision_gates(
        id,task_id,category,question,status,created_at
      ) VALUES(?,?,?,?,?,?)`).run(payload.id, task.id, payload.category, payload.question, "decision_required", now);
      next.eventType = "decision_required";
    } else if (action === "resolve_decision") {
      const gate = this.database.prepare("SELECT * FROM decision_gates WHERE id=? AND task_id=?").get(payload.id, task.id);
      if (!gate || gate.status !== "decision_required" || payload.resolution === undefined) {
        throw codedError("invalid_request", "an unresolved decision and resolution are required");
      }
      this.database.prepare(`UPDATE decision_gates SET
        status='resolved',resolution_json=?,resolved_by=?,resolved_at=? WHERE id=?`).run(
        JSON.stringify(payload.resolution), capability.actor_id, now, gate.id,
      );
      next.eventType = "decision_resolved";
    } else if (action === "complete") {
      const evaluation = this.evaluateCompletion(task.id);
      if (!evaluation.allowed) throw codedError("completion_blocked", `completion blocked: ${evaluation.reasons.join(",")}`, { reasons: evaluation.reasons });
      next.status = "done";
      next.mergeRequested = true;
      next.eventType = "task_completed";
      this.database.prepare(`INSERT INTO merge_requests(
        id,task_id,revision,requested_by,status,created_at
      ) VALUES(?,?,?,?,?,?) ON CONFLICT(task_id,revision) DO UPDATE SET
        requested_by=excluded.requested_by,status=excluded.status,created_at=excluded.created_at`).run(
        randomUUID(), task.id, task.revision, capability.actor_id, "requested", now,
      );
    } else if (action === "reopen") {
      next.status = "in_progress";
      next.mergeRequested = false;
      next.eventType = "task_reopened";
    } else {
      throw codedError("invalid_request", `unsupported task action: ${action}`);
    }
    return next;
  }

  evaluateCompletion(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const latestReview = this.database.prepare(`SELECT * FROM reviews WHERE
      task_id=? AND revision=? AND reviewer_id<>COALESCE(?, '')
      ORDER BY rowid DESC LIMIT 1`).get(taskId, task.revision, task.assigned_worker);
    const validation = this.database.prepare(`SELECT * FROM validations WHERE
      task_id=? AND revision=? AND status='passed' ORDER BY created_at DESC LIMIT 1`).get(taskId, task.revision);
    const openDecision = this.database.prepare("SELECT id FROM decision_gates WHERE task_id=? AND status='decision_required' LIMIT 1").get(taskId);
    const unresolvedDependency = this.database.prepare(`SELECT t.id FROM task_dependencies d
      JOIN tasks t ON t.id=d.depends_on_task_id
      WHERE d.task_id=? AND t.status<>'done' LIMIT 1`).get(taskId);
    const reasons = [];
    if (latestReview?.disposition !== "approve") reasons.push("independent_review_required");
    if (!validation || !task.validation_passed) reasons.push("validation_required");
    if (openDecision) reasons.push("human_decision_required");
    if (unresolvedDependency) reasons.push("unresolved_dependency");
    return { allowed: reasons.length === 0, reasons, reviewedRevision: latestReview?.disposition === "approve" ? latestReview.revision : null };
  }

  parseAuditEvent(row) {
    return {
      ...row,
      prior: parseJson(row.prior_json),
      current: parseJson(row.new_json),
      payload: parseJson(row.payload_json),
    };
  }

  taskAudit(taskId) {
    return this.database.prepare("SELECT * FROM audit_events WHERE task_id=? ORDER BY sequence").all(taskId).map((row) => this.parseAuditEvent(row));
  }

  board() {
    const rows = this.database.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, id").all();
    const columns = Object.fromEntries([...TASK_STATES].map((state) => [state, []]));
    for (const row of rows) columns[row.status].push(row);
    return { columns, generatedAt: this.clock() };
  }

  createSession({ id, taskId, nativePath, provider, model, parentSessionId = null }) {
    const now = this.clock();
    this.database
      .prepare(`INSERT INTO sessions(id,task_id,native_path,state,model_provider,model_id,parent_session_id,updated_at)
                VALUES(?,?,?,?,?,?,?,?)`)
      .run(id, taskId, nativePath, "idle", provider, model, parentSessionId, now);
    return this.getSession(id);
  }

  getSession(id) {
    return this.database.prepare("SELECT * FROM sessions WHERE id=?").get(id) ?? null;
  }

  createRun({
    id = randomUUID(), sessionId, processId = null, shellProcessId = null, containerId = null, imageId = null,
    workspaceId = null, credentialProfile = null, orchestratorId = null, phase = "implementation",
  }) {
    if (!RUN_PHASES.has(phase)) throw codedError("invalid_request", `unsupported run phase: ${phase}`);
    if (orchestratorId) {
      const session = this.getSession(sessionId);
      const task = session ? this.getTask(session.task_id) : null;
      const orchestrator = task ? this.activeProjectOrchestrator(task.project_id) : null;
      if (!task || !orchestrator || orchestrator.id !== orchestratorId) {
        throw codedError("orchestrator_denied", "run orchestrator must hold the active lease for the task project");
      }
    }
    this.database
      .prepare(`INSERT INTO runs(
        id,session_id,state,process_id,shell_process_id,started_at,container_id,image_id,workspace_id,
        credential_profile,orchestrator_id,phase
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, sessionId, "running", processId, shellProcessId, this.clock(), containerId, imageId,
        workspaceId, credentialProfile, orchestratorId, phase,
      );
    return this.getRun(id);
  }

  getRun(id) {
    return this.database.prepare("SELECT * FROM runs WHERE id=?").get(id) ?? null;
  }

  runningRuns() {
    return this.database.prepare("SELECT * FROM runs WHERE state='running' ORDER BY started_at,id").all();
  }

  appendRunEvent(runId, sequence, type, payload) {
    this.database
      .prepare("INSERT OR IGNORE INTO run_events(run_id,sequence,type,payload_json,created_at) VALUES(?,?,?,?,?)")
      .run(runId, sequence, type, JSON.stringify(payload), this.clock());
  }

  runEvents(runId) {
    return this.database
      .prepare("SELECT sequence,type,payload_json,created_at FROM run_events WHERE run_id=? ORDER BY sequence")
      .all(runId)
      .map((row) => ({ ...row, payload: parseJson(row.payload_json) }));
  }

  finishRun(runId, state = "stopped") {
    this.database.prepare("UPDATE runs SET state=?,ended_at=? WHERE id=?").run(state, this.clock(), runId);
    return this.getRun(runId);
  }

  nextRunEventSequence(runId) {
    const last = this.database.prepare("SELECT COALESCE(MAX(sequence),0) AS value FROM run_events WHERE run_id=?").get(runId);
    return Number(last.value) + 1;
  }

  beginSideEffect({ runId, kind, idempotencyKey, intent = {} }) {
    if (!runId || !kind || !idempotencyKey) {
      throw codedError("invalid_request", "side-effect run, kind, and idempotency key are required");
    }
    const requestSha256 = sha256(JSON.stringify({ runId, kind, idempotencyKey, intent }));
    const prior = this.database.prepare(
      "SELECT * FROM side_effects WHERE run_id=? AND kind=? AND idempotency_key=?",
    ).get(runId, kind, idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "side-effect identity was reused for a different intent");
      }
      return { effect: this.parseSideEffect(prior), replayed: true };
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO side_effects(
        id,run_id,kind,idempotency_key,request_sha256,state,intent_json,started_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        id, runId, kind, idempotencyKey, requestSha256, "intent", JSON.stringify(intent), now,
      );
      this.appendSideEffectReceipt({
        sideEffectId: id, phase: "intent", state: "intent",
        payload: { runId, kind, idempotencyKey, requestSha256, intent }, createdAt: now,
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { effect: this.getSideEffect(id), replayed: false };
  }

  completeSideEffect(id, result = {}, { reconciled = false } = {}) {
    const effect = this.getSideEffect(id);
    if (!effect) throw codedError("not_found", `unknown side effect: ${id}`);
    if (effect.state === "completed") return { effect, replayed: true };
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE side_effects SET
        state='completed',result_json=?,completed_at=COALESCE(completed_at,?),
        reconciled_at=CASE WHEN ? THEN ? ELSE reconciled_at END
        WHERE id=?`).run(JSON.stringify(result), now, reconciled ? 1 : 0, now, id);
      this.appendSideEffectReceipt({
        sideEffectId: id, phase: reconciled ? "reconciliation" : "completion",
        state: "completed", payload: result, createdAt: now,
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { effect: this.getSideEffect(id), replayed: false };
  }

  requireSideEffectReconciliation(id, reason, evidence = {}) {
    const effect = this.getSideEffect(id);
    if (!effect) throw codedError("not_found", `unknown side effect: ${id}`);
    if (effect.state === "completed") return effect;
    const now = this.clock();
    const result = { reason, evidence };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE side_effects SET
        state='reconciliation_required',result_json=?,reconciled_at=? WHERE id=?`)
        .run(JSON.stringify(result), now, id);
      this.appendSideEffectReceipt({
        sideEffectId: id, phase: "reconciliation", state: "reconciliation_required",
        payload: result, createdAt: now,
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getSideEffect(id);
  }

  appendSideEffectReceipt({ sideEffectId, phase, state, payload, createdAt = this.clock() }) {
    const serialized = JSON.stringify({ sideEffectId, phase, state, payload, createdAt });
    this.database.prepare(`INSERT INTO side_effect_receipts(
      side_effect_id,phase,state,payload_json,receipt_sha256,created_at
    ) VALUES(?,?,?,?,?,?)`).run(sideEffectId, phase, state, JSON.stringify(payload), sha256(serialized), createdAt);
  }

  parseSideEffect(row) {
    return row ? { ...row, intent: parseJson(row.intent_json), result: parseJson(row.result_json) } : null;
  }

  getSideEffect(id) {
    return this.parseSideEffect(this.database.prepare("SELECT * FROM side_effects WHERE id=?").get(id));
  }

  findSideEffect(runId, kind, idempotencyKey) {
    return this.parseSideEffect(this.database.prepare(
      "SELECT * FROM side_effects WHERE run_id=? AND kind=? AND idempotency_key=?",
    ).get(runId, kind, idempotencyKey));
  }

  sideEffectsForRun(runId) {
    return this.database.prepare("SELECT * FROM side_effects WHERE run_id=? ORDER BY started_at,id")
      .all(runId).map((row) => this.parseSideEffect(row));
  }

  sideEffectReceipts(runId) {
    return this.database.prepare(`SELECT r.* FROM side_effect_receipts r
      JOIN side_effects e ON e.id=r.side_effect_id WHERE e.run_id=? ORDER BY r.sequence`)
      .all(runId).map((row) => ({ ...row, payload: parseJson(row.payload_json) }));
  }

  recordArtifact({ sessionId, kind, path, sha256, metadata = {} }) {
    const id = randomUUID();
    this.database
      .prepare(`INSERT OR IGNORE INTO artifacts(id,session_id,kind,path,sha256,metadata_json,created_at)
                VALUES(?,?,?,?,?,?,?)`)
      .run(id, sessionId, kind, path, sha256, JSON.stringify(metadata), this.clock());
  }

  artifacts(sessionId) {
    return this.database.prepare("SELECT * FROM artifacts WHERE session_id=? ORDER BY created_at,path").all(sessionId);
  }

  recordWorkspace({ id, taskId, runId, repositoryPath, workspacePath, branch, baseRevision, gitMarkerSha256 }) {
    const now = this.clock();
    this.database.prepare(`INSERT INTO workspaces(
      id,task_id,run_id,repository_path,workspace_path,branch,state,base_revision,git_marker_sha256,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, taskId, runId, repositoryPath, workspacePath, branch, "active", baseRevision, gitMarkerSha256, now, now,
    );
    return this.getWorkspace(id);
  }

  getWorkspace(id) {
    return this.database.prepare("SELECT * FROM workspaces WHERE id=?").get(id) ?? null;
  }

  workspaceForRun(runId) {
    return this.database.prepare("SELECT * FROM workspaces WHERE run_id=?").get(runId) ?? null;
  }

  findGitOperation(idempotencyKey) {
    const row = this.database.prepare("SELECT * FROM git_operations WHERE idempotency_key=?").get(idempotencyKey);
    return row ? { ...row, metadata: parseJson(row.metadata_json) } : null;
  }

  recordGitOperation({
    id, workspaceId, taskId, runId, capabilityId, kind, idempotencyKey, requestSha256,
    priorRevision, newRevision, metadata = {},
  }) {
    this.database.prepare(`INSERT INTO git_operations(
      id,workspace_id,task_id,run_id,capability_id,kind,idempotency_key,request_sha256,
      prior_revision,new_revision,status,metadata_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, workspaceId, taskId, runId, capabilityId, kind, idempotencyKey, requestSha256,
      priorRevision, newRevision, "committed", JSON.stringify(metadata), this.clock(),
    );
    return this.findGitOperation(idempotencyKey);
  }

  recordCredentialRun({ runId, profileId, authType, billingMode }) {
    this.database.prepare(`INSERT INTO credential_runs(
      run_id,profile_id,auth_type,billing_mode,delivery_mode,created_at
    ) VALUES(?,?,?,?,?,?)`).run(runId, profileId, authType, billingMode, "readonly_source_to_private_run_copy", this.clock());
  }

  verifyCredentialRun(runId, canonicalUnchanged) {
    this.database.prepare("UPDATE credential_runs SET canonical_unchanged=?,verified_at=? WHERE run_id=?")
      .run(canonicalUnchanged ? 1 : 0, this.clock(), runId);
  }

  credentialRun(runId) {
    const row = this.database.prepare("SELECT * FROM credential_runs WHERE run_id=?").get(runId);
    return row ? { ...row, canonical_unchanged: row.canonical_unchanged === null ? null : Boolean(row.canonical_unchanged) } : null;
  }
}
