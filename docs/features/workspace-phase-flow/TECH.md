# Workspace inspectors and phase flow

Status: Approved for Phase 1 implementation

Last updated: 2026-07-18

## Design

The SQLite control plane remains authoritative. A phase command is the durable
unit of orchestration; it succeeds only after the task Pi process settles and
its evidence is ingested. The project daemon asks the control plane to execute
the command with `execute: true`, and the control plane starts the run, sends a
constant-size kickoff, exports context, then stops the container in a
`finally` block.

Task agents recover their scope through `boss_task_get`; the orchestrator does
not resend conversation history or task context in the kickoff.

## Fixed-revision custody

`HostGitService.createWorkspace` resolves the task's recorded revision and
creates the run branch from that commit. A checkpoint is still created by the
host service from writable worktree content and immutable capability/run
identity. After the Git operation receipt is durable, the store applies an
idempotent `host_git_revision_recorded` mutation:

- `tasks.revision` becomes the operation's `new_revision`;
- validation, requested-review revision, and merge-request flags are cleared;
- task and audit events link the Git operation, run, workspace, prior
  revision, and new revision.

Replayed or restart-reconciled Git operations use the same receipt identity,
so task revision advancement is also replay-safe.

## Phase authority

- implementation: existing `worker` capability, assigned implementation actor,
  Git reads and checkpoint/commit requests;
- test: new `validator` capability, read/progress/block/record-validation and
  Git reads only;
- review: existing `reviewer` capability, read/submit-review and Git reads.

The store verifies that validator capabilities reference a persisted run whose
phase is `test`. Review independence continues to compare reviewer identity
with the assigned implementation actor.

## Scheduling state machine

`scheduleOwnerTaskRun` becomes phase-aware:

- implementation claims an unassigned ready/backlog task and moves it to
  `in_progress`;
- test requires a current revision and an active task state, retaining the
  implementer assignment and task status;
- review requires `status=review` and
  `requested_review_revision=revision`, retaining the implementer assignment.

All phases reject scheduling when the task already has a queued/claimed command
or running session. Each schedule action increments task version and records a
phase-specific audit event without pretending that test/review owns the task.

## Inspector projection

`GET /api/tasks/:id/workspace` is a loopback-owner endpoint. The store produces
the relational projection (task, commands, sessions, runs, workspaces, Git
operations, validations, reviews, decisions, source snapshots, run events,
artifacts, and side-effect receipts). The control plane enriches each existing
workspace with host-verified status, revision, and diff. Per-workspace read
errors are returned as explicit inspector errors so one stale worktree cannot
hide the remaining evidence.

The existing task detail view loads this endpoint on selection and renders
compact phase, revision, diff, validation, review, context, and artifact
sections. Schedule controls are derived from server-provided allowed phases,
not hard-coded board status.

## API and tools

- `GET /api/tasks/:id/workspace`
- `POST /api/tasks/:id/sessions` with `{ phase, execute: true }`
- Pi tool `boss_test_record_validation`

No remote owner API is introduced.

## Baseline

`npm run test:workflow` runs a model-less observer probe against the real store
and host Git service. It emits one concise line per authoritative transition
and a final JSON receipt. It asserts:

- implementation scheduling and actor assignment;
- provenance checkpoint and revision advancement;
- test scheduling, fixed-base workspace, and validation evidence;
- review scheduling, distinct identity, and approval;
- successful completion gating.

Live Docker/Pi validation remains a separate proportional smoke test because
the deterministic baseline must not consume provider quota.

After a settled review run, the control plane evaluates completion gates. If
they pass, it issues a one-minute, task-scoped orchestrator capability, records
completion and the merge-request receipt, and revokes the capability. A failed
test, non-approval, open decision, or dependency leaves the task open.
