# Deterministic Ready scheduler results

Status: Implemented and verified by live release-flow dogfood

Last updated: 2026-07-18

## Implemented

- Existing and directly created tasks default to `manual`.
- Owners and the scoped Pi orchestrator can durably release, pause, manualize,
  and prioritize queued executable work.
- Release requires concrete acceptance criteria and refuses unresolved
  dependencies or protected decisions.
- The central scheduler selects `automatic` Ready tasks by priority descending,
  release time ascending, then task ID.
- Selection, capacity enforcement, task assignment, command creation, task
  event, command event, and audit event occur under one immediate SQLite
  transaction.
- Project command claims and successful command settlement reconcile missed
  work without a background LLM or broker.
- Cockpit cards and task detail show policy, priority, rank, and wait reason.
  `boss dispatch` provides the same mutations in a terminal.
- Direct phase scheduling remains an advanced recovery/override.

Phase 1 conservatively permits one active command per project and one globally,
matching the current single owner-authenticated execution lane. Phase 2
measures provider and host concurrency before widening those values.

## Verification

`probe-phase1-ready-scheduler.mjs` proves:

- migration to manual and release validation;
- priority, release-time, and task-ID ordering;
- pause behavior and visible lease/rank blockers;
- one command under competing claim requests;
- dispatch after capacity release; and
- reconciliation after an API restart.

The probe makes zero provider requests. The full core suite now contains 15
model-less Phase 1 probes.

## Live acceptance receipt

Task `94613637-58af-4ba5-ae4e-b03503bf5a54` was created and released through
the normal persistent Pi orchestrator conversation with automatic policy and
priority 10. The release event at `2026-07-18T22:03:55.734Z` was followed by
the scheduler event at `2026-07-18T22:03:55.736Z`, proving that the LLM did
not select or pop the runnable queue.

Implementation checkpointed
`392df1763419a143523dd3a9512f8371bc6a2de1`. Independent validation passed
the 15-probe core suite, independent review approved the same revision with no
findings, completion moved the task to Done, and merge request
`4c0eb5af-e68a-470f-8aba-0939320f2c17` was recorded. The resulting change was
merged as [PR #15](https://github.com/weblue/pink-guy/pull/15).

The implementation command's transport failed while its Pi run continued and
later emitted the accepted checkpoint. The owner used the normal stop and
reset controls before automatic validation/review settlement. This is a
Phase 2 recovery defect: command failure must cancel or quarantine the live
run, and late evidence must have an explicit reconciliation path.
