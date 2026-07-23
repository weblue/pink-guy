# Governed Git integration results

Status: Model-less acceptance and live push/PR publication complete

Last updated: 2026-07-22

## Accepted behavior

The deterministic Phase 2 Git/retention probe creates two clean repository
contexts and proves:

- new projects default to prepare-only, merge-commit history, detected target,
  `origin`, and no remote writes;
- merge-commit, squash, and rebase plans produce valid isolated results;
- a deterministic content conflict leaves the target branch unchanged;
- integration execution requires current completion, validation, independent
  approval, policy version, source revision, and target revision;
- source revisions remain addressable after integration;
- preparation retries return the original receipt even after target movement;
- completed integration worktrees and local integration branches are removed;
- force push is absent from the policy and Git adapters;
- an interrupted integration is reconciled to owner attention without replay.

The full dependency-free core suite includes this probe and passes. Default
policy remains prepare-only until an owner changes it.

A fresh-context pre-PR review also verified that precondition refusals do not
claim accepted-action receipts; Git attention exposes current gate blockers
and accepted receipt counts consistently in the cockpit and `pink` client.

## Live P2-4 publication

The owner temporarily enabled `pull_request` mode with normal push and PR
authorization only for the Denver test project. Pink Guy created task
`a820875a-62bc-4d2d-8d8a-57fce36c1f27`, produced revision `1610973`, passed a
fresh test phase, received independent approval on that revision, and recorded
its merge request. Integration `3c76c91c-466f-405f-8b09-026a7c8cf2e6` then:

- simulated a clean merge against exact target `b75c464`;
- created integration revision `5e50ee7` under host-owned Git authority;
- pushed `pink-guy/integration/3c76c91c-466f-405f-8b09-026a7c8cf2e6`
  without force;
- opened [Denver DSA PR #1](https://github.com/weblue/denver-dsa-test/pull/1)
  through `gh`; and
- retained a completed publication receipt while removing the temporary
  integration worktree.

GitHub reported the PR mergeable. The adapter, rather than an owner-side
manual push, therefore closes the live credentialed push/PR gate. The PR is
left open for human audit; this drill does not change the prepare-only default
for other projects.

## Command

```sh
npm run test:git-retention
```
