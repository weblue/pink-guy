# Execution recovery and late-evidence contract

Status: Implemented; D-057 long-turn deadline remediation verified

Last updated: 2026-07-19

Figma: none provided. This contract uses the existing cockpit and terminal
surfaces; detailed visual styling is not part of this slice.

## Summary

Pink Guy must distinguish an execution request, an accepted command, a live
Pi run, and a settled phase outcome. Transport loss, process failure, timeout,
stop, pause, and uncertain side effects must produce different observable
states so the platform never reports failure while an agent can still mutate
the task or silently discards work that may be recoverable.

## Problem

The Phase 1 closure run exposed a split-brain failure: the project daemon lost
its long-running HTTP request and marked the implementation command failed,
while the central API's Pi run remained alive and later created a valid host
checkpoint. The owner could stop and reset the run through supported controls,
but the reset raced the late checkpoint. A full-time coding platform needs one
authority for execution settlement and explicit treatment of late evidence.

## Goals

- Make accepted execution independent of an observer's HTTP connection.
- Stop or fence failed work quickly enough that it cannot continue mutating
  authoritative task state.
- Preserve paused work and uncertain evidence for audit and recovery.
- Give the owner safe, explicit recovery actions without SQLite edits.
- Resume automatic phase continuation only from a proven authoritative state.

## Non-goals

- Automatically replaying an uncertain provider response, tool call, Git
  operation, or phase.
- True live-process reattachment across control-plane restart.
- Automatically trusting or merging a late checkpoint.
- Solving Phase 2 Git integration, credential concurrency, backup, or remote
  access in this feature.
- Replacing retained Pi-native sessions and model-less custody bundles.

## Behavior

### Execution identity and visible state

1. Every scheduled task-phase command has at most one accepted execution.
   Once accepted, the command, execution, task, phase, session, run, workspace,
   base revision, model route, and orchestrator lease are linked in the
   inspectable audit record.

2. The user can distinguish these execution conditions without interpreting
   logs:
   - **Queued:** eligible work has not been claimed.
   - **Starting:** execution was durably accepted but the managed Pi run is not
     ready yet.
   - **Running:** a managed Pi run is active and allowed to mutate within its
     phase capability.
   - **Stopping:** authority has been fenced and Pink Guy is terminating or
     verifying termination of managed processes.
   - **Paused:** processes are stopped, retained context is safe, and no
     unresolved side effect prevents an explicit resume or retry.
   - **Failed:** processes are stopped and Pink Guy has authoritative evidence
     that the phase failed.
   - **Needs reconciliation:** processes are stopped or quarantined, but one or
     more outcomes or side effects remain uncertain.
   - **Succeeded:** the required phase outcome is durably recorded and cleanup
     is complete enough for the next policy transition.
   - **Cancelled:** the owner intentionally ended the execution and no active
     process retains mutation authority.

3. Task lifecycle, dispatch policy, command state, and execution state remain
   separate. Pausing or reconciling an execution does not archive the task,
   silently change its automatic/manual/paused dispatch policy, or erase its
   prior task status.

4. A command cannot be shown as Failed, Succeeded, Paused, or Cancelled while
   its Pi process, shell process, or task capability can still mutate
   authoritative state. It remains Starting, Running, Stopping, or Needs
   reconciliation until the authority boundary is proven.

5. A user-visible failure includes a stable failure class, the phase, last
   meaningful activity time, process/container state, affected side effects,
   retained evidence, and the next permitted recovery actions. Raw exception
   text may supplement but never replace this projection.

### Acceptance and settlement

6. Execution acceptance is a short, idempotent operation. Once Pink Guy
   returns an accepted execution identity, disconnecting the project daemon,
   browser, terminal, or initiating HTTP client cannot change the execution
   to Failed or cause a duplicate run.

7. If the initiating client loses its connection before learning whether
   acceptance succeeded, repeating the same request returns the same execution
   or its current state. It never creates a second run.

8. The central API owns settlement of an accepted execution. A project daemon
   may initiate and observe execution, but it cannot report an accepted
   command Failed or Succeeded based only on its local request result.

9. Implementation succeeds only after a current fixed checkpoint and review
   request are recorded. Test succeeds only after validation is recorded for
   that exact revision. Review succeeds only after a disposition is recorded
   for that exact revision. Agent prose and process exit alone never satisfy a
   phase.

10. Automatic test/review continuation begins only after the prior execution
    is durably Succeeded. Failed, Paused, Cancelled, Stopping, or Needs
    reconciliation executions never advance automatically.

11. A setup error before any Pi run or uncertain side effect exists may fail
    authoritatively. If Pink Guy cannot prove that no process or side effect
    exists, the execution requires reconciliation instead.

### Failure detection, fencing, and stop

12. Pi process exit, container exit, protocol rejection, and explicit provider
    errors are projected as soon as observed; the user does not wait for the
    inactivity or hard deadline to learn about them.

13. Meaningful Pi RPC activity refreshes an inactivity watchdog. When that
    watchdog expires, Pink Guy begins the fenced stop flow and records
    inactivity as the trigger. A longer hard deadline remains a final bound,
    not the normal failure detector.

    The hard bound is explicit, configurable, and long enough for the measured
    coding workload. A final assistant response already streaming at the bound
    receives a bounded settlement grace; trickle activity cannot remove the
    absolute safety ceiling.

14. Beginning a stop, cancel, timeout, or uncertain-effect recovery fences the
    execution before waiting for processes to exit. Subsequent task, review,
    validation, artifact-promotion, or task-revision mutations using that
    execution's agent capability are rejected.

