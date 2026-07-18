# Workspace inspectors and phase flow

Status: Approved for Phase 1 implementation

Last updated: 2026-07-18

Figma: none provided; extend the existing cockpit interaction and visual language.

## Summary

Boss Man turns one task into an observable, fixed-revision workflow:
implementation creates a host-owned Git checkpoint, an independent test agent
records validation against that revision, and an independent review agent
submits a disposition against the same revision. The local owner can inspect
the evidence and explicitly complete the task without accepting or merging it
by hand.

## Goals

- Make task workspaces, diffs, runs, tests, reviews, context custody, artifacts,
  source context, and decisions inspectable from one task detail view.
- Let the owner or project orchestrator explicitly start implementation, then
  let the platform continue successful test and review phases to settlement.
- Make the implementation checkpoint the authoritative revision handed to
  every later phase.
- Permit a test-scoped agent to record pass/fail validation evidence.
- Preserve independent review and all existing completion gates.
- Provide a deterministic, model-less baseline that visibly exercises the
  phase protocol before live-provider dogfooding.

## Non-goals

- Automatic merging, rebasing, pushing, or remote pull-request management.
- Automatically starting untouched Ready tasks.
- Editing a completed implementation from the test or review phase.
- A browser terminal emulator or terminal-scrollback-derived state.
- Remote authentication or public deployment.

## Owner workflow

1. Select a ready task and schedule **implementation**.
2. The project orchestrator starts the phase agent and sends a short,
   deterministic kickoff. The agent reads authoritative task state, works in
   its managed worktree, and requests a host-owned checkpoint.
3. The checkpoint updates the task's authoritative revision. After the
   implementation requests review, the platform schedules **test**.
4. The test agent receives a fresh worktree at the fixed revision and records
   passed or failed validation with exact evidence.
5. After passed validation, the platform schedules **review**. The owner can
   still use the manual phase action as an override or recovery control.
6. A separately identified review agent inspects the fixed revision and
   submits approve, request-changes, or blocked.
7. When validation passed, review approved, dependencies are complete, and
   decision gates are resolved, the project orchestrator completes the task.
   The owner has the same explicit completion control as a recovery path.
   Completion records a merge request; Phase 2 will own actual integration.

## Inspector behavior

The task inspector shows:

- authoritative task status, revision, acceptance criteria, dependencies, and
  decision gates;
- a phase timeline with command, session, run, model, prompt revision, and
  terminal state;
- each managed workspace's branch, base revision, current revision, status,
  and host-generated diff;
- Git checkpoint provenance;
- validation and independent-review evidence pinned to a revision;
- run events, context/custody exports, and recorded artifacts;
- immutable project source snapshots relevant to the task's project.

Stored evidence remains available after a container stops. Missing workspace
files or an unreadable historical worktree are shown as unavailable rather
than silently reconstructed.

## Scheduling rules

- Implementation starts only from an unassigned ready/backlog task.
- Test starts only after a fixed task revision exists and no task run is
  active. It does not replace the implementation assignment.
- Review starts only while the task is in review and the requested revision
  equals the current revision.
- Only one queued, claimed, or running phase is allowed for a task at a time.
- A new checkpoint invalidates validation and review evidence from older
  revisions.
- Test and review agents cannot create commits.

## Acceptance criteria

- Scheduling a phase causes its project orchestrator command to execute the
  phase kickoff to Pi settlement and release the task container.
- A successful Git checkpoint atomically advances the task revision with an
  audited host-authority event.
- Test validation is accepted only from the test-scoped run and only for the
  current revision.
- Review remains independent from the assigned implementation actor.
- Test and review worktrees are rooted at the current task revision.
- The cockpit exposes complete stored phase and workspace evidence without
  requiring an active agent capability.
- A model-less baseline prints and asserts the implementation/checkpoint/test/
  review/completion sequence.
