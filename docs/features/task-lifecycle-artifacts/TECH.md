# Task lifecycle and planning artifacts

Status: Approved for Phase 1 implementation

Last updated: 2026-07-18

## Context

`src/server/store.mjs` currently uses one `status` column for execution and
projects every retained row into the six-column board. `scheduleOwnerTaskRun`
only checks status/assignment, so the bootstrap intake task and parents created
by `split` look executable. `createConversationTask`,
`mutateConversationTask`, the loopback task API, and
`src/pi/orchestrator-extension.ts` do not carry classification metadata.
`src/ui/cockpit.html` renders every retained task on the active board and has
no archive/restore surface.

The retained UI dogfood records demonstrate the failure: one completed child,
its ready umbrella parent, a superseded review-only child, and a repository
bootstrap task all appear as equivalent Ready work.

## Proposed changes

### Storage and compatibility classification

Add task columns:

- `task_kind TEXT NOT NULL DEFAULT 'executable'`
- `tags_json TEXT NOT NULL DEFAULT '[]'`
- `archived_at TEXT`
- `archived_by TEXT`
- `archive_reason TEXT`

The existing additive `ensureColumn` migration pattern remains sufficient.
After columns exist, a deterministic compatibility pass classifies tasks with
children as `umbrella` and stable `intake-%` seed records as `intake`. It does
not inspect titles or invoke a model.

`getTaskDetails` parses tags and exposes `archived` as a boolean while
retaining raw archive provenance.

### Validation and mutations

Central helpers validate:

- kind in `executable | umbrella | intake`; and
- at most 20 unique lowercase tags matching
  `[a-z0-9][a-z0-9._-]{0,49}`.

Owner create/update and conversational create/update accept kind/tags.
`split` updates the parent kind to `umbrella` in the same transaction that
creates the executable child.

Add one shared store mutation,
`setTaskArchived({ taskId, archived, expectedVersion, reason, actor,
actorRole, idempotencyKey })`, behind separate archive and restore API/tool
actions. Both paths use optimistic versioning and task/audit events. Archive
rejects active commands/runs and `in_progress`/`review` tasks. Restore only
applies to an archived task and preserves its execution status.

Conversational task mutations add `archive` and `restore`, with task-scoped
project/lease authorization. Pi exposes dedicated structured tools so
archival never depends on prose parsing.

### Scheduling authority

`scheduleOwnerTaskRun`, `resumeOwnerTaskRun`, `allowedTaskPhases`, and
automatic phase reconciliation reject or omit archived/non-executable tasks.
The rejection occurs before command construction and side effects.

### Board and cockpit

`board()` returns:

- the existing active `columns`, excluding archived tasks; and
- an `archived` array containing retained archived projections.

The cockpit adds:

- kind and comma-separated tags to direct create and task edit forms;
- kind/tag chips on cards;
- a collapsed Archived artifacts section with count and retained-status cards;
- Archive with required reason and Restore controls in task detail.

Archived task selection continues to use the existing detail/workspace APIs.
Refresh logic considers both active columns and the archived projection.

### Project counts and context

Project `active_task_count` excludes archived rows. Conversation context
retains archived tasks with explicit lifecycle metadata so the orchestrator
can explain or restore them without losing provenance.

## Testing and validation

- Add a lifecycle probe covering Behavior 1–17:
  default/explicit kinds, tag normalization, split conversion, scheduling
  rejection without side effects, optimistic archive/restore, busy-state
  rejection, board separation, audit history, and archived project counts.
- Extend cockpit contract assertions for kind/tag inputs, archive/restore
  controls, and archived visibility (Behavior 6, 11, 13).
- Run `npm test`, `npm run test:workflow`, `npm run test:baseline`, and
  `git diff --check`.
- Restart the retained local database and verify deterministic classification
  of the three Ready records (Behavior 4, 18).
- Use normal loopback lifecycle APIs to tag/archive the superseded child and
  archive the umbrella/intake records; assert Ready is empty and all three
  remain inspectable under Archived (Behavior 8–12, 18).

## Risks and mitigations

- **Archival bypasses recovery:** disallow active statuses, commands, and runs.
- **Old rows become misclassified:** compatibility uses only stable structure
  (children and `intake-` identity), never title text.
- **Status/archive conflation:** keep archive metadata orthogonal and preserve
  status through restore.
- **Unbounded taxonomy:** constrain tags but keep them optional and
  authority-neutral.
- **Hidden history:** return archived records explicitly and keep all existing
  detail, audit, custody, and evidence relations intact.

## Parallelization

Parallel agents are not proposed. Schema migration, task transactions,
scheduler guards, Pi tools, board projection, and live retained-state
verification share one versioned lifecycle contract and are safer to implement
sequentially in one checkout.
