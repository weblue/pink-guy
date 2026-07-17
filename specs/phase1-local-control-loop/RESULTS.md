# Phase 1 local control loop — implementation results

Status: First Phase 1 slice implemented

Last updated: 2026-07-17

## Delivered

- additive SQLite command and command-event records;
- idempotent, task/project-scoped `start_task` enqueue;
- active-lease, project-scoped FIFO claim;
- structured `succeeded` and `failed` completion;
- `reconciliation_required` on lease release or expiry, with automatic replay
  disabled;
- loopback API routes for queue, claim, completion, and listing;
- one-at-a-time command consumption by the project-orchestrator process;
- implementation/test/review phase forwarding to the existing session-start
  boundary; and
- recent-command visibility in the task-first local cockpit.

## Verification

The following checks passed on the M1 Max development host:

```text
node --check phase0/direct/store.mjs
node --check phase0/direct/control-plane.mjs
node --check phase0/scripts/project-orchestrator.mjs
node --check phase0/scripts/probe-phase1-command-loop.mjs
node phase0/scripts/probe-phase1-command-loop.mjs <fixture>
node phase0/scripts/probe-direct-task-policy.mjs <fixture>
node phase0/scripts/probe-direct-context-custody.mjs <fixture>
node phase0/scripts/probe-direct-foundation.mjs <fixture>
node phase0/scripts/probe-direct-restart-reconciliation.mjs <fixture>
```

The Phase 1 probe makes no provider request and starts no task container. It
uses a real temporary central API/SQLite store plus a deterministic fake
execution endpoint to prove both consumer success and consumer failure.

The two container-backed regression probes used the pinned ARM64 image
`boss-man-phase0:pi-0.80.9-rtk-0.42.3` at image ID
`sha256:7669de2c3791c662a1f59094ad31ff018178de20e843d3485c5796d545688074`.

## Remaining Phase 1 boundary

The follow-up `phase1-local-task-controls` slice now creates tasks and
atomically assigns/starts ready work from the cockpit. Task detail editing,
dependencies, reconciliation controls, persistent PTY, and workspace
inspectors remain.
