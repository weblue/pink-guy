import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TASK_STATES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);

function parseJson(value) {
  return value ? JSON.parse(value) : null;
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
    `);
  }

  close() {
    this.database.close();
  }

  seedProjectTask({ projectId = "phase0-project", taskId = "phase0-task", repositoryPath, title }) {
    const now = this.clock();
    this.database
      .prepare("INSERT OR IGNORE INTO projects(id,name,repository_path,created_at) VALUES(?,?,?,?)")
      .run(projectId, "Phase 0 fixture", repositoryPath, now);
    this.database
      .prepare("INSERT OR IGNORE INTO tasks(id,project_id,title,status,version,updated_at) VALUES(?,?,?,?,1,?)")
      .run(taskId, projectId, title, "ready", now);
    return this.getTask(taskId);
  }

  getTask(taskId) {
    return this.database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) ?? null;
  }

  board() {
    const rows = this.database.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, id").all();
    const columns = Object.fromEntries([...TASK_STATES].map((state) => [state, []]));
    for (const row of rows) columns[row.status].push(row);
    return { columns, generatedAt: this.clock() };
  }

  mutateTask({ taskId, kind, actor, idempotencyKey, expectedVersion, status, payload = {} }) {
    if (!idempotencyKey) throw new Error("idempotency key is required");
    if (status && !TASK_STATES.has(status)) throw new Error(`invalid task status: ${status}`);
    const existing = this.database
      .prepare("SELECT * FROM task_events WHERE idempotency_key=?")
      .get(idempotencyKey);
    if (existing) return { replayed: true, event: { ...existing, payload: parseJson(existing.payload_json) }, task: this.getTask(taskId) };

    const task = this.getTask(taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    if (expectedVersion !== task.version) {
      const error = new Error(`task version conflict: expected ${expectedVersion}, current ${task.version}`);
      error.code = "version_conflict";
      throw error;
    }
    const now = this.clock();
    const nextStatus = status ?? task.status;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("UPDATE tasks SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?")
        .run(nextStatus, now, taskId, expectedVersion);
      const result = this.database
        .prepare(`INSERT INTO task_events(task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at)
                  VALUES(?,?,?,?,?,?,?,?)`)
        .run(taskId, kind, actor, task.status, nextStatus, JSON.stringify(payload), idempotencyKey, now);
      this.database.exec("COMMIT");
      return {
        replayed: false,
        event: this.database.prepare("SELECT * FROM task_events WHERE sequence=?").get(result.lastInsertRowid),
        task: this.getTask(taskId),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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

  createRun({ id = randomUUID(), sessionId, processId, shellProcessId }) {
    this.database
      .prepare("INSERT INTO runs(id,session_id,state,process_id,shell_process_id,started_at) VALUES(?,?,?,?,?,?)")
      .run(id, sessionId, "running", processId, shellProcessId, this.clock());
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
}
