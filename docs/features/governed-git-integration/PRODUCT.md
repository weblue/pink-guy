# Governed Git integration

Status: Implemented — model-less acceptance complete

Last updated: 2026-07-19

## Summary

Pink Guy turns an independently approved, validated task revision into an
auditable Git integration plan and, only under explicit project policy and
owner action, may execute that plan. Task agents never receive authority to
merge, rebase, push, force-push, or create a pull request.

## Figma

Figma: none provided. The cockpit extends its existing task detail and
attention patterns.

## Behavior

1. Every project has a versioned Git integration policy. The default is
   prepare-only, uses a merge commit when execution is later enabled, names
   `origin` as the remote, permits no push or pull-request side effect, and
   allows only the repository's detected default branch.

2. Only the local owner may change integration policy. Policy changes require
   the expected policy version, a reason, and an idempotency key. Force-push
   cannot be enabled.

3. Preparing integration is model-less and side-effect-free with respect to
   the target branch and remote. It records the exact task revision, target
   branch and revision, history policy, repository identity, gate evidence,
   and predicted clean/conflict outcome.

4. Preparation is denied unless the task is Done, its current revision has
   passed validation and independent approval, its merge request is pending,
   and it has no unresolved owner decision, dependency, execution recovery, or
   late-evidence candidate.

5. A stale preparation can never execute. Target movement, task revision
   movement, policy version movement, repository identity change, or newly
   opened gate requires a fresh plan.

6. A predicted or observed conflict creates a visible integration-attention
   item. Pink Guy preserves the evidence and never asks an LLM to silently
   choose a resolution inside the integration operation.

7. Executing a plan requires a separate owner action. Prepare-only policy
   refuses execution. `local_integrate` policy may update only a named,
   allowed local target branch after rechecking all preparation evidence.

8. The supported local history policies are merge commit, squash, and rebase.
   Each produces a new result revision owned by Pink Guy. Rebase never rewrites
   the retained task revision or force-updates an existing branch.

9. Pink Guy refuses to update a checked-out target with local modifications.
   It also refuses non-fast-forward target publication and reports the
   condition as attention rather than cleaning or resetting owner work.

10. Optional remote publication is a separate policy and operation. A normal
    push may be enabled for a named remote/branch; force-push is always denied.
    GitHub pull-request creation may be enabled only when `gh` is available,
    authenticated by the owner, and the policy selects pull-request mode.

11. Every successful preparation and accepted execution/cancellation has a
    durable idempotent receipt. Replaying an identical accepted request returns
    the original receipt; reusing the key for different intent fails. A
    precondition refusal returns a structured error without claiming that a
    Git action was accepted.

12. The cockpit and `pink` CLI show the same policy, plan, state, current gate
    blockers, conflict evidence, allowed actions, and accepted-action receipts.
    Target and policy movement are rechecked when execution is requested and
    return a structured stale-plan refusal.

13. Successful integration changes the merge request from Requested to
    Integrated or Published and records the resulting local/remote revision.
    It does not erase the task revision, validation, review, execution, or
    source-workspace history.

14. Cancellation retains the plan and evidence. It does not modify Git state.

## Non-goals

- Autonomous conflict resolution.
- Force-push.
- Giving task containers repository credentials or protected-branch access.
- Assuming GitHub is the only supported repository host.
