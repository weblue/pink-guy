# Boss Man v2 decision log

Status: Draft

Last updated: 2026-07-16

This file separates owner direction, accepted working decisions, technical hypotheses that require spikes, and the remaining implementation questions.

## Decision register

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D-001 | Pi is the only supported harness; model providers remain pluggable. | Direction given | Reduces harness-specific state/tool ambiguity while preserving provider choice. |
| D-002 | The primary UI is a developer cockpit with task/session management, diffs, tests, context, review, artifacts, and a real terminal; chat is secondary. | Direction given | The original chat-first UI obscured development work and observability. |
| D-003 | The first release supports one human owner, not team accounts or public registration. | Accepted | “Something simple” preserves the needed agent roles without premature human RBAC/multi-tenancy. |
| D-004 | Native Pi JSONL is authoritative session evidence; a versioned deterministic bundle is the portable context format. | Accepted | Enables exact Pi resume and inspectable/model-switchable handoff without LLM dependency. |
| D-005 | A snapshot is mandatory before automatic compaction, model switch, fork/handoff, and provider continuation. | Accepted | Makes recovery a runtime invariant rather than a user habit. |
| D-006 | Sandcastle is removed. Container lifecycle is owned by the selected Boss Man foundation through a narrow, observable runtime boundary. | Proposed | Avoids depending on a niche library and keeps lifecycle policy testable. |
| D-007 | Boss Man, not the model, owns worktree lifecycle, commits, and merges. | Accepted | Fixes unreliable Git tool/event behavior and centralizes provenance. |
| D-008 | Workers may update their assigned task, append progress, block it, create scoped child tasks, and request review. | Accepted | Gives agents enough authority for the board to reflect reality. |
| D-009 | An implementer cannot self-approve. A separate read-only reviewer reports on a fixed revision; after approval and required validation, the orchestrator may complete and merge changes that do not cross a human-decision gate. | Accepted | Preserves autonomous throughput while reserving high-risk or hard-to-reverse choices for the owner. |
| D-010 | SQLite remains the v1 task/audit database, with append-only events and versioned projections. | Proposed | Fits one host and the existing product strengths. |
| D-011 | Provider/model selection and manual safe-boundary switching are v1; automatic OpenRouter fallback is deferred unless it proves nearly free after the abstraction exists. | Accepted | Context portability is essential; automatic paid routing is useful but not on the critical path. |
| D-012 | Claude remains available only as a paid model route in Pi unless verified behavior changes. | Proposed | Current Pi warns its Anthropic subscription auth incurs per-token extra usage. |
| D-013 | LiteLLM is deferred from v1. | Proposed | Pi already abstracts providers; an extra proxy adds operations and supply-chain exposure. |
| D-014 | Containers are accidental-damage containment, not a complete malicious-code boundary. | Proposed | Credentials and allowed network access remain exfiltration paths. |
| D-015 | Agent of Empires and a thin direct-Pi control plane are equal Phase 0 candidates. Fork AoE only if the product layer is bounded, one daemon owns lifecycle, and upstream intake remains practical. | Proposed spike | AoE solves valuable cockpit/runtime infrastructure, but its current plugin API cannot implement the Boss Man task, custody, Git, and policy contract. |
| D-016 | RTK is enabled for Pi commands with a pinned binary, telemetry disabled, full raw-output teeing, per-run savings, and an explicit bypass. | Accepted | Reduces context use without sacrificing retained audit/debug evidence. |
| D-017 | Complete native sessions, tool results, raw command output, artifacts, and snapshots are retained until explicit project/session deletion. | Accepted | Lossless recovery and later human audit are primary requirements. |
| D-018 | The web UI is served at a dedicated HTTPS subdomain through the existing SWAG container on the home server. | Direction given | Reuses the established public edge and certificate/reverse-proxy setup. |
| D-019 | Slack and email notifications are out of scope for v1. | Accepted | The in-product attention queue is sufficient initially. |
| D-020 | Tests are risk-based, not ceremonial: regression/unit coverage for isolatable behavior, integration coverage across meaningful boundaries, and an explicit reviewer-approved rationale when new tests add little value. | Accepted | Supports autonomous merge while keeping effort proportional and audit evidence useful. |
| D-021 | Canonical evidence, governed durable memory, derived retrieval indexes, and optional model-assisted intelligence are separate layers. | Proposed | Prevents a memory product, summary, or vector index from becoming an unexportable source of truth. |
| D-022 | Boss Man owns the memory schema, scopes, capabilities, audit, and export contract even if a Pi extension supplies part of the implementation. | Proposed | Keeps task authority and context custody coherent and makes dependencies replaceable. |
| D-023 | SQLite FTS5 is the required model-less retrieval baseline; embeddings, vector search, and knowledge graphs are optional and rebuildable. | Proposed | Supports offline recovery and predictable operations while leaving room to benchmark better recall. |
| D-024 | Agents propose durable memory; policy promotes it. Low-trust, global/identity, secret-like, inferred, or contested records never auto-promote. | Proposed | Reduces cross-session prompt injection, false-memory accumulation, and privilege escalation. |
| D-025 | `pi-persistent-intelligence` is the leading memory spike candidate, not an accepted production dependency. | Proposed spike | Its JSONL/projection/patch model fits closely, but its age and adoption are not yet sufficient for a core guarantee. |
| D-026 | SWAG Basic Auth remains an outer non-local access gate; Boss Man also maintains its own single-owner authenticated device session for all terminal and mutation access. | Accepted | Conditional edge auth is useful defense in depth but does not establish application identity or protect local-LAN access. |
| D-027 | Daily SSH recovery uses the existing key-only port 315 endpoint on the home server as a `ProxyJump` bastion to the Boss Man Mac over the LAN. A second router-forwarded Mac SSH port is deferred. | Accepted | Avoids another public host endpoint; direct IP SSH would bypass SWAG and normal Cloudflare HTTP protections. |
| D-028 | High-risk, long-lived, or hard-to-reverse architecture decisions require an explicit human decision. Agents investigate options, record evidence and an ADR proposal, then block instead of assuming. | Direction given | Architecture, security, data, dependency, and operational choices can outlive the task and are expensive to undo. |
| D-029 | Agents define a versioned secret/configuration contract with placeholders or references; the human supplies real values through deployment-owned secret storage. | Direction given | Keeps real credentials out of source, task text, model context, and durable artifacts while still making applications deployable. |
| D-030 | Agents may build deployment manifests and perform bounded ephemeral deployment tests, but the human owns long-term deployment, DNS, proxy, router, production credentials, promotion, rollback, and ongoing operation unless explicitly delegated for a named task. | Direction given | Separates development validation from persistent external side effects and operational ownership. |
| D-031 | RAG is a derived, governed retrieval layer for related tasks, memory, sessions, and artifacts—not the task store or memory authority. SQL and canonical records answer authoritative questions; FTS5 is the required baseline, and optional embeddings/vector indexes are rebuildable projections admitted only by measured benefit. | Accepted | Preserves exact task policy, provenance, model-less export, and recovery while allowing semantic discovery when lexical retrieval is insufficient. |
| D-032 | Select the thin direct-Pi control plane as the v2 foundation; retain Agent of Empires as a UI/runtime reference rather than a fork or runtime dependency. | Accepted | Approved by the human owner on 2026-07-16. Phase 0 proves the direct seams independently and stops AoE because fixing lifecycle authority and Git custody while adding the product layer crosses storage, server, sandbox, and navigation cores. See `PHASE0-RESULTS.md` and `ADR-FOUNDATION.md`. |

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

