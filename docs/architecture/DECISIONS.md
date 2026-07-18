# Boss Man v2 decision log

Status: Active decision log

Last updated: 2026-07-18

This file separates owner direction, accepted working decisions, technical hypotheses that require spikes, and the remaining implementation questions.

## Decision register

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D-001 | Pi is the only supported harness; model providers remain pluggable. | Direction given | Reduces harness-specific state/tool ambiguity while preserving provider choice. |
| D-002 | The primary UI is a developer cockpit with task/session management, diffs, tests, context, review, artifacts, and a real terminal; chat is secondary. | Direction given | The original chat-first UI obscured development work and observability. |
| D-003 | The first release supports one human owner, not team accounts or public registration. | Accepted | “Something simple” preserves the needed agent roles without premature human RBAC/multi-tenancy. |
| D-004 | Native Pi JSONL is authoritative session evidence; a versioned deterministic bundle is the portable context format. | Accepted | Enables exact Pi resume and inspectable/model-switchable handoff without LLM dependency. |
| D-005 | A snapshot is mandatory before automatic compaction, model switch, fork/handoff, and provider continuation. | Accepted | Makes recovery a runtime invariant rather than a user habit. |
| D-006 | Sandcastle is removed. Container lifecycle is owned by the selected Boss Man foundation through a narrow, observable runtime boundary. | Validated Phase 0 decision | Avoids depending on a niche library and keeps lifecycle policy testable. |
| D-007 | Boss Man, not the model, owns worktree lifecycle, commits, and merges. | Accepted | Fixes unreliable Git tool/event behavior and centralizes provenance. |
| D-008 | Workers may update their assigned task, append progress, block it, create scoped child tasks, and request review. | Accepted | Gives agents enough authority for the board to reflect reality. |
| D-009 | An implementer cannot self-approve. A separate read-only reviewer reports on a fixed revision; after approval and required validation, the orchestrator may complete the task and create a merge request when no human-decision gate applies. Actual integration is a separate Phase 2 policy action. | Accepted | Preserves autonomous throughput while reserving high-risk or hard-to-reverse choices for the owner. |
| D-010 | SQLite remains the v1 task/audit database, with append-only events and versioned projections. | Validated Phase 0 decision | Fits one host and the existing product strengths. |
| D-011 | Provider/model selection is independent for every orchestrator and sub-agent. Manual safe-boundary switching is v1, and local models are first-class Pi routes. No automatic fallback service is assumed. | Accepted | Preserves model choice and context portability without adding a second routing authority. |
| D-012 | Claude remains available only as a paid model route in Pi unless verified behavior changes. | Verified provider constraint | Re-verified on 2026-07-17 against Pi 0.80.9: its provider documentation warns that Anthropic subscription authentication in a third-party harness draws paid extra usage per token rather than Claude plan limits. |
| D-014 | Containers are accidental-damage containment, not a complete malicious-code boundary. | Accepted boundary | Credentials and allowed network access remain exfiltration paths. |
| D-016 | RTK is enabled for Pi commands with a pinned binary, telemetry disabled, full raw-output teeing, per-run savings, and an explicit bypass. | Accepted | Reduces context use without sacrificing retained audit/debug evidence. |
| D-017 | Complete native sessions, tool results, raw command output, artifacts, and snapshots are retained until explicit project/session deletion. | Accepted | Lossless recovery and later human audit are primary requirements. |
| D-018 | The web UI is served at a dedicated HTTPS subdomain through the existing SWAG container on the home server. | Direction given | Reuses the established public edge and certificate/reverse-proxy setup. |
| D-020 | Tests are risk-based, not ceremonial: regression/unit coverage for isolatable behavior, integration coverage across meaningful boundaries, and an explicit reviewer-approved rationale when new tests add little value. | Accepted | Supports autonomous merge while keeping effort proportional and audit evidence useful. |
| D-021 | Canonical evidence, governed durable memory, and derived retrieval indexes are separate layers. | Validated Phase 0 decision | Prevents retrieval or summaries from becoming an unexportable source of truth. |
| D-022 | Boss Man owns the memory schema, scopes, capabilities, audit, and export contract even if a Pi extension supplies part of the implementation. | Validated Phase 0 decision | Keeps task authority and context custody coherent and makes dependencies replaceable. |
| D-024 | Agents propose durable memory; policy promotes it. Low-trust, global/identity, secret-like, inferred, or contested records never auto-promote. | Validated Phase 0 decision | Reduces cross-session prompt injection, false-memory accumulation, and privilege escalation. |
| D-025 | `pi-persistent-intelligence` is the leading memory spike candidate, not an accepted production dependency. | Deferred spike | Its JSONL/projection/patch model fits closely, but its age and adoption are not yet sufficient for a core guarantee. |
| D-026 | SWAG Basic Auth remains an outer non-local access gate; Boss Man also maintains its own single-owner authenticated device session for terminal and mutation access. | Superseded by D-036 | Authentication is deferred with all network exposure; Phase 1 remains loopback-only and Phase 3 defines the authenticated remote profile. |
| D-027 | Daily SSH recovery uses the existing key-only port 315 endpoint on the home server as a `ProxyJump` bastion to the Boss Man Mac over the LAN. A second router-forwarded Mac SSH port is deferred. | Accepted | Avoids another public host endpoint; direct IP SSH would bypass SWAG and normal Cloudflare HTTP protections. |
| D-028 | High-risk, long-lived, or hard-to-reverse architecture decisions require an explicit human decision. Agents investigate options, record evidence and an ADR proposal, then block instead of assuming. | Direction given | Architecture, security, data, dependency, and operational choices can outlive the task and are expensive to undo. |
| D-029 | Agents define a versioned secret/configuration contract with placeholders or references; the human supplies real values through deployment-owned secret storage. | Direction given | Keeps real credentials out of source, task text, model context, and durable artifacts while still making applications deployable. |
| D-030 | Agents may build deployment manifests and perform bounded ephemeral deployment tests, but the human owns long-term deployment, DNS, proxy, router, production credentials, promotion, rollback, and ongoing operation unless explicitly delegated for a named task. | Direction given | Separates development validation from persistent external side effects and operational ownership. |
| D-032 | Select the thin direct-Pi control plane as the v2 foundation and sole harness integration. | Accepted | Approved by the human owner on 2026-07-16. Historical foundation comparisons remain under `docs/history/phase0/`; they are not active product options. |
| D-033 | For the C0-02 proof and bounded live smoke, copy an owner-managed provider credential snapshot into private per-run Pi state, mount the source read-only, and limit OAuth profiles to one active run; do not reconcile refresh mutations automatically. | Validated Phase 0 decision | Synthetic isolation and one owner-authorized OpenAI Codex turn pass without exposing shared writable auth state. Parallel OAuth runs remain disabled until an independently verifiable refresh strategy is proven. |
| D-034 | After daemon loss, recover only side effects whose identity and completion are independently provable; pause verified idle runs and require explicit reconciliation for uncertain provider or tool effects instead of replaying them. | Validated Phase 0 decision | C0-03 proves container identity/liveness checks, native-byte preservation, checksum snapshot recovery, provenance Git recovery, and zero tool/commit duplication without claiming in-flight Pi RPC reattachment. |
| D-035 | One central Boss Man API is the durable authority across projects. Each project may hold one active orchestrator lease, represented by a daemon or tmux-backed process, and may run multiple task subagents whose runs are each scoped to exactly one initial phase: implementation, test, or review. | Direction given | Allows cmux/tmux and SSH process management without splitting durable task/session authority, prevents competing project orchestrators, and makes subagent purpose visible in the audit model. |
| D-036 | Phase 1 is loopback-only. The next network-accessible profile is authenticated remote access through SWAG in Phase 3. | Direction given | Avoids an unauthenticated intermediate network mode and keeps public-edge work off the local cockpit critical path. |
| D-037 | Project orchestrators consume durable FIFO commands from the central API one at a time. A claimed command becomes reconciliation-required on lease loss and is never replayed automatically. | Validated Phase 1 decision | Extends the Phase 0 uncertain-effect policy to scheduling, keeps project scope and command history authoritative in SQLite, and avoids duplicate provider/tool side effects after process loss. |
| D-038 | A loopback owner schedule action atomically assigns a phase-scoped task agent, moves the task to `in_progress`, and queues one orchestrator command. Agent-originated task changes remain capability-scoped. | Validated Phase 1 decision | Prevents partial board/queue state while preserving the existing least-authority boundary for model-driven mutations. |
| D-039 | Model top-level intent as a first-class pre-project topic with a durable orchestrator conversation; do not create a fake task/repository or make repository-backed projects nullable merely to support discovery. | Accepted | Approved by the owner on 2026-07-17. Preserves existing project/task execution invariants while allowing new-project and prototype conversations before Git binding. |
| D-040 | Use one centrally leased system-intake orchestrator for unbound topic conversations, then transfer a snapshotted conversation to the one project orchestrator after repository binding. | Accepted | Approved by the owner on 2026-07-17. Separates pre-project discovery from project execution without creating one unmanaged authority or daemon per conversation. |
| D-041 | External work items are immutable, manually refreshed, generic read-only source snapshots with no synchronization or write-back contract. | Accepted | Provides provenance and private work-item intake without another external authority or always-on integration. |
| D-042 | Boss Man resolves and persists the provider, model, and thinking policy independently for every orchestrator and task-subagent run, including local-model routes, then supplies that selection when starting Pi. Agents cannot silently select a different route; later model changes use the safe-boundary snapshot policy. | Validated Phase 1 decision | Pi supports startup `--provider`/`--model` flags and RPC `set_model`; configured defaults, phase overrides, explicit orchestrator scheduling, effective-route verification, and persisted provenance are implemented without a routing intermediary. |
| D-043 | The primary orchestrator surface renders the persistent Pi RPC/session stream as structured conversation UI; Boss Man does not rebuild or resend history and does not build a browser terminal emulator for Phase 1. tmux/SSH remains an exact-session operational fallback, and an embedded terminal may be reconsidered only for workflows that cannot be expressed through Pi RPC and cockpit controls. | Accepted | Approved by the owner on 2026-07-17. Preserves Pi-native context and compaction, gives reconnectable browser UX without terminal-control coupling, and avoids repeating the original Boss Man context-resend failure. This refines D-002: a terminal remains an attach/recovery capability, not the authoritative orchestrator conversation transport. |
| D-044 | Current design contains no unauthenticated network listener, provider fallback service, external notification or ticket synchronization, fixed-service container orchestrator, semantic retrieval pipeline, or shared credential service. Reconsider an adapter only after a concrete dogfood failure. | Accepted | Keeps the one-owner system small while preserving direct Pi model routes, local models, host-owned dynamic Docker runs, canonical custody, and FTS retrieval. |
| D-045 | Independent review plus required validation may complete a task and create its merge request without human acceptance. Actual merge/rebase/push is Phase 2, defaults to prepare-only, and may become automatic per project/branch only after clean integration checks and no unresolved decision gate. | Accepted | Mandatory human acceptance adds ceremony but little evidence. Policy-governed integration materially improves throughput without granting blanket authority over risky changes. |

