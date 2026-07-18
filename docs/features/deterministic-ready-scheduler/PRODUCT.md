# Deterministic Ready scheduler — proposed product specification

Status: Proposed for owner approval

Last updated: 2026-07-18

Figma: none provided. This changes task/queue behavior and adds compact policy
controls to existing task surfaces.

## Summary

Move Ready-queue selection and sub-agent dispatch out of the conversational
LLM and into the central control plane. Pi continues to refine intent, create
task graphs, and perform phases; durable policy decides which released task
runs next.

## Behavior

1. Every executable task has an explicit dispatch policy:
   - `manual`: remains Ready until an owner/orchestrator release;
   - `automatic`: may be selected by the central scheduler when eligible; or
   - `paused`: cannot be selected until explicitly resumed.
2. Existing tasks migrate to `manual`. Creating a task through a direct form
   defaults to `manual`. A conversational orchestrator may create/refine a task
   and explicitly release it to `automatic` only after the task has concrete
   acceptance criteria and no material ambiguity.
3. Release is a durable, audited task mutation. It expresses that a task is
   executable; it does not choose a queue position, claim capacity, or spawn
   an agent itself.
4. The model-less scheduler selects only active executable tasks that are
   Ready, `automatic`, unarchived, dependency-satisfied, free of unresolved
   human decisions, and without an active command or run.
5. Eligible tasks are ordered deterministically by:
   - higher explicit priority first;
   - earlier release timestamp next; and
   - task ID as the stable final tie-breaker.
6. Priority is a bounded integer with a visible normal default. Changing it is
   audited and never interrupts an already running phase.
7. Dispatch also requires a live project-orchestrator lease, available
   per-project/global capacity, and a configured implementation model route.
   Missing capacity or lease leaves the task Ready without marking failure.
8. Once selected, the scheduler uses the existing atomic task/command
   transaction and phase-scoped route/prompt policy. The project daemon claims
   the command and spawns Pi without another LLM decision.
9. Repeated scheduler ticks, concurrent daemons, and API restarts cannot
   duplicate a command. Selection and capacity claims are transactional and
   idempotent.
10. A failed implementation, missing required phase evidence, failed
    validation, non-approved review, protected decision, or unresolved
    dependency stops automatic dispatch until explicit recovery.
11. Successful implementation continues through the existing deterministic
    test/review coordinator at the exact fixed revision.
12. The cockpit and terminal show dispatch policy, priority, eligibility
    blockers, queue order, and why an automatic task is waiting.
13. The owner can pause or return a queued Ready task to manual without
    deleting it. A claimed/running command uses the existing stop/recovery
    controls rather than pretending it was never dispatched.
14. Scheduler decisions are derived entirely from SQLite state and configured
    resource policy. No provider request, embedding, semantic search, or
    conversational transcript parsing is involved.

## Non-goals

- Having the scheduler invent, split, rewrite, or prioritize tasks from prose.
- Automatically repairing failed phases or review-requested changes.
- Preempting running agents.
- Merging, rebasing, pushing, or opening remote pull requests.
- Dynamic multi-host placement or paid-provider fallback.
