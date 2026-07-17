# Boss Man v2 product specification

Status: Draft for owner review

Last updated: 2026-07-16

## Summary

Boss Man v2 is a single-owner control plane for planning, running, observing, handing off, and resuming software-development work performed by Pi agents on an always-on Mac. Implementation is local-first; authenticated remote access is a later delivery phase.

The product is harness-specific and model-provider agnostic: Pi is the only supported agent harness, while each session may use any model provider supported by the configured Pi installation. The web dashboard is the primary interface. Chat remains available inside tasks and sessions, but is not the application's organizing metaphor.

The defining capability is lossless session custody. Boss Man preserves the complete Pi session and its artifacts without calling an LLM, including immediately before compaction. A user can resume the same session, fork a subagent with explicit context, or continue with another model after a limit or provider failure.

## Problem

The current Boss Man proves several useful ideas—SQL-backed task tracking, an agile board, containerized agents, and worktree-backed changes—but its product and runtime contracts are too implicit:

- The UI is organized around chat rather than work requiring attention.
- Discovery always asks about eight fixed topics instead of resolving only material ambiguity.
- Worker agents cannot safely report normal task progress or create scoped follow-up work.
- Container and branch lifecycle depend on Sandcastle and on agents emitting the right Git behavior.
- Conversation continuity is reconstructed from summaries and recent text rather than preserved as a portable, deterministic artifact.
- Provider selection and subscription assumptions are mixed into the harness configuration.
- Remote operation depends too heavily on terminal multiplexing and local client setup.

Existing session managers solve much of the terminal-fleet problem. Boss Man v2 should focus on the unsolved intersection: Pi-native task authority, deterministic context portability, and a dashboard that exposes the state of work.

## Goals

1. Make outstanding work and required human attention visible without opening chat transcripts.
2. Let authorized agents update task state through constrained, audited actions.
3. Run Pi sessions in isolated workspaces with centrally managed lifecycle and Git state.
4. Preserve complete session evidence and artifacts without an LLM.
5. Retain useful project knowledge as governed, inspectable memory without confusing it with raw session evidence.
6. Resume or fork work across Pi sessions and model providers with an explicit context contract.
7. Become usable remotely through a later authenticated developer cockpit served at a dedicated HTTPS subdomain, with SSH as a recovery path, without making that edge a prerequisite for local development.
8. Degrade clearly and recoverably when a model is rate-limited, unavailable, or out of credit.
9. Keep the first deployment understandable and maintainable by one owner on one Mac.

## Non-goals

- Supporting Claude Code, Codex CLI, or other agent harnesses in v2.
- Providing public multi-tenant SaaS hosting.
- Treating containers as a defense against a determined malicious agent with network access and credentials.
- Automatically merging unreviewed agent changes to a protected branch.
- Porting live sessions between unrelated harness formats.
- Building a general terminal multiplexer or replacing SSH.
- Requiring LLM-generated summaries for export, recovery, or audit.

## Figma

Figma: none provided; design exploration pending.

## Product model

The primary objects are:

- **Project:** a repository and its policies.
- **Task:** a unit of desired work with status, dependencies, ownership, and acceptance criteria.
- **Session:** a durable Pi conversation and context tree.
- **Run:** one period in which a session is actively executing.
- **Workspace:** the isolated filesystem and Git worktree assigned to work.
- **Artifact:** an exported file, context bundle, log, patch, screenshot, or other durable output.
- **Memory record:** a scoped, typed, provenance-linked claim such as a decision, convention, preference, lesson, or runbook.
- **Memory candidate:** a proposed durable record that has not passed its required governance policy.
- **Attention item:** a condition requiring a person to decide, approve, recover, or supply information.

A task can have multiple sequential runs and sessions. A session may be attached to a task, forked into a child task, or retained after a run stops. Task state is not inferred solely from process state.

## Behavioral requirements

### 1. Dashboard and navigation

1.1 The default page shows work requiring attention, active runs, blocked tasks, recent failures, provider availability, and project-level progress.

1.2 A user can move from the dashboard to a project board, task detail, session detail, run timeline, provider health, or artifact without navigating through a chat transcript.

1.3 Chat is presented as one interaction surface within a task or session, alongside status, context, artifacts, Git changes, tests, review evidence, terminal access, and run events. No primary route opens into chat by default.

