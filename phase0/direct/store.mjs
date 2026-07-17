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
      children: this.database.prepare("SELECT id,title,status,version FROM tasks WHERE parent_task_id=? ORDER BY id").all(taskId),
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
    const reasons = [];
    if (latestReview?.disposition !== "approve") reasons.push("independent_review_required");
    if (!validation || !task.validation_passed) reasons.push("validation_required");
    if (openDecision) reasons.push("human_decision_required");
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