## Recorded deployment assumptions

1. The Boss Man Mac and SWAG home server are on the same LAN; SWAG proxies to a reserved LAN address.
2. SWAG terminates public TLS and proxies the dedicated subdomain, WebSockets, streams, and artifact transfers to the Boss Man origin. Each application has its own SWAG Basic Auth, normally challenged only for non-local source addresses.
3. The Boss Man origin is not directly exposed to the public internet.
4. The existing public SSH endpoint terminates on the home server at port 315 and is the preferred recovery/bastion path to the Mac, not web authentication.
5. The private key remains only on authorized client devices and is never mounted into agent containers.
6. The target Mac uses FileVault, has reliable power/network, and can run a supported container engine.
7. Agent containers cannot directly write the protected/default branch or shared Git control directory.
8. Exact cross-harness continuation is not required because Pi is the sole harness.
9. The most current upstream repositories, not absent local history, are the source baseline. This workspace was empty when planning began.

## Resolved owner direction

### Q-008: SWAG authentication

SWAG uses a per-application Basic Auth gate, normally bypassed for local-source
traffic. It is not part of the local-first release. When Phase 3 enables the
remote profile, Boss Man will treat SWAG auth as an optional outer control and
add one simple owner mechanism: either a locally stored Argon2id password
verifier with HttpOnly device sessions or a locally stored API-key hash with
bearer authorization. Loopback requires no application authentication.
Browser `localStorage` is not the default credential store because same-origin
scripts can read bearer material.

