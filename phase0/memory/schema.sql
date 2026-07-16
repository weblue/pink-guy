PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  state TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  acceptance_criteria TEXT NOT NULL
) STRICT;

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  dependency_id TEXT NOT NULL,
  satisfied INTEGER NOT NULL CHECK (satisfied IN (0, 1)),
  PRIMARY KEY (task_id, dependency_id)
) STRICT;

CREATE TABLE task_assignments (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL
) STRICT;

CREATE TABLE task_reviewers (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  actor_id TEXT NOT NULL,
  revision TEXT NOT NULL
) STRICT;

CREATE TABLE decision_gates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  question TEXT NOT NULL
) STRICT;

CREATE TABLE memory_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  record_id TEXT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;

CREATE TABLE memory_records (
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
) STRICT;

CREATE TABLE memory_tombstones (
  record_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  deleted_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_refs_json TEXT NOT NULL
) STRICT;

CREATE TABLE normalized_evidence (
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
) STRICT;

CREATE TABLE context_receipts (
  receipt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  query_text TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  method_json TEXT NOT NULL,
  ranked_sources_json TEXT NOT NULL,
  exclusions_json TEXT NOT NULL,
  injected_excerpts_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL
) STRICT;

CREATE INDEX memory_records_scope_status
  ON memory_records(project_id, repository_id, task_id, scope_type, scope_id, status, trust_class);

CREATE INDEX normalized_evidence_scope_status
  ON normalized_evidence(project_id, repository_id, task_id, scope_type, scope_id, status, trust_class);