1.4 A task workspace provides direct access to Overview, Changes, Tests, Review, Artifacts, Timeline, Conversation, and Terminal surfaces. The default surface is Overview or the last non-conversation surface used for that task.

1.5 The desktop interface supports a project/task/session navigator, a central work surface, and a resizable inspector. The inspector can show task state, context snapshots, validation, review, model, cost, and workspace status without obscuring the work surface.

1.6 A real interactive terminal is available for developer inspection and smoke testing. Terminal state survives browser navigation and reconnects, and the user can distinguish an agent terminal, a workspace shell, and a read-only captured log.

1.7 The Changes surface provides a changed-file tree, diff navigation, commit/checkpoint provenance, and review findings. The Tests surface shows commands, results, duration, raw output access, and which task acceptance criteria they cover.

1.8 The interface provides a command palette and keyboard navigation for switching projects, tasks, sessions, work surfaces, and terminal focus. Destructive or paid actions remain confirmable and are not triggered by single ambiguous shortcuts.

1.9 The interface remains functional on a phone-sized viewport for checking attention items, reviewing a task summary or diff, answering a question, pausing a run, and opening a full-screen terminal. Dense multi-pane layouts collapse into navigable single-pane views rather than shrinking unreadably.

1.10 When a configured browser IDE or external workspace client is available, the task workspace provides an explicit “Open workspace” action. Returning to Boss Man preserves the selected task and session.

### 2. Projects and readiness

2.1 A user can register a repository, select its default branch, and define project-level execution, model, retention, and Git policies.

2.2 Before starting work, the system identifies only unresolved facts that materially affect scope, validation, risk, or architecture.

2.3 The system may group related questions, but it must not require a fixed number or fixed taxonomy of questions.

2.4 A clear request can pass readiness without an interview.

2.5 When the system proceeds on assumptions, those assumptions are displayed and attached to the task. A user can correct them later without losing prior history.

2.6 Readiness is satisfied when scope, expected outcome, material constraints, and a validation method are sufficiently explicit for the requested level of autonomy.

2.7 The system may proceed with explicit, reversible, low-risk assumptions. A high-risk or hard-to-reverse uncertainty creates a typed `Decision Required` attention item and blocks the affected transition rather than allowing an agent to choose silently.

2.8 An agent may propose an ADR with alternatives, evidence, costs, and a recommendation. The human owner selects or rejects decisions that change the foundation, public contract, security boundary, durable data model, production infrastructure, or other protected category.

### 3. Task board and task authority

3.1 The project board supports at least Backlog, Ready, In Progress, Review, Blocked, and Done states.

3.2 Dependencies are visible. A task that has unresolved blocking dependencies cannot be claimed unless a human explicitly overrides it.

3.3 Every task mutation records who or what made the change, the associated run and session when applicable, the prior value, the new value, and a timestamp.

3.4 A worker assigned to a task may:

- claim or release that task;
- append progress and evidence;
- mark it blocked with a reason;
- create child tasks within its assigned scope;
- request review;
- propose that its task is complete.

3.5 An implementing worker may not approve its own work. Completion requires a separate reviewer session whose identity and context provenance are recorded.

3.6 A reviewer receives the task requirements, diff, validation evidence, and relevant artifacts in read-only mode. It reports findings, test gaps, residual risk, and one of: approve, request changes, or blocked.

3.7 After reviewer approval and required checks pass, and when no unresolved human-decision gate applies, the orchestrator may mark the task Done and request a platform-owned merge without human approval. The implementing worker cannot perform that transition itself.

3.8 A worker or reviewer may not silently close another unrelated task, change project policy, reassign unrelated work, bypass validation policy, or delete history.

3.9 A human can override any task state, pause autonomous merging, or reopen completed work and can see when the new state conflicts with agent, reviewer, or validation evidence.

3.10 One central Boss Man API manages every registered project. Each project can have at most one active orchestrator lease, whether its process is run as a daemon or in a tmux/cmux session.

3.11 A project orchestrator may run multiple task subagents concurrently when policy and host capacity allow it. Each subagent run is scoped to one recorded phase—initially implementation, test, or review—so its permissions, expected output, and evidence are unambiguous.

### 4. Session lifecycle

4.1 Starting a task creates or selects a durable Pi session and an isolated workspace.

4.2 A user can pause, stop, resume, fork, or archive a session without conflating those actions with task completion.

4.3 Reconnecting to the dashboard does not interrupt a run. Losing a browser connection does not lose session history.