### Q-009: network topology

The hosts share a LAN. SWAG proxies to the Mac's reserved LAN address. Public key-only SSH currently terminates on the home server at port 315, which becomes the normal `ProxyJump` bastion to a LAN-only Mac SSH listener. Do not open a second router port merely for convenience. If direct Mac SSH is later necessary, it is a separate human-approved network change with key-only auth, firewall restrictions, rate limiting, and its own audit; Cloudflare's ordinary DNS/HTTP proxy is not in the raw SSH path.

### Q-010: autonomous merge risk ceiling

Normal, reversible implementation work may complete and create a merge request
after independent review and required checks. Phase 2 may integrate it
automatically only when project/branch policy permits. A task stops for human
decision before selecting or applying a high-risk, long-lived, or
hard-to-reverse choice. Initial mandatory categories include public APIs and
durable schemas, authentication/authorization, secret and permission models,
network exposure, data-loss/destructive migrations, production
infrastructure, new paid/external services, licenses, retention changes, and
replacement of a major dependency or storage engine.

Agents may produce alternatives, prototypes, migration plans, threat models, and an ADR recommendation while blocked. The owner records the selected decision and any conditions; that record becomes task and governed-memory evidence.

## Remaining decision gates

- Detailed visual language after Phase 1 dogfooding exposes concrete
  navigation or evidence-density failures.
- Docker Desktop versus another compatible host engine.
- Cloud backup destination and retention encryption.
- Multi-host scheduling and high availability.
- Team accounts and public registration.
- A second router-forwarded SSH port directly to the Mac.
