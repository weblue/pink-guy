# Phase 1 orchestrator conversations — substrate results

Status: Durable conversation runtime, shared browser/terminal clients, and
audited task-graph mutations implemented; custody and intake adapters remain

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
- explicit tmux/cmux/SSH attach guidance without a browser terminal emulator;
- a dependency-free `boss` terminal client that resolves topics by topic ID,
  project ID, or registered repository path and reuses the same project topic
  as the cockpit;
- interactive, piped, and one-shot terminal turns over the central API with
  durable history, structured task-change projection, model/scope identity,
  orchestrator lease status, and cockpit deep links;
- cockpit display of the same terminal command and live tmux pane/process
  endpoint;
- optimistic-versioned task title and acceptance-criteria replacement;
- one-child-per-call task splitting with parent/child origin records;
- same-project, cycle-free task dependencies that block scheduling and
  completion until finished;
- explicit low-risk task assumptions and protected owner decision gates; and
- direct change-card navigation back to the authoritative board.

## Verification

The model-less integration probe passes:

```text
node tests/probes/probe-phase1-orchestrator-conversations.mjs \
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
node tests/probes/probe-phase1-conversation-runtime.mjs \
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
node tests/probes/probe-phase1-conversation-cockpit.mjs \
  /Users/ND139178/Documents/boss-man
```

The in-app browser flow also passed against disposable local state: project
Ask orchestrator created a bound topic, the owner turn appeared queued, a
simulated central orchestrator completion reconnected into the same
conversation, and its provenance-linked task appeared as a structured change
card. A second disposable smoke rendered update and assumption cards from one
turn, refreshed the authoritative task to version 3, and focused that exact
board card through **Show on board**.

The model-less task-graph mutation probe passes:

```text
node tests/probes/probe-phase1-task-graph-mutations.mjs \
  /Users/ND139178/Documents/boss-man
```

It covers create, update, split, dependency, assumption, and protected-decision
operations through one leased conversation turn. It proves optimistic version
conflicts, exact turn provenance, split retry idempotency, cross-project
denial, dependency-cycle rejection, unresolved-dependency scheduling gates,
and a protected decision completion gate. It makes no provider requests and
starts no task containers.

The model-less terminal parity probe passes:

```text
node tests/probes/probe-phase1-terminal-client.mjs \
  /Users/ND139178/Documents/boss-man
```

It proves repository-based topic selection, shared topic identity, durable
history and structured task-change rendering, explicit offline lease status,
cockpit deep links, and second-turn queueing without a provider request.

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

Conversation custody for model switching, repository import/dedup, immutable
external-source snapshots, task detail, and owner decision resolution are now
implemented by later Phase 1 slices. Custody before orchestrator compaction
and scope transfer plus deeper source/decision/custody/workspace inspectors
remain.
