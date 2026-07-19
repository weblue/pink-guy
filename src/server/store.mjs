import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_PROMPT_PROFILES,
  PROMPT_PROFILE_KEYS,
} from "./prompt-profiles.mjs";
import { validateModelRoute } from "./model-routes.mjs";

const TASK_STATES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
const TASK_KINDS = new Set(["executable", "umbrella", "intake"]);
const RUN_PHASES = new Set(["implementation", "test", "review"]);
const DISPATCH_POLICIES = new Set(["manual", "automatic", "paused"]);
const DISPATCH_PRIORITY_MIN = -100;
const DISPATCH_PRIORITY_MAX = 100;
const ORCHESTRATOR_COMMAND_KINDS = new Set(["start_task"]);
const ORCHESTRATOR_COMMAND_TERMINAL_STATES = new Set([
  "paused", "succeeded", "failed", "reconciliation_required", "cancelled",
]);
const EXECUTION_STATES = new Set([
  "starting", "running", "stopping", "paused", "failed",
  "reconciliation_required", "succeeded", "cancelled",
]);
const EXECUTION_TERMINAL_STATES = new Set([
  "paused", "failed", "reconciliation_required", "succeeded", "cancelled",
]);
const RECOVERY_CANDIDATE_STATES = new Set(["pending", "accepted", "rejected", "ineligible"]);
const GIT_INTEGRATION_MODES = new Set(["prepare_only", "local_integrate", "pull_request"]);
const GIT_HISTORY_POLICIES = new Set(["merge_commit", "squash", "rebase"]);
const GIT_INTEGRATION_STATES = new Set([
  "preparing", "prepared", "conflict", "integrating", "integrated",
  "published", "cancelled", "failed", "reconciliation_required",
]);
const RETENTION_SCOPE_TYPES = new Set([
  "project", "task", "session", "run", "workspace",
]);
const CAPABILITY_ACTIONS = {
  worker: new Set([
    "read", "claim", "release", "progress", "block", "create_child", "request_review", "propose_complete",
    "git_status", "git_diff", "git_checkpoint_request", "git_commit_request",
  ]),
  validator: new Set(["read", "progress", "block", "record_validation", "git_status", "git_diff"]),
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

function normalizeTaskKind(value, fallback = "executable") {
  const kind = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!TASK_KINDS.has(kind)) {
    throw codedError("invalid_request", `unsupported task kind: ${kind}`);
  }
  return kind;
}

function normalizeTaskTags(value = []) {
  if (!Array.isArray(value) || value.length > 20) {
    throw codedError("invalid_request", "task tags must be a list of at most 20 values");
  }
  const tags = [...new Set(value.map((item) =>
    typeof item === "string" ? item.trim().toLowerCase() : ""
  ))].filter(Boolean);
  if (tags.some((tag) => !/^[a-z0-9][a-z0-9._-]{0,49}$/.test(tag))) {
    throw codedError(
      "invalid_request",
      "task tags must use 1-50 lowercase letters, numbers, dot, underscore, or hyphen",
    );
  }
  return tags;
}

function normalizeDispatchPolicy(value) {
  if (!DISPATCH_POLICIES.has(value)) {
    throw codedError("invalid_request", `unsupported dispatch policy: ${value}`);
  }
  return value;
}

function normalizeDispatchPriority(value) {
  if (
    !Number.isInteger(value)
    || value < DISPATCH_PRIORITY_MIN
    || value > DISPATCH_PRIORITY_MAX
  ) {
    throw codedError(
      "invalid_request",
      `task priority must be an integer from ${DISPATCH_PRIORITY_MIN} to ${DISPATCH_PRIORITY_MAX}`,
    );
  }
  return value;
}

