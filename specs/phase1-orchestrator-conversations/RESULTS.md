# Phase 1 orchestrator conversations — substrate results

Status: Durable conversation runtime and first cockpit workspace implemented;
custody and intake adapters remain

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
- a provenance-ready `task_origins` table for structured task mutations;
- persistent managed Pi RPC sessions with centrally assigned provider, model,
  and thinking level;
- one project daemon now consumes both task commands and conversation turns;
- real Pi startup requires an explicit credential source copied into private
  runtime-owned configuration rather than writable shared auth;
- `conversation_runs` with native session identity and no-history-resend
  evidence;
- sanitized, idempotent Pi lifecycle and text event projection for browser
  reconnect without persisting private reasoning;
- a narrow orchestrator extension that reads authoritative scope and creates
  project-bound tasks with exact turn provenance;
- explicit rejection of task creation from unbound topics; and
- corrected queue behavior so a second owner message is not stranded when the
  prior turn reports `waiting_for_owner`;
- a task-first browser cockpit with New topic and project Ask orchestrator
  entry points;
- a durable conversation composer and reconnect polling over Pi RPC event
  projections;
- owner/Pi turn lifecycle, structured task-change cards, and synchronized
  board/topic projections; and
- explicit tmux/cmux/SSH attach guidance without a browser terminal emulator.

## Verification

The model-less integration probe passes:

```text
node phase0/scripts/probe-phase1-orchestrator-conversations.mjs \
  /Users/ND139178/Documents/boss-man
```

It covers first-class unbound and bound topics, topic and turn idempotency,
central model assignment, ordered queueing, prevention of same-conversation
turn races, scope-isolated leases, reconnect history, lease-loss
reconciliation, provenance-linked conversation task creation, archival, and
rejection of new turns on archived topics. It makes no provider requests and
starts no task containers.

The managed-runtime probe also passes:

```text
node phase0/scripts/probe-phase1-conversation-runtime.mjs \
  /Users/ND139178/Documents/boss-man
```

It runs two turns through one fake persistent Pi RPC process, retains the
native session path, projects sanitized stream events, and proves that each
owner message is sent exactly once without reconstructing prior history. It
makes no provider requests.

The existing Phase 1 command-loop and task-control probes remain regression
gates.

The model-less cockpit contract probe passes:

```text
node phase0/scripts/probe-phase1-conversation-cockpit.mjs \
  /Users/ND139178/Documents/boss-man
```

The in-app browser flow also passed against disposable local state: project
Ask orchestrator created a bound topic, the owner turn appeared queued, a
simulated central orchestrator completion reconnected into the same
conversation, and its provenance-linked task appeared as a structured change
card.

An owner-authorized live Pi smoke test also passed through the integrated
project orchestrator and the retained local API state. Pi ran with
`openai-codex/gpt-5.4-mini` at `low` thinking, resumed the conversation's
native JSONL session, and returned a two-sentence project summary through the
same durable browser event projection. The run recorded 1,962 input tokens,
90 output tokens, 2,052 total tokens, and estimated cost `0.0018765`; its
`contextResend` receipt was `false`. The prompt forbade task mutation, and the
authoritative board remained unchanged. The orchestrator released its lease
and deleted its private credential copy on shutdown.

## Remaining in the approved slice

1. Expand structured, provenance-linked task mutations beyond create to
   update/split/dependency/assumption/decision operations.
2. Snapshot conversation custody before compaction, scope transfer, model
   switch, and provider continuation.
3. Add host-owned repository import/dedup and immutable manual/Jira source
   snapshots.
4. Add deeper source/decision/custody inspectors and task-change navigation.
