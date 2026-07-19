# Boss Man v2 delivery roadmap

Status: Active

Last updated: 2026-07-18

This is the canonical phase sequence. Phase 0 research artifacts remain useful evidence, but they no longer make remote authentication or second-host reproduction prerequisites for local product development.

## Operating profiles

| Profile | Intended access | Listener | Application authentication |
|---|---|---|---|
| Local smoke | Browser and tools on the Boss Man Mac | Loopback only | None |
| Remote | SWAG HTTPS subdomain or another explicitly approved remote edge | Private upstream reachable only from the trusted proxy/LAN | Required |

The application must select a profile explicitly at startup. It must not decide that a request is “local” merely from an untrusted `X-Forwarded-For` header. Enabling remote exposure is a human-approved deployment change.

## Phase 0 — foundation and local smoke

Status: Complete

Purpose: prove the hard architectural seams and produce a locally runnable operator shell.

Completed outcomes:

- direct Pi foundation selected;
- authoritative task/policy transactions;
- daemon-owned containers, worktrees, Git capabilities, credentials, and RTK evidence;
- conservative restart/side-effect reconciliation;
- atomic model-less context custody and governed FTS retrieval;
- central multi-project API, one active orchestrator lease per project, and phase-scoped task runs;
- exact localhost run instructions and browser smoke of the operator shell.

Phase 0 does not require application authentication because its runnable profile binds to loopback. The disposable remote-edge/auth probe remains research evidence, not a local closure gate. Second-host reproduction is moved to Phase 2 portability work.

## Phase 1 — useful local-first developer cockpit

Status: Complete — accepted for supervised local development on 2026-07-18

Purpose: make Boss Man useful for supervised daily development on its host.

The completed local control-loop slice is
[`../features/local-control-loop/PRODUCT.md`](../features/local-control-loop/PRODUCT.md)
and [`../features/local-control-loop/TECH.md`](../features/local-control-loop/TECH.md);
these documents define the durable project-orchestrator command loop that
began this phase.
The completed local task-control slice is
[`../features/local-task-controls/PRODUCT.md`](../features/local-task-controls/PRODUCT.md)
and [`../features/local-task-controls/TECH.md`](../features/local-task-controls/TECH.md).
The active conversation slice is
[`../features/orchestrator-conversations/PRODUCT.md`](../features/orchestrator-conversations/PRODUCT.md)
and
[`../features/orchestrator-conversations/TECH.md`](../features/orchestrator-conversations/TECH.md);
its durable topic/intake scope was approved as D-039 through D-041 on
2026-07-17. Its additive topic/conversation store, local API, scoped leases,
managed persistent Pi RPC bridge, sanitized reconnect stream, and audited
create/update/split/dependency/assumption/decision task mutations are
implemented. The first New topic/Ask orchestrator workspace, conversation
stream, navigable change cards, and synchronized board projection are also
implemented. The `boss` terminal client now reopens that same durable
conversation by topic, project, or repository and exposes the cockpit deep
link plus orchestrator tmux/process endpoint. Versioned agent prompts,
custody-backed model switching, repository/source intake, task detail and
owner reconciliation controls are also implemented. Deeper workspace
inspection, phase execution to settlement, fixed-revision test/review
handoffs, and the model-less workflow observer are implemented. Blocking
pre-compaction custody, atomic intake-to-project transfer, independently
routed task phases, source-controlled plain-text prompts, deterministic
dogfood coverage, and one bounded provider/container smoke are implemented.
Automatic model-less implementation → test → review continuation is
implemented with deterministic restart reconciliation and explicit stop
conditions. Explicit executable/umbrella/intake task kinds, normalized tags,
and reversible archive/restore keep retained planning artifacts off the active
board. Activity-free managed imports can be safely removed through an audited
tombstone/quarantine workflow. The `doc-map` new-project and
`inspector-gadget` maintenance phase-flow runs are complete. Accepted D-046
now makes initial Ready selection and dispatch deterministic/model-less.
The closure smoke used a normal Pi-orchestrator release to prove integrated
model-less initial dispatch followed by test, independent review, and
completion at fixed revision
`392df1763419a143523dd3a9512f8371bc6a2de1`. The acceptance receipt and one
recovery defect are recorded in
[`DOGFOOD-PLAN.md`](DOGFOOD-PLAN.md) and the deterministic scheduler
[results](../features/deterministic-ready-scheduler/RESULTS.md).