function normalizeGitBranch(value, label = "Git branch") {
  const branch = typeof value === "string" ? value.trim() : "";
  if (
    !branch
    || branch.length > 240
    || branch.startsWith("-")
    || branch.includes("..")
    || /[\s~^:?*[\\\x00-\x1f\x7f]/.test(branch)
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.includes("//")
    || branch.includes("@{")
    || branch.endsWith(".lock")
  ) {
    throw codedError("invalid_request", `${label} is invalid`);
  }
  return branch;
}

function normalizeGitRemote(value) {
  const remote = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(remote)) {
    throw codedError("invalid_request", "Git remote name is invalid");
  }
  return remote;
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

function publicCommandExecution(row) {
  if (!row) return null;
  const {
    model_route_json: ignoredModelRouteJson,
    failure_json: ignoredFailureJson,
    ...visible
  } = row;
  return {
    ...visible,
    model_route: parseJson(row.model_route_json) ?? {},
    failure: parseJson(row.failure_json),
  };
}

function publicRecoveryCandidate(row) {
  if (!row) return null;
  const {
    evidence_json: ignoredEvidenceJson,
    proof_json: ignoredProofJson,
    ...visible
  } = row;
  return {
    ...visible,
    evidence: parseJson(row.evidence_json) ?? {},
    proof: parseJson(row.proof_json) ?? {},
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

function publicProjectDeletionReceipt(row) {
  if (!row) return null;
  const {
    request_sha256: ignoredRequestHash,
    project_snapshot_json: ignoredProjectSnapshotJson,
    ...visible
  } = row;
  return {
    ...visible,
    project_snapshot: parseJson(row.project_snapshot_json) ?? {},
  };
}

function publicGitPolicy(row) {
  if (!row) return null;
  const { allowed_target_branches_json: ignoredBranches, ...visible } = row;
  return {
    ...visible,
    allow_push: Boolean(row.allow_push),
    allow_pull_request: Boolean(row.allow_pull_request),
    allowed_target_branches: parseJson(row.allowed_target_branches_json) ?? [],
  };
}

function publicGitIntegration(row) {
  if (!row) return null;
  const {
    plan_json: ignoredPlan,
    result_json: ignoredResult,
    failure_json: ignoredFailure,
    request_sha256: ignoredRequestHash,
    ...visible
  } = row;
  return {
    ...visible,
    plan: parseJson(row.plan_json) ?? {},
    result: parseJson(row.result_json),
    failure: parseJson(row.failure_json),
  };
}

function publicCleanupOperation(row) {
  if (!row) return null;
  const {
    resources_json: ignoredResources,
    result_json: ignoredResult,
    request_sha256: ignoredRequestHash,
    ...visible
  } = row;
  return {
    ...visible,
    resources: parseJson(row.resources_json) ?? [],
    result: parseJson(row.result_json),
  };
}

function publicSessionDeletionReceipt(row) {
  if (!row) return null;
  const {
    preview_json: ignoredPreview,
    result_json: ignoredResult,
    request_sha256: ignoredRequestHash,
    ...visible
  } = row;
  return {
    ...visible,
    preview: parseJson(row.preview_json) ?? {},
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
      CREATE TABLE IF NOT EXISTS project_imports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
        source_url TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_deletion_receipts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        project_snapshot_json TEXT NOT NULL,
        original_path TEXT NOT NULL,
        quarantine_path TEXT NOT NULL,
        reason TEXT NOT NULL,
        actor TEXT NOT NULL,
        state TEXT NOT NULL,
        checkout_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tombstoned_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_git_policies (
        project_id TEXT PRIMARY KEY REFERENCES projects(id),
        mode TEXT NOT NULL,
        history_policy TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        remote_name TEXT NOT NULL,
        allow_push INTEGER NOT NULL,
        allow_pull_request INTEGER NOT NULL,
        allowed_target_branches_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_git_policy_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        prior_json TEXT NOT NULL,
        new_json TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS git_integrations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        merge_request_id TEXT REFERENCES merge_requests(id),
        state TEXT NOT NULL,
        mode TEXT NOT NULL,
        history_policy TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        target_revision TEXT NOT NULL,
        result_revision TEXT,
        remote_name TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        plan_json TEXT NOT NULL,
        result_json TEXT,
        failure_json TEXT,
        version INTEGER NOT NULL,
        prepared_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS git_integration_actions (
        id TEXT PRIMARY KEY,
        integration_id TEXT NOT NULL REFERENCES git_integrations(id),
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        result_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retention_holds (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        active INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        released_by TEXT,
        release_reason TEXT,
        released_at TEXT
      );
      CREATE TABLE IF NOT EXISTS retention_hold_events (
        id TEXT PRIMARY KEY,
        hold_id TEXT NOT NULL REFERENCES retention_holds(id),
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resource_cleanup_operations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        task_id TEXT REFERENCES tasks(id),
        preview_sha256 TEXT NOT NULL,
        state TEXT NOT NULL,
        resources_json TEXT NOT NULL,
        result_json TEXT,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_deletion_receipts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        preview_sha256 TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        manifest_path TEXT,
        state TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        result_json TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_flags (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        kind TEXT NOT NULL,
        source_ref TEXT,
        content TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS command_reconciliations (
        id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL REFERENCES orchestrator_commands(id),
        action TEXT NOT NULL,
        result_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_executions (
        id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL UNIQUE REFERENCES orchestrator_commands(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        phase TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        generation INTEGER NOT NULL,
        session_id TEXT UNIQUE,
        run_id TEXT UNIQUE,
        workspace_id TEXT,
        base_revision TEXT NOT NULL,
        model_route_json TEXT NOT NULL,
        failure_class TEXT,
        failure_json TEXT,
        last_activity_at TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        started_at TEXT,
        stop_requested_at TEXT,
        stopped_at TEXT,
        settled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_events (
        execution_id TEXT NOT NULL REFERENCES command_executions(id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS execution_action_receipts (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES command_executions(id),
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        result_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_candidates (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES command_executions(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        run_id TEXT,
        workspace_id TEXT,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        revision TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        resolved_by TEXT,
        resolution_reason TEXT,
        resolved_at TEXT,
        version INTEGER NOT NULL
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
      CREATE TABLE IF NOT EXISTS conversation_custody_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES orchestrator_conversations(id),
        trigger TEXT NOT NULL,
        path TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        native_sha256 TEXT,
        verified INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_model_changes (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES orchestrator_conversations(id),
        prior_version INTEGER NOT NULL,
        new_version INTEGER NOT NULL,
        prior_route_json TEXT NOT NULL,
        new_route_json TEXT NOT NULL,
        custody_snapshot_id TEXT NOT NULL REFERENCES conversation_custody_snapshots(snapshot_id),
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS topic_project_bindings (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id),
        conversation_id TEXT NOT NULL REFERENCES orchestrator_conversations(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        prior_conversation_version INTEGER NOT NULL,
        new_conversation_version INTEGER NOT NULL,
        custody_snapshot_id TEXT NOT NULL REFERENCES conversation_custody_snapshots(snapshot_id),
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_prompt_profiles (
        profile_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        active_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_prompt_revisions (
        id TEXT PRIMARY KEY,
        profile_key TEXT NOT NULL REFERENCES agent_prompt_profiles(profile_key),
        version INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        prompt_sha256 TEXT NOT NULL,
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(profile_key,version)
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
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
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
    this.ensureColumn("tasks", "description", "TEXT");
    this.ensureColumn("tasks", "task_kind", "TEXT NOT NULL DEFAULT 'executable'");
    this.ensureColumn("tasks", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("tasks", "archived_at", "TEXT");
    this.ensureColumn("tasks", "archived_by", "TEXT");
    this.ensureColumn("tasks", "archive_reason", "TEXT");
    this.ensureColumn("tasks", "dispatch_policy", "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureColumn("tasks", "priority", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "released_at", "TEXT");
    this.ensureColumn("tasks", "released_by", "TEXT");
    this.ensureColumn("tasks", "dispatch_model_route_json", "TEXT");
    const lifecycleMigration = "2026-07-18-task-lifecycle-classification";
    if (!this.database.prepare("SELECT 1 value FROM schema_migrations WHERE id=?").get(lifecycleMigration)) {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.prepare(
          "UPDATE tasks SET task_kind='intake' WHERE id LIKE 'intake-%' AND task_kind='executable'",
        ).run();
        this.database.prepare(`UPDATE tasks SET task_kind='umbrella'
          WHERE task_kind='executable' AND EXISTS(
            SELECT 1 FROM tasks child WHERE child.parent_task_id=tasks.id
          )`).run();
        this.database.prepare("INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)").run(
          lifecycleMigration,
          this.clock(),
        );
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    this.ensureColumn("projects", "repository_id", "TEXT");
    this.ensureColumn("projects", "source_url", "TEXT");
    this.ensureColumn("projects", "deleted_at", "TEXT");
    this.ensureColumn("projects", "deleted_by", "TEXT");
    this.ensureColumn("projects", "deletion_reason", "TEXT");
    this.ensureColumn("sessions", "deleted_at", "TEXT");
    this.ensureColumn("sessions", "deleted_by", "TEXT");
    this.ensureColumn("sessions", "deletion_reason", "TEXT");
    this.ensureColumn("sessions", "deletion_manifest_path", "TEXT");
    this.ensureColumn("task_events", "actor_role", "TEXT");
    this.ensureColumn("task_events", "run_id", "TEXT");
    this.ensureColumn("task_events", "task_version", "INTEGER");
    this.ensureColumn("runs", "container_id", "TEXT");
    this.ensureColumn("runs", "image_id", "TEXT");
    this.ensureColumn("runs", "workspace_id", "TEXT");
    this.ensureColumn("runs", "credential_profile", "TEXT");
    this.ensureColumn("runs", "orchestrator_id", "TEXT");
    this.ensureColumn("runs", "phase", "TEXT");
    this.ensureColumn("runs", "prompt_profile_key", "TEXT");
    this.ensureColumn("runs", "prompt_profile_version", "INTEGER");
    this.ensureColumn("runs", "prompt_sha256", "TEXT");
    this.ensureColumn("runs", "model_provider", "TEXT");
    this.ensureColumn("runs", "model_id", "TEXT");
    this.ensureColumn("runs", "thinking_level", "TEXT");
    this.ensureColumn("runs", "model_policy_source", "TEXT");
    this.ensureColumn("runs", "billing_class", "TEXT");
    this.ensureColumn("runs", "execution_id", "TEXT");
    this.ensureColumn("capabilities", "execution_id", "TEXT");
    this.ensureColumn("capabilities", "execution_generation", "INTEGER");
    this.ensureColumn("workspaces", "retired_at", "TEXT");
    this.ensureColumn("workspaces", "retired_by", "TEXT");
    this.ensureColumn("workspaces", "retirement_reason", "TEXT");
    this.ensureColumn("merge_requests", "integration_id", "TEXT");
    this.ensureColumn("merge_requests", "result_revision", "TEXT");
    this.ensureColumn("merge_requests", "integrated_at", "TEXT");
    this.ensureColumn("orchestrator_conversations", "version", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("conversation_custody_snapshots", "conversation_version", "INTEGER");
    this.seedPromptProfiles();
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
      CREATE INDEX IF NOT EXISTS command_executions_project_state
        ON command_executions(project_id,state,created_at);
      CREATE INDEX IF NOT EXISTS command_executions_task_state
        ON command_executions(task_id,state,created_at);
      CREATE INDEX IF NOT EXISTS git_integrations_task_state
        ON git_integrations(task_id,state,updated_at);
      CREATE INDEX IF NOT EXISTS retention_holds_scope
        ON retention_holds(project_id,scope_type,scope_id,active);
      CREATE INDEX IF NOT EXISTS cleanup_operations_task_state
        ON resource_cleanup_operations(task_id,state,updated_at);
      CREATE INDEX IF NOT EXISTS recovery_candidates_task_state
        ON recovery_candidates(task_id,state,discovered_at);
      CREATE INDEX IF NOT EXISTS topics_project_state
        ON topics(project_id,state,updated_at);
      CREATE INDEX IF NOT EXISTS conversation_turns_state
        ON conversation_turns(state,created_at,conversation_id,sequence);
      CREATE INDEX IF NOT EXISTS conversation_runs_turn_state
        ON conversation_runs(turn_id,state,started_at);
      CREATE INDEX IF NOT EXISTS conversation_custody_conversation_created
        ON conversation_custody_snapshots(conversation_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_prompt_revisions_profile_version
        ON agent_prompt_revisions(profile_key,version DESC);
      CREATE INDEX IF NOT EXISTS task_dependencies_reverse
        ON task_dependencies(depends_on_task_id,task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_orchestration_lease_per_scope
        ON orchestration_leases(scope_type,scope_id) WHERE status='active';
    `);
    this.database.exec(`
      DROP INDEX IF EXISTS one_project_per_import_source;
      CREATE UNIQUE INDEX one_project_per_import_source
        ON projects(source_url)
        WHERE source_url IS NOT NULL AND deleted_at IS NULL;
    `);
  }

  ensureColumn(table, column, definition) {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  seedPromptProfiles() {
    const now = this.clock();
    for (const profileKey of PROMPT_PROFILE_KEYS) {
      const defaults = DEFAULT_PROMPT_PROFILES[profileKey];
      this.database.prepare(`INSERT OR IGNORE INTO agent_prompt_profiles(
        profile_key,display_name,role,active_version,created_at,updated_at
      ) VALUES(?,?,?,1,?,?)`).run(
        profileKey,
        defaults.displayName,
        defaults.role,
        now,
        now,
      );
      const existing = this.database.prepare(`SELECT id FROM agent_prompt_revisions
        WHERE profile_key=? AND version=1`).get(profileKey);
      if (!existing) {
        const promptSha256 = sha256(defaults.prompt);
        this.database.prepare(`INSERT INTO agent_prompt_revisions(
          id,profile_key,version,prompt_text,prompt_sha256,actor,idempotency_key,
          request_sha256,created_at
        ) VALUES(?,?,1,?,?,? ,?,?,?)`).run(
          randomUUID(),
          profileKey,
          defaults.prompt,
          promptSha256,
          "platform-default",
          `platform-default:${profileKey}:1`,
          sha256(JSON.stringify({
            action: "seed_agent_prompt",
            profileKey,
            version: 1,
            prompt: defaults.prompt,
          })),
          now,
        );
      }
    }
  }

  agentPromptProfiles() {
    return this.database.prepare(`SELECT
      p.profile_key,p.display_name,p.role,p.active_version,p.created_at,p.updated_at,
      r.id AS revision_id,r.prompt_text,r.prompt_sha256,r.actor AS revision_actor,
      r.created_at AS revision_created_at
      FROM agent_prompt_profiles p
      JOIN agent_prompt_revisions r
        ON r.profile_key=p.profile_key AND r.version=p.active_version
      ORDER BY CASE p.profile_key
        WHEN 'orchestrator' THEN 0
        WHEN 'implementation' THEN 1
        WHEN 'test' THEN 2
        WHEN 'review' THEN 3
        ELSE 4 END`).all();
  }

  getAgentPromptProfile(profileKey) {
    if (!PROMPT_PROFILE_KEYS.includes(profileKey)) {
      throw codedError("not_found", `unknown agent prompt profile: ${profileKey}`);
    }
    const active = this.agentPromptProfiles().find((profile) => profile.profile_key === profileKey);
    if (!active) throw codedError("not_found", `unknown agent prompt profile: ${profileKey}`);
    const revisions = this.database.prepare(`SELECT
      id,profile_key,version,prompt_sha256,actor,created_at
      FROM agent_prompt_revisions WHERE profile_key=? ORDER BY version DESC`).all(profileKey);
    return { ...active, revisions };
  }

  getAgentPromptRevision(profileKey, version) {
    const revision = this.database.prepare(`SELECT
      id,profile_key,version,prompt_text,prompt_sha256,actor,created_at
      FROM agent_prompt_revisions WHERE profile_key=? AND version=?`).get(profileKey, version);
    if (!revision) throw codedError("not_found", `unknown ${profileKey} prompt revision: ${version}`);
    return revision;
  }

  updateAgentPromptProfile({
    profileKey,
    prompt,
    expectedVersion,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!PROMPT_PROFILE_KEYS.includes(profileKey)) {
      throw codedError("not_found", `unknown agent prompt profile: ${profileKey}`);
    }
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
    if (!normalizedPrompt || normalizedPrompt.length > 32_000 || normalizedPrompt.includes("\0")) {
      throw codedError("invalid_request", "agent prompt must be between 1 and 32000 characters");
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw codedError("invalid_request", "expected prompt version must be a positive integer");
    }
    const request = {
      action: "update_agent_prompt",
      profileKey,
      prompt: normalizedPrompt,
      expectedVersion,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const prior = this.database.prepare(
      "SELECT * FROM agent_prompt_revisions WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.profile_key !== profileKey) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different prompt update");
      }
      return {
        replayed: true,
        profile: this.getAgentPromptProfile(profileKey),
        revision: prior,
      };
    }
    const profile = this.database.prepare(
      "SELECT * FROM agent_prompt_profiles WHERE profile_key=?",
    ).get(profileKey);
    if (profile.active_version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `prompt profile ${profileKey} is version ${profile.active_version}, expected ${expectedVersion}`,
      );
    }
    const version = profile.active_version + 1;
    const now = this.clock();
    const revision = {
      id: randomUUID(),
      promptSha256: sha256(normalizedPrompt),
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO agent_prompt_revisions(
        id,profile_key,version,prompt_text,prompt_sha256,actor,idempotency_key,
        request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        revision.id,
        profileKey,
        version,
        normalizedPrompt,
        revision.promptSha256,
        actor,
        idempotencyKey,
        requestSha256,
        now,
      );
      const updated = this.database.prepare(`UPDATE agent_prompt_profiles SET
        active_version=?,updated_at=? WHERE profile_key=? AND active_version=?`).run(
        version,
        now,
        profileKey,
        expectedVersion,
      );
      if (Number(updated.changes) !== 1) {
        throw codedError("version_conflict", `prompt profile ${profileKey} changed concurrently`);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      profile: this.getAgentPromptProfile(profileKey),
      revision: this.database.prepare(
        "SELECT * FROM agent_prompt_revisions WHERE id=?",
      ).get(revision.id),
    };
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
    taskKind = "executable",
    tags = [],
  }) {
    const now = this.clock();
    const normalizedKind = normalizeTaskKind(taskKind);
    const normalizedTags = normalizeTaskTags(tags);
    this.database
      .prepare("INSERT OR IGNORE INTO projects(id,name,repository_path,created_at,repository_id) VALUES(?,?,?,?,?)")
      .run(projectId, projectName, repositoryPath, now, repositoryId);
    this.database.prepare("UPDATE projects SET repository_id=COALESCE(repository_id,?) WHERE id=?").run(repositoryId, projectId);
    this.database
      .prepare(`INSERT OR IGNORE INTO tasks(
        id,project_id,title,status,version,updated_at,revision,validation_passed,
        merge_requested,acceptance_criteria_json,task_kind,tags_json
      ) VALUES(?,?,?,?,1,?,?,0,0,?,?,?)`)
      .run(
        taskId,
        projectId,
        title,
        "ready",
        now,
        revision,
        JSON.stringify(acceptanceCriteria),
        normalizedKind,
        JSON.stringify(normalizedTags),
      );
    this.database.prepare("UPDATE tasks SET revision=COALESCE(revision,?) WHERE id=?").run(revision, taskId);
    return this.getTask(taskId);
  }

  createOwnerTask({
    projectId,
    title,
    acceptanceCriteria = [],
    taskKind = "executable",
    tags = [],
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
    const normalizedKind = normalizeTaskKind(taskKind);
    const normalizedTags = normalizeTaskTags(tags);
    const requestSha256 = sha256(JSON.stringify({
      action: "create_task",
      projectId,
      title: normalizedTitle,
      acceptanceCriteria: normalizedCriteria,
      taskKind: normalizedKind,
      tags: normalizedTags,
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
        merge_requested,acceptance_criteria_json,task_kind,tags_json
      ) VALUES(?,?,?,'ready',1,?,?,0,0,?,?,?)`).run(
        id,
        projectId,
        normalizedTitle,
        now,
        revision,
        JSON.stringify(normalizedCriteria),
        normalizedKind,
        JSON.stringify(normalizedTags),
      );
      const current = this.getTaskDetails(id);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, "task_created", "local-owner", null, "ready",
        JSON.stringify({
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
          taskKind: normalizedKind,
          tags: normalizedTags,
        }),
        idempotencyKey, now, "owner", null, 1,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, "task_created", "local-owner", "owner", null, null, "null", JSON.stringify(current),
        JSON.stringify({
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
          taskKind: normalizedKind,
          tags: normalizedTags,
        }),
        idempotencyKey, requestSha256, now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, task: this.getTaskDetails(id) };
  }

  updateOwnerTask({
    taskId,
    title,
    description = null,
    acceptanceCriteria = [],
    taskKind = null,
    tags = null,
    expectedVersion,
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (task.status === "done") {
      throw codedError("transition_denied", "completed tasks must be reopened before editing");
    }
    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    const normalizedDescription = typeof description === "string" && description.trim()
      ? description.trim()
      : null;
    if (!normalizedTitle || normalizedTitle.length > 500 || normalizedTitle.includes("\0")) {
      throw codedError("invalid_request", "task title must be between 1 and 500 characters");
    }
    if (
      normalizedDescription
      && (normalizedDescription.length > 20_000 || normalizedDescription.includes("\0"))
    ) {
      throw codedError("invalid_request", "task description must be at most 20000 characters");
    }
    if (
      !Array.isArray(acceptanceCriteria) || acceptanceCriteria.length > 100
      || acceptanceCriteria.some(
        (item) => typeof item !== "string" || !item.trim() || item.length > 2000,
      )
    ) {
      throw codedError("invalid_request", "acceptance criteria must be a list of non-empty strings");
    }
    if (!Number.isInteger(expectedVersion)) {
      throw codedError("invalid_request", "expected task version is required");
    }
    const normalizedCriteria = acceptanceCriteria.map((item) => item.trim());
    const normalizedKind = normalizeTaskKind(taskKind, task.task_kind);
    const normalizedTags = normalizeTaskTags(tags ?? parseJson(task.tags_json) ?? []);
    if (normalizedKind !== task.task_kind) {
      const busy = this.database.prepare(`SELECT 1 value FROM orchestrator_commands
        WHERE task_id=? AND state IN ('queued','claimed','running') LIMIT 1`).get(taskId)
        || this.database.prepare(`SELECT 1 value FROM runs r JOIN sessions s ON s.id=r.session_id
          WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(taskId);
      if (busy || ["in_progress", "review"].includes(task.status)) {
        throw codedError("transition_denied", "active task kind cannot change");
      }
    }
    const request = {
      action: "owner_update_task",
      taskId,
      title: normalizedTitle,
      description: normalizedDescription,
      acceptanceCriteria: normalizedCriteria,
      taskKind: normalizedKind,
      tags: normalizedTags,
      expectedVersion,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const priorAudit = this.database.prepare(
      "SELECT * FROM audit_events WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (priorAudit) {
      if (priorAudit.request_sha256 !== requestSha256 || priorAudit.type !== "task_updated") {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different task edit");
      }
      return { replayed: true, task: this.getTaskDetails(taskId) };
    }
    if (task.version !== expectedVersion) {
      throw codedError("version_conflict", `task is version ${task.version}, expected ${expectedVersion}`);
    }
    const prior = this.getTaskDetails(taskId);
    const now = this.clock();
    const nextVersion = task.version + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE tasks SET
        title=?,description=?,acceptance_criteria_json=?,task_kind=?,tags_json=?,version=?,updated_at=?
        WHERE id=? AND version=?`).run(
        normalizedTitle,
        normalizedDescription,
        JSON.stringify(normalizedCriteria),
        normalizedKind,
        JSON.stringify(normalizedTags),
        nextVersion,
        now,
        taskId,
        expectedVersion,
      );
      if (Number(changed.changes) !== 1) throw codedError("version_conflict", "task changed during edit");
      const current = this.getTaskDetails(taskId);
      const payload = {
        title: normalizedTitle,
        description: normalizedDescription,
        acceptanceCriteria: normalizedCriteria,
        taskKind: normalizedKind,
        tags: normalizedTags,
      };
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        "task_updated",
        "local-owner",
        task.status,
        task.status,
        JSON.stringify(payload),
        idempotencyKey,
        now,
        "owner",
        null,
        nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        "task_updated",
        "local-owner",
        "owner",
        null,
        null,
        JSON.stringify(prior),
        JSON.stringify(current),
        JSON.stringify(payload),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, task: this.getTaskDetails(taskId) };
  }

  setTaskArchived({
    taskId,
    archived,
    reason,
    expectedVersion,
    idempotencyKey,
    actor = "local-owner",
    actorRole = "owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (!Number.isInteger(expectedVersion)) {
      throw codedError("invalid_request", "expected task version is required");
    }
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";
    if (
      archived
      && (!normalizedReason || normalizedReason.length > 2_000 || normalizedReason.includes("\0"))
    ) {
      throw codedError("invalid_request", "archive reason must be between 1 and 2000 characters");
    }
    if (!archived && normalizedReason.length > 2_000) {
      throw codedError("invalid_request", "restore reason must be at most 2000 characters");
    }
    const request = {
      action: archived ? "archive_task" : "restore_task",
      taskId,
      expectedVersion,
      reason: normalizedReason,
      actor,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const eventType = archived ? "task_archived" : "task_restored";
    const priorAudit = this.database.prepare(
      "SELECT * FROM audit_events WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (priorAudit) {
      if (priorAudit.request_sha256 !== requestSha256 || priorAudit.type !== eventType) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different lifecycle mutation");
      }
      return { replayed: true, task: this.getTaskDetails(taskId) };
    }
    if (task.version !== expectedVersion) {
      throw codedError("version_conflict", `task is version ${task.version}, expected ${expectedVersion}`);
    }
    if (archived === Boolean(task.archived_at)) {
      throw codedError(
        "transition_denied",
        archived ? "task is already archived" : "task is not archived",
      );
    }
    if (archived) {
      const busy = this.database.prepare(`SELECT 1 value FROM orchestrator_commands
        WHERE task_id=? AND state IN ('queued','claimed','running') LIMIT 1`).get(taskId)
        || this.database.prepare(`SELECT 1 value FROM runs r JOIN sessions s ON s.id=r.session_id
          WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(taskId);
      if (busy || ["in_progress", "review"].includes(task.status)) {
        throw codedError("transition_denied", "active task work must be stopped or reconciled before archival");
      }
    }
    const prior = this.getTaskDetails(taskId);
    const now = this.clock();
    const nextVersion = task.version + 1;
    const payload = {
      reason: normalizedReason || "Restored to active board",
      kind: task.task_kind,
      tags: parseJson(task.tags_json) ?? [],
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE tasks SET
        archived_at=?,archived_by=?,archive_reason=?,version=?,updated_at=?
        WHERE id=? AND version=?`).run(
        archived ? now : null,
        archived ? actor : null,
        archived ? normalizedReason : null,
        nextVersion,
        now,
        taskId,
        expectedVersion,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "task changed during lifecycle mutation");
      }
      const current = this.getTaskDetails(taskId);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        eventType,
        actor,
        task.status,
        task.status,
        JSON.stringify(payload),
        idempotencyKey,
        now,
        actorRole,
        null,
        nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        eventType,
        actor,
        actorRole,
        null,
        null,
        JSON.stringify(prior),
        JSON.stringify(current),
        JSON.stringify(payload),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, task: this.getTaskDetails(taskId) };
  }

  setTaskDispatch({
    taskId,
    operation,
    expectedVersion,
    priority = null,
    modelRoute = null,
    idempotencyKey,
    actor = "local-owner",
    actorRole = "owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!["release", "pause_dispatch", "manualize_dispatch", "set_priority"].includes(operation)) {
      throw codedError("invalid_request", `unsupported dispatch mutation: ${operation}`);
    }
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (!Number.isInteger(expectedVersion)) {
      throw codedError("invalid_request", "expected task version is required");
    }
    const normalizedPriority = priority === null
      ? Number(task.priority)
      : normalizeDispatchPriority(priority);
    const normalizedRoute = modelRoute === null
      ? parseJson(task.dispatch_model_route_json)
      : {
        ...validateModelRoute(modelRoute, "implementation dispatch model route"),
        policySource: modelRoute?.policySource ?? "task_dispatch",
      };
    const nextPolicy = {
      release: "automatic",
      pause_dispatch: "paused",
      manualize_dispatch: "manual",
      set_priority: task.dispatch_policy,
    }[operation];
    normalizeDispatchPolicy(nextPolicy);
    const request = {
      action: operation,
      taskId,
      expectedVersion,
      dispatchPolicy: nextPolicy,
      priority: normalizedPriority,
      modelRoute: normalizedRoute,
      actor,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const eventType = {
      release: "task_released",
      pause_dispatch: "task_dispatch_paused",
      manualize_dispatch: "task_dispatch_manualized",
      set_priority: "task_priority_updated",
    }[operation];
    const priorEvent = this.database.prepare(
      "SELECT * FROM audit_events WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (priorEvent) {
      if (priorEvent.request_sha256 !== requestSha256 || priorEvent.type !== eventType) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different dispatch mutation");
      }
      return { replayed: true, task: this.getTaskDetails(taskId) };
    }
    if (task.version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `task version conflict: expected ${expectedVersion}, current ${task.version}`,
      );
    }
    if (task.archived_at || task.task_kind !== "executable") {
      throw codedError("transition_denied", "only active executable tasks have dispatch policy");
    }
    const active = this.database.prepare(`SELECT 1 value FROM orchestrator_commands
      WHERE task_id=? AND state IN ('queued','claimed','running') LIMIT 1`).get(taskId)
      || this.database.prepare(`SELECT 1 value FROM runs r JOIN sessions s ON s.id=r.session_id
        WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(taskId);
    if (active || !["ready", "backlog"].includes(task.status) || task.assigned_worker) {
      throw codedError(
        "transition_denied",
        "dispatch policy can change only for an unassigned queued task",
      );
    }
    if (operation === "release" && !["manual", "paused"].includes(task.dispatch_policy)) {
      throw codedError("transition_denied", "only manual or paused tasks can be released");
    }
    if (operation === "release" && task.status !== "ready") {
      throw codedError("transition_denied", "automatic release requires a Ready task");
    }
    if (operation === "pause_dispatch" && task.dispatch_policy !== "automatic") {
      throw codedError("transition_denied", "only automatic tasks can be paused");
    }
    if (
      operation === "manualize_dispatch"
      && !["automatic", "paused"].includes(task.dispatch_policy)
    ) {
      throw codedError("transition_denied", "task is already manual");
    }
    if (operation === "release") {
      const criteria = parseJson(task.acceptance_criteria_json) ?? [];
      if (criteria.length === 0) {
        throw codedError(
          "transition_denied",
          "automatic release requires at least one acceptance criterion",
        );
      }
      const dependency = this.database.prepare(`SELECT t.id FROM task_dependencies d
        JOIN tasks t ON t.id=d.depends_on_task_id
        WHERE d.task_id=? AND t.status<>'done' ORDER BY t.id LIMIT 1`).get(taskId);
      if (dependency) {
        throw codedError("transition_denied", `task dependency is not complete: ${dependency.id}`);
      }
      const decision = this.database.prepare(`SELECT id FROM decision_gates
        WHERE task_id=? AND status='decision_required' ORDER BY created_at,id LIMIT 1`).get(taskId);
      if (decision) {
        throw codedError("transition_denied", `task has an unresolved decision: ${decision.id}`);
      }
    }
    const now = this.clock();
    const resumed = operation === "release" && task.dispatch_policy === "paused";
    const releasedAt = operation === "release" && !resumed ? now : task.released_at;
    const releasedBy = operation === "release" && !resumed ? actor : task.released_by;
    const prior = this.getTaskDetails(taskId);
    const nextVersion = task.version + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE tasks SET
        dispatch_policy=?,priority=?,released_at=?,released_by=?,
        dispatch_model_route_json=?,version=?,updated_at=?
        WHERE id=? AND version=?`).run(
        nextPolicy,
        normalizedPriority,
        releasedAt,
        releasedBy,
        normalizedRoute ? JSON.stringify(normalizedRoute) : null,
        nextVersion,
        now,
        taskId,
        task.version,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "task changed during dispatch mutation");
      }
      const current = this.getTaskDetails(taskId);
      const payload = {
        operation,
        dispatchPolicy: nextPolicy,
        priority: normalizedPriority,
        releasedAt,
        releasedBy,
        modelRoute: normalizedRoute,
      };
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        eventType,
        actor,
        task.status,
        task.status,
        JSON.stringify(payload),
        idempotencyKey,
        now,
        actorRole,
        null,
        nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId,
        eventType,
        actor,
        actorRole,
        null,
        null,
        JSON.stringify(prior),
        JSON.stringify(current),
        JSON.stringify(payload),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, task: this.getTaskDetails(taskId) };
  }

  readyDispatchCandidates(projectId, {
    projectCapacity = 1,
    globalCapacity = 1,
  } = {}) {
    if (!this.getProject(projectId)) {
      throw codedError("not_found", `unknown project: ${projectId}`);
    }
    const orchestrator = this.activeProjectOrchestrator(projectId);
    const projectActive = Number(this.database.prepare(`SELECT COUNT(*) count
      FROM orchestrator_commands
      WHERE project_id=? AND state IN ('queued','claimed','running')`).get(projectId).count);
    const globalActive = Number(this.database.prepare(`SELECT COUNT(*) count
      FROM orchestrator_commands WHERE state IN ('queued','claimed','running')`).get().count);
    const rows = this.database.prepare(`SELECT * FROM tasks
      WHERE project_id=? AND archived_at IS NULL AND task_kind='executable'
        AND dispatch_policy IN ('automatic','paused')
      ORDER BY priority DESC,released_at,id`).all(projectId);
    const storagePressure = this.runtimeFlag("storage_pressure")?.value ?? {};
    let rank = 0;
    return rows.map((task) => {
      const blockers = [];
      if (task.dispatch_policy === "paused") blockers.push("paused");
      if (storagePressure.hardBlocked) blockers.push("storage_pressure");
      if (task.status !== "ready") blockers.push("not_ready");
      if (task.assigned_worker) blockers.push("assigned");
      const criteria = parseJson(task.acceptance_criteria_json) ?? [];
      if (criteria.length === 0) blockers.push("missing_acceptance_criteria");
      if (this.database.prepare(`SELECT 1 value FROM task_dependencies d
        JOIN tasks t ON t.id=d.depends_on_task_id
        WHERE d.task_id=? AND t.status<>'done' LIMIT 1`).get(task.id)) {
        blockers.push("unresolved_dependency");
      }
      if (this.database.prepare(`SELECT 1 value FROM decision_gates
        WHERE task_id=? AND status='decision_required' LIMIT 1`).get(task.id)) {
        blockers.push("human_decision_required");
      }
      if (
        this.database.prepare(`SELECT 1 value FROM orchestrator_commands
          WHERE task_id=? AND state IN ('queued','claimed','running') LIMIT 1`).get(task.id)
        || this.database.prepare(`SELECT 1 value FROM runs r JOIN sessions s ON s.id=r.session_id
          WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(task.id)
      ) blockers.push("phase_active");
      const structurallyEligible = blockers.length === 0;
      const queueRank = structurallyEligible ? ++rank : null;
      if (!orchestrator) blockers.push("orchestrator_unavailable");
      if (projectActive >= projectCapacity) blockers.push("project_capacity");
      if (globalActive >= globalCapacity) blockers.push("global_capacity");
      return {
        taskId: task.id,
        dispatchPolicy: task.dispatch_policy,
        priority: Number(task.priority),
        releasedAt: task.released_at,
        releasedBy: task.released_by,
        modelRoute: parseJson(task.dispatch_model_route_json),
        rank: queueRank,
        eligible: structurallyEligible
          && Boolean(orchestrator)
          && projectActive < projectCapacity
          && globalActive < globalCapacity,
        blockers,
      };
    });
  }

  taskDispatchProjection(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const projected = this.readyDispatchCandidates(task.project_id)
      .find((candidate) => candidate.taskId === taskId);
    return projected ?? {
      taskId,
      dispatchPolicy: task.dispatch_policy,
      priority: Number(task.priority),
      releasedAt: task.released_at,
      releasedBy: task.released_by,
      modelRoute: parseJson(task.dispatch_model_route_json),
      rank: null,
      eligible: false,
      blockers: task.dispatch_policy === "manual"
        ? ["manual"]
        : task.archived_at
          ? ["archived"]
          : task.task_kind !== "executable"
            ? ["non_executable"]
            : ["not_queued"],
    };
  }

  dispatchNextReadyTask({
    projectId,
    modelRoute,
    projectCapacity = 1,
    globalCapacity = 1,
    actor = "ready-scheduler",
  }) {
    if (!this.getProject(projectId)) {
      throw codedError("not_found", `unknown project: ${projectId}`);
    }
    this.expireOrchestratorLeases();
    const defaultRoute = {
      ...validateModelRoute(modelRoute, "automatic implementation model route"),
      policySource: modelRoute?.policySource ?? "automatic_dispatch_default",
    };
    const now = this.clock();
    if (this.runtimeFlag("storage_pressure")?.value?.hardBlocked) {
      return { scheduled: false, reason: "storage_pressure" };
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const orchestrator = this.database.prepare(`SELECT * FROM project_orchestrators
        WHERE project_id=? AND status='active' AND lease_expires_at>?`).get(projectId, now);
      if (!orchestrator) {
        this.database.exec("COMMIT");
        return { scheduled: false, reason: "orchestrator_unavailable" };
      }
      const projectActive = Number(this.database.prepare(`SELECT COUNT(*) count
        FROM orchestrator_commands
        WHERE project_id=? AND state IN ('queued','claimed','running')`).get(projectId).count);
      if (projectActive >= projectCapacity) {
        this.database.exec("COMMIT");
        return { scheduled: false, reason: "project_capacity" };
      }
      const globalActive = Number(this.database.prepare(`SELECT COUNT(*) count
        FROM orchestrator_commands WHERE state IN ('queued','claimed','running')`).get().count);
      if (globalActive >= globalCapacity) {
        this.database.exec("COMMIT");
        return { scheduled: false, reason: "global_capacity" };
      }
      const task = this.database.prepare(`SELECT t.* FROM tasks t
        WHERE t.project_id=? AND t.status='ready' AND t.task_kind='executable'
          AND t.archived_at IS NULL AND t.assigned_worker IS NULL
          AND t.dispatch_policy='automatic' AND t.released_at IS NOT NULL
          AND t.acceptance_criteria_json<>'[]'
          AND NOT EXISTS(
            SELECT 1 FROM task_dependencies d JOIN tasks dependency
              ON dependency.id=d.depends_on_task_id
            WHERE d.task_id=t.id AND dependency.status<>'done'
          )
          AND NOT EXISTS(
            SELECT 1 FROM decision_gates g
            WHERE g.task_id=t.id AND g.status='decision_required'
          )
          AND NOT EXISTS(
            SELECT 1 FROM orchestrator_commands c
            WHERE c.task_id=t.id AND c.state IN ('queued','claimed','running')
          )
          AND NOT EXISTS(
            SELECT 1 FROM runs r JOIN sessions s ON s.id=r.session_id
            WHERE s.task_id=t.id AND r.state='running'
          )
        ORDER BY t.priority DESC,t.released_at,t.id LIMIT 1`).get(projectId);
      if (!task) {
        this.database.exec("COMMIT");
        return { scheduled: false, reason: "no_eligible_task" };
      }
      const selectedRoute = parseJson(task.dispatch_model_route_json) ?? defaultRoute;
      validateModelRoute(selectedRoute, "selected automatic implementation model route");
      const idempotencyKey = `ready-dispatch:${task.id}:${task.version}:${task.released_at}:implementation:${task.revision ?? "none"}`;
      const payload = {
        source: "ready_scheduler",
        modelRoute: selectedRoute,
        dispatch: {
          priority: Number(task.priority),
          releasedAt: task.released_at,
          releasedBy: task.released_by,
          rank: 1,
          projectCapacity,
          globalCapacity,
        },
      };
      const commandRequest = {
        projectId,
        taskId: task.id,
        kind: "start_task",
        phase: "implementation",
        payload,
      };
      const commandRequestSha256 = sha256(JSON.stringify(commandRequest));
      const commandId = randomUUID();
      const actorId = `task-agent:implementation:${commandId}`;
      const prior = this.getTaskDetails(task.id);
      this.database.prepare(`INSERT INTO orchestrator_commands(
        id,project_id,task_id,orchestrator_id,kind,phase,state,payload_json,request_sha256,
        idempotency_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?)`).run(
        commandId,
        projectId,
        task.id,
        orchestrator.id,
        "start_task",
        "implementation",
        JSON.stringify(payload),
        commandRequestSha256,
        idempotencyKey,
        now,
        now,
      );
      const nextVersion = task.version + 1;
      const changed = this.database.prepare(`UPDATE tasks SET
        status='in_progress',assigned_worker=?,version=?,updated_at=?
        WHERE id=? AND version=?`).run(actorId, nextVersion, now, task.id, task.version);
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "task changed during automatic dispatch");
      }
      const current = this.getTaskDetails(task.id);
      this.appendOrchestratorCommandEvent(commandId, "queued", orchestrator.id, {
        projectId,
        taskId: task.id,
        kind: "start_task",
        phase: "implementation",
        source: "ready_scheduler",
        modelRoute: selectedRoute,
      }, now);
      const eventPayload = {
        phase: "implementation",
        commandId,
        phaseActor: actorId,
        assignedWorker: actorId,
        modelRoute: selectedRoute,
        dispatch: payload.dispatch,
      };
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id,
        "task_scheduled",
        actor,
        task.status,
        "in_progress",
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
        task.id,
        "task_scheduled",
        actor,
        "orchestrator",
        null,
        null,
        JSON.stringify(prior),
        JSON.stringify(current),
        JSON.stringify(eventPayload),
        idempotencyKey,
        sha256(JSON.stringify({
          action: "automatic_dispatch",
          taskId: task.id,
          modelRoute: selectedRoute,
          releasedAt: task.released_at,
        })),
        now,
      );
      this.database.exec("COMMIT");
      return {
        scheduled: true,
        task: this.getTaskDetails(task.id),
        command: this.orchestratorCommand(commandId),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  scheduleOwnerTaskRun({
    taskId,
    phase,
    idempotencyKey,
    modelRoute,
    actor = "local-owner",
    source = "local_owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!RUN_PHASES.has(phase)) throw codedError("invalid_request", `unsupported run phase: ${phase}`);
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const normalizedRoute = {
      ...validateModelRoute(modelRoute, `${phase} scheduled model route`),
      policySource: modelRoute?.policySource ?? "explicit_schedule",
    };
    const payload = { source, modelRoute: normalizedRoute };
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
    if (task.archived_at || task.task_kind !== "executable") {
      throw codedError("transition_denied", "only active executable tasks can be scheduled");
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
    const unresolvedDecision = this.database.prepare(`SELECT id FROM decision_gates
      WHERE task_id=? AND status='decision_required' ORDER BY created_at,id LIMIT 1`).get(taskId);
    if (unresolvedDecision) {
      throw codedError(
        "transition_denied",
        `task has an unresolved decision: ${unresolvedDecision.id}`,
      );
    }
    const orchestrator = this.activeProjectOrchestrator(task.project_id);
    if (!orchestrator) {
      throw codedError("orchestrator_unavailable", "project has no active orchestrator lease");
    }
    const activeCommand = this.database.prepare(`SELECT id,phase,state FROM orchestrator_commands
      WHERE task_id=? AND state IN ('queued','claimed','running') ORDER BY sequence LIMIT 1`).get(taskId);
    if (activeCommand) {
      throw codedError("transition_denied", `task already has an active ${activeCommand.phase} command: ${activeCommand.id}`);
    }
    const running = this.database.prepare(`SELECT r.id FROM runs r JOIN sessions s ON s.id=r.session_id
      WHERE s.task_id=? AND r.state='running' ORDER BY r.started_at LIMIT 1`).get(taskId);
    if (running) throw codedError("transition_denied", `task already has a running session: ${running.id}`);
    if (phase === "implementation") {
      if (!["ready", "backlog"].includes(task.status) || task.assigned_worker) {
        throw codedError("transition_denied", "implementation requires an unassigned ready or backlog task");
      }
    } else if (phase === "test") {
      if (
        !task.revision
        || task.requested_review_revision !== task.revision
        || !["ready", "in_progress", "review"].includes(task.status)
      ) {
        throw codedError("transition_denied", "test requires a review-requested fixed revision");
      }
    } else if (
      !["ready", "review"].includes(task.status)
      || !task.revision
      || task.requested_review_revision !== task.revision
    ) {
      throw codedError("transition_denied", "review requires a requested current fixed revision");
    }
    const commandId = randomUUID();
    const actorId = `task-agent:${phase}:${commandId}`;
    const now = this.clock();
    const prior = this.getTaskDetails(taskId);
    const actorRole = actor === "local-owner" ? "owner" : "orchestrator";
    const auditRequestSha256 = sha256(JSON.stringify({
      action: "schedule_task", taskId, phase, modelRoute: normalizedRoute, actor,
    }));
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
      const nextStatus = phase === "implementation" ? "in_progress" : "review";
      const nextAssignedWorker = phase === "implementation" ? actorId : task.assigned_worker;
      const changed = this.database.prepare(`UPDATE tasks SET
        status=?,assigned_worker=?,version=?,updated_at=? WHERE id=? AND version=?`).run(
        nextStatus, nextAssignedWorker, nextVersion, now, taskId, task.version,
      );
      if (Number(changed.changes) !== 1) throw codedError("version_conflict", "task changed during scheduling");
      const current = this.getTaskDetails(taskId);
      this.appendOrchestratorCommandEvent(commandId, "queued", orchestrator.id, {
        projectId: task.project_id, taskId, kind: "start_task", phase, source,
        modelRoute: normalizedRoute,
      }, now);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, "task_scheduled", actor, task.status, nextStatus,
        JSON.stringify({
          phase, commandId, phaseActor: actorId, assignedWorker: nextAssignedWorker,
          modelRoute: normalizedRoute,
        }),
        idempotencyKey, now, actorRole, null, nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, "task_scheduled", actor, actorRole, null, null,
        JSON.stringify(prior), JSON.stringify(current),
        JSON.stringify({
          phase, commandId, phaseActor: actorId, assignedWorker: nextAssignedWorker,
          modelRoute: normalizedRoute,
        }),
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

  resumeOwnerTaskRun({ taskId, phase, idempotencyKey, modelRoute }) {
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (task.archived_at || task.task_kind !== "executable") {
      throw codedError("transition_denied", "only active executable tasks can resume");
    }
    if (!task.assigned_worker || !["in_progress", "blocked", "review"].includes(task.status)) {
      throw codedError("transition_denied", "only an assigned active task can resume a stopped run");
    }
    const running = this.database.prepare(`SELECT r.id FROM runs r
      JOIN sessions s ON s.id=r.session_id
      WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(taskId);
    if (running) throw codedError("transition_denied", `task already has a running session: ${running.id}`);
    return this.enqueueOrchestratorCommand({
      projectId: task.project_id,
      taskId,
      kind: "start_task",
      phase,
      payload: {
        source: "local_owner_resume",
        modelRoute: {
          ...validateModelRoute(modelRoute, `${phase} resumed model route`),
          policySource: modelRoute?.policySource ?? "explicit_resume",
        },
      },
      idempotencyKey,
    });
  }

  getTask(taskId) {
    return this.database.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) ?? null;
  }

  getProject(projectId, { includeDeleted = false } = {}) {
    return this.database.prepare(
      `SELECT * FROM projects WHERE id=?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
    ).get(projectId) ?? null;
  }

  projectBySourceUrl(sourceUrl) {
    return this.database.prepare(
      "SELECT * FROM projects WHERE source_url=? AND deleted_at IS NULL",
    ).get(sourceUrl) ?? null;
  }

  importedProjectByRequest({ sourceUrl, name, idempotencyKey }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const requestSha256 = sha256(JSON.stringify({
      action: "import_project",
      sourceUrl,
      name,
    }));
    const receipt = this.database.prepare(
      "SELECT * FROM project_imports WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (!receipt) return null;
    if (receipt.request_sha256 !== requestSha256 || receipt.source_url !== sourceUrl) {
      throw codedError("idempotency_conflict", "idempotency key was reused for a different project import");
    }
    return { receipt, project: this.getProject(receipt.project_id) };
  }

  createImportedProject({
    projectId,
    repositoryId,
    name,
    repositoryPath,
    sourceUrl,
    idempotencyKey,
  }) {
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName || normalizedName.length > 500 || normalizedName.includes("\0")) {
      throw codedError("invalid_request", "project name must be between 1 and 500 characters");
    }
    const prior = this.importedProjectByRequest({
      sourceUrl,
      name: normalizedName,
      idempotencyKey,
    });
    if (prior) return { replayed: true, ...prior };
    const now = this.clock();
    const requestSha256 = sha256(JSON.stringify({
      action: "import_project",
      sourceUrl,
      name: normalizedName,
    }));
    const receiptId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO projects(
        id,name,repository_path,created_at,repository_id,source_url
      ) VALUES(?,?,?,?,?,?)`).run(
        projectId,
        normalizedName,
        repositoryPath,
        now,
        repositoryId,
        sourceUrl,
      );
      this.database.prepare(`INSERT INTO project_imports(
        id,project_id,source_url,request_sha256,idempotency_key,created_at
      ) VALUES(?,?,?,?,?,?)`).run(
        receiptId,
        projectId,
        sourceUrl,
        requestSha256,
        idempotencyKey,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      receipt: this.database.prepare("SELECT * FROM project_imports WHERE id=?").get(receiptId),
      project: this.getProject(projectId),
    };
  }

  createSourceSnapshot({
    projectId,
    kind,
    sourceRef = null,
    content,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    if (!["manual", "external"].includes(kind)) {
      throw codedError("invalid_request", "source snapshot kind must be manual or external");
    }
    const normalizedContent = typeof content === "string" ? content.trim() : "";
    const normalizedRef = typeof sourceRef === "string" && sourceRef.trim() ? sourceRef.trim() : null;
    if (!normalizedContent || normalizedContent.length > 50_000 || normalizedContent.includes("\0")) {
      throw codedError("invalid_request", "source snapshot must be between 1 and 50000 characters");
    }
    if (normalizedRef && (normalizedRef.length > 2_000 || normalizedRef.includes("\0"))) {
      throw codedError("invalid_request", "source reference must be at most 2000 characters");
    }
    const request = {
      action: "create_source_snapshot",
      projectId,
      kind,
      sourceRef: normalizedRef,
      content: normalizedContent,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const prior = this.database.prepare(
      "SELECT * FROM source_snapshots WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "idempotency key was reused for different source content");
      }
      return { replayed: true, snapshot: prior };
    }
    const id = randomUUID();
    this.database.prepare(`INSERT INTO source_snapshots(
      id,project_id,kind,source_ref,content,content_sha256,actor,idempotency_key,
      request_sha256,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id,
      projectId,
      kind,
      normalizedRef,
      normalizedContent,
      sha256(normalizedContent),
      actor,
      idempotencyKey,
      requestSha256,
      this.clock(),
    );
    return {
      replayed: false,
      snapshot: this.database.prepare("SELECT * FROM source_snapshots WHERE id=?").get(id),
    };
  }

  sourceSnapshots(projectId) {
    if (!this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    return this.database.prepare(`SELECT * FROM source_snapshots
      WHERE project_id=? ORDER BY created_at DESC,id DESC`).all(projectId);
  }

  projects() {
    return this.database.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t
        WHERE t.project_id=p.id AND t.archived_at IS NULL
          AND t.status IN ('in_progress','review','blocked')) AS active_task_count,
      (SELECT COUNT(*) FROM tasks t
        WHERE t.project_id=p.id AND t.archived_at IS NOT NULL) AS archived_task_count
      FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.name,p.id`).all().map((project) => {
      const deletion = this.projectDeletionEligibility(project.id);
      return {
        ...project,
        deletion_eligible: deletion.eligible,
        deletion_blockers: deletion.blockers,
      };
    });
  }

  projectDeletionEligibility(projectId) {
    const project = this.getProject(projectId, { includeDeleted: true });
    if (!project) throw codedError("not_found", `unknown project: ${projectId}`);
    const counts = {
      tasks: Number(this.database.prepare(
        "SELECT COUNT(*) value FROM tasks WHERE project_id=?",
      ).get(projectId).value),
      sources: Number(this.database.prepare(
        "SELECT COUNT(*) value FROM source_snapshots WHERE project_id=?",
      ).get(projectId).value),
      commands: Number(this.database.prepare(
        "SELECT COUNT(*) value FROM orchestrator_commands WHERE project_id=?",
      ).get(projectId).value),
      memories: Number(this.database.prepare(
        "SELECT COUNT(*) value FROM memory_records WHERE project_id=?",
      ).get(projectId).value),
      evidence: Number(this.database.prepare(
        "SELECT COUNT(*) value FROM normalized_evidence WHERE project_id=?",
      ).get(projectId).value),
      active_project_orchestrators: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM project_orchestrators WHERE project_id=? AND status='active'`).get(projectId).value),
      active_orchestration_leases: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM orchestration_leases
        WHERE scope_type='project' AND scope_id=? AND status='active'`).get(projectId).value),
      turns: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM conversation_turns turn
        JOIN orchestrator_conversations conversation ON conversation.id=turn.conversation_id
        WHERE conversation.project_id=?`).get(projectId).value),
      conversation_runs: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM conversation_runs run
        JOIN orchestrator_conversations conversation ON conversation.id=run.conversation_id
        WHERE conversation.project_id=?`).get(projectId).value),
      custody_snapshots: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM conversation_custody_snapshots snapshot
        JOIN orchestrator_conversations conversation ON conversation.id=snapshot.conversation_id
        WHERE conversation.project_id=?`).get(projectId).value),
      model_changes: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM conversation_model_changes change
        JOIN orchestrator_conversations conversation ON conversation.id=change.conversation_id
        WHERE conversation.project_id=?`).get(projectId).value),
      project_bindings: Number(this.database.prepare(
        "SELECT COUNT(*) value FROM topic_project_bindings WHERE project_id=?",
      ).get(projectId).value),
      non_idle_conversations: Number(this.database.prepare(`SELECT COUNT(*) value
        FROM orchestrator_conversations
        WHERE project_id=? AND state NOT IN ('idle','archived')`).get(projectId).value),
    };
    const blockers = [];
    if (project.deleted_at) blockers.push("already_deleted");
    if (!project.source_url) blockers.push("not_managed_import");
    for (const [kind, count] of Object.entries(counts)) {
      if (count > 0) blockers.push(`${kind}:${count}`);
    }
    return {
      project,
      eligible: blockers.length === 0,
      blockers,
      counts,
    };
  }

  projectDeletionReceiptByIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    return publicProjectDeletionReceipt(this.database.prepare(
      "SELECT * FROM project_deletion_receipts WHERE idempotency_key=?",
    ).get(idempotencyKey));
  }

  beginProjectDeletion({
    receiptId,
    projectId,
    confirmName,
    reason,
    originalPath,
    quarantinePath,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";
    if (!normalizedReason || normalizedReason.length > 2_000 || normalizedReason.includes("\0")) {
      throw codedError("invalid_request", "deletion reason must be between 1 and 2000 characters");
    }
    if (typeof confirmName !== "string" || confirmName.includes("\0")) {
      throw codedError("invalid_request", "exact project-name confirmation is required");
    }
    const requestSha256 = sha256(JSON.stringify({
      action: "delete_project",
      projectId,
      confirmName,
      reason: normalizedReason,
    }));
    const prior = this.database.prepare(
      "SELECT * FROM project_deletion_receipts WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.project_id !== projectId) {
        throw codedError(
          "idempotency_conflict",
          "idempotency key was reused for a different project deletion",
        );
      }
      return { replayed: true, receipt: publicProjectDeletionReceipt(prior) };
    }
    const project = this.getProject(projectId);
    if (!project) throw codedError("not_found", `unknown active project: ${projectId}`);
    if (confirmName !== project.name) {
      throw codedError("confirmation_mismatch", "project name confirmation did not match exactly");
    }
    const eligibility = this.projectDeletionEligibility(projectId);
    if (!eligibility.eligible) {
      throw codedError(
        "deletion_blocked",
        `project deletion blocked: ${eligibility.blockers.join(",")}`,
        { blockers: eligibility.blockers },
      );
    }
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const lockedEligibility = this.projectDeletionEligibility(projectId);
      if (!lockedEligibility.eligible) {
        throw codedError(
          "deletion_blocked",
          `project deletion blocked: ${lockedEligibility.blockers.join(",")}`,
          { blockers: lockedEligibility.blockers },
        );
      }
      this.database.prepare(`INSERT INTO project_deletion_receipts(
        id,project_id,idempotency_key,request_sha256,project_snapshot_json,
        original_path,quarantine_path,reason,actor,state,checkout_state,
        created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'prepared','original',?,?)`).run(
        receiptId,
        projectId,
        idempotencyKey,
        requestSha256,
        JSON.stringify(project),
        originalPath,
        quarantinePath,
        normalizedReason,
        actor,
        now,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      receipt: this.projectDeletionReceiptByIdempotency(idempotencyKey),
    };
  }

  tombstoneProjectDeletion(receiptId) {
    const receipt = this.database.prepare(
      "SELECT * FROM project_deletion_receipts WHERE id=?",
    ).get(receiptId);
    if (!receipt) throw codedError("not_found", `unknown project deletion: ${receiptId}`);
    if (["tombstoned", "complete"].includes(receipt.state)) {
      return publicProjectDeletionReceipt(receipt);
    }
    if (receipt.state !== "prepared") {
      throw codedError("transition_denied", `cannot tombstone deletion in state ${receipt.state}`);
    }
    const eligibility = this.projectDeletionEligibility(receipt.project_id);
    if (!eligibility.eligible) {
      throw codedError(
        "deletion_blocked",
        `project deletion blocked: ${eligibility.blockers.join(",")}`,
        { blockers: eligibility.blockers },
      );
    }
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const lockedEligibility = this.projectDeletionEligibility(receipt.project_id);
      if (!lockedEligibility.eligible) {
        throw codedError(
          "deletion_blocked",
          `project deletion blocked: ${lockedEligibility.blockers.join(",")}`,
          { blockers: lockedEligibility.blockers },
        );
      }
      const topics = this.database.prepare(
        "SELECT id FROM topics WHERE project_id=?",
      ).all(receipt.project_id);
      for (const topic of topics) {
        this.database.prepare(
          "UPDATE topics SET state='archived',version=version+1,updated_at=? WHERE id=?",
        ).run(now, topic.id);
        this.database.prepare(`UPDATE orchestrator_conversations SET
          state='archived',current_turn_id=NULL,updated_at=? WHERE topic_id=?`).run(now, topic.id);
        this.database.prepare(`INSERT INTO topic_events(
          topic_id,type,actor,payload_json,idempotency_key,request_sha256,created_at
        ) VALUES(?,'topic_archived',?,?,?,?,?)`).run(
          topic.id,
          receipt.actor,
          JSON.stringify({ reason: "project_deleted", projectId: receipt.project_id }),
          `project-delete:${receipt.id}:topic:${topic.id}`,
          sha256(JSON.stringify({
            action: "archive_topic_for_project_deletion",
            projectId: receipt.project_id,
            topicId: topic.id,
          })),
          now,
        );
      }
      const changed = this.database.prepare(`UPDATE projects SET
        deleted_at=?,deleted_by=?,deletion_reason=? WHERE id=? AND deleted_at IS NULL`).run(
        now,
        receipt.actor,
        receipt.reason,
        receipt.project_id,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "project changed during deletion");
      }
      this.database.prepare(`UPDATE project_deletion_receipts SET
        state='tombstoned',checkout_state='quarantined',tombstoned_at=?,updated_at=?
        WHERE id=? AND state='prepared'`).run(now, now, receipt.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return publicProjectDeletionReceipt(this.database.prepare(
      "SELECT * FROM project_deletion_receipts WHERE id=?",
    ).get(receipt.id));
  }

  completeProjectDeletion(receiptId) {
    const receipt = this.database.prepare(
      "SELECT * FROM project_deletion_receipts WHERE id=?",
    ).get(receiptId);
    if (!receipt) throw codedError("not_found", `unknown project deletion: ${receiptId}`);
    if (receipt.state === "complete") return publicProjectDeletionReceipt(receipt);
    if (receipt.state !== "tombstoned") {
      throw codedError("transition_denied", `cannot complete deletion in state ${receipt.state}`);
    }
    const now = this.clock();
    this.database.prepare(`UPDATE project_deletion_receipts SET
      state='complete',checkout_state='removed',completed_at=?,updated_at=?
      WHERE id=? AND state='tombstoned'`).run(now, now, receiptId);
    return publicProjectDeletionReceipt(this.database.prepare(
      "SELECT * FROM project_deletion_receipts WHERE id=?",
    ).get(receiptId));
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

  conversationRuns(conversationId) {
    return this.database.prepare(
      "SELECT * FROM conversation_runs WHERE conversation_id=? ORDER BY started_at,id",
    ).all(conversationId).map((row) => publicConversationRun(row));
  }

  conversationCustodySnapshots(conversationId) {
    if (!this.getConversation(conversationId)) {
      throw codedError("not_found", `unknown conversation: ${conversationId}`);
    }
    return this.database.prepare(`SELECT * FROM conversation_custody_snapshots
      WHERE conversation_id=? ORDER BY created_at DESC,snapshot_id DESC`).all(conversationId);
  }

  recordConversationCustodySnapshot({
    snapshotId,
    conversationId,
    trigger,
    path,
    manifestSha256,
    nativeSha256 = null,
    conversationVersion,
  }) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw codedError("not_found", `unknown conversation: ${conversationId}`);
    }
    const capturedVersion = conversationVersion ?? conversation.version;
    this.database.prepare(`INSERT OR IGNORE INTO conversation_custody_snapshots(
      snapshot_id,conversation_id,trigger,path,manifest_sha256,native_sha256,verified,created_at,
      conversation_version
    ) VALUES(?,?,?,?,?,?,1,?,?)`).run(
      snapshotId,
      conversationId,
      trigger,
      path,
      manifestSha256,
      nativeSha256,
      this.clock(),
      capturedVersion,
    );
    const snapshot = this.database.prepare(
      "SELECT * FROM conversation_custody_snapshots WHERE snapshot_id=?",
    ).get(snapshotId);
    if (
      snapshot.conversation_id !== conversationId
      || snapshot.manifest_sha256 !== manifestSha256
      || snapshot.path !== path
      || snapshot.conversation_version !== capturedVersion
    ) {
      throw codedError("idempotency_conflict", "conversation custody snapshot identity was reused");
    }
    return snapshot;
  }

  topicProjectBindingByIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    const binding = this.database.prepare(
      "SELECT * FROM topic_project_bindings WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (!binding) return null;
    return {
      ...binding,
      ...this.topicDetails(binding.topic_id),
    };
  }

  bindTopicToProject({
    topicId,
    projectId,
    expectedVersion,
    custodySnapshotId,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw codedError("invalid_request", "expected conversation version must be a positive integer");
    }
    const request = {
      action: "bind_topic_to_project",
      topicId,
      projectId,
      expectedVersion,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const prior = this.database.prepare(
      "SELECT * FROM topic_project_bindings WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different topic binding");
      }
      return { replayed: true, binding: this.topicProjectBindingByIdempotency(idempotencyKey) };
    }
    const project = this.getProject(projectId);
    if (!project) throw codedError("not_found", `unknown project: ${projectId}`);
    const topic = this.database.prepare("SELECT * FROM topics WHERE id=?").get(topicId);
    if (!topic) throw codedError("not_found", `unknown topic: ${topicId}`);
    const conversation = this.database.prepare(
      "SELECT * FROM orchestrator_conversations WHERE topic_id=?",
    ).get(topicId);
    if (topic.project_id || conversation.project_id || conversation.scope_type !== "system_intake") {
      throw codedError("transition_denied", "topic is already bound to a project");
    }
    if (conversation.version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `conversation is version ${conversation.version}, expected ${expectedVersion}`,
      );
    }
    if (conversation.state === "running" || conversation.current_turn_id) {
      throw codedError("transition_denied", "cannot transfer a topic while a conversation turn is running");
    }
    if (conversation.state === "reconciliation_required") {
      throw codedError("transition_denied", "conversation requires reconciliation before scope transfer");
    }
    const snapshot = this.database.prepare(
      "SELECT * FROM conversation_custody_snapshots WHERE snapshot_id=?",
    ).get(custodySnapshotId);
    if (
      !snapshot
      || snapshot.conversation_id !== conversation.id
      || snapshot.trigger !== "scope_transfer"
      || !snapshot.verified
      || snapshot.conversation_version !== conversation.version
    ) {
      throw codedError("custody_required", "a current verified scope-transfer snapshot is required");
    }
    const now = this.clock();
    const bindingId = randomUUID();
    const newVersion = conversation.version + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE topics SET
        project_id=?,version=version+1,updated_at=? WHERE id=? AND project_id IS NULL`).run(
        projectId,
        now,
        topicId,
      );
      const changed = this.database.prepare(`UPDATE orchestrator_conversations SET
        project_id=?,scope_type='project',scope_id=?,version=?,state='idle',updated_at=?
        WHERE id=? AND version=? AND project_id IS NULL`).run(
        projectId,
        projectId,
        newVersion,
        now,
        conversation.id,
        expectedVersion,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "conversation changed during scope transfer");
      }
      this.database.prepare(`INSERT INTO topic_project_bindings(
        id,topic_id,conversation_id,project_id,prior_conversation_version,
        new_conversation_version,custody_snapshot_id,actor,idempotency_key,
        request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        bindingId,
        topicId,
        conversation.id,
        projectId,
        expectedVersion,
        newVersion,
        custodySnapshotId,
        actor,
        idempotencyKey,
        requestSha256,
        now,
      );
      this.database.prepare(`INSERT INTO topic_events(
        topic_id,type,actor,payload_json,idempotency_key,request_sha256,created_at
      ) VALUES(?,'topic_project_bound',?,?,?,?,?)`).run(
        topicId,
        actor,
        JSON.stringify({
          projectId,
          conversationId: conversation.id,
          custodySnapshotId,
          priorScope: { type: "system_intake", id: "system-intake" },
          newScope: { type: "project", id: projectId },
          priorConversationVersion: expectedVersion,
          newConversationVersion: newVersion,
        }),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.appendConversationEvent(conversation.id, null, "scope_transferred", actor, {
        projectId,
        custodySnapshotId,
        priorScope: { type: "system_intake", id: "system-intake" },
        newScope: { type: "project", id: projectId },
        priorVersion: expectedVersion,
        newVersion,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      binding: this.topicProjectBindingByIdempotency(idempotencyKey),
    };
  }

  conversationModelChangeByIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    const row = this.database.prepare(
      "SELECT * FROM conversation_model_changes WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (!row) return null;
    return {
      ...row,
      prior_route: parseJson(row.prior_route_json),
      new_route: parseJson(row.new_route_json),
      conversation: this.getConversation(row.conversation_id),
    };
  }

  switchConversationModel({
    conversationId,
    modelProvider,
    modelId,
    thinkingLevel,
    expectedVersion,
    custodySnapshotId,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    const provider = typeof modelProvider === "string" ? modelProvider.trim() : "";
    const model = typeof modelId === "string" ? modelId.trim() : "";
    const thinking = typeof thinkingLevel === "string" ? thinkingLevel.trim() : "";
    if (
      !provider || provider.length > 200 || provider.includes("\0")
      || !model || model.length > 500 || model.includes("\0")
      || !["off", "minimal", "low", "medium", "high", "xhigh"].includes(thinking)
    ) {
      throw codedError("invalid_request", "provider, model, and supported thinking level are required");
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw codedError("invalid_request", "expected conversation version must be a positive integer");
    }
    const request = {
      action: "switch_conversation_model",
      conversationId,
      modelProvider: provider,
      modelId: model,
      thinkingLevel: thinking,
      expectedVersion,
    };
    const requestSha256 = sha256(JSON.stringify(request));
    const prior = this.database.prepare(
      "SELECT * FROM conversation_model_changes WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.conversation_id !== conversationId) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different model switch");
      }
      return { replayed: true, change: this.conversationModelChangeByIdempotency(idempotencyKey) };
    }
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw codedError("not_found", `unknown conversation: ${conversationId}`);
    if (conversation.version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `conversation is version ${conversation.version}, expected ${expectedVersion}`,
      );
    }
    const runningTurn = this.database.prepare(
      "SELECT id FROM conversation_turns WHERE conversation_id=? AND state='running'",
    ).get(conversationId);
    if (runningTurn) {
      throw codedError("transition_denied", "cannot switch model while a conversation turn is running");
    }
    const snapshot = this.database.prepare(
      "SELECT * FROM conversation_custody_snapshots WHERE snapshot_id=?",
    ).get(custodySnapshotId);
    if (
      !snapshot
      || snapshot.conversation_id !== conversationId
      || !snapshot.verified
      || snapshot.conversation_version !== conversation.version
    ) {
      throw codedError("custody_required", "a verified snapshot of this conversation is required");
    }
    const priorRoute = {
      modelProvider: conversation.model_provider,
      modelId: conversation.model_id,
      thinkingLevel: conversation.thinking_level,
    };
    const newRoute = { modelProvider: provider, modelId: model, thinkingLevel: thinking };
    const changeId = randomUUID();
    const newVersion = conversation.version + 1;
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE orchestrator_conversations SET
        model_provider=?,model_id=?,thinking_level=?,version=?,updated_at=?
        WHERE id=? AND version=?`).run(
        provider,
        model,
        thinking,
        newVersion,
        now,
        conversationId,
        expectedVersion,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "conversation changed during model switch");
      }
      this.database.prepare(`INSERT INTO conversation_model_changes(
        id,conversation_id,prior_version,new_version,prior_route_json,new_route_json,
        custody_snapshot_id,actor,idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        changeId,
        conversationId,
        expectedVersion,
        newVersion,
        JSON.stringify(priorRoute),
        JSON.stringify(newRoute),
        custodySnapshotId,
        actor,
        idempotencyKey,
        requestSha256,
        now,
      );
      this.appendConversationEvent(conversationId, null, "model_route_changed", actor, {
        priorVersion: expectedVersion,
        newVersion,
        priorRoute,
        newRoute,
        custodySnapshotId,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, change: this.conversationModelChangeByIdempotency(idempotencyKey) };
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
    return {
      topic,
      conversation,
      project,
      tasks,
      sources: conversation.project_id ? this.sourceSnapshots(conversation.project_id) : [],
      prompt_profile: this.getAgentPromptProfile("orchestrator"),
    };
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
    taskKind = "executable",
    tags = [],
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
    const normalizedKind = normalizeTaskKind(taskKind);
    const normalizedTags = normalizeTaskTags(tags);
    const requestSha256 = sha256(JSON.stringify({
      action: "conversation_create_task",
      turnId,
      projectId: conversation.project_id,
      title: normalizedTitle,
      acceptanceCriteria: normalizedCriteria,
      taskKind: normalizedKind,
      tags: normalizedTags,
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
        merge_requested,acceptance_criteria_json,task_kind,tags_json
      ) VALUES(?,?,?,'ready',1,?,?,0,0,?,?,?)`).run(
        id,
        conversation.project_id,
        normalizedTitle,
        now,
        revision,
        JSON.stringify(normalizedCriteria),
        normalizedKind,
        JSON.stringify(normalizedTags),
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
          taskKind: normalizedKind,
          tags: normalizedTags,
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
        JSON.stringify({
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
          taskKind: normalizedKind,
          tags: normalizedTags,
          turnId,
        }),
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
    taskKind = null,
    tags = null,
    dependsOnTaskId = null,
    body = null,
    category = null,
    question = null,
    reason = null,
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (![
      "update",
      "split",
      "add_dependency",
      "record_assumption",
      "require_decision",
      "archive",
      "restore",
    ].includes(operation)) {
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
    if (!Number.isInteger(expectedVersion)) {
      throw codedError("invalid_request", "expected task version is required");
    }
    if (operation === "archive" || operation === "restore") {
      const result = this.setTaskArchived({
        taskId,
        archived: operation === "archive",
        reason,
        expectedVersion,
        idempotencyKey,
        actor: `orchestrator:${conversation.id}`,
        actorRole: "orchestrator",
      });
      if (!result.replayed) {
        this.appendConversationEvent(
          conversation.id,
          turn.id,
          "task_mutation_applied",
          "orchestrator",
          {
            operation,
            taskId,
            taskVersion: result.task.version,
            reason: typeof reason === "string" ? reason.trim() : "",
          },
        );
      }
      return { ...result, operation, childTask: null };
    }
    if (task.status === "done") {
      throw codedError("transition_denied", "completed tasks must be reopened before mutation");
    }

    let normalizedTitle = null;
    let normalizedCriteria = null;
    let normalizedKind = null;
    let normalizedTags = null;
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
      normalizedKind = operation === "update"
        ? normalizeTaskKind(taskKind, task.task_kind)
        : "executable";
      normalizedTags = operation === "update"
        ? normalizeTaskTags(tags ?? parseJson(task.tags_json) ?? [])
        : [];
      if (operation === "update" && normalizedKind !== task.task_kind) {
        const busy = this.database.prepare(`SELECT 1 value FROM orchestrator_commands
          WHERE task_id=? AND state IN ('queued','claimed','running') LIMIT 1`).get(taskId)
          || this.database.prepare(`SELECT 1 value FROM runs r JOIN sessions s ON s.id=r.session_id
            WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(taskId);
        if (busy || ["in_progress", "review"].includes(task.status)) {
          throw codedError("transition_denied", "active task kind cannot change");
        }
      }
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
      taskKind: normalizedKind,
      tags: normalizedTags,
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
          title=?,acceptance_criteria_json=?,task_kind=?,tags_json=?,version=?,updated_at=?
          WHERE id=? AND version=?`).run(
          normalizedTitle,
          JSON.stringify(normalizedCriteria),
          normalizedKind,
          JSON.stringify(normalizedTags),
          nextVersion,
          now,
          taskId,
          task.version,
        );
        Object.assign(eventPayload, {
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
          taskKind: normalizedKind,
          tags: normalizedTags,
        });
      } else if (operation === "split") {
        childTaskId = randomUUID();
        this.database.prepare(`INSERT INTO tasks(
          id,project_id,title,status,version,updated_at,parent_task_id,revision,
          validation_passed,merge_requested,acceptance_criteria_json,task_kind,tags_json
        ) VALUES(?,?,?,'ready',1,?,?,?,0,0,?,'executable','[]')`).run(
          childTaskId,
          task.project_id,
          normalizedTitle,
          now,
          taskId,
          task.revision,
          JSON.stringify(normalizedCriteria),
        );
        this.database.prepare(
          "UPDATE tasks SET task_kind='umbrella',version=?,updated_at=? WHERE id=? AND version=?",
        ).run(nextVersion, now, taskId, task.version);
        Object.assign(eventPayload, {
          childTaskId,
          title: normalizedTitle,
          acceptanceCriteria: normalizedCriteria,
          parentTaskKind: "umbrella",
          childTaskKind: "executable",
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
    if (task.archived_at || task.task_kind !== "executable") {
      throw codedError("transition_denied", "only active executable tasks can receive commands");
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
    if (this.commandExecutionForCommand(commandId)) {
      throw codedError(
        "execution_managed",
        "execution-backed commands are settled by the central API; use execution recovery actions",
      );
    }
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
    const failedTask = state === "failed" && command.task_id
      ? this.getTask(command.task_id)
      : null;
    const priorFailedTask = failedTask && failedTask.status !== "done"
      ? this.getTaskDetails(failedTask.id)
      : null;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE orchestrator_commands SET
        state=?,result_json=?,completed_at=?,updated_at=? WHERE id=? AND state='claimed'`).run(
        state, JSON.stringify(result), now, now, commandId,
      );
      this.appendOrchestratorCommandEvent(commandId, state, orchestrator.id, result, now);
      if (priorFailedTask) {
        const nextVersion = failedTask.version + 1;
        const changed = this.database.prepare(`UPDATE tasks SET
          status='blocked',version=?,updated_at=? WHERE id=? AND version=?`).run(
          nextVersion,
          now,
          failedTask.id,
          failedTask.version,
        );
        if (Number(changed.changes) !== 1) {
          throw codedError("version_conflict", "task changed while recording command failure");
        }
        const currentTask = this.getTaskDetails(failedTask.id);
        const failurePayload = {
          commandId,
          phase: command.phase,
          error: result,
          retryRequiresOwnerAction: true,
        };
        this.database.prepare(`INSERT INTO task_events(
          task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
          actor_role,run_id,task_version
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
          failedTask.id,
          "task_command_failed",
          `project-orchestrator:${orchestrator.id}`,
          failedTask.status,
          "blocked",
          JSON.stringify(failurePayload),
          `command-failed:${commandId}`,
          now,
          "orchestrator",
          null,
          nextVersion,
        );
        this.database.prepare(`INSERT INTO audit_events(
          task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
          idempotency_key,request_sha256,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          failedTask.id,
          "task_command_failed",
          `project-orchestrator:${orchestrator.id}`,
          "orchestrator",
          null,
          null,
          JSON.stringify(priorFailedTask),
          JSON.stringify(currentTask),
          JSON.stringify(failurePayload),
          `command-failed:${commandId}`,
          sha256(JSON.stringify(failurePayload)),
          now,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.orchestratorCommand(commandId);
  }

  orchestratorCommand(id) {
    const command = publicOrchestratorCommand(
      this.database.prepare("SELECT * FROM orchestrator_commands WHERE id=?").get(id),
    );
    return command ? {
      ...command,
      execution: this.commandExecutionForCommand(id),
    } : null;
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
    return rows.map((row) => ({
      ...publicOrchestratorCommand(row),
      execution: this.commandExecutionForCommand(row.id),
    }));
  }

  orchestratorCommandEvents(commandId) {
    return this.database.prepare(`SELECT sequence,type,orchestrator_id,payload_json,created_at
      FROM orchestrator_command_events WHERE command_id=? ORDER BY sequence`).all(commandId)
      .map((row) => ({ ...row, payload: parseJson(row.payload_json) ?? {} }));
  }

  acceptCommandExecution({ token, commandId, idempotencyKey }) {
    if (idempotencyKey !== `execute-command:${commandId}`) {
      throw codedError(
        "invalid_request",
        `execution acceptance requires Idempotency-Key execute-command:${commandId}`,
      );
    }
    const orchestrator = this.authorizeActiveProjectOrchestrator(token);
    const command = this.database.prepare(
      "SELECT * FROM orchestrator_commands WHERE id=?",
    ).get(commandId);
    if (!command) throw codedError("not_found", `unknown orchestrator command: ${commandId}`);
    if (
      command.project_id !== orchestrator.project_id
      || command.orchestrator_id !== orchestrator.id
    ) {
      throw codedError("orchestrator_denied", "orchestrator cannot accept an execution outside its active lease");
    }
    const prior = this.database.prepare(
      "SELECT * FROM command_executions WHERE command_id=?",
    ).get(commandId);
    if (prior) {
      return {
        replayed: true,
        command: this.orchestratorCommand(commandId),
        execution: publicCommandExecution(prior),
      };
    }
    if (command.kind !== "start_task" || command.state !== "claimed") {
      throw codedError("command_conflict", "only a claimed task-phase command can be accepted");
    }
    const task = this.getTask(command.task_id);
    if (!task || task.project_id !== command.project_id) {
      throw codedError("orchestrator_denied", "execution task is outside the command project");
    }
    if (!task.revision) throw codedError("revision_required", "execution requires an authoritative base revision");
    const route = parseJson(command.payload_json)?.modelRoute ?? {};
    validateModelRoute(route, "accepted command model route");
    const now = this.clock();
    const executionId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const stillClaimed = this.database.prepare(`UPDATE orchestrator_commands SET
        state='running',updated_at=? WHERE id=? AND state='claimed'`).run(now, commandId);
      if (Number(stillClaimed.changes) !== 1) {
        throw codedError("command_conflict", "command changed before execution acceptance");
      }
      this.database.prepare(`INSERT INTO command_executions(
        id,command_id,project_id,task_id,phase,state,version,generation,
        base_revision,model_route_json,last_activity_at,accepted_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,'starting',1,1,?,?,?,?,?,?)`).run(
        executionId,
        commandId,
        command.project_id,
        command.task_id,
        command.phase,
        task.revision,
        JSON.stringify(route),
        now,
        now,
        now,
        now,
      );
      this.appendExecutionEvent(executionId, "accepted", {
        commandId,
        orchestratorId: orchestrator.id,
        taskVersion: task.version,
        baseRevision: task.revision,
        modelRoute: route,
      }, now);
      this.appendOrchestratorCommandEvent(commandId, "execution_accepted", orchestrator.id, {
        executionId,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const replay = this.database.prepare(
          "SELECT * FROM command_executions WHERE command_id=?",
        ).get(commandId);
        if (replay) {
          return {
            replayed: true,
            command: this.orchestratorCommand(commandId),
            execution: publicCommandExecution(replay),
          };
        }
      }
      throw error;
    }
    return {
      replayed: false,
      command: this.orchestratorCommand(commandId),
      execution: this.commandExecution(executionId),
    };
  }

  commandExecution(id) {
    return publicCommandExecution(
      this.database.prepare("SELECT * FROM command_executions WHERE id=?").get(id),
    );
  }

  commandExecutionForCommand(commandId) {
    return publicCommandExecution(
      this.database.prepare("SELECT * FROM command_executions WHERE command_id=?").get(commandId),
    );
  }

  commandExecutionForRun(runId) {
    return publicCommandExecution(
      this.database.prepare("SELECT * FROM command_executions WHERE run_id=?").get(runId),
    );
  }

  commandExecutions({ projectId = null, nonterminalOnly = false } = {}) {
    const terminal = "'paused','failed','reconciliation_required','succeeded','cancelled'";
    const clauses = [
      ...(projectId ? ["project_id=?"] : []),
      ...(nonterminalOnly ? [`state NOT IN (${terminal})`] : []),
    ];
    const rows = this.database.prepare(`SELECT * FROM command_executions
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY created_at,id`).all(...(projectId ? [projectId] : []));
    return rows.map((row) => publicCommandExecution(row));
  }

  executionEvents(executionId) {
    return this.database.prepare(`SELECT sequence,type,payload_json,created_at
      FROM execution_events WHERE execution_id=? ORDER BY sequence`).all(executionId)
      .map((row) => ({ ...row, payload: parseJson(row.payload_json) ?? {} }));
  }

  appendExecutionEvent(executionId, type, payload = {}, now = this.clock()) {
    const next = this.database.prepare(`SELECT COALESCE(MAX(sequence),0)+1 value
      FROM execution_events WHERE execution_id=?`).get(executionId);
    this.database.prepare(`INSERT INTO execution_events(
      execution_id,sequence,type,payload_json,created_at
    ) VALUES(?,?,?,?,?)`).run(
      executionId,
      Number(next.value),
      type,
      JSON.stringify(payload),
      now,
    );
  }

  bindExecutionResources({
    executionId,
    generation,
    sessionId = null,
    runId = null,
    workspaceId = null,
  }) {
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    if (
      execution.generation !== generation
      || !["starting", "running"].includes(execution.state)
    ) {
      throw codedError("execution_fenced", "execution authority changed before runtime binding");
    }
    const now = this.clock();
    const nextState = runId && sessionId ? "running" : execution.state;
    const changed = this.database.prepare(`UPDATE command_executions SET
      session_id=COALESCE(?,session_id),run_id=COALESCE(?,run_id),
      workspace_id=COALESCE(?,workspace_id),state=?,version=version+1,
      started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,
      last_activity_at=?,updated_at=?
      WHERE id=? AND generation=? AND state IN ('starting','running')`).run(
      sessionId,
      runId,
      workspaceId,
      nextState,
      nextState,
      now,
      now,
      now,
      executionId,
      generation,
    );
    if (Number(changed.changes) !== 1) {
      throw codedError("execution_fenced", "execution authority changed during runtime binding");
    }
    this.appendExecutionEvent(executionId, nextState === "running" ? "started" : "resources_bound", {
      sessionId,
      runId,
      workspaceId,
      generation,
    }, now);
    return this.commandExecution(executionId);
  }

  attachExecutionEvidenceResources({
    executionId,
    runId = null,
    workspaceId = null,
    reason,
  }) {
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    const now = this.clock();
    this.database.prepare(`UPDATE command_executions SET
      run_id=COALESCE(run_id,?),workspace_id=COALESCE(workspace_id,?),
      version=version+1,updated_at=? WHERE id=?`).run(
      runId,
      workspaceId,
      now,
      executionId,
    );
    this.appendExecutionEvent(executionId, "late_resource_evidence_attached", {
      runId,
      workspaceId,
      reason,
    }, now);
    return this.commandExecution(executionId);
  }

  touchExecution(executionId, generation, activity = {}) {
    const now = this.clock();
    const current = this.commandExecution(executionId);
    if (
      current
      && current.generation === generation
      && ["starting", "running"].includes(current.state)
      && Date.parse(now) - Date.parse(current.last_activity_at) < 1_000
    ) return true;
    const changed = this.database.prepare(`UPDATE command_executions SET
      last_activity_at=?,updated_at=? WHERE id=? AND generation=?
      AND state IN ('starting','running')`).run(now, now, executionId, generation);
    if (Number(changed.changes) === 1) {
      const last = this.database.prepare(`SELECT created_at FROM execution_events
        WHERE execution_id=? AND type='activity' ORDER BY sequence DESC LIMIT 1`).get(executionId);
      if (!last || Date.parse(now) - Date.parse(last.created_at) >= 5_000) {
        this.appendExecutionEvent(executionId, "activity", activity, now);
      }
      return true;
    }
    return false;
  }

  assertExecutionGeneration(executionId, generation) {
    const execution = this.commandExecution(executionId);
    if (
      !execution
      || execution.generation !== generation
      || !["starting", "running"].includes(execution.state)
    ) {
      throw codedError("execution_fenced", "execution mutation authority is fenced");
    }
    return execution;
  }

  fenceExecution({
    executionId,
    expectedVersion = null,
    reason,
    failureClass = null,
    failure = null,
  }) {
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    if (expectedVersion !== null && execution.version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `execution version conflict: expected ${expectedVersion}, current ${execution.version}`,
      );
    }
    if (execution.state === "stopping" || EXECUTION_TERMINAL_STATES.has(execution.state)) {
      return { replayed: true, execution };
    }
    if (!reason?.trim()) throw codedError("invalid_request", "execution fence reason is required");
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE command_executions SET
        state='stopping',generation=generation+1,version=version+1,
        failure_class=COALESCE(?,failure_class),failure_json=COALESCE(?,failure_json),
        stop_requested_at=COALESCE(stop_requested_at,?),updated_at=?
        WHERE id=? AND version=? AND state IN ('starting','running')`).run(
        failureClass,
        failure ? JSON.stringify(failure) : null,
        now,
        now,
        executionId,
        execution.version,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "execution changed while applying mutation fence");
      }
      if (execution.run_id) {
        this.database.prepare(`UPDATE capabilities SET revoked_at=COALESCE(revoked_at,?)
          WHERE run_id=?`).run(now, execution.run_id);
      }
      this.appendExecutionEvent(executionId, "fenced", {
        reason,
        priorGeneration: execution.generation,
        generation: execution.generation + 1,
        failureClass,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, execution: this.commandExecution(executionId) };
  }

  settleExecution({
    executionId,
    state,
    failureClass = null,
    failure = null,
    result = {},
  }) {
    if (!EXECUTION_TERMINAL_STATES.has(state)) {
      throw codedError("invalid_request", `unsupported terminal execution state: ${state}`);
    }
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    if (EXECUTION_TERMINAL_STATES.has(execution.state)) {
      if (execution.state !== state) {
        throw codedError("transition_denied", `execution already settled ${execution.state}`);
      }
      return { replayed: true, execution };
    }
    if (execution.state !== "stopping") {
      throw codedError("transition_denied", "execution must be fenced before settlement");
    }
    const command = this.database.prepare(
      "SELECT * FROM orchestrator_commands WHERE id=?",
    ).get(execution.command_id);
    const task = this.getTask(execution.task_id);
    const now = this.clock();
    const commandState = state;
    const failurePayload = failure ?? (failureClass ? { failureClass } : null);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE command_executions SET
        state=?,version=version+1,failure_class=COALESCE(?,failure_class),
        failure_json=COALESCE(?,failure_json),stopped_at=COALESCE(stopped_at,?),
        settled_at=?,updated_at=? WHERE id=? AND state='stopping'`).run(
        state,
        failureClass,
        failurePayload ? JSON.stringify(failurePayload) : null,
        now,
        now,
        now,
        executionId,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "execution changed while settling");
      }
      this.database.prepare(`UPDATE orchestrator_commands SET
        state=?,result_json=?,completed_at=?,updated_at=? WHERE id=?`).run(
        commandState,
        JSON.stringify({
          ...result,
          executionId,
          failureClass,
          failure: failurePayload,
        }),
        now,
        now,
        command.id,
      );
      this.appendExecutionEvent(executionId, "settled", {
        state,
        failureClass,
        result,
      }, now);
      this.appendOrchestratorCommandEvent(command.id, commandState, command.orchestrator_id, {
        executionId,
        failureClass,
      }, now);
      if (
        task
        && task.status !== "done"
        && ["failed", "reconciliation_required"].includes(state)
      ) {
        const priorTask = this.getTaskDetails(task.id);
        const nextVersion = task.version + 1;
        this.database.prepare(`UPDATE tasks SET
          status='blocked',version=?,updated_at=? WHERE id=? AND version=?`).run(
          nextVersion,
          now,
          task.id,
          task.version,
        );
        const currentTask = this.getTaskDetails(task.id);
        const payload = {
          executionId,
          commandId: command.id,
          phase: execution.phase,
          failureClass,
          failure: failurePayload,
          recoveryRequired: state === "reconciliation_required",
        };
        this.database.prepare(`INSERT INTO task_events(
          task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,
          created_at,actor_role,run_id,task_version
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
          task.id,
          "task_execution_attention",
          "control-plane",
          task.status,
          "blocked",
          JSON.stringify(payload),
          `execution-attention:${executionId}`,
          now,
          "host",
          execution.run_id,
          nextVersion,
        );
        this.database.prepare(`INSERT INTO audit_events(
          task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,
          payload_json,idempotency_key,request_sha256,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          task.id,
          "task_execution_attention",
          "control-plane",
          "host",
          null,
          execution.run_id,
          JSON.stringify(priorTask),
          JSON.stringify(currentTask),
          JSON.stringify(payload),
          `execution-attention:${executionId}`,
          sha256(JSON.stringify(payload)),
          now,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { replayed: false, execution: this.commandExecution(executionId) };
  }

  resolveReconciliationExecution({
    executionId,
    state = "cancelled",
    reason,
    actor = "local-owner",
  }) {
    if (!["cancelled", "failed", "paused"].includes(state)) {
      throw codedError("invalid_request", "unsupported reconciliation resolution state");
    }
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    if (execution.state !== "reconciliation_required") {
      throw codedError("transition_denied", "execution does not require reconciliation");
    }
    const run = execution.run_id ? this.getRun(execution.run_id) : null;
    if (run?.state === "running") {
      throw codedError("transition_denied", "cannot resolve while the linked run is still running");
    }
    const liveCapability = execution.run_id
      ? this.database.prepare(`SELECT id FROM capabilities
        WHERE run_id=? AND revoked_at IS NULL LIMIT 1`).get(execution.run_id)
      : null;
    if (liveCapability) {
      throw codedError("transition_denied", "cannot resolve while a mutation capability remains active");
    }
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE command_executions SET
        state=?,version=version+1,settled_at=?,updated_at=?
        WHERE id=? AND state='reconciliation_required'`).run(
        state,
        now,
        now,
        executionId,
      );
      this.database.prepare(`UPDATE orchestrator_commands SET
        state=?,result_json=?,completed_at=COALESCE(completed_at,?),updated_at=?
        WHERE id=?`).run(
        state,
        JSON.stringify({
          executionId,
          ownerResolution: state,
          reason,
          uncertainEvidenceRetained: true,
        }),
        now,
        now,
        execution.command_id,
      );
      this.appendExecutionEvent(executionId, "reconciliation_resolved", {
        state,
        reason,
        actor,
        uncertainEvidenceRetained: true,
      }, now);
      this.appendOrchestratorCommandEvent(
        execution.command_id,
        state,
        null,
        { executionId, reason, actor, uncertainEvidenceRetained: true },
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.commandExecution(executionId);
  }

  executionActionReceipt(idempotencyKey) {
    const row = this.database.prepare(
      "SELECT * FROM execution_action_receipts WHERE idempotency_key=?",
    ).get(idempotencyKey);
    return row ? { ...row, result: parseJson(row.result_json) ?? {} } : null;
  }

  recordExecutionAction({
    executionId,
    action,
    expectedVersion,
    reason,
    idempotencyKey,
    actor = "local-owner",
    result = {},
  }) {
    if (!["stop", "pause", "cancel"].includes(action)) {
      throw codedError("invalid_request", "execution control action must stop, pause, or cancel");
    }
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!reason?.trim()) throw codedError("invalid_request", "recovery action reason is required");
    const requestSha256 = sha256(JSON.stringify({
      executionId,
      action,
      expectedVersion,
      reason: reason.trim(),
      actor,
    }));
    const prior = this.executionActionReceipt(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "idempotency key was reused for a different recovery action");
      }
      return { replayed: true, receipt: prior, execution: this.commandExecution(executionId) };
    }
    const now = this.clock();
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const execution = this.commandExecution(executionId);
      if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
      if (execution.version !== expectedVersion) {
        throw codedError(
          "version_conflict",
          `execution version conflict: expected ${expectedVersion}, current ${execution.version}`,
        );
      }
      if (execution.state === "reconciliation_required") {
        if (action !== "cancel") {
          throw codedError(
            "transition_denied",
            `${action} is not valid while execution is reconciliation_required`,
          );
        }
        const run = execution.run_id ? this.getRun(execution.run_id) : null;
        if (run?.state === "running") {
          throw codedError(
            "transition_denied",
            "cannot resolve while the linked run is still running",
          );
        }
        const liveCapability = execution.run_id
          ? this.database.prepare(`SELECT id FROM capabilities
            WHERE run_id=? AND revoked_at IS NULL LIMIT 1`).get(execution.run_id)
          : null;
        if (liveCapability) {
          throw codedError(
            "transition_denied",
            "cannot resolve while a mutation capability remains active",
          );
        }
        const changed = this.database.prepare(`UPDATE command_executions SET
          state='cancelled',version=version+1,settled_at=?,updated_at=?
          WHERE id=? AND version=? AND state='reconciliation_required'`).run(
          now,
          now,
          executionId,
          expectedVersion,
        );
        if (Number(changed.changes) !== 1) {
          throw codedError("version_conflict", "execution changed while resolving cancellation");
        }
        this.database.prepare(`UPDATE orchestrator_commands SET
          state='cancelled',result_json=?,completed_at=COALESCE(completed_at,?),updated_at=?
          WHERE id=?`).run(
          JSON.stringify({
            executionId,
            ownerResolution: "cancelled",
            reason: reason.trim(),
            uncertainEvidenceRetained: true,
          }),
          now,
          now,
          execution.command_id,
        );
        this.appendExecutionEvent(executionId, "reconciliation_resolved", {
          state: "cancelled",
          reason: reason.trim(),
          actor,
          uncertainEvidenceRetained: true,
        }, now);
        this.appendOrchestratorCommandEvent(
          execution.command_id,
          "cancelled",
          null,
          {
            executionId,
            reason: reason.trim(),
            actor,
            uncertainEvidenceRetained: true,
          },
          now,
        );
      } else {
        if (!["starting", "running"].includes(execution.state)) {
          throw codedError(
            "transition_denied",
            `${action} is not valid while execution is ${execution.state}`,
          );
        }
        const failureClass = action === "stop" ? "owner_stop" : null;
        const changed = this.database.prepare(`UPDATE command_executions SET
          state='stopping',generation=generation+1,version=version+1,
          failure_class=COALESCE(?,failure_class),
          stop_requested_at=COALESCE(stop_requested_at,?),updated_at=?
          WHERE id=? AND version=? AND state IN ('starting','running')`).run(
          failureClass,
          now,
          now,
          executionId,
          expectedVersion,
        );
        if (Number(changed.changes) !== 1) {
          throw codedError("version_conflict", "execution changed while applying owner action");
        }
        if (execution.run_id) {
          this.database.prepare(`UPDATE capabilities SET revoked_at=COALESCE(revoked_at,?)
            WHERE run_id=?`).run(now, execution.run_id);
        }
        this.appendExecutionEvent(executionId, "fenced", {
          reason: reason.trim(),
          priorGeneration: execution.generation,
          generation: execution.generation + 1,
          failureClass,
        }, now);
      }
      this.database.prepare(`INSERT INTO execution_action_receipts(
        id,execution_id,action,actor,reason,request_sha256,result_json,idempotency_key,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        id,
        executionId,
        action,
        actor,
        reason.trim(),
        requestSha256,
        JSON.stringify(result),
        idempotencyKey,
        now,
      );
      this.appendExecutionEvent(executionId, `owner_${action}`, {
        actor,
        reason: reason.trim(),
        receiptId: id,
        ...result,
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      receipt: this.executionActionReceipt(idempotencyKey),
      execution: this.commandExecution(executionId),
    };
  }

  queueExecutionReplacement({
    executionId,
    action,
    expectedVersion,
    reason,
    idempotencyKey,
    actor = "local-owner",
    modelRoute = null,
  }) {
    if (!["retry", "resume"].includes(action)) {
      throw codedError("invalid_request", "replacement action must be retry or resume");
    }
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    if (execution.version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `execution version conflict: expected ${expectedVersion}, current ${execution.version}`,
      );
    }
    if (
      action === "resume"
        ? execution.state !== "paused"
        : !["paused", "failed"].includes(execution.state)
    ) {
      throw codedError("transition_denied", `${action} is not valid while execution is ${execution.state}`);
    }
    if (this.recoveryCandidates({ taskId: execution.task_id }).some((candidate) =>
      candidate.execution_id === execution.id && candidate.state === "pending"
    )) {
      throw codedError("transition_denied", "resolve pending late evidence before replacing the execution");
    }
    const priorReceipt = this.executionActionReceipt(idempotencyKey);
    const requestSha256 = sha256(JSON.stringify({
      executionId,
      action,
      expectedVersion,
      reason: reason?.trim(),
      actor,
      modelRoute,
    }));
    if (priorReceipt) {
      if (priorReceipt.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "idempotency key was reused for another replacement");
      }
      return {
        replayed: true,
        receipt: priorReceipt,
        command: this.orchestratorCommand(priorReceipt.result.commandId),
        execution,
      };
    }
    if (!reason?.trim()) throw codedError("invalid_request", "replacement reason is required");
    const route = modelRoute
      ? {
        ...validateModelRoute(modelRoute, `${action} model route`),
        policySource: modelRoute.policySource ?? `owner_${action}`,
      }
      : execution.model_route;
    const task = this.getTask(execution.task_id);
    const orchestrator = this.activeProjectOrchestrator(execution.project_id);
    if (!orchestrator) {
      throw codedError("orchestrator_unavailable", "project has no active orchestrator for replacement");
    }
    const commandId = randomUUID();
    const now = this.clock();
    const payload = {
      source: `owner_${action}`,
      modelRoute: route,
      ...(action === "retry" ? { retryOf: execution.command_id } : {
        resumeOf: execution.id,
        parentSessionId: execution.session_id,
      }),
    };
    const priorTask = this.getTaskDetails(task.id);
    const nextTaskVersion = task.version + 1;
    const nextStatus = execution.phase === "implementation" ? "in_progress" : "review";
    const nextWorker = execution.phase === "implementation"
      ? `task-agent:${execution.phase}:${commandId}`
      : task.assigned_worker;
    const receiptId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO orchestrator_commands(
        id,project_id,task_id,orchestrator_id,kind,phase,state,payload_json,
        request_sha256,idempotency_key,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?)`).run(
        commandId,
        execution.project_id,
        execution.task_id,
        orchestrator.id,
        "start_task",
        execution.phase,
        JSON.stringify(payload),
        sha256(JSON.stringify({
          projectId: execution.project_id,
          taskId: execution.task_id,
          phase: execution.phase,
          payload,
        })),
        `execution-replacement:${idempotencyKey}`,
        now,
        now,
      );
      const changed = this.database.prepare(`UPDATE tasks SET
        status=?,assigned_worker=?,version=?,updated_at=? WHERE id=? AND version=?`).run(
        nextStatus,
        nextWorker,
        nextTaskVersion,
        now,
        task.id,
        task.version,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "task changed while queuing replacement");
      }
      const result = { commandId, action, priorExecutionId: executionId };
      this.database.prepare(`INSERT INTO execution_action_receipts(
        id,execution_id,action,actor,reason,request_sha256,result_json,idempotency_key,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        receiptId,
        executionId,
        action,
        actor,
        reason.trim(),
        requestSha256,
        JSON.stringify(result),
        idempotencyKey,
        now,
      );
      this.appendExecutionEvent(executionId, `owner_${action}`, {
        actor,
        reason: reason.trim(),
        receiptId,
        commandId,
      }, now);
      this.appendOrchestratorCommandEvent(commandId, "queued", orchestrator.id, payload, now);
      const currentTask = this.getTaskDetails(task.id);
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,
        created_at,actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id,
        `task_execution_${action}_queued`,
        actor,
        task.status,
        nextStatus,
        JSON.stringify(result),
        `task-execution-replacement:${idempotencyKey}`,
        now,
        "owner",
        execution.run_id,
        nextTaskVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,
        payload_json,idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id,
        `task_execution_${action}_queued`,
        actor,
        "owner",
        null,
        execution.run_id,
        JSON.stringify(priorTask),
        JSON.stringify(currentTask),
        JSON.stringify(result),
        `task-execution-replacement:${idempotencyKey}`,
        sha256(JSON.stringify(result)),
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      receipt: this.executionActionReceipt(idempotencyKey),
      command: this.orchestratorCommand(commandId),
      execution: this.commandExecution(executionId),
      task: this.getTaskDetails(task.id),
    };
  }

  allowedExecutionActions(execution) {
    if (!execution) return [];
    if (["starting", "running"].includes(execution.state)) return ["stop", "pause", "cancel"];
    if (execution.state === "paused") return ["resume", "retry"];
    if (execution.state === "failed") return ["retry"];
    if (execution.state === "reconciliation_required") return ["cancel"];
    return [];
  }

  createRecoveryCandidate({
    executionId,
    revision,
    baseRevision,
    evidence = {},
    proof = {},
    eligible = false,
  }) {
    const execution = this.commandExecution(executionId);
    if (!execution) throw codedError("not_found", `unknown execution: ${executionId}`);
    if (!revision || !baseRevision) {
      throw codedError("invalid_request", "recovery candidate requires revision and base revision");
    }
    const prior = this.database.prepare(`SELECT * FROM recovery_candidates
      WHERE execution_id=? AND kind='checkpoint' AND revision=?`).get(executionId, revision);
    if (prior) return { replayed: true, candidate: publicRecoveryCandidate(prior) };
    const now = this.clock();
    const id = randomUUID();
    const state = eligible ? "pending" : "ineligible";
    this.database.prepare(`INSERT INTO recovery_candidates(
      id,execution_id,task_id,run_id,workspace_id,kind,state,revision,base_revision,
      evidence_json,proof_json,discovered_at,version
    ) VALUES(?,?,?,?,?,'checkpoint',?,?,?,?,?,?,1)`).run(
      id,
      executionId,
      execution.task_id,
      execution.run_id,
      execution.workspace_id,
      state,
      revision,
      baseRevision,
      JSON.stringify(evidence),
      JSON.stringify(proof),
      now,
    );
    this.appendExecutionEvent(executionId, "late_checkpoint_discovered", {
      candidateId: id,
      state,
      revision,
      baseRevision,
      proof,
    }, now);
    return { replayed: false, candidate: this.recoveryCandidate(id) };
  }

  recoveryCandidate(id) {
    return publicRecoveryCandidate(
      this.database.prepare("SELECT * FROM recovery_candidates WHERE id=?").get(id),
    );
  }

  recoveryCandidates({ taskId = null, state = null } = {}) {
    if (state && !RECOVERY_CANDIDATE_STATES.has(state)) {
      throw codedError("invalid_request", `unsupported recovery candidate state: ${state}`);
    }
    const clauses = [
      ...(taskId ? ["task_id=?"] : []),
      ...(state ? ["state=?"] : []),
    ];
    const values = [...(taskId ? [taskId] : []), ...(state ? [state] : [])];
    return this.database.prepare(`SELECT * FROM recovery_candidates
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY discovered_at,id`).all(...values).map((row) => publicRecoveryCandidate(row));
  }

  resolveRecoveryCandidate({
    candidateId,
    action,
    expectedVersion,
    reason,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!["accept", "reject"].includes(action)) {
      throw codedError("invalid_request", "candidate action must be accept or reject");
    }
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!reason?.trim()) throw codedError("invalid_request", "candidate resolution reason is required");
    const requestSha256 = sha256(JSON.stringify({
      action: "resolve_recovery_candidate",
      candidateId,
      resolution: action,
      expectedVersion,
      reason: reason.trim(),
      actor,
    }));
    const auditKey = `recovery-candidate:${idempotencyKey}`;
    const priorAudit = this.database.prepare(
      "SELECT * FROM audit_events WHERE idempotency_key=?",
    ).get(auditKey);
    if (priorAudit) {
      if (priorAudit.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "idempotency key was reused for another candidate resolution");
      }
      return {
        replayed: true,
        candidate: this.recoveryCandidate(candidateId),
        task: this.getTaskDetails(priorAudit.task_id),
      };
    }
    const candidate = this.recoveryCandidate(candidateId);
    if (!candidate) throw codedError("not_found", `unknown recovery candidate: ${candidateId}`);
    if (candidate.version !== expectedVersion) {
      throw codedError(
        "version_conflict",
        `candidate version conflict: expected ${expectedVersion}, current ${candidate.version}`,
      );
    }
    if (candidate.state !== "pending") {
      throw codedError("transition_denied", `candidate is ${candidate.state}, not pending`);
    }
    const execution = this.commandExecution(candidate.execution_id);
    const task = this.getTask(candidate.task_id);
    if (!execution || !task) throw codedError("reconciliation_required", "candidate scope is incomplete");
    if (action === "accept") {
      if (!candidate.proof.eligible) {
        throw codedError("transition_denied", "candidate proof is not eligible for acceptance");
      }
      if (task.revision !== candidate.base_revision) {
        throw codedError(
          "revision_conflict",
          "task advanced after candidate discovery; use governed Git integration",
        );
      }
      if (!EXECUTION_TERMINAL_STATES.has(execution.state)) {
        throw codedError("transition_denied", "candidate cannot advance while its execution remains active");
      }
    }
    const now = this.clock();
    const priorTask = this.getTaskDetails(task.id);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE recovery_candidates SET
        state=?,resolved_by=?,resolution_reason=?,resolved_at=?,version=version+1
        WHERE id=? AND version=? AND state='pending'`).run(
        action === "accept" ? "accepted" : "rejected",
        actor,
        reason.trim(),
        now,
        candidateId,
        expectedVersion,
      );
      let nextVersion = task.version;
      if (action === "accept") {
        nextVersion += 1;
        const changed = this.database.prepare(`UPDATE tasks SET
          revision=?,validation_passed=0,requested_review_revision=?,merge_requested=0,
          status='review',version=?,updated_at=? WHERE id=? AND version=?`).run(
          candidate.revision,
          candidate.revision,
          nextVersion,
          now,
          task.id,
          task.version,
        );
        if (Number(changed.changes) !== 1) {
          throw codedError("version_conflict", "task changed while accepting recovery candidate");
        }
      }
      const currentTask = this.getTaskDetails(task.id);
      const payload = {
        candidateId,
        executionId: candidate.execution_id,
        action,
        reason: reason.trim(),
        priorRevision: task.revision,
        candidateRevision: candidate.revision,
        validationAndReviewInvalidated: action === "accept",
      };
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,
        created_at,actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id,
        `recovery_candidate_${action}ed`,
        actor,
        task.status,
        currentTask.status,
        JSON.stringify(payload),
        auditKey,
        now,
        "owner",
        candidate.run_id,
        nextVersion,
      );
      this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,
        payload_json,idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id,
        `recovery_candidate_${action}ed`,
        actor,
        "owner",
        null,
        candidate.run_id,
        JSON.stringify(priorTask),
        JSON.stringify(currentTask),
        JSON.stringify(payload),
        auditKey,
        requestSha256,
        now,
      );
      this.appendExecutionEvent(candidate.execution_id, `recovery_candidate_${action}ed`, {
        candidateId,
        actor,
        reason: reason.trim(),
      }, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      candidate: this.recoveryCandidate(candidateId),
      task: this.getTaskDetails(task.id),
    };
  }

  recoveryAttention({ projectId = null } = {}) {
    const executions = this.commandExecutions({ projectId }).filter((execution) =>
      ["starting", "running", "stopping", "paused", "failed", "reconciliation_required"]
        .includes(execution.state)
    );
    return executions.map((execution) => {
      const task = this.getTaskDetails(execution.task_id);
      const run = execution.run_id ? this.getRun(execution.run_id) : null;
      const sideEffects = run ? this.sideEffectsForRun(run.id) : [];
      return {
        execution,
        command: this.orchestratorCommand(execution.command_id),
        task: task ? {
          id: task.id,
          title: task.title,
          status: task.status,
          version: task.version,
          revision: task.revision,
        } : null,
        run,
        side_effects: sideEffects,
        uncertain_side_effects: sideEffects.filter((effect) =>
          effect.state !== "completed"
        ),
        recovery_candidates: this.recoveryCandidates({ taskId: execution.task_id })
          .filter((candidate) => candidate.execution_id === execution.id),
        allowed_actions: this.allowedExecutionActions(execution),
        action_receipts: this.database.prepare(`SELECT
          id,action,actor,reason,result_json,idempotency_key,created_at
          FROM execution_action_receipts WHERE execution_id=? ORDER BY created_at,id`)
          .all(execution.id).map((row) => ({
            ...row,
            result: parseJson(row.result_json) ?? {},
            result_json: undefined,
          })),
      };
    });
  }

  reconcileOrchestratorCommand({
    commandId,
    action,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!idempotencyKey) throw codedError("invalid_request", "idempotency key is required");
    if (!["retry", "reset"].includes(action)) {
      throw codedError("invalid_request", "command reconciliation action must be retry or reset");
    }
    const command = this.orchestratorCommand(commandId);
    if (!command) throw codedError("not_found", `unknown command: ${commandId}`);
    if (this.commandExecutionForCommand(commandId)) {
      throw codedError(
        "execution_managed",
        "execution-backed commands require explicit execution recovery actions",
      );
    }
    const requestSha256 = sha256(JSON.stringify({
      action: "reconcile_orchestrator_command",
      commandId,
      resolution: action,
    }));
    const prior = this.database.prepare(
      "SELECT * FROM command_reconciliations WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256 || prior.command_id !== commandId) {
        throw codedError("idempotency_conflict", "idempotency key was reused for another reconciliation");
      }
      return {
        replayed: true,
        reconciliation: { ...prior, result: parseJson(prior.result_json) },
        command: this.orchestratorCommand(commandId),
      };
    }
    if (!["failed", "reconciliation_required"].includes(command.state)) {
      throw codedError("transition_denied", "only failed or uncertain commands require reconciliation");
    }
    const task = command.task_id ? this.getTask(command.task_id) : null;
    const now = this.clock();
    const reconciliationId = randomUUID();
    let result;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (action === "retry") {
        const orchestrator = this.activeProjectOrchestrator(command.project_id);
        if (!orchestrator) {
          throw codedError("orchestrator_unavailable", "project has no active orchestrator for retry");
        }
        const retryId = randomUUID();
        const retryPayload = { ...command.payload, retryOf: command.id, source: "owner_reconciliation" };
        this.database.prepare(`INSERT INTO orchestrator_commands(
          id,project_id,task_id,orchestrator_id,kind,phase,state,payload_json,result_json,
          request_sha256,idempotency_key,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,'queued',?,NULL,?,?,?,?)`).run(
          retryId,
          command.project_id,
          command.task_id,
          orchestrator.id,
          command.kind,
          command.phase,
          JSON.stringify(retryPayload),
          sha256(JSON.stringify({
            projectId: command.project_id,
            taskId: command.task_id,
            kind: command.kind,
            phase: command.phase,
            payload: retryPayload,
          })),
          `command-retry:${idempotencyKey}`,
          now,
          now,
        );
        this.appendOrchestratorCommandEvent(retryId, "queued", orchestrator.id, retryPayload, now);
        this.appendOrchestratorCommandEvent(commandId, "owner_retry_queued", orchestrator.id, {
          retryCommandId: retryId,
        }, now);
        result = { action, retryCommandId: retryId };
      } else {
        this.database.prepare(`UPDATE orchestrator_commands SET
          state='cancelled',result_json=?,updated_at=? WHERE id=?`).run(
          JSON.stringify({ ...(command.result ?? {}), ownerResolution: "reset" }),
          now,
          commandId,
        );
        this.appendOrchestratorCommandEvent(commandId, "cancelled", null, {
          actor,
          taskReset: Boolean(task),
        }, now);
        if (task) {
          const priorTask = this.getTaskDetails(task.id);
          const nextVersion = task.version + 1;
          this.database.prepare(`UPDATE tasks SET
            status='ready',assigned_worker=NULL,version=?,updated_at=? WHERE id=? AND version=?`).run(
            nextVersion,
            now,
            task.id,
            task.version,
          );
          const currentTask = this.getTaskDetails(task.id);
          this.database.prepare(`INSERT INTO task_events(
            task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
            actor_role,run_id,task_version
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
            task.id,
            "task_reconciled_reset",
            actor,
            task.status,
            "ready",
            JSON.stringify({ commandId }),
            `task-reset:${idempotencyKey}`,
            now,
            "owner",
            null,
            nextVersion,
          );
          this.database.prepare(`INSERT INTO audit_events(
            task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
            idempotency_key,request_sha256,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            task.id,
            "task_reconciled_reset",
            actor,
            "owner",
            null,
            null,
            JSON.stringify(priorTask),
            JSON.stringify(currentTask),
            JSON.stringify({ commandId }),
            `task-reset:${idempotencyKey}`,
            sha256(JSON.stringify({ action: "task_reconciled_reset", commandId })),
            now,
          );
        }
        result = { action, taskId: task?.id ?? null, taskState: task ? "ready" : null };
      }
      this.database.prepare(`INSERT INTO command_reconciliations(
        id,command_id,action,result_json,idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?)`).run(
        reconciliationId,
        commandId,
        action,
        JSON.stringify(result),
        idempotencyKey,
        requestSha256,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      reconciliation: {
        ...this.database.prepare("SELECT * FROM command_reconciliations WHERE id=?").get(reconciliationId),
        result,
      },
      command: this.orchestratorCommand(commandId),
      retryCommand: result.retryCommandId ? this.orchestratorCommand(result.retryCommandId) : null,
      task: task ? this.getTaskDetails(task.id) : null,
    };
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

  reconcileLegacyClaimedCommands(reason = "control_plane_restart", now = this.clock()) {
    const commands = this.database.prepare(`SELECT c.id,c.orchestrator_id
      FROM orchestrator_commands c
      LEFT JOIN command_executions e ON e.command_id=c.id
      WHERE c.state='claimed' AND e.id IS NULL ORDER BY c.sequence`).all();
    for (const command of commands) {
      const result = { reason, automaticReplay: false, executionMissing: true };
      this.database.prepare(`UPDATE orchestrator_commands SET
        state='reconciliation_required',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND state='claimed'`).run(JSON.stringify(result), now, now, command.id);
      this.appendOrchestratorCommandEvent(
        command.id,
        "reconciliation_required",
        command.orchestrator_id,
        result,
        now,
      );
    }
    return commands.map((command) => command.id);
  }

  getTaskDetails(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;
    return {
      ...task,
      validation_passed: Boolean(task.validation_passed),
      merge_requested: Boolean(task.merge_requested),
      archived: Boolean(task.archived_at),
      tags: normalizeTaskTags(parseJson(task.tags_json) ?? []),
      acceptance_criteria: parseJson(task.acceptance_criteria_json) ?? [],
      dispatch_model_route: parseJson(task.dispatch_model_route_json),
      origin: this.database.prepare(
        "SELECT * FROM task_origins WHERE task_id=? AND task_version=?",
      ).get(taskId, task.version) ?? null,
      children: this.database.prepare(`SELECT
        id,title,status,version,task_kind,tags_json,archived_at
        FROM tasks WHERE parent_task_id=? ORDER BY id`).all(taskId).map((child) => ({
        ...child,
        tags: parseJson(child.tags_json) ?? [],
        archived: Boolean(child.archived_at),
      })),
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
      git_integrations: this.gitIntegrations({ taskId }),
    };
  }

  ensureProjectGitPolicy({ projectId, targetBranch, actor = "system-default" }) {
    if (!this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    const prior = this.projectGitPolicy(projectId);
    if (prior) return prior;
    const branch = normalizeGitBranch(targetBranch, "default target branch");
    const now = this.clock();
    this.database.prepare(`INSERT INTO project_git_policies(
      project_id,mode,history_policy,target_branch,remote_name,allow_push,
      allow_pull_request,allowed_target_branches_json,version,updated_by,reason,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)`).run(
      projectId,
      "prepare_only",
      "merge_commit",
      branch,
      "origin",
      0,
      0,
      JSON.stringify([branch]),
      actor,
      "conservative default",
      now,
    );
    return this.projectGitPolicy(projectId);
  }

  projectGitPolicy(projectId) {
    return publicGitPolicy(
      this.database.prepare("SELECT * FROM project_git_policies WHERE project_id=?").get(projectId),
    );
  }

  updateProjectGitPolicy({
    projectId,
    mode,
    historyPolicy,
    targetBranch,
    remoteName = "origin",
    allowPush = false,
    allowPullRequest = false,
    allowedTargetBranches = [],
    expectedVersion,
    reason,
    actor = "local-owner",
    idempotencyKey,
  }) {
    const prior = this.projectGitPolicy(projectId);
    if (!prior) throw codedError("not_found", `project Git policy is not initialized: ${projectId}`);
    if (!idempotencyKey || !reason?.trim()) {
      throw codedError("invalid_request", "policy reason and idempotency key are required");
    }
    if (!GIT_INTEGRATION_MODES.has(mode)) {
      throw codedError("invalid_request", `unsupported Git integration mode: ${mode}`);
    }
    if (!GIT_HISTORY_POLICIES.has(historyPolicy)) {
      throw codedError("invalid_request", `unsupported Git history policy: ${historyPolicy}`);
    }
    const target = normalizeGitBranch(targetBranch, "target branch");
    const remote = normalizeGitRemote(remoteName);
    const allowed = [...new Set(allowedTargetBranches.map((branch) =>
      normalizeGitBranch(branch, "allowed target branch")
    ))].sort();
    if (!allowed.includes(target)) {
      throw codedError("invalid_request", "target branch must be in allowed target branches");
    }
    if (allowPullRequest && (!allowPush || mode !== "pull_request")) {
      throw codedError(
        "invalid_request",
        "pull-request publication requires pull_request mode and normal push authorization",
      );
    }
    if (mode === "pull_request" && (!allowPush || !allowPullRequest)) {
      throw codedError(
        "invalid_request",
        "pull_request mode requires normal push and pull-request authorization",
      );
    }
    const intent = {
      projectId,
      mode,
      historyPolicy,
      targetBranch: target,
      remoteName: remote,
      allowPush: Boolean(allowPush),
      allowPullRequest: Boolean(allowPullRequest),
      allowedTargetBranches: allowed,
      expectedVersion,
      reason: reason.trim(),
    };
    const requestSha256 = sha256(JSON.stringify(intent));
    const replay = this.database.prepare(
      "SELECT * FROM project_git_policy_events WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (replay) {
      if (replay.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "policy idempotency key was reused");
      }
      return { replayed: true, policy: this.projectGitPolicy(projectId), event: replay };
    }
    if (prior.version !== expectedVersion) {
      throw codedError("version_conflict", "project Git policy changed", { current: prior });
    }
    const now = this.clock();
    const nextVersion = prior.version + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.database.prepare(`UPDATE project_git_policies SET
        mode=?,history_policy=?,target_branch=?,remote_name=?,allow_push=?,
        allow_pull_request=?,allowed_target_branches_json=?,version=?,updated_by=?,
        reason=?,updated_at=? WHERE project_id=? AND version=?`).run(
        mode,
        historyPolicy,
        target,
        remote,
        allowPush ? 1 : 0,
        allowPullRequest ? 1 : 0,
        JSON.stringify(allowed),
        nextVersion,
        actor,
        reason.trim(),
        now,
        projectId,
        expectedVersion,
      );
      if (Number(changed.changes) !== 1) {
        throw codedError("version_conflict", "project Git policy changed");
      }
      const current = this.projectGitPolicy(projectId);
      this.database.prepare(`INSERT INTO project_git_policy_events(
        id,project_id,prior_json,new_json,actor,reason,request_sha256,idempotency_key,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(),
        projectId,
        JSON.stringify(prior),
        JSON.stringify(current),
        actor,
        reason.trim(),
        requestSha256,
        idempotencyKey,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      replayed: false,
      policy: this.projectGitPolicy(projectId),
      event: this.database.prepare(
        "SELECT * FROM project_git_policy_events WHERE idempotency_key=?",
      ).get(idempotencyKey),
    };
  }

  integrationGateEvaluation(taskId) {
    const task = this.getTaskDetails(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const completion = this.evaluateCompletion(taskId);
    const mergeRequest = this.database.prepare(
      "SELECT * FROM merge_requests WHERE task_id=? AND revision=? ORDER BY created_at DESC LIMIT 1",
    ).get(taskId, task.revision);
    const activeExecution = this.database.prepare(`SELECT id,state FROM command_executions
      WHERE task_id=? AND state IN ('starting','running','stopping','paused','reconciliation_required')
      ORDER BY created_at DESC LIMIT 1`).get(taskId);
    const recoveryCandidate = this.database.prepare(`SELECT id,state FROM recovery_candidates
      WHERE task_id=? AND state='pending' ORDER BY discovered_at DESC LIMIT 1`).get(taskId);
    const reasons = [...completion.reasons];
    if (task.status !== "done") reasons.push("task_not_done");
    if (!task.merge_requested || !mergeRequest || mergeRequest.status !== "requested") {
      reasons.push("merge_request_not_pending");
    }
    if (activeExecution) reasons.push(`execution_${activeExecution.state}`);
    if (recoveryCandidate) reasons.push("recovery_candidate_pending");
    return {
      allowed: reasons.length === 0,
      reasons: [...new Set(reasons)],
      task,
      mergeRequest: mergeRequest ?? null,
      policy: this.projectGitPolicy(task.project_id),
      activeExecution: activeExecution ?? null,
      recoveryCandidate: recoveryCandidate ?? null,
    };
  }

  recordGitIntegrationPreparation({
    id = randomUUID(),
    taskId,
    state,
    sourceRevision,
    targetBranch,
    targetRevision,
    plan,
    idempotencyKey,
  }) {
    if (!["prepared", "conflict"].includes(state)) {
      throw codedError("invalid_request", "Git preparation must be prepared or conflict");
    }
    const gates = this.integrationGateEvaluation(taskId);
    if (!gates.allowed) {
      throw codedError("integration_blocked", `integration blocked: ${gates.reasons.join(",")}`, {
        reasons: gates.reasons,
      });
    }
    const policy = gates.policy;
    if (!policy) throw codedError("integration_blocked", "project Git policy is not initialized");
    const branch = normalizeGitBranch(targetBranch, "target branch");
    if (!policy.allowed_target_branches.includes(branch) || branch !== policy.target_branch) {
      throw codedError("integration_blocked", "target branch is not allowed by project policy");
    }
    if (sourceRevision !== gates.task.revision) {
      throw codedError("revision_conflict", "integration source is not the current task revision");
    }
    const intent = { taskId };
    const requestSha256 = sha256(JSON.stringify(intent));
    const prior = this.database.prepare(
      "SELECT * FROM git_integrations WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "integration preparation key was reused");
      }
      return { replayed: true, integration: publicGitIntegration(prior) };
    }
    const now = this.clock();
    this.database.prepare(`INSERT INTO git_integrations(
      id,task_id,project_id,merge_request_id,state,mode,history_policy,
      source_revision,target_branch,target_revision,remote_name,policy_version,
      request_sha256,idempotency_key,plan_json,version,prepared_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,
      taskId,
      gates.task.project_id,
      gates.mergeRequest.id,
      state,
      policy.mode,
      policy.history_policy,
      sourceRevision,
      branch,
      targetRevision,
      policy.remote_name,
      policy.version,
      requestSha256,
      idempotencyKey,
      JSON.stringify(plan),
      1,
      now,
      now,
    );
    return { replayed: false, integration: this.gitIntegration(id) };
  }

  gitIntegration(id) {
    return publicGitIntegration(
      this.database.prepare("SELECT * FROM git_integrations WHERE id=?").get(id),
    );
  }

  gitIntegrationPreparationByIdempotency({ taskId, idempotencyKey }) {
    if (!idempotencyKey) return null;
    const row = this.database.prepare(
      "SELECT * FROM git_integrations WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (!row) return null;
    if (row.task_id !== taskId) {
      throw codedError(
        "idempotency_conflict",
        "integration preparation key was reused for another task",
      );
    }
    return publicGitIntegration(row);
  }

  gitIntegrations({ taskId = null, projectId = null } = {}) {
    const clauses = [];
    const values = [];
    if (taskId) {
      clauses.push("task_id=?");
      values.push(taskId);
    }
    if (projectId) {
      clauses.push("project_id=?");
      values.push(projectId);
    }
    return this.database.prepare(`SELECT * FROM git_integrations
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY prepared_at,id`).all(...values).map(publicGitIntegration);
  }

  integrationAttention(projectId = null) {
    const rows = this.database.prepare(`SELECT * FROM git_integrations
      WHERE state IN ('conflict','failed','reconciliation_required')
        ${projectId ? "AND project_id=?" : ""}
      ORDER BY updated_at,id`).all(...(projectId ? [projectId] : []));
    return rows.map((row) => {
      const integration = publicGitIntegration(row);
      const gates = this.integrationGateEvaluation(integration.task_id);
      return {
        integration,
        task: this.getTaskDetails(integration.task_id),
        gate_evaluation: { allowed: gates.allowed, reasons: gates.reasons },
        action_receipts: this.database.prepare(`SELECT
          id,action,actor,reason,result_json,idempotency_key,created_at
          FROM git_integration_actions WHERE integration_id=? ORDER BY created_at,id`)
          .all(integration.id).map((receipt) => ({
            ...receipt,
            result: parseJson(receipt.result_json) ?? {},
            result_json: undefined,
          })),
        allowed_actions: integration.state === "conflict"
          ? ["cancel"]
          : integration.state === "failed" ? ["cancel"] : ["cancel"],
      };
    });
  }

  reconcileGitIntegrationsAfterRestart() {
    const rows = this.database.prepare(
      "SELECT id,version FROM git_integrations WHERE state IN ('preparing','integrating') ORDER BY updated_at,id",
    ).all();
    for (const row of rows) {
      this.transitionGitIntegration({
        integrationId: row.id,
        expectedVersion: row.version,
        state: "reconciliation_required",
        failure: {
          code: "control_plane_restart",
          message: "Git integration was interrupted; no automatic replay is permitted.",
        },
      });
    }
    return rows.map((row) => row.id);
  }

  recordGitIntegrationAction({
    integrationId,
    action,
    expectedVersion,
    reason,
    idempotencyKey,
    actor = "local-owner",
    result = {},
  }) {
    if (!["execute", "cancel"].includes(action) || !reason?.trim() || !idempotencyKey) {
      throw codedError("invalid_request", "integration action, reason, and idempotency key are required");
    }
    const integration = this.gitIntegration(integrationId);
    if (!integration) throw codedError("not_found", `unknown Git integration: ${integrationId}`);
    const intent = { integrationId, action, expectedVersion, reason: reason.trim() };
    const requestSha256 = sha256(JSON.stringify(intent));
    const prior = this.database.prepare(
      "SELECT * FROM git_integration_actions WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "integration action key was reused");
      }
      return {
        replayed: true,
        receipt: { ...prior, result: parseJson(prior.result_json) ?? {} },
        integration: this.gitIntegration(integrationId),
      };
    }
    if (integration.version !== expectedVersion) {
      throw codedError("version_conflict", "Git integration changed", { current: integration });
    }
    const now = this.clock();
    const id = randomUUID();
    this.database.prepare(`INSERT INTO git_integration_actions(
      id,integration_id,action,actor,reason,request_sha256,result_json,idempotency_key,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id,
      integrationId,
      action,
      actor,
      reason.trim(),
      requestSha256,
      JSON.stringify(result),
      idempotencyKey,
      now,
    );
    return {
      replayed: false,
      receipt: {
        ...this.database.prepare("SELECT * FROM git_integration_actions WHERE id=?").get(id),
        result,
      },
      integration,
    };
  }

  completeGitIntegrationAction(receiptId, result) {
    const receipt = this.database.prepare(
      "SELECT * FROM git_integration_actions WHERE id=?",
    ).get(receiptId);
    if (!receipt) throw codedError("not_found", `unknown integration action receipt: ${receiptId}`);
    this.database.prepare(
      "UPDATE git_integration_actions SET result_json=? WHERE id=?",
    ).run(JSON.stringify(result), receiptId);
    return {
      ...this.database.prepare("SELECT * FROM git_integration_actions WHERE id=?").get(receiptId),
      result,
    };
  }

  transitionGitIntegration({
    integrationId,
    expectedVersion,
    state,
    resultRevision = null,
    result = null,
    failure = null,
  }) {
    if (!GIT_INTEGRATION_STATES.has(state)) {
      throw codedError("invalid_request", `unsupported Git integration state: ${state}`);
    }
    const prior = this.gitIntegration(integrationId);
    if (!prior) throw codedError("not_found", `unknown Git integration: ${integrationId}`);
    if (prior.version !== expectedVersion) {
      throw codedError("version_conflict", "Git integration changed", { current: prior });
    }
    const nextVersion = prior.version + 1;
    const now = this.clock();
    const completedAt = ["integrated", "published", "cancelled"].includes(state) ? now : null;
    const changed = this.database.prepare(`UPDATE git_integrations SET
      state=?,result_revision=COALESCE(?,result_revision),result_json=?,
      failure_json=?,version=?,completed_at=COALESCE(?,completed_at),updated_at=?
      WHERE id=? AND version=?`).run(
      state,
      resultRevision,
      result === null ? prior.result ? JSON.stringify(prior.result) : null : JSON.stringify(result),
      failure === null ? null : JSON.stringify(failure),
      nextVersion,
      completedAt,
      now,
      integrationId,
      expectedVersion,
    );
    if (Number(changed.changes) !== 1) {
      throw codedError("version_conflict", "Git integration changed");
    }
    if (["integrated", "published"].includes(state)) {
      this.database.prepare(`UPDATE merge_requests SET
        status=?,integration_id=?,result_revision=?,integrated_at=?
        WHERE id=? AND task_id=? AND revision=?`).run(
        state,
        integrationId,
        resultRevision,
        now,
        prior.merge_request_id,
        prior.task_id,
        prior.source_revision,
      );
    }
    return this.gitIntegration(integrationId);
  }

  createRetentionHold({
    projectId,
    scopeType,
    scopeId,
    reason,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!RETENTION_SCOPE_TYPES.has(scopeType) || !scopeId || !reason?.trim() || !idempotencyKey) {
      throw codedError("invalid_request", "valid hold scope, reason, and idempotency key are required");
    }
    const intent = { projectId, scopeType, scopeId, reason: reason.trim() };
    const requestSha256 = sha256(JSON.stringify(intent));
    const prior = this.database.prepare(
      "SELECT * FROM retention_holds WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "retention hold key was reused");
      }
      return { replayed: true, hold: { ...prior, active: Boolean(prior.active) } };
    }
    if (!this.getProject(projectId)) throw codedError("not_found", `unknown project: ${projectId}`);
    let scopedProjectId = null;
    if (scopeType === "project") {
      scopedProjectId = scopeId;
    } else if (scopeType === "task") {
      scopedProjectId = this.getTask(scopeId)?.project_id ?? null;
    } else if (scopeType === "session") {
      const session = this.getSession(scopeId);
      scopedProjectId = session ? this.getTask(session.task_id)?.project_id ?? null : null;
    } else if (scopeType === "run") {
      const run = this.getRun(scopeId);
      const session = run ? this.getSession(run.session_id) : null;
      scopedProjectId = session ? this.getTask(session.task_id)?.project_id ?? null : null;
    } else if (scopeType === "workspace") {
      const workspace = this.getWorkspace(scopeId);
      scopedProjectId = workspace ? this.getTask(workspace.task_id)?.project_id ?? null : null;
    }
    if (!scopedProjectId) {
      throw codedError("not_found", `unknown ${scopeType} hold scope: ${scopeId}`);
    }
    if (scopedProjectId !== projectId) {
      throw codedError("scope_mismatch", `${scopeType} hold scope is outside project ${projectId}`);
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.prepare(`INSERT INTO retention_holds(
      id,project_id,scope_type,scope_id,reason,active,created_by,request_sha256,
      idempotency_key,created_at
    ) VALUES(?,?,?,?,?,1,?,?,?,?)`).run(
      id,
      projectId,
      scopeType,
      scopeId,
      reason.trim(),
      actor,
      requestSha256,
      idempotencyKey,
      now,
    );
    return {
      replayed: false,
      hold: { ...this.database.prepare("SELECT * FROM retention_holds WHERE id=?").get(id), active: true },
    };
  }

  releaseRetentionHold({
    holdId,
    reason,
    idempotencyKey,
    actor = "local-owner",
  }) {
    const hold = this.database.prepare("SELECT * FROM retention_holds WHERE id=?").get(holdId);
    if (!hold) throw codedError("not_found", `unknown retention hold: ${holdId}`);
    if (!reason?.trim() || !idempotencyKey) {
      throw codedError("invalid_request", "release reason and idempotency key are required");
    }
    const intent = { holdId, reason: reason.trim() };
    const requestSha256 = sha256(JSON.stringify(intent));
    const prior = this.database.prepare(
      "SELECT * FROM retention_hold_events WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "retention release key was reused");
      }
      const current = this.database.prepare("SELECT * FROM retention_holds WHERE id=?").get(holdId);
      return { replayed: true, hold: { ...current, active: Boolean(current.active) } };
    }
    if (!hold.active) throw codedError("transition_denied", "retention hold is already released");
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE retention_holds SET
        active=0,released_by=?,release_reason=?,released_at=? WHERE id=? AND active=1`).run(
        actor,
        reason.trim(),
        now,
        holdId,
      );
      this.database.prepare(`INSERT INTO retention_hold_events(
        id,hold_id,action,actor,reason,request_sha256,idempotency_key,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        randomUUID(),
        holdId,
        "release",
        actor,
        reason.trim(),
        requestSha256,
        idempotencyKey,
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    const current = this.database.prepare("SELECT * FROM retention_holds WHERE id=?").get(holdId);
    return { replayed: false, hold: { ...current, active: Boolean(current.active) } };
  }

  retentionHolds(projectId, { activeOnly = true } = {}) {
    return this.database.prepare(`SELECT * FROM retention_holds WHERE project_id=?
      ${activeOnly ? "AND active=1" : ""} ORDER BY created_at,id`).all(projectId)
      .map((hold) => ({ ...hold, active: Boolean(hold.active) }));
  }

  setRuntimeFlag(key, value) {
    this.database.prepare(`INSERT INTO runtime_flags(key,value_json,updated_at)
      VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,updated_at=excluded.updated_at`).run(
      key,
      JSON.stringify(value),
      this.clock(),
    );
    return this.runtimeFlag(key);
  }

  runtimeFlag(key) {
    const row = this.database.prepare("SELECT * FROM runtime_flags WHERE key=?").get(key);
    return row ? { ...row, value: parseJson(row.value_json) } : null;
  }

  resourceCleanupProjection(taskId) {
    const task = this.getTaskDetails(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const holds = this.retentionHolds(task.project_id);
    const integrated = task.git_integrations.some((integration) =>
      ["integrated", "published"].includes(integration.state)
      && integration.source_revision === task.revision
    );
    const workspaces = this.database.prepare(`SELECT w.*,r.state AS run_state,r.phase,
      r.container_id,r.session_id,r.execution_id
      FROM workspaces w JOIN runs r ON r.id=w.run_id
      WHERE w.task_id=? ORDER BY w.created_at,w.id`).all(taskId).map((workspace) => {
      const blockers = [];
      if (workspace.state !== "active") blockers.push("workspace_not_active");
      if (workspace.run_state === "running") blockers.push("run_active");
      const execution = workspace.execution_id
        ? this.commandExecution(workspace.execution_id)
        : null;
      if (execution && ["starting", "running", "stopping", "paused", "reconciliation_required"].includes(execution.state)) {
        blockers.push(`execution_${execution.state}`);
      }
      if (this.database.prepare(`SELECT 1 value FROM recovery_candidates
        WHERE workspace_id=? AND state='pending' LIMIT 1`).get(workspace.id)) {
        blockers.push("recovery_candidate_pending");
      }
      if (this.sideEffectsForRun(workspace.run_id).some((effect) => effect.state !== "completed")) {
        blockers.push("side_effect_unsettled");
      }
      if (workspace.phase === "implementation" && !integrated) {
        blockers.push("implementation_not_integrated");
      }
      const matchingHolds = holds.filter((hold) =>
        (hold.scope_type === "project" && hold.scope_id === task.project_id)
        || (hold.scope_type === "task" && hold.scope_id === taskId)
        || (hold.scope_type === "session" && hold.scope_id === workspace.session_id)
        || (hold.scope_type === "run" && hold.scope_id === workspace.run_id)
        || (hold.scope_type === "workspace" && hold.scope_id === workspace.id)
      );
      if (matchingHolds.length) blockers.push("retention_hold");
      return {
        ...workspace,
        execution,
        holds: matchingHolds,
        eligible: blockers.length === 0,
        blockers,
      };
    });
    return {
      task,
      holds,
      workspaces,
      integrated,
      generated_at: this.clock(),
    };
  }

  beginResourceCleanup({
    projectId,
    taskId,
    previewSha256,
    resources,
    reason,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (!previewSha256 || !reason?.trim() || !idempotencyKey || !Array.isArray(resources)) {
      throw codedError("invalid_request", "cleanup preview, resources, reason, and idempotency key are required");
    }
    const intent = { projectId, taskId, previewSha256, resources, reason: reason.trim() };
    const requestSha256 = sha256(JSON.stringify(intent));
    const prior = this.database.prepare(
      "SELECT * FROM resource_cleanup_operations WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "cleanup idempotency key was reused");
      }
      return { replayed: true, operation: publicCleanupOperation(prior) };
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.prepare(`INSERT INTO resource_cleanup_operations(
      id,project_id,task_id,preview_sha256,state,resources_json,actor,reason,
      request_sha256,idempotency_key,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,
      projectId,
      taskId,
      previewSha256,
      "prepared",
      JSON.stringify(resources),
      actor,
      reason.trim(),
      requestSha256,
      idempotencyKey,
      now,
      now,
    );
    return { replayed: false, operation: this.resourceCleanupOperation(id) };
  }

  resourceCleanupOperation(id) {
    return publicCleanupOperation(
      this.database.prepare("SELECT * FROM resource_cleanup_operations WHERE id=?").get(id),
    );
  }

  resourceCleanupByIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    return publicCleanupOperation(
      this.database.prepare(
        "SELECT * FROM resource_cleanup_operations WHERE idempotency_key=?",
      ).get(idempotencyKey),
    );
  }

  completeResourceCleanup(id, { state, result }) {
    if (!["complete", "cleanup_pending", "reconciliation_required"].includes(state)) {
      throw codedError("invalid_request", `unsupported cleanup state: ${state}`);
    }
    const now = this.clock();
    this.database.prepare(`UPDATE resource_cleanup_operations SET
      state=?,result_json=?,completed_at=CASE WHEN ?='complete' THEN ? ELSE completed_at END,
      updated_at=? WHERE id=?`).run(state, JSON.stringify(result), state, now, now, id);
    return this.resourceCleanupOperation(id);
  }

  markWorkspaceRetired(workspaceId, {
    actor = "local-owner",
    reason,
  }) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) throw codedError("not_found", `unknown workspace: ${workspaceId}`);
    if (workspace.state === "retired") return workspace;
    const now = this.clock();
    this.database.prepare(`UPDATE workspaces SET
      state='retired',retired_at=?,retired_by=?,retirement_reason=?,updated_at=?
      WHERE id=? AND state='active'`).run(now, actor, reason, now, workspaceId);
    return this.getWorkspace(workspaceId);
  }

  sessionDeletionProjection(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) throw codedError("not_found", `unknown session: ${sessionId}`);
    const task = this.getTaskDetails(session.task_id);
    const runs = this.database.prepare(
      "SELECT * FROM runs WHERE session_id=? ORDER BY started_at,id",
    ).all(sessionId);
    const holds = this.retentionHolds(task.project_id).filter((hold) =>
      (hold.scope_type === "project" && hold.scope_id === task.project_id)
      || (hold.scope_type === "task" && hold.scope_id === task.id)
      || (hold.scope_type === "session" && hold.scope_id === sessionId)
      || runs.some((run) => hold.scope_type === "run" && hold.scope_id === run.id)
    );
    const blockers = [];
    if (session.deleted_at) blockers.push("session_already_deleted");
    if (runs.some((run) => run.state === "running")) blockers.push("run_active");
    if (holds.length) blockers.push("retention_hold");
    if (runs.some((run) => this.database.prepare(`SELECT 1 value FROM recovery_candidates
      WHERE run_id=? AND state='pending' LIMIT 1`).get(run.id))) {
      blockers.push("recovery_candidate_pending");
    }
    const implementationRevision = runs.some((run) => run.phase === "implementation");
    if (
      implementationRevision
      && !task.git_integrations.some((integration) =>
        ["integrated", "published"].includes(integration.state)
        && integration.source_revision === task.revision
      )
    ) blockers.push("implementation_not_integrated");
    return {
      session,
      task,
      runs,
      artifacts: this.artifacts(sessionId),
      holds,
      eligible: blockers.length === 0,
      blockers,
      generated_at: this.clock(),
    };
  }

  beginSessionDeletion({
    sessionId,
    confirmSessionId,
    previewSha256,
    preview,
    reason,
    idempotencyKey,
    actor = "local-owner",
  }) {
    if (confirmSessionId !== sessionId) {
      throw codedError("confirmation_mismatch", "session confirmation must exactly match the session ID");
    }
    if (!previewSha256 || !reason?.trim() || !idempotencyKey) {
      throw codedError("invalid_request", "session deletion preview, reason, and idempotency key are required");
    }
    const intent = { sessionId, confirmSessionId, previewSha256, reason: reason.trim() };
    const requestSha256 = sha256(JSON.stringify(intent));
    const prior = this.database.prepare(
      "SELECT * FROM session_deletion_receipts WHERE idempotency_key=?",
    ).get(idempotencyKey);
    if (prior) {
      if (prior.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "session deletion key was reused");
      }
      return { replayed: true, receipt: publicSessionDeletionReceipt(prior) };
    }
    const projection = this.sessionDeletionProjection(sessionId);
    if (!projection.eligible) {
      throw codedError("deletion_blocked", `session deletion blocked: ${projection.blockers.join(",")}`, {
        blockers: projection.blockers,
      });
    }
    const id = randomUUID();
    const now = this.clock();
    this.database.prepare(`INSERT INTO session_deletion_receipts(
      id,session_id,task_id,preview_sha256,preview_json,state,actor,reason,
      request_sha256,idempotency_key,created_at,updated_at
    ) VALUES(?,?,?,?,?,'prepared',?,?,?,?,?,?)`).run(
      id,
      sessionId,
      projection.task.id,
      previewSha256,
      JSON.stringify(preview),
      actor,
      reason.trim(),
      requestSha256,
      idempotencyKey,
      now,
      now,
    );
    return { replayed: false, receipt: this.sessionDeletionReceipt(id) };
  }

  sessionDeletionReceipt(id) {
    return publicSessionDeletionReceipt(
      this.database.prepare("SELECT * FROM session_deletion_receipts WHERE id=?").get(id),
    );
  }

  sessionDeletionByIdempotency(idempotencyKey) {
    if (!idempotencyKey) return null;
    return publicSessionDeletionReceipt(
      this.database.prepare(
        "SELECT * FROM session_deletion_receipts WHERE idempotency_key=?",
      ).get(idempotencyKey),
    );
  }

  settleSessionDeletion(id, {
    state,
    manifestPath = null,
    result = {},
  }) {
    if (!["cleanup_pending", "complete"].includes(state)) {
      throw codedError("invalid_request", `unsupported session deletion state: ${state}`);
    }
    const receipt = this.sessionDeletionReceipt(id);
    if (!receipt) throw codedError("not_found", `unknown session deletion receipt: ${id}`);
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE session_deletion_receipts SET
        state=?,manifest_path=COALESCE(?,manifest_path),result_json=?,
        completed_at=CASE WHEN ?='complete' THEN ? ELSE completed_at END,updated_at=?
        WHERE id=?`).run(
        state,
        manifestPath,
        JSON.stringify(result),
        state,
        now,
        now,
        id,
      );
      if (state === "complete") {
        this.database.prepare(`UPDATE sessions SET
          state='deleted',deleted_at=?,deleted_by=?,deletion_reason=?,
          deletion_manifest_path=?,updated_at=? WHERE id=?`).run(
          now,
          receipt.actor,
          receipt.reason,
          manifestPath,
          now,
          receipt.session_id,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.sessionDeletionReceipt(id);
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

  issueCapability({
    role,
    actorId,
    taskId,
    runId = null,
    executionId = null,
    executionGeneration = null,
    actions = [...(CAPABILITY_ACTIONS[role] ?? [])],
    expiresAt,
  }) {
    if (!CAPABILITY_ACTIONS[role]) throw codedError("invalid_role", `unknown role: ${role}`);
    if (!this.getTask(taskId)) throw codedError("not_found", `unknown task: ${taskId}`);
    if (executionId) this.assertExecutionGeneration(executionId, executionGeneration);
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
        id,token_sha256,role,actor_id,task_id,run_id,expires_at,created_at,
        execution_id,execution_generation
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        id,
        sha256(token),
        role,
        actorId,
        taskId,
        runId,
        expiresAt,
        this.clock(),
        executionId,
        executionGeneration,
      );
      const insertAction = this.database.prepare("INSERT INTO capability_actions(capability_id,action) VALUES(?,?)");
      for (const action of actions) insertAction.run(id, action);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      id,
      token,
      role,
      actorId,
      taskId,
      runId,
      executionId,
      executionGeneration,
      actions,
      expiresAt,
    };
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
    if (capability.execution_id) {
      this.assertExecutionGeneration(capability.execution_id, capability.execution_generation);
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
    if (capability.role === "validator") {
      const run = capability.run_id ? this.getRun(capability.run_id) : null;
      if (!run || run.phase !== "test") {
        throw codedError("capability_denied", "validation requires a persisted test-phase run");
      }
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

  taskPhaseOutcome(taskId, phase) {
    if (!RUN_PHASES.has(phase)) {
      throw codedError("invalid_request", `unsupported run phase: ${phase}`);
    }
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const validation = task.revision
      ? this.database.prepare(`SELECT * FROM validations
        WHERE task_id=? AND revision=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(
        taskId,
        task.revision,
      ) ?? null
      : null;
    const review = task.revision
      ? this.database.prepare(`SELECT * FROM reviews
        WHERE task_id=? AND revision=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(
        taskId,
        task.revision,
      ) ?? null
      : null;
    const recorded = phase === "implementation"
      ? Boolean(task.revision && task.requested_review_revision === task.revision)
      : phase === "test" ? Boolean(validation) : Boolean(review);
    return {
      taskId,
      phase,
      revision: task.revision,
      recorded,
      requestedReviewRevision: task.requested_review_revision,
      validation: validation ? {
        id: validation.id,
        revision: validation.revision,
        status: validation.status,
      } : null,
      review: review ? {
        id: review.id,
        revision: review.revision,
        disposition: review.disposition,
        reviewerId: review.reviewer_id,
      } : null,
    };
  }

  automaticPipelineDirectives(projectId) {
    if (!this.getProject(projectId)) {
      throw codedError("not_found", `unknown project: ${projectId}`);
    }
    const tasks = this.database.prepare(`SELECT * FROM tasks
      WHERE project_id=? AND status NOT IN ('done','blocked')
        AND task_kind='executable' AND archived_at IS NULL
        AND revision IS NOT NULL
        AND requested_review_revision=revision
      ORDER BY updated_at,id`).all(projectId);
    return tasks.map((task) => {
      const activeCommand = this.database.prepare(`SELECT id,phase,state
        FROM orchestrator_commands
        WHERE task_id=? AND state IN ('queued','claimed','running')
        ORDER BY sequence LIMIT 1`).get(task.id);
      const running = this.database.prepare(`SELECT r.id,r.phase FROM runs r
        JOIN sessions s ON s.id=r.session_id
        WHERE s.task_id=? AND r.state='running'
        ORDER BY r.started_at LIMIT 1`).get(task.id);
      if (activeCommand || running) {
        return {
          taskId: task.id,
          revision: task.revision,
          action: "wait",
          reason: "phase_active",
        };
      }
      const openDecision = this.database.prepare(`SELECT id FROM decision_gates
        WHERE task_id=? AND status='decision_required' LIMIT 1`).get(task.id);
      if (openDecision) {
        return {
          taskId: task.id,
          revision: task.revision,
          action: "stop",
          reason: "human_decision_required",
        };
      }
      const unresolvedDependency = this.database.prepare(`SELECT t.id FROM task_dependencies d
        JOIN tasks t ON t.id=d.depends_on_task_id
        WHERE d.task_id=? AND t.status<>'done' LIMIT 1`).get(task.id);
      if (unresolvedDependency) {
        return {
          taskId: task.id,
          revision: task.revision,
          action: "stop",
          reason: "unresolved_dependency",
        };
      }
      const outcome = this.taskPhaseOutcome(task.id, "test");
      if (!outcome.validation) {
        return {
          taskId: task.id,
          revision: task.revision,
          action: "schedule",
          phase: "test",
          reason: "validation_required",
        };
      }
      if (outcome.validation.status !== "passed") {
        return {
          taskId: task.id,
          revision: task.revision,
          action: "stop",
          reason: "validation_failed",
        };
      }
      if (!outcome.review) {
        return {
          taskId: task.id,
          revision: task.revision,
          action: "schedule",
          phase: "review",
          reason: "independent_review_required",
        };
      }
      return {
        taskId: task.id,
        revision: task.revision,
        action: "stop",
        reason: outcome.review.disposition === "approve"
          ? "completion_gate_pending"
          : `review_${outcome.review.disposition}`,
      };
    });
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

  recordHostGitRevision(operation) {
    if (!operation?.id || !operation.task_id || !operation.new_revision) {
      throw codedError("invalid_request", "a committed Git operation is required");
    }
    const idempotencyKey = `host-git-revision:${operation.id}`;
    const requestSha256 = sha256(JSON.stringify({
      operationId: operation.id,
      taskId: operation.task_id,
      runId: operation.run_id,
      workspaceId: operation.workspace_id,
      priorRevision: operation.prior_revision,
      newRevision: operation.new_revision,
    }));
    const priorEvent = this.database.prepare("SELECT * FROM audit_events WHERE idempotency_key=?").get(idempotencyKey);
    if (priorEvent) {
      if (priorEvent.request_sha256 !== requestSha256) {
        throw codedError("idempotency_conflict", "Git revision receipt identity changed");
      }
      return { replayed: true, event: this.parseAuditEvent(priorEvent), task: this.getTaskDetails(operation.task_id) };
    }
    const task = this.getTask(operation.task_id);
    if (!task) throw codedError("not_found", `unknown task: ${operation.task_id}`);
    const execution = this.commandExecutionForRun(operation.run_id);
    const operationCapability = this.database.prepare(
      "SELECT * FROM capabilities WHERE id=?",
    ).get(operation.capability_id);
    if (
      execution
      && (
        !operationCapability
        || operationCapability.execution_id !== execution.id
        || operationCapability.execution_generation !== execution.generation
        || !["starting", "running"].includes(execution.state)
      )
    ) {
      const identityProven = Boolean(
        operation.workspace_id === execution.workspace_id
        && operation.run_id === execution.run_id
        && operation.task_id === execution.task_id
      );
      const directDescendant = operation.prior_revision === task.revision;
      const proof = {
        eligible: identityProven && directDescendant,
        repositoryScopeProven: identityProven,
        executionGenerationFenced: true,
        directParentMatchesAuthoritativeRevision: directDescendant,
        operationReceiptId: operation.id,
      };
      const candidate = this.createRecoveryCandidate({
        executionId: execution.id,
        revision: operation.new_revision,
        baseRevision: task.revision,
        evidence: {
          operationId: operation.id,
          runId: operation.run_id,
          workspaceId: operation.workspace_id,
          capabilityId: operation.capability_id,
          priorRevision: operation.prior_revision,
          discoveredBy: "host_git_revision_guard",
        },
        proof,
        eligible: proof.eligible,
      });
      return {
        replayed: candidate.replayed,
        lateEvidence: true,
        candidate: candidate.candidate,
        task: this.getTaskDetails(task.id),
      };
    }
    const prior = this.getTaskDetails(task.id);
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const nextVersion = task.version + 1;
      const changed = this.database.prepare(`UPDATE tasks SET
        revision=?,validation_passed=0,requested_review_revision=NULL,merge_requested=0,
        version=?,updated_at=? WHERE id=? AND version=?`).run(
        operation.new_revision, nextVersion, now, task.id, task.version,
      );
      if (Number(changed.changes) !== 1) throw codedError("version_conflict", "task changed while recording Git revision");
      const current = this.getTaskDetails(task.id);
      const payload = {
        operationId: operation.id,
        runId: operation.run_id,
        workspaceId: operation.workspace_id,
        kind: operation.kind,
        priorRevision: operation.prior_revision,
        newRevision: operation.new_revision,
      };
      this.database.prepare(`INSERT INTO task_events(
        task_id,kind,actor,prior_status,new_status,payload_json,idempotency_key,created_at,
        actor_role,run_id,task_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id, "host_git_revision_recorded", "host-git-service", task.status, task.status,
        JSON.stringify(payload), idempotencyKey, now, "host", operation.run_id, nextVersion,
      );
      const inserted = this.database.prepare(`INSERT INTO audit_events(
        task_id,type,actor_id,actor_role,capability_id,run_id,prior_json,new_json,payload_json,
        idempotency_key,request_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        task.id, "host_git_revision_recorded", "host-git-service", "host",
        operation.capability_id, operation.run_id, JSON.stringify(prior), JSON.stringify(current),
        JSON.stringify(payload), idempotencyKey, requestSha256, now,
      );
      this.database.exec("COMMIT");
      return {
        replayed: false,
        event: this.parseAuditEvent(this.database.prepare("SELECT * FROM audit_events WHERE sequence=?").get(inserted.lastInsertRowid)),
        task: this.getTaskDetails(task.id),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  allowedTaskPhases(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    if (task.archived_at || task.task_kind !== "executable") return [];
    const busy = this.database.prepare(`SELECT 1 AS value FROM orchestrator_commands
      WHERE task_id=? AND state IN ('queued','claimed','running') LIMIT 1`).get(taskId)
      || this.database.prepare(`SELECT 1 AS value FROM runs r JOIN sessions s ON s.id=r.session_id
        WHERE s.task_id=? AND r.state='running' LIMIT 1`).get(taskId);
    if (busy) return [];
    const phases = [];
    if (["ready", "backlog"].includes(task.status) && !task.assigned_worker) phases.push("implementation");
    if (
      task.revision
      && task.requested_review_revision === task.revision
      && ["ready", "in_progress", "review"].includes(task.status)
    ) phases.push("test");
    if (
      ["ready", "review"].includes(task.status)
      && task.revision
      && task.requested_review_revision === task.revision
    ) phases.push("review");
    return phases;
  }

  taskWorkspaceProjection(taskId) {
    const task = this.getTaskDetails(taskId);
    if (!task) throw codedError("not_found", `unknown task: ${taskId}`);
    const runs = this.database.prepare(`SELECT
      r.*,s.task_id,s.model_provider,s.model_id,s.native_path,s.state AS session_state
      FROM runs r JOIN sessions s ON s.id=r.session_id
      WHERE s.task_id=? ORDER BY r.started_at,r.id`).all(taskId).map((run) => ({
        ...run,
        events: this.runEvents(run.id),
        workspace: this.workspaceForRun(run.id),
        git_operations: this.database.prepare(
          "SELECT * FROM git_operations WHERE run_id=? ORDER BY created_at,id",
        ).all(run.id).map((row) => ({ ...row, metadata: parseJson(row.metadata_json) ?? {} })),
        artifacts: this.artifacts(run.session_id).map((row) => ({
          ...row,
          metadata: parseJson(row.metadata_json) ?? {},
        })),
        context_receipts: this.database.prepare(
          "SELECT * FROM context_receipts WHERE run_id=? ORDER BY created_at,receipt_id",
        ).all(run.id).map((row) => ({
          ...row,
          filters: parseJson(row.filters_json) ?? {},
          method: parseJson(row.method_json) ?? {},
          ranked_sources: parseJson(row.ranked_sources_json) ?? [],
          exclusions: parseJson(row.exclusions_json) ?? [],
          injected_excerpts: parseJson(row.injected_excerpts_json) ?? [],
          receipt: parseJson(row.receipt_json) ?? {},
        })),
        side_effects: this.sideEffectsForRun(run.id),
        side_effect_receipts: this.sideEffectReceipts(run.id),
      }));
    return {
      task: {
        ...task,
        dispatch: this.taskDispatchProjection(taskId),
        activity: this.taskAudit(taskId),
      },
      allowed_phases: this.allowedTaskPhases(taskId),
      completion_evaluation: this.evaluateCompletion(taskId),
      commands: this.database.prepare(
        "SELECT * FROM orchestrator_commands WHERE task_id=? ORDER BY sequence",
      ).all(taskId).map((row) => ({
        ...publicOrchestratorCommand(row),
        execution: this.commandExecutionForCommand(row.id),
        events: this.orchestratorCommandEvents(row.id),
      })),
      executions: this.commandExecutions().filter((execution) => execution.task_id === taskId)
        .map((execution) => ({
          ...execution,
          events: this.executionEvents(execution.id),
          allowed_actions: this.allowedExecutionActions(execution),
        })),
      recovery_candidates: this.recoveryCandidates({ taskId }),
      runs,
      sources: this.database.prepare(
        "SELECT id,kind,source_ref,content,content_sha256,actor,created_at FROM source_snapshots WHERE project_id=? ORDER BY created_at,id",
      ).all(task.project_id),
      generated_at: this.clock(),
    };
  }

  board() {
    const rows = this.database.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, id").all();
    const columns = Object.fromEntries([...TASK_STATES].map((state) => [state, []]));
    const archived = [];
    const dispatchByTask = new Map();
    for (const projectId of new Set(rows.map((row) => row.project_id))) {
      for (const projection of this.readyDispatchCandidates(projectId)) {
        dispatchByTask.set(projection.taskId, projection);
      }
    }
    for (const row of rows) {
      const task = {
        ...row,
        archived: Boolean(row.archived_at),
        tags: parseJson(row.tags_json) ?? [],
        acceptance_criteria: parseJson(row.acceptance_criteria_json) ?? [],
        dispatch_model_route: parseJson(row.dispatch_model_route_json),
        dispatch: dispatchByTask.get(row.id) ?? {
          taskId: row.id,
          dispatchPolicy: row.dispatch_policy,
          priority: Number(row.priority),
          releasedAt: row.released_at,
          releasedBy: row.released_by,
          modelRoute: parseJson(row.dispatch_model_route_json),
          rank: null,
          eligible: false,
          blockers: row.dispatch_policy === "manual" ? ["manual"] : [],
        },
      };
      if (row.archived_at) archived.push(task);
      else columns[row.status].push(task);
    }
    return { columns, archived, generatedAt: this.clock() };
  }

  createSession({ id, taskId, nativePath, provider, model, parentSessionId = null }) {
    const now = this.clock();
    this.database
      .prepare(`INSERT INTO sessions(id,task_id,native_path,state,model_provider,model_id,parent_session_id,updated_at)
                VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  native_path=excluded.native_path,state='idle',
                  model_provider=excluded.model_provider,model_id=excluded.model_id,
                  updated_at=excluded.updated_at`)
      .run(id, taskId, nativePath, "idle", provider, model, parentSessionId, now);
    return this.getSession(id);
  }

  getSession(id) {
    return this.database.prepare("SELECT * FROM sessions WHERE id=?").get(id) ?? null;
  }

  createRun({
    id = randomUUID(), sessionId, processId = null, shellProcessId = null, containerId = null, imageId = null,
    workspaceId = null, credentialProfile = null, orchestratorId = null, phase = "implementation",
    executionId = null,
    promptProfileKey = null, promptProfileVersion = null, promptSha256 = null,
    modelProvider = null, modelId = null, thinkingLevel = null,
    modelPolicySource = null, billingClass = null,
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
        credential_profile,orchestrator_id,phase,prompt_profile_key,prompt_profile_version,prompt_sha256,
        model_provider,model_id,thinking_level,model_policy_source,billing_class,execution_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, sessionId, "running", processId, shellProcessId, this.clock(), containerId, imageId,
        workspaceId, credentialProfile, orchestratorId, phase,
        promptProfileKey, promptProfileVersion, promptSha256,
        modelProvider, modelId, thinkingLevel, modelPolicySource, billingClass,
        executionId,
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
