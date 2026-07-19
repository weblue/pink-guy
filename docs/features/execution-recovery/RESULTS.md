# Execution recovery results

Status: Complete

Last updated: 2026-07-19

## Delivered

- One durable execution identity per accepted task-phase command.
- Short idempotent daemon acceptance and central asynchronous settlement.
- Generation-fenced capabilities and fence-before-stop recovery.
- Stable failure classes, activity timestamps, and restart reconciliation
  without automatic replay.
- Explicit stop, pause, resume, retry, cancel, and late-candidate owner actions.
- Dead-letter-style checkpoint quarantine with accept/reject, stale-task
  protection, and mandatory fresh validation/review.
- Shared cockpit and `pink` recovery-attention projection.
- Owner action receipt and mutation fence/resolution commit atomically, so a
  version race cannot retain a receipt for an action that never occurred.

## Model-less evidence

`npm run test:recovery` proves:

- concurrent/repeated starts produce one accepted execution and one launch;
- daemon/client transport cannot settle an execution-backed command;
- fencing revokes the accepted mutation generation;
- a post-fence checkpoint cannot advance task authority;
- accepting a proven candidate invalidates prior gates and makes fresh test
  work eligible;
- rejection retains evidence without changing the task revision;
- a stale owner action rolls back without a receipt or execution mutation; and
- accepted-before-run restart fails safely without replay.

The full `npm test` suite contains this probe plus the 15 Phase 1 regression
probes and starts no task container or provider request.

## Live acceptance

Both authenticated OpenAI Codex/gpt-5.4-mini drills passed on 2026-07-18:

1. The project daemon was stopped immediately after execution acceptance. The
   API-owned implementation remained active, settled successfully, and a
   replacement daemon completed automatic fixed-revision test, independent
   approval, and task completion without owner repair or SQLite edits.
2. `probe-phase2-live-late-checkpoint.mjs` paused at `git_after_commit`,
   applied the mutation fence, and produced a pending recovery candidate
   without advancing the task. Owner acceptance advanced only the revision;
   fresh test and review passed before the task reached Done.

The fenced implementation conservatively settled `reconciliation_required`
because its interrupted provider response remained uncertain. That is the
intended classification: accepting the proven Git candidate does not rewrite
the old execution as successful.
