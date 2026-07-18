# Deterministic Ready scheduler — proposed technical specification

Status: Proposed for owner approval

Last updated: 2026-07-18

## Context

The behavior contract is in [PRODUCT.md](./PRODUCT.md).

The current system is deterministic after implementation starts:

- `Phase0Store.scheduleOwnerTaskRun()` atomically transitions a task and
  creates one command;
- `scripts/project-orchestrator.mjs` deterministically claims FIFO commands
  and invokes the phase runtime; and
- `automaticPipelineDirectives()` derives test/review/completion from fixed
  revision evidence without an LLM.

Initial Ready selection is still an explicit owner or conversational-
orchestrator schedule tool call. That makes queue popping a model decision and
leaves priority/capacity behavior implicit.

## Proposed changes

### Durable dispatch fields

Add task fields:

- `dispatch_policy`: `manual | automatic | paused`, default `manual`;
- `priority`: bounded integer, default `0`;
- `released_at` and `released_by`; and
- optional `dispatch_model_route_json` validated through the existing route
  policy.

Add audited, versioned owner/orchestrator mutations for release, pause,
manualize, and priority/route changes. The orchestrator Pi tool may release
only its scoped project task; the store remains the authority.

### Scheduler projection and transaction

Add `readyDispatchCandidates(projectId)` as a pure ordered projection over
canonical task/dependency/decision/command/run state. It returns candidates
and explicit blocker codes.

Add `dispatchNextReadyTask()` as one immediate SQLite transaction that:

1. re-evaluates ordered eligibility;
2. enforces configured global/project capacity;
3. resolves the pinned/default implementation route;
4. calls the same internal task/command transition used by manual scheduling;
   and
5. records scheduler source, priority, release identity, queue rank, route,
   and capacity receipt.

Idempotency is based on task ID, task version, release timestamp, phase, and
revision. The transaction selects at most one task per invocation.

### Trigger and recovery

Run the scheduler:

- after task release, phase settlement, recovery, dependency/decision
  resolution, lease acquisition, and capacity release; and
- before each project command claim as a restart/crash reconciliation path.

No background broker is required for Phase 1. A low-frequency model-less
reconciliation tick may be added only to recover from missed host events; it
derives the same idempotent transaction.

Generalize the existing automatic phase coordinator so initial implementation
dispatch and later test/review continuation share route, capacity, blocker,
audit, and idempotency primitives without sharing eligibility rules.

### Surfaces

- Project/task APIs expose dispatch policy, priority, release data, rank, and
  blockers.
- Conversation task mutations add `release`, `pause_dispatch`,
  `manualize_dispatch`, and `set_priority`.
- Cockpit task cards show `Auto #N`, `Manual`, or `Paused` and the primary wait
  reason.
- Terminal/API controls mirror those mutations.
- The current manual phase action remains an explicit recovery/override path.

## Testing and validation

- Model-less store/API probes cover migration-to-manual, release validation,
  deterministic priority/FIFO/ID order, dependencies/decisions, lease and
  capacity waiting, route validation, pause/manualize, idempotency, competing
  dispatchers, and restart reconciliation (PRODUCT 1–10, 13–14).
- Extend the workflow observer to start from several released Ready tasks and
  prove one deterministic implementation → test → review flow (PRODUCT 5,
  8–11).
- Add cockpit/terminal parity assertions for rank and blockers (PRODUCT 12).
- Repeat the `inspector-gadget` maintenance shape with two released tasks and
  verify the LLM is not called between release and implementation spawn.

## Parallelization

Parallel agents are not proposed for the first implementation. Schema,
eligibility projection, atomic scheduling, phase continuation, and concurrency
tests are one state-machine boundary and should land as one coherent slice.

## Risks and mitigations

- **Accidental execution of stale planning records:** migration/default is
  manual; only explicit release makes a task eligible.
- **LLM still controls queue order:** release does not choose order; bounded
  priority plus stable release time/ID does.
- **Capacity races:** selection and command creation occur in one immediate
  transaction against recorded active claims.
- **Starvation:** rank and wait reasons are visible; later aging policy requires
  measured evidence rather than an implicit heuristic.
- **Duplicate work after restart:** deterministic idempotency and reconciliation
  reuse the existing no-replay command boundary.