4.4 A stopped or crashed run reports its final known process, provider, workspace, task, and artifact state.

4.5 A session can be opened in three explicit child-context modes:

- **Fresh:** instructions and referenced artifacts only.
- **Bundle:** a deterministic context bundle plus selected artifacts.
- **Fork:** the complete selected Pi session branch.

The selected mode is visible before the child starts and remains part of its provenance.

4.6 cmux, tmux, terminal clients, and SSH are attach and process-management transports. They do not become alternative task, session, lease, or artifact authorities; all durable changes pass through the central API.

### 5. Context custody and export

5.1 The complete native Pi session log is retained as the authoritative conversation evidence for that session.

5.2 The system produces a provider-neutral context bundle without calling an LLM. It includes, at minimum:

- schema and exporter versions;
- project, task, session, run, and parent identifiers;
- the selected conversation branch with user, assistant, tool-call, and tool-result records;
- model and reasoning-mode changes plus recorded usage;
- decisions, assumptions, open questions, and task state;
- referenced artifacts and checksums;
- workspace and Git checkpoint references;
- a checksum and location for the native Pi session.

5.3 Immediately before Pi compacts a session, the system atomically preserves the native pre-compaction session and a corresponding deterministic bundle.

5.4 The system also snapshots at the end of a turn, before a model switch, on a rate-limit or provider error, on fork or handoff, and on manual export.

5.5 Compaction and generated summaries are derived conveniences. They never replace or mutate the authoritative raw record.

5.6 An export can be inspected and copied without having the original model credentials available.

5.7 Export failure prevents an automatic compaction from proceeding and creates an attention item. The user may explicitly override this safeguard.

#### Governed durable memory

5.8 Raw Pi JSONL, task/audit events, tool evidence, and artifacts remain canonical evidence. A memory product or generated summary may reference that evidence but never replace or rewrite it.

5.9 Durable memory records are typed and scoped to one of global owner, project, repository, task, or session. Each record includes provenance, author, confidence, status, creation and update timestamps, and optional expiry or supersession links.

5.10 Supported initial record types are decision, constraint, preference, convention, fact, failure/lesson, and runbook. Adding a type changes a versioned schema rather than relying on an unstructured prompt convention.

5.11 Memory follows an explicit lifecycle: proposed, active, contested, superseded, rejected, or deleted. Deletion uses a tombstone where needed to prevent silent re-creation; it does not remove the underlying retained session evidence unless the owner invokes the separate deletion policy.

5.12 Agents may submit project- or task-scoped memory candidates through capability-scoped actions. They may not silently create global owner memory, auto-approve contested claims, or treat repository text and generated content as trusted instructions.

5.13 Promotion policy is configurable by scope and type. Low-trust repository content, inferred preferences, identity-like records, secrets, and contradictory claims always require review. Explicit project decisions and verified runbooks may be approved by the orchestrator or an independent reviewer when project policy allows it.

5.14 Every injected memory item is visible in a context receipt showing its memory ID, scope, selection reason, source evidence, retrieval method, and version. A session never receives hidden durable instructions from the memory layer.

5.15 Model-less full-text search is always available over active records and retained session evidence. Semantic or graph retrieval may improve recall, but its indexes and embeddings are optional, disposable, and rebuildable from canonical records.

5.16 Retrieval is bounded by an explicit token budget and favors current project decisions, applicable constraints, relevant runbooks, dependency context, and previous failed approaches. Stale, contested, or superseded records are not injected as hard rules.

5.17 Memory records can be inspected, searched, edited through governed patches, superseded, exported, imported, and rebuilt without calling an LLM. LLM-assisted extraction or consolidation may only create candidates or derived summaries and is never required for recovery.

5.18 The deterministic context bundle contains the governed memory records selected for that session plus the exact context receipt. It does not need to contain search-index files because those are rebuildable.

### 6. Resume, handoff, and model changes

6.1 A native Pi session can be resumed by identifier after a service restart.

6.2 A user can import an exported native Pi session into a new managed session while retaining provenance.

6.3 A user can change models between turns. The UI shows the previous model, next model, reason for switching, and any compatibility warning.

6.4 Rate limits, authentication failures, exhausted credit, and provider outages are distinct visible states.

6.5 Automatic fallback, when enabled by policy, occurs only at a safe turn boundary. The system must not silently replay a tool action whose completion is uncertain.

