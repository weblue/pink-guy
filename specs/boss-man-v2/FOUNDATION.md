# Boss Man v2 foundation assessment

Status: Draft for owner review

Last verified: 2026-07-16

Inspected Agent of Empires revision: [`7803b25451bc836ad40ad9ad9d5efad11de83764`](https://github.com/agent-of-empires/agent-of-empires/tree/7803b25451bc836ad40ad9ad9d5efad11de83764). The repository advertised v1.13.0 as its latest release at inspection time. Phase 0 execution is separately pinned in `PHASE0.md` so later upstream changes do not silently alter this assessment.

## Current verdict

Agent of Empires is a strong runtime and cockpit substrate, but it does not currently satisfy the Boss Man v2 product contract as an installed plugin or unchanged subordinate service.

It solves much of the expensive horizontal infrastructure: persistent agent processes, browser and TUI clients, mobile PWA behavior, real terminals, structured ACP rendering, worktrees, containers, diffs, artifacts, authentication, reverse-proxy protections, and active upstream maintenance. It does not solve the product's differentiating control-plane requirements: SQL task authority, dependency-aware board state, independent review and merge policy, human architecture gates, governed memory, deterministic Pi-native custody, restricted Git authority, or deployment boundaries.

The supported plugin API is too narrow to add those missing pieces cleanly. A Boss Man-on-AoE product would therefore be a meaningful core fork, not a theme, configuration preset, or ordinary plugin. That may still be worthwhile, but it must win a comparative Phase 0 spike against a thin direct-Pi implementation.

## What AoE actually owns

AoE is not only a frontend. One Rust binary contains an Axum HTTP/WebSocket backend, an embedded React PWA, a TUI, session/worktree/container lifecycle, tmux integration, detached ACP workers, plugin workers, authentication, and persisted state.

Relevant current behavior:

- The structured-view daemon owns detached ACP workers and a SQLite UI-event transcript. Workers can survive daemon restarts and reattach in flight.
- Terminal sessions remain tmux-backed. Session metadata is primarily stored in `sessions.json` with cross-process file locks.
- The TUI and daemon can both mutate session storage today. [Open issue #2734](https://github.com/agent-of-empires/agent-of-empires/issues/2734) proposes making the daemon the single lifecycle authority; that target architecture matches Boss Man, but it is not yet the current architecture.
- Pi runs through the community `pi-acp` adapter. AoE applies a protocol-version check, but unlike its Claude and OpenCode adapters it currently has no minimum `pi-acp` version or Pi-specific compatibility contract.
- AoE retains its ACP UI transcript in SQLite and can configure unlimited event-count retention, but this transcript is not the native Pi JSONL and has no model-less pre-compaction export invariant.
- The published HTTP API documents session creation, terminal-mode send, and terminal output. The web frontend uses a broader internal API, but those endpoints are not a stable external orchestration contract.

## Fit against the Boss Man specification

| Requirement area | Fit | Evidence and consequence |
|---|---|---|
| Remote browser cockpit, PWA, mobile triage | Strong | Existing React PWA, structured view, terminal, diff, reconnect, command palette, and phone layouts are directly reusable. |
| Persistent session fleet | Strong | Detached ACP workers and tmux sessions survive client disconnects; ACP workers can survive daemon restarts and in-flight turns. |
| Reverse proxy and owner authentication | Strong with configuration | `--behind-proxy`, allowed Host/Origin, secure cookies, passphrase/device sessions, rate limits, and step-up auth fit behind SWAG. Boss Man should retain inner app auth even when SWAG Basic Auth is the external gate. |
| Pi-only product | Partial | Pi is registered through `pi-acp`, but AoE is deliberately multi-harness. Hiding other agents is feasible; deleting their code would create unnecessary fork drift. |
| Pi-native exact resume and pre-compaction custody | Weak/unknown | AoE captures Pi session IDs, but ACP/UI events are not authoritative Pi JSONL. The blocking `session_before_compact` export path still needs proof through `pi-acp`. |
| Task graph, dependencies, readiness, board | Missing | AoE organizes sessions by repository/group and has triage metadata, not tasks or validated task transitions. Its own [competitor catalogue #1363](https://github.com/agent-of-empires/agent-of-empires/issues/1363) lists task gates and a Kanban board as capabilities AoE does not yet have. |
| Agent task mutations and independent review | Missing | No worker/task capability model, reviewer role, fixed-revision review artifact, acceptance criteria, or completion policy exists. |
| Human architecture decision gates | Missing | AoE has tool approvals and settings step-up, but not task-level irreversible-decision records or a policy that blocks agents pending a human architecture choice. |
| Platform-owned commits and merges | Conflicts | AoE creates worktrees, but sandboxed agents receive the project and required main Git metadata read-write. Agents can commit and, when credentials are provided, push. Boss Man requires host-owned Git mutations and restricted agent metadata. |
| Container isolation | Partial | Per-session containers, limits, and runtime adapters are valuable. Defaults share persistent agent auth directories read-write and mount complete Git metadata so Git works, which conflicts with least-privilege per-run credentials and Git custody. |
| Deterministic context export and governed memory | Missing | AoE has ACP replay, context primers, conversation search, and plugin event storage, but not the specified normalized export, context receipt, memory governance, or FTS-backed evidence contract. |
| Provider/model policy | Partial | ACP exposes model and rate-limit controls, including manual agent switching, but Boss Man's Pi-only billing-mode, spend, and safe-provider-switch policy is absent. |
| Developer diff and terminal surfaces | Strong | These are among AoE's best-aligned parts and expensive to reproduce at the same maturity. |
| Human-owned deployment and secret contract | Missing as workflow policy | AoE can pass environment variables and credentials, but it does not distinguish ephemeral test deployment from owner-operated long-term deployment or enforce placeholder-only secret configuration in generated projects. |
| Single lifecycle authority | Not yet | ACP workers are daemon-owned, but general session metadata still has TUI/daemon dual writers. Boss Man cannot build on the assumption that the AoE daemon already owns every lifecycle mutation. |

## Why an ordinary AoE plugin is insufficient

AoE's plugin system is thoughtfully capability-gated, versioned, and useful for badges, cards, columns, filters, settings, commands, notifications, per-session panes, and composer actions. It is not currently an application-extension framework.

The supported worker host API is limited to:

- plugin event publish/subscribe;
- session metadata get/set/compare-and-swap;
- session listing;
- the plugin's own configuration; and
- host-rendered UI-state slots.

It does not expose supported plugin calls for session creation, prompt submission, stop/resume, transcript replay, worktree/container lifecycle, diffs, Git mutations, authentication policy, or arbitrary REST routes. UI contributions are bounded host-rendered payloads; plugins cannot add an arbitrary full route such as `/projects/:id/board` or replace the session-first navigation model.

A separate Boss Man service could call AoE's HTTP endpoints, but that would create two lifecycle authorities and depend on internal, fast-moving web APIs for essential behavior. An iframe or plugin pane containing a second dashboard would also recreate the UI fragmentation this project is intended to remove.

## What a meaningful AoE fork would change

A credible product fork would keep AoE's proven session substrate and add Boss Man as first-class core modules:

1. Add the task/audit SQLite schema, task capability API, board routes, task workspace, attention model, reviewer workflow, and governed memory.
2. Make the daemon the sole authority for all session, task, workspace, container, and Git lifecycle mutations; the web and TUI become clients.
3. Add a Pi-only product allowlist without deleting upstream multi-agent implementations.
4. Add a Pi runtime contract around `pi-acp`: supported version pin, native session mapping, extension availability, exact resume/import, and blocking pre-compaction export.
5. Replace writable shared Git metadata with a host-owned Git service and agent-facing status/diff/checkpoint capabilities.
6. Replace shared read-write agent auth directories with owner-managed credential sources and per-run least-privilege delivery.
7. Add irreversible-decision, secret-contract, and deployment-authority policy to tasks and merge gates.
8. Extend the React information architecture from session-first to task-first while retaining AoE's terminal, structured timeline, diff, settings, and mobile components.

Those changes touch storage, server routes, lifecycle authority, container mounts, Git, ACP integration, and top-level navigation. Calling that work a plugin would obscure its actual maintenance cost.

## Long-term fork discipline

If AoE wins the foundation spike, the fork should be designed for upstream intake from the first commit:

- Preserve `upstream/main` and pin every Boss Man release to a reviewed upstream commit.
- Keep Boss Man code additive: new modules, migrations, routes, adapters, and React feature areas. Avoid broad renames or deleting non-Pi upstream code merely to simplify the product surface.
- Put the Pi-only experience behind an allowlist/product configuration so upstream agent additions do not repeatedly conflict.
- Upstream general-purpose prerequisites where possible: daemon-only lifecycle authority, plugin/full-page extension points, supported session-control APIs, restrictive mount modes, and a `pi-acp` compatibility floor.
- Keep upstream tests unchanged and green; add Boss Man contract and end-to-end suites beside them.
- Perform an upstream-sync rehearsal during Phase 0, not after months of development. Record changed files, semantic conflicts, resolution time, and whether conflicts cluster in the ACP supervisor, session storage, server router, or container/worktree core.
- Track a fork budget: most Boss Man behavior should live in new or clearly isolated files. If ordinary upstream releases repeatedly require reworking Boss Man's task schema, Pi custody, Git authority, or root navigation, the foundation has failed even if each merge is technically possible.

An acceptable fork is one where AoE remains recognizable and updateable as the runtime substrate while Boss Man is a coherent product layer. An unacceptable fork is a rewrite that retains AoE's name and dependency graph but replaces its storage, supervisor, router, sandbox, and frontend shell simultaneously.

## Phase 0 comparison

Do not start the product by declaring AoE the winner. Build two deliberately small spikes against the same acceptance fixture.

### Candidate A: bounded AoE product fork

- Add one real task and board route in the existing Axum/React application.
- Start a Pi-only structured session from that task through supported server code.
- Capture a native Pi JSONL snapshot through `pi-acp` before compaction.
- prove a platform-owned checkpoint while the agent cannot write the shared Git directory;
- inject a per-run test secret without mounting global Pi/auth state; and
- merge a representative upstream change set into the spike branch and measure the conflict surface.

### Candidate B: thin direct-Pi control plane

- Add the same task and board fixture to a minimal control plane.
- Start Pi through direct RPC, attach a real xterm-compatible workspace shell, and render the same structured event subset.
- Perform the same snapshot, Git, credential, proxy, and restart tests.
- Estimate the cost of reaching AoE-equivalent terminal, diff, mobile, and recovery quality rather than comparing only prototype line counts.

### Choose AoE only if

1. One daemon can own the full lifecycle without a second Boss Man supervisor.
2. Pi-native custody works without patching or forking `pi-acp` itself.
3. Git and credential restrictions can reuse AoE's container/worktree pipeline rather than duplicating it beside the original path.
4. The task-first UI and data model land mainly as isolated modules and routes.
5. A representative upstream sync is bounded and leaves the upstream test suite intact.
6. The retained AoE capabilities materially exceed the ongoing rebase and security-review burden.

If any of the first three conditions fail, use AoE as a source and UX reference under its MIT license rather than as the runtime foundation.

## Recommendation now

Change the working assumption from “fork AoE unless the spike fails” to “AoE and direct Pi are equal Phase 0 candidates.”

AoE deserves serious consideration because rebuilding its polished terminal, structured session, mobile, diff, authentication, and recovery behavior would be expensive. Its missing pieces, however, are exactly Boss Man's core identity, and its present extension boundary cannot carry them. A fork is justified only if the spike proves those additions can remain a maintained product layer instead of becoming a rewrite of AoE's core.
