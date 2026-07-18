# Phase 1 orchestrator conversations and project intake

Status: Approved for implementation

Last updated: 2026-07-17

## Summary

The primary way to define and expand work is a durable conversation with an
orchestrator. The conversation converts intent and attached sources into
structured projects, tasks, assumptions, dependencies, acceptance criteria,
and decision gates while the board remains the authoritative view of work.

## Figma

Figma: none provided.

## Behavior

1. The owner can start a top-level **Topic** from anywhere in the cockpit. A
   topic is a durable unit of intent with its own orchestrator conversation and
   may exist before a repository or project has been selected.

2. Topic creation supports two initial paths:
   - **New project or prototype:** a title and optional initial description,
     with no repository required yet.
   - **Existing project:** a repository URL or registered local repository,
     plus an optional project description and zero or more external work-item
     references.

3. Starting a topic opens its orchestrator workspace, not an unscoped global
   chat. The workspace always shows the topic/project identity, current source
   attachments, task changes produced by the conversation, unresolved
   questions, decisions, and relevant board state.

4. A topic without a repository can be explored and refined. It cannot launch
   a code-changing task until it is linked to an existing project or promoted
   into a new project with a managed Git repository.

5. When an existing repository is supplied:
   - an already registered canonical repository is reused rather than cloned
     or registered twice;
   - an unregistered remote can be imported into an owner-configured local
     repository root;
   - the owner sees clone/import progress and actionable authentication,
     branch, network, or destination errors; and
   - repository credentials are never requested in the conversation or
     exposed to an orchestrator or task agent.

6. An existing-project topic accepts an optional description even when the
   repository is available. The description is treated as owner context and
   remains distinguishable from facts inferred from repository content.

7. External work items use a generic source attachment. A topic may retain a
   URL, pasted text, or a supported provider's item without coupling the
   conversation model to a named ticket system.

8. Importing a work item creates a timestamped, checksum-bound source snapshot
   containing its provider, external identifier, canonical URL, available
   title/body/comments/attachments metadata, and fetch status. Refresh creates
   a new revision and visible diff; it never silently rewrites the prior
   snapshot.

9. External sources are read-only. Creating or editing Boss Man tasks does not
   modify a source system.

10. Before asking the owner questions, the orchestrator reads the supplied
    description, current source snapshots, applicable project memory, and
    enough repository evidence to avoid asking for information already
    available.

11. The orchestrator asks only questions whose answers materially affect
    scope, expected outcome, validation, risk, architecture, or the requested
    level of autonomy. It never requires a fixed count or taxonomy of
    questions, and a sufficiently refined ticket may produce tasks without an
    interview.

12. When ambiguity is low-risk and reversible, the orchestrator may record an
    explicit assumption and proceed. When ambiguity crosses a protected
    decision category, it creates a visible `Decision Required` item and
    blocks only the affected task or project transition.

13. The orchestrator may create and update tasks, acceptance criteria,
    dependencies, source links, assumptions, and proposed phase order within
    its topic/project scope. It cannot silently change another project's work,
    protected project policy, or a resolved owner decision.

14. Every conversation-driven mutation appears as a structured change card
    linked to the exact orchestrator turn. The card shows created, updated,
    blocked, or superseded tasks and provides direct navigation to the board
    or task workspace.

15. Low-risk task-graph changes do not require ceremonial human acceptance.
    They commit through the same audited central authority used by manual
    controls. The owner can correct, reopen, or supersede them, and protected
    decisions still require explicit owner resolution.

16. Direct task forms remain available as a fast path, accessibility surface,
    API primitive, and recovery mechanism. They are not the primary product
    path for turning vague intent into work.

17. A project has a durable orchestrator conversation that can be reopened to:
    - add new work;
    - refine or split existing tasks;
    - explain current board state;
    - attach a new ticket or source revision;
    - request a prototype or investigation; and
    - resolve orchestrator questions.

18. A topic may produce multiple tasks. It may link to one existing project or
    be promoted into one new project in the first release. Cross-project
    initiatives remain visible as a future extension rather than being
    represented by silently duplicated topics.

19. A submitted owner message has one visible lifecycle: queued, running,
    waiting for owner, completed, failed, cancelled, or reconciliation
    required. Reconnect preserves streamed output and structured task changes.
    A second submit cannot race the same conversation turn; it queues behind
    the active turn or the owner cancels the active turn first.

20. Orchestrator messages, tool calls, source snapshots, assumptions, task
    mutations, and decision events are retained as canonical evidence. The
    orchestrator session participates in the same model-less pre-compaction,
    export, resume, model-switch, and provider-failure custody contract as task
    sessions.

21. Repository content, ticket text, comments, and attachments are treated as
    untrusted evidence rather than privileged instructions. Source text cannot
    override Boss Man policy or grant the orchestrator/task agents additional
    authority.

22. Empty, offline, and failure states are actionable:
    - no topics explains how to start a prototype or attach a repository;
    - an unavailable orchestrator retains the draft message and reports the
      lease/runtime problem;
    - a source authentication failure identifies the provider without
      requesting a secret in chat;
    - a repository import failure preserves the topic and source inputs; and
    - a failed turn never leaves an unreported partial task mutation.

23. For a mature or maintenance-mode repository, intake is delta-oriented:
    the supplied ticket/request defines the intended change, while repository
    conventions, tests, and governed project memory supply constraints. The
    orchestrator does not restart broad product discovery unless the requested
    change exposes a material conflict or missing decision.

24. For a new project or prototype, the conversation may stay exploratory
    across multiple turns and revise its proposed task graph as intent becomes
    concrete. Superseded proposals remain visible as history; only current
    structured tasks appear as actionable board work.

25. The owner can open the same topic conversation from the browser cockpit or
    a terminal client. Both surfaces use the central conversation and event
    APIs, show the same topic/scope/model identity and durable turn history,
    submit idempotent owner turns, expose structured task changes, and report
    whether the matching orchestrator lease is online. Switching surfaces never
    rebuilds or resends Pi history.

26. The terminal client is suitable for a dedicated cmux/tmux pane. It can
    select a conversation by topic, project ID, or registered repository path;
    reuses the same project topic as **Ask orchestrator**; supports interactive
    and one-shot input; and prints a browser deep link for visual inspection.
    cmux/tmux hosts the orchestrator process and terminal client but does not
    become a second authority or a raw Pi-terminal transport.

## Non-goals

- making the entire dashboard a conversation list;
- replacing the task board, task workspace, or direct task API;
- source-system write-back or two-way synchronization;
- allowing a topic without a repository to run code-changing agents;
- letting source content act as trusted system instructions;
- supporting a harness other than Pi.
- treating terminal scrollback or a tmux pane as canonical conversation
  history.