6.6 Before fallback, the system checkpoints context and presents the intended provider/model route in the run timeline.

6.7 If automatic continuation is unsafe, the run pauses with the last successful action and the available recovery choices.

### 7. Workspaces and sandboxing

7.1 Each active task receives a distinct workspace unless a human explicitly chooses to share one.

7.2 An agent can write only to its assigned repository worktree and approved artifact locations by default.

7.3 Host home directories, unrelated repositories, the container control socket, and global credential stores are not mounted into agent containers.

7.4 Network and credential access is visible as part of the run policy. The product describes containers as damage containment, not a complete security boundary.

7.5 Resource and concurrency limits are configurable per project and globally.

7.6 Agents create versioned configuration contracts such as schemas, documented environment variables, and redacted example files. Real secret values remain human-managed deployment inputs and must not be committed, copied into context bundles, or placed in durable agent memory.

7.7 Agents may create deployment manifests and run ephemeral deployments needed for validation. Creating or changing long-lived services, DNS, SWAG, router rules, production secrets, or other production infrastructure requires explicit human authorization for that named action.

### 8. Git behavior

8.1 The platform creates, names, validates, and removes worktrees. Agents are not responsible for lifecycle bookkeeping.

8.2 Agents can inspect status and diffs and can request a checkpoint or commit through explicit platform actions.

8.3 Every platform-created commit is linked to the task, session, run, and validation evidence that produced it.

8.4 Merge is a separate, policy-governed action. The orchestrator may request it after independent reviewer approval, required checks, and resolution of applicable human-decision gates; a successful implementation run alone never implies a merge.

8.5 Dirty, conflicted, missing, or externally modified workspaces create explicit states rather than being repaired destructively.

### 9. Review and validation

9.1 Every code-changing task declares a validation plan before autonomous merge. The plan may be revised during implementation, but revisions and reasons are visible.

9.2 Unit or regression tests are expected when behavior can be isolated and a future regression would be plausible. Integration tests are expected when the change crosses meaningful process, service, persistence, protocol, or UI boundaries.

9.3 Tests are not mandatory ceremony for every task. Documentation-only, exploratory, generated-artifact, or otherwise low-value cases may omit new tests when the implementer and reviewer record why existing checks or smoke testing are sufficient.

9.4 A reviewer can reject an unjustified test omission, require a narrower regression test, or identify manual smoke steps that must be performed before merge.

9.5 Reviewer output is structured and preserved with the task: reviewed revision, findings by severity, commands and results inspected, missing coverage, residual risks, and disposition.

9.6 The human audit path emphasizes task intent, final summary, changed files, reviewer findings, test evidence, and reproducible smoke-test instructions. Reading the full conversation is optional.

9.7 Human approval is mandatory for high-risk or hard-to-reverse categories: foundation forks or replacements; public APIs and durable schemas; authentication and trust boundaries; secrets strategy; public network exposure; destructive migrations; production infrastructure; externally billed services; license changes; retention-policy changes; and replacement of a major runtime, storage engine, or core dependency. Projects may add narrower gates.

9.8 A human decision records the question, considered alternatives, evidence, selected option, owner, timestamp, and affected tasks or revisions. Approval of one decision does not grant standing authority over later deployment or infrastructure mutations.

### 10. Run observability

10.1 A run timeline presents prompts, model responses, tool calls, tool results, task mutations, context snapshots, Git checkpoints, provider events, errors, and operator actions in chronological order.

10.2 Large or sensitive payloads may be stored as referenced artifacts, but the timeline retains type, provenance, checksum, and access status.

10.3 The user can see current model, elapsed time, token/cost data when supplied by the provider, task state, workspace, and last heartbeat for every active run.

10.4 RTK-filtered output is identified as filtered. The corresponding complete raw command output remains available as an artifact so token reduction never removes audit or debugging evidence.

10.5 RTK token savings, bypasses, parse failures, and raw-output artifact links are visible per run and in aggregate. An agent or human can explicitly rerun or inspect unfiltered output when compression removed required detail.

10.6 Logs, complete native sessions, command outputs, and artifacts remain available until the containing project or session is explicitly deleted. Quotas warn and block new runs before silently deleting retained evidence.

### 11. Remote operation

11.1 Local-first releases support an explicit loopback profile with no application authentication. The listener binds only to loopback and clearly identifies that exposure mode.