Scope:

- project-orchestrator command queue, scheduling, heartbeat-loss handling, and task-agent lifecycle;
- deterministic model-less Ready selection using task state, dependencies,
  priority, leases, phase policy, and resource capacity; the LLM refines and
  proposes work but does not nondeterministically pop the runnable queue;
- topic/project orchestrator conversations as the primary task-ingress path,
  including new-project discovery, repository intake, and read-only external
  work-item snapshots;
- usable project/task creation, editing, assignment, dependencies, attention queue, and phase selection;
- persistent Pi RPC conversation reconnect plus tmux/cmux/SSH attach
  information; D-043 defers a browser PTY until a demonstrated workflow gap;
- task workspace with diffs, tests, review, artifacts, context snapshots, decisions, and raw evidence;
- host-owned checkpoint/commit operations and manual merge preparation;
- centrally assigned per-run provider/model selection, including local-model
  routes, and current run/resource observability;
- desktop browser tests and local smoke runbook.

Exit: the owner can start or reopen a scoped orchestrator conversation, turn a
new idea or existing repository/ticket into observable tasks, manage multiple
repositories, and complete an implementation → fixed checkpoint → test →
review workflow from the local cockpit without editing SQLite or calling
internal probe helpers. The workflow is proven on two real repositories and
orchestrator context is captured before compaction.

Adoption result: this is the earliest point where Boss Man should be preferred
for supervised local coding. Manual merge/recovery may remain acceptable, but
the full workflow must be dogfooded across multiple real repositories and a
direct coding client remains the emergency fallback.

## Phase 2 — autonomy, recovery, and portability

Status: Designing — execution recovery contract proposed

Purpose: make unattended local operation dependable before adding a public edge.

The delivery order and closure evidence are defined in
[`PHASE2-PLAN.md`](PHASE2-PLAN.md). The first blocking slice is the proposed
execution recovery [product contract](../features/execution-recovery/PRODUCT.md)
and [technical design](../features/execution-recovery/TECH.md).

Scope:

- policy-governed merge/rebase/push, conflict handling, and worktree cleanup;
- central ownership of accepted execution settlement, mutation fencing,
  paused-session resume, late-evidence resolution, and restart recovery;
- retention deletion, quotas, backup/restore, encryption expectations, and storage-pressure behavior;
- provider failure drills and switch recovery across configured direct Pi
  routes;
- measured global/per-project concurrency and host-pressure limits for the 64 GB M1 Max;
- clean second-ARM64-host reproduction and migration rehearsal;
- security review of artifact, capability, optional workspace-shell, and
  network boundaries.

Exit: local operation survives application/host restarts, preserves audit/context custody, and has measured resource and recovery policies.

Adoption result: this is the threshold for using Boss Man as the full-time
local coding environment instead of Codex. Routine work must not depend on
direct SQLite repair, manual artifact recovery, or a single irreplaceable
OAuth process.

## Phase 3 — authenticated remote access

Purpose: expose the mature cockpit through SWAG without making authentication a prerequisite for local development.

Scope:

- dedicated HTTPS subdomain through the existing SWAG host;
- trusted proxy, Host/Origin, WebSocket, streaming, upload, reconnect, and CSRF controls;
- one-owner authentication using a locally stored server-side secret contract:
  - password mode stores only an Argon2id verifier and issues Secure/HttpOnly/SameSite device sessions; or
  - API-key mode stores only a key hash and accepts the raw key through `Authorization: Bearer`;
- rate limiting, revocation/rotation, bootstrap, and recovery;
- outer SWAG Basic Auth retained as optional defense in depth;
- deployment/runbook artifacts, while the human continues to own DNS, SWAG, router, host service, and production secrets.

Raw passwords and API keys are never checked into Git, stored in SQLite task/context records, or placed in browser `localStorage` by default. A browser UI should use an HttpOnly session after password login. API clients should use an OS keychain, environment/secret file, or an in-memory/session-scoped key. Persisting a bearer key in browser `localStorage` may be offered only as an explicit convenience mode after an XSS/CSP review because any script running in that origin can read it.

Exit: all requests through the remote profile require a valid owner session
or API key, while loopback remains independently operational.

Adoption result: Boss Man is ready for its intended remote-first use through
the home-server SWAG edge.

## Deferred beyond Phase 3

- team accounts and multi-tenant authorization;
- public registration;
- a second public SSH/router path to the Mac.
