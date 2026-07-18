# Task lifecycle and planning artifacts

Status: Implemented and verified against retained dogfood state

Last updated: 2026-07-18

Figma: none provided; extend the existing cockpit controls and visual language.

## Summary

Boss Man distinguishes executable tasks from umbrella and intake artifacts,
supports lightweight task tags, and lets owners or orchestrators archive
settled records without deleting their history or pretending they completed
implementation.

## Goals

- Keep the active board limited to actionable work.
- Preserve intake, planning, provenance, and child relationships until
  explicit deletion exists.
- Prevent agents from accidentally executing umbrella or intake artifacts.
- Make lifecycle changes visible, reversible, and auditable.

## Non-goals

- Deleting tasks, sessions, artifacts, or audit history.
- A general-purpose taxonomy or mandatory tag hierarchy.
- Automatically archiving every completed executable task.
- Inferring task kind from its title or prose at runtime.
- Replacing execution status with archival state.

## Behavior

1. Every task has exactly one kind:
   - **Executable** represents work that can enter implementation, test, and
     review.
   - **Umbrella** groups or explains child work and cannot run an agent phase.
   - **Intake** preserves discovery, bootstrap, or request context and cannot
     run an agent phase.

2. New direct and conversational tasks default to Executable unless the owner
   or orchestrator explicitly selects another kind.

3. Splitting a task into child work converts the parent to Umbrella. New child
   tasks default to Executable. The conversion is shown in authoritative task
   history.

4. Existing records are classified model-lessly on upgrade:
   - a task with children becomes Umbrella; and
   - a repository bootstrap task with the stable `intake-` identity becomes
     Intake.
   No title or LLM inference is used.

5. Only active, non-archived Executable tasks can be scheduled or resumed.
   Attempts to schedule an Umbrella, Intake, or archived task fail before a
   command, container, provider request, or assignment is created.

6. A task may have zero or more tags. Tags are optional organization labels,
   are visible on board cards and task detail, and do not grant authority or
   change scheduling by themselves.

7. Tags are trimmed, lowercased, deduplicated, and limited to simple
   human-readable tokens. Invalid or excessive tags are rejected atomically.

8. Archiving removes a task from every active execution-status column while
   retaining its status, kind, tags, relationships, events, evidence,
   conversations, and artifacts.

9. Archiving requires a concise reason and is recorded with actor, time,
   prior/current task projection, and task version.

10. A queued/claimed command or running phase prevents archival. Tasks in
    active implementation or review status cannot be archived as a shortcut
    around stop/recovery semantics.

11. Archived tasks are available in a separate, collapsed-by-default cockpit
    view. Selecting one exposes its complete task inspector and an explicit
    Restore control.

12. Restoring an archived task returns it to the active column matching its
    retained execution status. Restoration is versioned and audited; it does
    not automatically schedule work.

13. Editing kind or tags uses the same optimistic task version contract as
    title, description, and acceptance criteria. Concurrent stale edits fail
    without partial changes.

14. Changing an Executable task to Umbrella or Intake is rejected while it
    has queued/claimed commands, running work, or active implementation/review
    status.

15. Changing an Umbrella or Intake task to Executable is allowed only through
    an explicit owner/orchestrator edit. It does not schedule the task.

16. The project orchestrator can create, classify, tag, archive, and restore
    project-scoped tasks through structured tools. It must not archive a record
    merely because it is old; the reason must state why it is no longer active.

17. Board counts and project active-task counts exclude archived records.
    Retained task totals may still include them when explicitly labeled as
    total or archived.

18. The three retained Ready records from the first UI dogfood must verify the
    feature:
    - the UI parent is classified Umbrella and archived as settled planning;
    - the review-only child is tagged `superseded` and archived because
      automatic review continuation replaced it; and
    - the bootstrap record is classified Intake and archived because the
      durable project conversation now owns intake.
    The active Ready column is empty afterward, while all three remain
    inspectable in Archived.
