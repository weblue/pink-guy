# Automatic phase continuation

Status: Implemented; P2-4 found a long-turn supervision regression

Last updated: 2026-07-19

Figma: none provided; this changes workflow behavior and existing cockpit copy,
not the visual design.

## Summary

After an orchestrator starts an implementation task, Pink Guy automatically
continues successful work through test and independent review. The durable
task, revision, validation, review, and command records—not an LLM
conversation—determine each transition.

## Goals

- Remove routine owner clicks between implementation, test, and review.
- Preserve conversational refinement and orchestrator control over which
  Ready task starts.
- Make every automatic transition observable, idempotent, and recoverable
  after API or daemon restart.
- Stop safely when evidence is missing, a phase fails, or human judgment is
  required.

## Non-goals

- Automatically starting every task in the Ready column.
- Guessing task intent from titles, descriptions, or agent prose.
- Automatically retrying failed validation, requested review changes, blocked
  reviews, provider failures, or protocol violations.
- Automatically merging, pushing, or creating a remote pull request.
- Removing the owner's manual phase controls.

## Behavior

1. Creating or refining a task does not automatically execute it. A project
   orchestrator or owner starts the first implementation phase after material
   vagueness, dependencies, and protected decisions have been handled.

2. Once implementation has been scheduled, the project daemon executes one
   phase command at a time. The command is not considered a successful
   implementation outcome unless the task records a review request for its
   current fixed revision.

3. When implementation succeeds with a review-requested fixed revision and
   that revision has no validation result, Pink Guy automatically queues a
   test phase using the configured test model route.

4. A test command is not considered a settled test outcome unless it records
   passed or failed validation against the exact current revision.

5. When test validation passes and the current revision has no review
   disposition, Pink Guy automatically queues an independent review phase
   using the configured review model route.

6. When test validation fails, automatic continuation stops. Pink Guy does not
   repeatedly retest or silently send the work back to implementation.

7. A review command is not considered a settled review outcome unless it
   records approve, request-changes, or blocked against the exact current
   revision.

8. When review approves and all existing completion gates pass, Pink Guy
   completes the task and records its local merge request exactly as it does
   today.

9. When review requests changes or reports blocked, automatic continuation
   stops. Rework requires an explicit orchestrator or owner action so changed
   scope and risk can be reconsidered.

10. Open human decisions, unresolved dependencies, a blocked task, or an
    active phase prevent automatic scheduling.

11. Every automatic schedule is visible in task and command history as an
    automatic pipeline action with its phase and selected model route.

12. Automatic scheduling is idempotent for a task, revision, and phase.
    Repeated reconciliation, concurrent polling, API restart, or project-daemon
    restart cannot create duplicate active phase commands.

13. If the API stops after recording one command's completion but before
    scheduling the next phase, the next project-daemon poll resumes
    reconciliation from durable state without an LLM call or owner click.

14. Provider/process failures continue to block the task and remain eligible
    for explicit owner recovery. Failure detection uses process exit and
    inactivity supervision; the ten-minute hard ceiling is not the expected
    detection path. Proposed D-057 corrects the implementation after P2-4
    observed that ceiling fencing healthy finishing work.

15. The cockpit's manual phase action remains available only as an explicit
    override or recovery control. Its label and explanatory copy must not imply
    that routine phase advancement requires a human click.

16. Ready tasks that have never entered the phase pipeline remain Ready until
    the orchestrator or owner selects them. This prevents stale umbrella tasks,
    intake tasks, and review-only planning artifacts from being executed as
    implementation work.
