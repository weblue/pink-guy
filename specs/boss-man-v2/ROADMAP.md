# Boss Man v2 delivery roadmap

Status: Active

Last updated: 2026-07-17

This is the canonical phase sequence. Phase 0 research artifacts remain useful evidence, but they no longer make remote authentication or second-host reproduction prerequisites for local product development.

## Operating profiles

| Profile | Intended access | Listener | Application authentication |
|---|---|---|---|
| Local smoke | Browser and tools on the Boss Man Mac | Loopback only | None |
| Trusted LAN development | Explicitly selected private LAN interface and allowlisted private CIDRs | Private address only; never a public wildcard | None initially |
| Remote | SWAG HTTPS subdomain or another explicitly approved remote edge | Private upstream reachable only from the trusted proxy/LAN | Required |

The application must select a profile explicitly at startup. It must not decide that a request is “local” merely from an untrusted `X-Forwarded-For` header. Enabling remote exposure is a human-approved deployment change.

## Phase 0 — foundation and local smoke

Status: Complete

Purpose: prove the hard architectural seams and produce a locally runnable operator shell.

Completed outcomes:

- direct Pi foundation selected over an Agent of Empires fork;
- authoritative task/policy transactions;
- daemon-owned containers, worktrees, Git capabilities, credentials, and RTK evidence;
- conservative restart/side-effect reconciliation;
- atomic model-less context custody and governed FTS retrieval;
- central multi-project API, one active orchestrator lease per project, and phase-scoped task runs;
- exact localhost run instructions and browser smoke of the operator shell.

Phase 0 does not require application authentication because its runnable profile binds to loopback. The disposable remote-edge/auth probe remains research evidence, not a local closure gate. Second-host reproduction is moved to Phase 2 portability work.

## Phase 1 — useful local-first developer cockpit

Purpose: make Boss Man useful for daily development on the host and, when explicitly enabled, a trusted LAN.

Active slice: [`../phase1-local-control-loop/PRODUCT.md`](../phase1-local-control-loop/PRODUCT.md)
and [`../phase1-local-control-loop/TECH.md`](../phase1-local-control-loop/TECH.md)
define the durable project-orchestrator command loop that began this phase.
The completed local task-control slice is
[`../phase1-local-task-controls/PRODUCT.md`](../phase1-local-task-controls/PRODUCT.md)
and [`../phase1-local-task-controls/TECH.md`](../phase1-local-task-controls/TECH.md).
The next proposed slice is
[`../phase1-orchestrator-conversations/PRODUCT.md`](../phase1-orchestrator-conversations/PRODUCT.md)
and
[`../phase1-orchestrator-conversations/TECH.md`](../phase1-orchestrator-conversations/TECH.md);
its durable topic/intake scope requires owner approval before implementation.

Scope:

- project-orchestrator command queue, scheduling, heartbeat-loss handling, and task-agent lifecycle;
- topic/project orchestrator conversations as the primary task-ingress path,
  including new-project discovery, repository intake, and read-only external
  work-item snapshots;
- usable project/task creation, editing, assignment, dependencies, attention queue, and phase selection;
- persistent PTY with resize, reconnect, scrollback, and tmux/cmux attach information;
- task workspace with diffs, tests, review, artifacts, context snapshots, decisions, and raw evidence;
- host-owned checkpoint/commit operations and manual merge preparation;
- local provider/model selection and current run/resource observability;
- desktop browser tests and local smoke runbook;
- explicit trusted-LAN listener profile with interface/CIDR validation and a clear “no application auth” warning.

Exit: the owner can start or reopen a scoped orchestrator conversation, turn a
new idea or existing repository/ticket into observable tasks, manage multiple
repositories, and complete an implementation → test → review workflow from
the local cockpit without editing SQLite or calling internal probe helpers.

## Phase 2 — autonomy, recovery, and portability

Purpose: make unattended local operation dependable before adding a public edge.

Scope:

- policy-governed merge/rebase/push, conflict handling, and worktree cleanup;
- orchestrator restart recovery, paused-session resume, and uncertain-effect resolution UX;
- retention deletion, quotas, backup/restore, encryption expectations, and storage-pressure behavior;
- provider failure drills, manual safe-boundary switching, and optional paid fallback decision;
- measured global/per-project concurrency and host-pressure limits for the 64 GB M1 Max;
- clean second-ARM64-host reproduction and migration rehearsal;
- security review of terminal, artifact, capability, and trusted-LAN boundaries.

Exit: local operation survives application/host restarts, preserves audit/context custody, and has measured resource and recovery policies.

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

Exit: all requests through the remote profile require a valid owner session or API key, while local and trusted-LAN profiles remain operationally independent.

## Deferred beyond Phase 3

- team accounts and multi-tenant authorization;
- public registration;
- automatic OpenRouter failover unless Phase 2 measurements justify it;
- semantic/vector/graph memory beyond the rebuildable FTS baseline;
- Slack/email notifications;
- a second public SSH/router path to the Mac.
