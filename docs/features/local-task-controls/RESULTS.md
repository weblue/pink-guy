# Phase 1 local task controls — implementation results

Status: Implemented

Last updated: 2026-07-17

## Delivered

- loopback owner task creation with title and acceptance criteria;
- server-derived current repository revision;
- durable `task_created` owner audit;
- atomic task assignment, `in_progress` transition, and `start_task` enqueue;
- implementation/test/review selection on ready/backlog board cards;
- idempotent create and schedule operations with mismatch rejection;
- no-orchestrator and invalid-phase rollback without partial task state; and
- inline cockpit mutation status followed by server-authoritative reload.

## Verification

The model-less integration probe passed:

```text
node tests/probes/probe-phase1-local-task-controls.mjs <fixture>
```

It proves current-revision binding, acceptance-criteria preservation,
create/schedule idempotency, atomic rollback, task/command atomicity, owner
audit events, and the local-profile guard. It makes zero provider requests and
starts zero task containers.

A live browser smoke against `http://127.0.0.1:4310` also passed:

1. created `Browser smoke: inspect local task controls` with two acceptance
   criteria;
2. observed it in `ready` with a phase selector;
3. selected `test` and scheduled it;
4. observed task version 2 in `in_progress`;
5. observed a running managed session; and
6. observed the durable `start_task · test` command reach `succeeded`.

The live smoke used the pinned deterministic local task image and no external
provider request.

## Next product slice

The later dogfood-controls slice adds task detail, description/acceptance
editing, owner decision resolution, stop/resume, and explicit failed-command
reconciliation. Owner dependency editing and deeper workspace inspectors
remain. D-043 defers a persistent browser PTY.