SWAG uses a per-application Basic Auth gate, normally bypassed for local-source traffic. Boss Man will treat this as an outer edge control and retain an application session of its own. The v1 inner mechanism should stay simple: one owner passphrase, Argon2id storage, secure device-bound session cookies, rate limiting, revocation, and SSH recovery. A later passkey/OIDC change is not required for the first release.

### Q-009: network topology

The hosts share a LAN. SWAG proxies to the Mac's reserved LAN address. Public key-only SSH currently terminates on the home server at port 315, which becomes the normal `ProxyJump` bastion to a LAN-only Mac SSH listener. Do not open a second router port merely for convenience. If direct Mac SSH is later necessary, it is a separate human-approved network change with key-only auth, firewall restrictions, rate limiting, and its own audit; Cloudflare's ordinary DNS/HTTP proxy is not in the raw SSH path.

### Q-010: autonomous merge risk ceiling

Normal, reversible implementation work may complete and merge after independent review and required checks. A task stops for human decision before selecting or applying a high-risk, long-lived, or hard-to-reverse choice. Initial mandatory categories include architecture/foundation forks, public APIs and durable schemas, authentication/authorization, secret and permission models, network exposure, data-loss/destructive migrations, production infrastructure, new paid/external services, licenses, retention changes, and replacement of a major dependency or storage engine.

Agents may produce alternatives, prototypes, migration plans, threat models, and an ADR recommendation while blocked. The owner records the selected decision and any conditions; that record becomes task and governed-memory evidence.

## Feasibility questions answered by spikes

1. Can Agent of Empires run Pi through a pinned `pi-acp` while retaining native Pi resume, extensions, context hooks, and a Pi-only product surface?
2. Can a bounded AoE core fork support the board, task workspace, context inspector, validation, and reviewer workflow mainly through isolated modules, and can it absorb a representative upstream update without architectural conflict?
3. Can `session_before_compact` block long enough for an atomic external snapshot through `pi-acp` and cancel cleanly on failure?
4. Can RTK retain complete raw output for all managed commands while providing reliable savings and filtered output to Pi?
5. Can the selected foundation enforce host-owned Git commits/merges and restricted common Git metadata?
6. Can multiple Pi sessions use subscription/OAuth-backed providers without corrupting refresh state, or is a credential broker required?
7. Does the SWAG path preserve structured streams, terminal WebSockets, large artifacts, secure cookies, Host/Origin controls, and reconnect behavior?
8. Can `pi-persistent-intelligence` be embedded or adapted while Boss Man remains the sole memory authority, and can it pass FTS-only export/import, scope, poisoning, and index-rebuild tests?
9. Can AoE's currently split TUI/daemon session authority be resolved for Boss Man without carrying a permanent private rewrite of its session store and lifecycle paths?

## Explicitly deferred choices

- Detailed visual language and component library, pending low-fidelity UI layouts.
- Docker Desktop versus OrbStack.
- Final fallback model identifiers and automatic OpenRouter routing.
- Cloud backup destination.
- External notifications.
- Multi-host scheduling and high availability.
- Organization-wide LiteLLM deployment.
- Semantic/vector/graph memory beyond the FTS5 baseline, pending a measured recall benchmark.
- Team accounts and public registration.
- Cross-harness session conversion.
- A second router-forwarded SSH port directly to the Mac.
