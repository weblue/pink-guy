# Deterministic Ready scheduler results

Status: Model-less implementation verified; one live release-flow dogfood remains

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

The probe makes zero provider requests. The full core suite now contains 14
model-less Phase 1 probes.

## Remaining evidence

Use the normal cockpit or orchestrator release tool on a small real repository
task and observe automatic implementation → test → review settlement. This is
an acceptance smoke for the integrated Pi tool and live daemon; it does not
require another scheduler design decision.
