import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TASK_STATES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
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
    `);
    this.ensureColumn("tasks", "parent_task_id", "TEXT");
    this.ensureColumn("tasks", "assigned_worker", "TEXT");
    this.ensureColumn("tasks", "revision", "TEXT");
    this.ensureColumn("tasks", "validation_passed", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "requested_review_revision", "TEXT");
    this.ensureColumn("tasks", "merge_requested", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("task_events", "actor_role", "TEXT");
    this.ensureColumn("task_events", "run_id", "TEXT");
    this.ensureColumn("task_events", "task_version", "INTEGER");
    this.ensureColumn("runs", "container_id", "TEXT");
    this.ensureColumn("runs", "image_id", "TEXT");
    this.ensureColumn("runs", "workspace_id", "TEXT");
    this.ensureColumn("runs", "credential_profile", "TEXT");
  }

  ensureColumn(table, column, definition) {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close() {
    this.database.close();
  }

  seedProjectTask({ projectId = "phase0-project", taskId = "phase0-task", repositoryPath, title, revision = "fixture-revision-1" }) {
    const now = this.clock();
    this.database
      .prepare("INSERT OR IGNORE INTO projects(id,name,repository_path,created_at) VALUES(?,?,?,?)")
      .run(projectId, "Phase 0 fixture", repositoryPath, now);
    this.database
      .prepare(`INSERT OR IGNORE INTO tasks(
        id,project_id,title,status,version,updated_at,revision,validation_passed,merge_requested
      ) VALUES(?,?,?,?,1,?,?,0,0)`)
      .run(taskId, projectId, title, "ready", now, revision);
    this.database.prepare("UPDATE tasks SET revision=COALESCE(revision,?) WHERE id=?").run(revision, taskId);
    return this.getTask(taskId);
  }

  getTask(taskId) {
    return this.database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) ?? null;
  }

  getTaskDetails(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;
    return {
      ...task,
      validation_passed: Boolean(task.validation_passed),
      merge_requested: Boolean(task.merge_requested),
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

  createRun({ id = randomUUID(), sessionId, processId, shellProcessId, containerId = null, imageId = null, workspaceId = null, credentialProfile = null }) {
    this.database
      .prepare(`INSERT INTO runs(
        id,session_id,state,process_id,shell_process_id,started_at,container_id,image_id,workspace_id,credential_profile
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, sessionId, "running", processId, shellProcessId, this.clock(), containerId, imageId, workspaceId, credentialProfile);
    return this.getRun(id);
  }

  getRun(id) {
    return this.database.prepare("SELECT * FROM runs WHERE id=?").get(id) ?? null;
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

  reconcileRunningRuns() {
    const running = this.database.prepare("SELECT * FROM runs WHERE state='running'").all();
    for (const run of running) {
      const last = this.database.prepare("SELECT COALESCE(MAX(sequence),0) AS value FROM run_events WHERE run_id=?").get(run.id);
      this.appendRunEvent(run.id, Number(last.value) + 1, "run_reconciliation_required", {
        priorState: "running",
        reason: "control_plane_restart",
        processId: run.process_id,
      });
      this.finishRun(run.id, "orphaned");
    }
    return running.map((run) => run.id);
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