15. Fencing and stop are idempotent. Concurrent owner actions, daemon loss,
    API retries, or restart cannot grant authority again, launch a duplicate
    stop, or produce conflicting terminal states.

16. Pink Guy attempts graceful Pi and shell termination, then bounded forced
    termination, then container removal. It verifies credential cleanup and
    capability revocation. An unverified step is visible and changes the
    result to Needs reconciliation rather than being silently ignored.

17. Owner-requested pause preserves the native Pi session, context custody,
    artifacts, run events, workspace identity, and stopped-process receipt.
    Pause is not failure and remains visible until the owner resumes, retries,
    cancels, or deletes the retained session under a later retention policy.

18. A user may request stop while Starting, Running, Paused, or Needs
    reconciliation. Stop never implies that unverified provider/tool/Git work
    did not happen; uncertain side effects remain explicit.

### Late evidence

19. Evidence first observed after an execution is fenced is labeled **late
    evidence** with its run, workspace, task, phase, timestamps, base
    revision, side-effect receipts, and discovery method. It remains retained
    even when rejected for task advancement.

20. Recovery candidates form a dead-letter-style quarantine for late
    evidence, not a runnable or dead task queue. They are excluded from Ready
    scheduling and every automatic phase selector.

21. Late evidence never changes the task revision, validation, review,
    completion, dispatch eligibility, or automatic pipeline by itself.

22. A Git checkpoint is eligible to become a recovery candidate only when Boss
    Man proves its repository, workspace, run, task, parent/base revision,
    commit identity, and relevant Git side-effect receipt. An ambiguous,
    missing, cross-task, or non-descendant commit remains evidence but cannot
    be accepted.

    A timeout after a proven same-generation checkpoint must project that
    checkpoint as a candidate or retain an explicit proof explaining why it is
    ineligible. An unresolved provider-response receipt alone does not make
    already-fixed Git evidence disappear.

23. Only the human owner may accept or reject a late checkpoint in this
    contract. An orchestrator or sub-agent may summarize evidence and recommend
    an action but cannot resolve the recovery gate.

24. Before accepting a late checkpoint, the owner sees:
    - the candidate and current authoritative revisions;
    - the diff and checkpoint provenance;
    - whether newer task work exists;
    - side effects that remain uncertain;
    - the exact task status/revision changes acceptance will make; and
    - the fact that validation and review must run again.

25. Accepting a proven late checkpoint atomically advances the authoritative
    task revision, invalidates stale validation/review evidence, records the
    owner and rationale, and makes a fresh test phase eligible. It does not
    declare implementation, validation, review, completion, merge, or push
    successful.

26. Rejecting a recovery candidate marks it rejected with an owner and reason
    but preserves the commit, diff, custody, and audit record until explicit
    retention deletion. Rejection does not delete a worktree or branch as an
    incidental side effect.

27. If the task has advanced from the candidate's expected authoritative
    revision, acceptance is denied until the owner deliberately chooses a
    separate Git integration path. Recovery never overwrites newer task work.

### Recovery actions

28. The recovery surface offers only actions valid for the current proven
    state:
    - **Stop** fences and terminates active work.
    - **Pause** stops safely while preserving resumable custody.
    - **Resume from custody** starts a new managed execution from the same
      native session/context at a safe boundary.
    - **Retry phase** creates a new command from the current authoritative
      revision after all earlier execution authority is closed.
    - **Accept checkpoint** applies a proven late candidate under (24–25).
    - **Reject checkpoint** retains but excludes a candidate under (26).
    - **Cancel** closes the execution without scheduling replacement work.

29. Retry and resume are distinct. Retry starts a new phase attempt from the
    task's authoritative revision and may use a new model route. Resume uses
    retained native/context custody from the paused attempt. Both create new
    execution identities and preserve their ancestry.

30. Retry, resume, or return-to-Ready is denied while an earlier execution can
    still mutate, while a stop is unverified, or while an uncertain side
    effect capable of changing the intended base remains unresolved.

31. Every recovery action requires an idempotency key, expected task/execution
    version, owner identity, and non-empty reason. Repeating the same action
    returns its original receipt; conflicting reuse is rejected.

32. The existing ambiguous **Reset task** action is replaced by explicit
    state-aware actions. No control both dismisses failure and makes a task
    schedulable unless its stop/fence and revision consequences are shown.

### Restart and cross-surface observability

33. On control-plane restart, Pink Guy reconciles every nonterminal execution
    before dispatching new work. It checks durable execution/run identity,
    container identity, process state where available, capabilities, side
    effects, workspace/Git provenance, native custody, and required phase
    outcomes.

34. Pink Guy does not replay an uncertain provider response, tool call, Git
    operation, or phase after restart. A proven completed outcome settles;
    proven safely stopped work becomes Paused or Failed as appropriate; all
    other cases require reconciliation.

35. True in-flight process reattachment is not required for this slice. When
    the control plane cannot prove safe reattachment, it fences and stops the
    old execution, preserves custody, and exposes resume/retry after
    reconciliation.

36. Cockpit and `pink` terminal views present the same state, last activity,
    failure class, process/container evidence, late candidates, allowed
    actions, and action receipts. tmux output is supplementary diagnostics,
    not execution authority.

37. Paused and Needs reconciliation work appears in a consolidated attention
    projection and remains easy to audit. It is never hidden merely because
    the task left In progress or because the underlying process stopped.

38. All automatic classifications and owner resolutions append command,
    execution, run, task, side-effect, and audit events as applicable.
    Existing evidence is never rewritten to make the final path look clean.

39. Complete sessions and recovery evidence remain retained until explicit
    deletion. This feature does not introduce automatic age-based cleanup.
