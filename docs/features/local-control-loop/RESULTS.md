# Phase 1 local control loop — implementation results

Status: Implemented; Phase 1 complete

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
node --check src/server/store.mjs
node --check src/server/control-plane.mjs
node --check scripts/project-orchestrator.mjs
node --check tests/probes/probe-phase1-command-loop.mjs
node tests/probes/probe-phase1-command-loop.mjs <fixture>
node tests/probes/probe-direct-task-policy.mjs <fixture>
node tests/probes/probe-direct-context-custody.mjs <fixture>
node tests/probes/probe-direct-foundation.mjs <fixture>
node tests/probes/probe-direct-restart-reconciliation.mjs <fixture>
```

The Phase 1 probe makes no provider request and starts no task container. It
uses a real temporary central API/SQLite store plus a deterministic fake
execution endpoint to prove both consumer success and consumer failure.

The two container-backed regression probes used the pinned ARM64 image now
tagged `boss-man:pi-0.80.9-rtk-0.42.3` at image ID
`sha256:7669de2c3791c662a1f59094ad31ff018178de20e843d3485c5796d545688074`.

## Subsequent Phase 1 closure

Later Phase 1 slices added task creation/editing, dependencies, reconciliation
controls, workspace inspectors, persistent Pi RPC conversation projection,
automatic test/review continuation, and deterministic initial dispatch. Phase
1 closed on 2026-07-18 after multi-repository dogfood and the live
automatic-release acceptance run. D-043 deliberately deferred a browser PTY;
tmux/SSH remains the exact-session fallback.
