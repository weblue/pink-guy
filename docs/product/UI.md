# Pink Guy v2 developer cockpit

Status: Current cockpit contract; Phase 2U redesign inputs recorded

Last updated: 2026-07-19

## Decision summary

Do not revive the original chat-first dashboard and do not treat Ghostty or cmux as a web application foundation.

The direct Pi RPC cockpit is the implemented foundation. Completed foundation
comparisons remain under `docs/history/phase0/` and are not active product
options.

## Why the obvious alternatives are insufficient

| Candidate | Useful parts | Material mismatch | Disposition |
|---|---|---|---|
| [Lumbergh](https://github.com/voglster/lumbergh) | Clean web terminal, Git views, file browser, PWA, MIT, easy React/FastAPI codebase | Claude/tmux-centric, TinyDB, no container authority, manager chat emphasis, limited security story | UI reference and possible component source |
| [Coder](https://coder.com/docs/user-guides/workspace-access) | Mature remote workspaces, web terminal, code-server, SSH, port forwarding | Adds a second heavyweight workspace/provisioning control plane and Postgres; no Pi task/context semantics | Optional external workspace integration, not Pink Guy core |
| [xterm.js](https://github.com/xtermjs/xterm.js) + code-server | Proven web terminal and full browser IDE; maximum semantic control | Requires Pink Guy to build the session shell, reconnection, layout, auth, diff, and mobile UX | Fallback foundation |
| [Agent Deck](https://github.com/asheshgoplani/agent-deck) | Strong TUI/session fleet, remote SSH, worktrees, Docker, conductor | Terminal-first and tmux-oriented; web experience and Pi structured context are not the primary contract | Operational reference |
| Ghostty | Excellent local terminal emulator and SSH client behavior | Not a web server, remote workspace dashboard, or session database | Supported client preference only |
| cmux | Excellent macOS local workspace/session organization | macOS-only client and not remotely served through SWAG | Optional local operator workflow only |

## Information architecture

The application is organized around work state, not a conversation list.
Scoped orchestrator conversations are the primary intake/control surface for
creating that work.

The diagram below is the C0-04 information-architecture wireframe. It defines placement and hierarchy, not final visual design. The served Phase 0 operator shell implements this three-region shape for projects, orchestrator leases, the task board, sessions, context status, and a terminal/attach placeholder. Detailed interaction wireframes listed at the end of this document remain Phase 1 design work.

```text
┌──────────────────┬────────────────────────────────────┬─────────────────────┐
│ Topics / Projects│ Main work surface                  │ Inspector           │
│                  │                                    │                     │
│ Attention        │ Board / Overview / Changes         │ Task + dependencies │
│ Active runs      │ Tests / Review / Artifacts         │ Session + model     │
│ Ready tasks      │ Timeline / Conversation / Terminal │ Context snapshots   │
│ Sessions         │                                    │ Validation + risk   │
├──────────────────┴────────────────────────────────────┴─────────────────────┤
│ Host · provider · cost · RTK savings · container · branch · connection     │
└────────────────────────────────────────────────────────────────────────────┘
```

The left navigator answers “what needs attention?” The center answers “what am I doing or inspecting?” The right inspector answers “what state, evidence, and risk explain this work?” The bottom status surface answers “what runtime am I connected to?”

Chat never occupies all three answers.

### Topic and orchestrator intake

- A global **New topic** action offers “New project/prototype” and “Existing
  repository.”
- Existing-repository intake accepts a remote URL or registered local
  repository, optional owner description, and external work-item references.
- A project-level **Ask orchestrator** action reopens the durable project
  conversation to add, refine, split, or explain work.
- The conversation shares the main surface with structured source,
  assumption, question, decision, and task-change cards. The inspector shows
  repository binding, source revisions, affected tasks, and readiness.
- Orchestrator-created changes are navigable without reading prose: each turn
  exposes created/updated/blocked tasks and links to their board/workspace.
- Direct task creation remains available as a compact fast path and recovery
  tool.
- Lease presentation treats `status === "active"` as the live lease; released,
  expired, and any other non-active rows stay durable and collapse into the
  lease-history disclosure without rewriting stored records.

## Required desktop surfaces

### Fleet and attention

- Active, waiting, blocked, reviewing, failed, and recently completed sessions.
- Tasks awaiting reviewer, changes requested, validation failed, merge conflicted, or carrying a typed `Decision Required` gate.
- Global concurrency, host pressure, provider state, and current spend mode.
- Fast actions to open, pause, resume, assign reviewer, or archive.

### Board

- Backlog, Ready, In Progress, Review, Blocked, and Done columns.
- Dependency indicators, implementing/reviewer agents, risk, validation state, changed-file count, and last activity visible on cards.
- Filtering and grouping by project, agent, state, risk, model, and branch.
- Dragging expresses an allowed request; the server remains authoritative and explains rejected transitions.

### Task workspace

- Overview: request, clarified assumptions, acceptance criteria, plan, dependencies, ownership, and risk.
- Decisions: protected decision question, alternatives, evidence, agent recommendation, affected tasks/contracts, and owner resolution history.
- Changes: file tree, unified/split diff, commit/checkpoint graph, comments, and provenance.
- Tests: planned checks, commands, pass/fail/skipped state, duration, summarized output, full raw artifacts, and coverage rationale.
- Review: independent reviewer identity, reviewed revision, findings, residual risk, disposition, and change-request loop.
- Artifacts: context exports, logs, reports, screenshots, patches, preview links, and checksums.
- Memory: applicable decisions, constraints, runbooks, previous failures, injected-memory receipt, and links back to source evidence.
- Timeline: typed task/session/run events with filters.
- Conversation: Pi messages and composer, intentionally one tab among peers.
- Attach/recovery: exact tmux/cmux/SSH information and captured command
  artifacts. A separate browser workspace shell is optional only after a
  demonstrated workflow gap.

### Session and context

- Native Pi branch/tree, current leaf, parent/child sessions, context mode, compaction points, and snapshots.
- Model/provider history and reasoning mode.
- Context size/usage, RTK savings, and full-output artifact availability.
- Injected-memory receipt showing what was selected, why, by which retrieval method, and from which source evidence.
- Resume, fork, snapshot, export, model switch, stop, and archive controls.

### Memory inspector

- Search across active governed memory and retained session evidence with scope, type, status, freshness, and source filters.
- Separate candidate, active, contested, stale, superseded, rejected, and tombstoned views.
- Review a proposed patch as a diff, inspect every evidence reference, then approve, edit, reject, contest, or supersede within the operator's policy.
- Explain “why remembered?” and “why injected?” without opening the full conversation.
- Rebuild derived indexes, show index/version health, and clearly identify optional semantic results versus required model-less FTS results.

### Developer access

- Pi RPC conversation and cockpit controls are the primary developer surface;
  tmux/cmux/SSH is the exact-session operational fallback.
- “Open workspace” integration for a configured browser IDE such as
  code-server is optional and must not become a second task or session
  authority.
- Preview/port links surfaced only through authenticated proxy routes or an explicitly approved network path.
- Reproducible smoke-test instructions attached to the task and copyable as commands.

## Mobile behavior

Mobile prioritizes triage over a squeezed desktop replica:

1. Attention and active work list.
2. Task summary with current state, risk, agent, and last event.
3. Swipe or tab navigation for Changes, Tests, Review, Conversation, and Attach.
4. Diff defaults to one file and one column at a time.
5. Attach details open full-screen; a future browser terminal would require a
   separate approved contract.
6. High-impact actions require a deliberate confirmation surface that shows task, branch, and policy consequence.

## Deferred embedded workspace-terminal contract

D-043 removes an embedded browser PTY from the Phase 1 baseline. The current
terminal experience is the `pink` central-API conversation client plus
cmux/tmux/SSH process attach and recovery. The rules below apply only if a
later demonstrated workflow gap justifies a browser workspace shell.

- Pi structured events are the primary semantic record; terminal output is an interactive and diagnostic surface.
- A workspace shell is distinct from the Pi agent process so human smoke tests do not inject keystrokes into the agent conversation.
- Disconnecting a WebSocket does not terminate the PTY or Pi run.
- Reconnect restores dimensions, scrollback where retained, and an explicit gap marker if bytes were dropped.
- Terminal access is authenticated, audited, rate-limited at the edge, and disabled in read-only mode.
- Pasted multiline commands show a confirmation preview when the terminal is connected to a privileged host shell.
- Raw command artifacts remain available even when the terminal scrollback is truncated.

## Chat containment rules

1. The application never defaults globally to a blank chat composer.
2. Starting work begins from a named topic or project-scoped orchestrator
   conversation, never an identity-free global chat or a transcript list.
3. Agent questions appear as attention items linked to the exact task and turn.
4. Long tool output collapses into typed cards/artifacts instead of dominating the transcript.
5. The conversation can be hidden without losing run controls, terminal
   attach/recovery information, diffs, tests, or review.
6. Search spans tasks, files, artifacts, events, and conversations and identifies the result type.

## Design work guided by dogfooding

The implemented cockpit establishes the three-region layout, project/topic
intake, durable Pi conversation, board, fixed-revision workspace inspector,
validation, review, custody, artifacts, and phase controls. Further design is
usage-driven:

- attention aggregation across multiple active repositories;
- large-diff and artifact navigation;
- recovery/reconciliation explanations;
- resource-pressure and provider-state visibility; and
- mobile triage after the desktop workflow is stable.

No browser terminal or full browser IDE is required to close Phase 1. A
polished chat screen is not a substitute for task, evidence, and risk
observability.

### Phase 2D friction evidence

Record a friction event when the owner loses position, cannot identify the
next action, cannot explain a visible element, leaves Pink Guy to finish
ordinary work, or performs an avoidable recovery action. Each event records:

- journey and project/task/topic;
- intended action and actual outcome;
- frequency and severity (`blocking`, `costly`, or `cosmetic`);
- screenshot or event/time reference where useful;
- workaround and whether a direct Pi/Codex client was required.

Known hypotheses—not yet accepted redesign requirements—are:

- orchestrator chat can bounce away from the owner's scroll position;
- populated panels or the page can grow and scroll without a useful bound;
- task, execution, evidence, Git, retention, and recovery details compete for
  attention without enough explanation or progressive disclosure.

The executable evidence and interview sequence live in
[`PHASE2-CLOSURE.md`](PHASE2-CLOSURE.md). Phase 2U begins with an owner
interview, produces a mockup based on the existing cockpit, and requires owner
acceptance before implementation. A bounded fix may land earlier only when a
known scrolling defect blocks Phase 2D evidence collection.

## Visual system notes

- The cockpit uses a shared semantic palette rather than one-off colors for each
  region: cyan/green for primary status, blue for navigation and state, and
  warmer accents for focus and warnings.
- Spacing now follows a tighter, repeated rhythm inside panels, cards, and
  control rows so future screens should prefer the same gap-based layout over
  ad hoc top margins.
- The color lift stays intentionally local to the cockpit shell; new surfaces
  should reuse the same tokens instead of introducing unrelated accents.
