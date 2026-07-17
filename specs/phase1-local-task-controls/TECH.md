# Phase 1 local task controls — technical specification

Status: Approved for implementation

Last updated: 2026-07-17

## Context

The behavior contract is in [PRODUCT.md](./PRODUCT.md). The preceding
[`phase1-local-control-loop`](../phase1-local-control-loop/TECH.md) slice
provides durable orchestrator commands, but queueing a command does not claim
a ready task. The existing worker mutation path in
`phase0/direct/store.mjs:840` is capability-scoped and intentionally remains
agent-facing.

The local shell in `phase0/direct/control-plane.mjs` reads the board but has no
forms. `phase0/scripts/serve-direct.mjs` binds the selected local profile to
`127.0.0.1`.

## Proposed changes

### Owner task creation

Add a store operation that validates title/criteria, inserts a `ready` task,
and writes `task_created` task/audit events in one transaction. It accepts an
idempotency key and request hash. The API derives the initial revision from
the selected project's current Git `HEAD`; clients cannot forge it.

Expose `POST /api/projects/:projectId/tasks` in the loopback profile:

```json
{
  "title": "Implement the settings inspector",
  "acceptanceCriteria": ["The owner can save a provider choice."]
}
```

### Atomic owner scheduling

Add one store transaction for a `ready`/`backlog` task that:

1. verifies the task project and an active project-orchestrator lease;
2. creates a `start_task` command with its phase and idempotency receipt;
3. assigns a server-derived `task-agent:<phase>:<command-id>` identity;
4. moves the task to `in_progress` and increments its version; and
5. writes both command and owner task/audit lifecycle events.

Expose it as `POST /api/tasks/:taskId/schedule`. Direct low-level command
enqueue remains available for tests and already-claimed tasks.

The transaction does not mint a worker bearer token. The existing
`startTask()` boundary issues the run-scoped worker capability after the
orchestrator consumes the command.

### Local-profile guard

The control plane records the listen host and rejects owner mutation routes
unless it is one of the explicit loopback hosts used by the local profile.
Forwarded headers do not influence this decision.

### Cockpit controls

Add:

- a compact project/title/acceptance-criteria task form;
- a phase selector and schedule button on ready/backlog task cards;
- inline success/error status; and
- reload after a committed mutation so the board and command panel remain
  server-authoritative.

No chat input or transcript becomes part of this flow.

## Testing and validation

- Store/API integration covers creation validation, current-revision binding,
  create replay/conflict, scheduling phase validation, no-orchestrator
  rollback, atomic task/command results, and schedule replay/conflict
  (invariants 1–7).
- The command-loop consumer probe remains the execution-boundary test
  (invariant 8).
- HTML/browser smoke checks the create form, phase controls, and absence of a
  chat-first interaction (invariants 1, 4, and 9).
- Existing task-policy, context-custody, foundation, and restart probes remain
  regression checks.

## Parallelization

Parallel agents are not used. The store transaction, two routes, UI controls,
and integration probe are one tightly coupled vertical slice.

## Risks and mitigations

- **Partial scheduling:** one immediate SQLite transaction owns the task,
  command, and both event records.
- **Forged repository revision:** the server resolves Git `HEAD`.
- **Accidental remote mutation:** owner routes check the selected listener
  profile, not client-controlled forwarding headers.
- **Duplicate actions from browser retries:** both mutations require
  idempotency keys generated once per user action.