11.2 Phase 1 may add an explicit trusted-LAN profile with no application authentication. It binds to a selected private interface, restricts accepted source networks to configured private CIDRs, displays a persistent warning, and is never enabled implicitly.

11.3 Loopback and trusted-LAN classification comes from the configured listener and host/network policy, not from arbitrary forwarded headers. Public wildcard binding is rejected unless the authenticated remote profile is configured.

11.4 Authenticated remote access is a later phase. Its primary web service is served through the existing SWAG reverse proxy at a dedicated HTTPS subdomain, without exposing the Boss Man origin directly to the public internet.

11.5 The remote profile supports one human owner and requires either an owner session or API key for every request, including terminal, streaming, artifact, and mutation routes. SWAG Basic Auth may remain as an independent outer gate.

11.6 Password mode stores an Argon2id verifier locally on the Boss Man host and issues Secure/HttpOnly/SameSite device sessions. API-key mode stores only a local key hash and accepts the raw key through the `Authorization` header. Secrets do not enter Git, task/context records, or logs.

11.7 Browser `localStorage` is not the default credential store. Password login uses an HttpOnly cookie; API clients use an OS keychain, protected secret file/environment, or session-scoped memory. Persisting a bearer key in browser `localStorage` requires an explicit convenience/security choice.

11.8 WebSockets, streaming responses, uploads, downloads, Host/Origin validation, CSRF protection where cookies are used, rate limiting, rotation/revocation, and reconnect behavior work through the remote proxy.

11.9 SSH remains a separate operator recovery path. The existing public port 315 terminates on the home server and provides `ProxyJump` access to the Boss Man Mac over the LAN. The private key is never uploaded to Boss Man or copied into agent containers.

11.10 A host restart restores the control plane, reconstructs run state, and marks processes that cannot be recovered instead of assuming they are still active.

11.11 Opening a second public router port directly to the Mac remains deferred and requires a separate human network and hardening decision.

### 12. Provider policy and spend

12.1 Harness selection and model-provider selection are independent concepts in the UI and data model.

12.2 A project can define model policies by work type, budget, and availability rather than a single hard-coded model, even before automatic cross-provider fallback is enabled.

12.3 The system shows whether credentials represent subscription use, direct API billing, prepaid gateway credit, or an unknown billing mode.

12.4 Automatic paid fallback is a later objective unless the provider abstraction makes it low-risk and inexpensive to deliver. Until enabled, exhaustion pauses the run with a portable snapshot and a manual model-switch path.

12.5 Spend limits and fallback policies are explicit. Running out of the primary provider's allowance does not automatically authorize unbounded paid usage.

12.6 Provider and model identifiers can change without changing the context or task formats.

### 13. Failure and recovery

13.1 Starting, stopping, snapshotting, claiming, and task mutation operations are safe to retry.

13.2 The system distinguishes a lost process from a lost container, a lost connection, and a provider failure.

13.3 On restart, ambiguous active operations are marked for reconciliation and are not repeated automatically.

13.4 A user can download or copy the latest valid context bundle and native session even when the agent runtime is unavailable.

### 14. First usable release boundary

14.1 One owner can register a repository and create a sufficiently clear task from the local web UI.

14.2 The owner can start a Pi session in an isolated worktree and container and use both structured session controls and an interactive workspace terminal.

14.3 Agents update the board, preserve context before compaction, and create inspectable raw and RTK-filtered command artifacts.

14.4 An implementing agent can request independent review; after approval, required validation, and resolution of applicable human-decision gates, the orchestrator can create the platform-owned commit, merge, and mark the task Done without human approval.

14.5 The owner can audit the result from the task description, diff, tests, reviewer report, and smoke-test instructions without reading the conversation.

14.6 The owner can stop and resume the same native session, fork a child with a declared context mode, and manually continue on another configured model.

14.7 The owner can recover an exported native session and normalized context bundle after restarting the control plane.

14.8 No Slack or email integration is required in the first release; attention remains visible in the product.

14.9 The owner can inspect active and proposed project memory, trace every injected item to evidence, and rebuild model-less search after deleting the derived index.

14.10 The repository contains a complete local configuration contract and smoke runbook. Phase 3 adds the redacted remote secret contract and deployment manifests. No phase mutates long-lived SWAG, router, DNS, host-service, or production-secret state unless the owner separately authorizes deployment.
