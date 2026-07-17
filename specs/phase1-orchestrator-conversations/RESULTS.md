# Phase 1 orchestrator conversations — substrate results

Status: Durable topic/conversation substrate implemented; Pi runtime, intake
adapters, and cockpit remain

Last updated: 2026-07-17

## Delivered in this increment

- additive first-class `topics` and append-only `topic_events`;
- one durable orchestrator conversation per topic without fake projects or
  tasks;
- unbound `system_intake` and repository-backed `project:<id>` scopes;
- centrally assigned provider, model, thinking level, and model-policy
  projection on every conversation;
- idempotent, ordered owner turns with independent lifecycle state;
- ordered conversation events with reconnect cursors;
- additive system-intake/project orchestration leases;
- one active lease per scope and one active turn per conversation;
- scope-isolated turn claiming and structured completion;
- no-replay `reconciliation_required` handling when a lease is released or
  expires during a turn;
- topic create/list/open/archive and conversation turn/event local APIs; and
- a provenance-ready `task_origins` table for the structured task mutation
  increment.

## Verification

The model-less integration probe passes:

```text
node phase0/scripts/probe-phase1-orchestrator-conversations.mjs \
  /Users/ND139178/Documents/boss-man
```

It covers first-class unbound and bound topics, topic and turn idempotency,
central model assignment, ordered queueing, prevention of same-conversation
turn races, scope-isolated leases, reconnect history, lease-loss
reconciliation, archival, and rejection of new turns on archived topics. It
makes no provider requests and starts no task containers.

The existing Phase 1 command-loop and task-control probes remain regression
gates.

## Remaining in the approved slice

1. Run the claimed turn through a managed Pi planning session with the narrow
   orchestrator tool contract and no fixed question count.
2. Apply structured, provenance-linked task mutations through central
   capability checks.
3. Snapshot conversation custody before compaction, scope transfer, model
   switch, and provider continuation.
4. Add host-owned repository import/dedup and immutable manual/Jira source
   snapshots.
5. Add the New topic and Ask orchestrator cockpit surfaces plus browser
   coverage.
