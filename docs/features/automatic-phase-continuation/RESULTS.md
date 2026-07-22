# Automatic phase continuation results

Status: Regression found in live dogfood; current-run evidence fencing pending

Last updated: 2026-07-22

Pink Guy now derives successful test and review transitions from canonical
SQLite task evidence after the first implementation schedule. Reconciliation
runs after command completion and before the next command claim, uses a
task/revision/phase idempotency key, and makes no provider request.

Phase settlement now requires authoritative output:

- implementation records a review request for the current fixed revision;
- test records passed or failed validation for that revision; and
- review records an independent disposition for that revision.

Missing output follows the existing failed-command path and blocks the task.
Failed validation, non-approved review, open decisions, unresolved
dependencies, blocked tasks, and active work do not advance automatically.
Untouched Ready tasks are not selected.

## Live dogfood regression

The Denver DSA website run showed that the implemented predicate is necessary
but not sufficient. A later implementation attempt inherited a task whose
prior revision already had a review request and failed validation. The new Pi
session stopped at context length after making uncommitted edits and emitted
no authoritative transition. `taskPhaseOutcome` nevertheless returned
`recorded: true` from the historical review request, so the command was marked
successful while the task remained assigned and no test/review continuation
was possible.

Closure requires a per-execution phase-evidence baseline (event sequence,
revision, or equivalent) and proof that the required transition was produced
by the current run. Context-length/compaction settlement with a dirty
workspace and no new checkpoint must be represented as incomplete/resumable,
not successful. The regression must also prove that a successful retry
supersedes earlier execution attention without deleting its audit history.

Verification:

- `npm test` — 11 probes passed, including the automatic-continuation probe;
- `npm run test:workflow` — fixed-revision implementation/test/review/completion
  observer passed;
- `npm run test:baseline` — deterministic baseline passed; and
- `git diff --check` — passed.

The local API, system-intake orchestrator, and project orchestrator were
restarted on the implementation branch. The project orchestrator reconciled
the retained Ready queue and correctly selected no implementation. The
follow-up task-lifecycle feature now classifies and archives the intake
placeholder, completed-work umbrella, and superseded review-only child while
retaining their history.
