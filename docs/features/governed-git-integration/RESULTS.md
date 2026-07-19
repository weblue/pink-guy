# Governed Git integration results

Status: Model-less acceptance complete

Last updated: 2026-07-19

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

The full dependency-free core suite includes this probe and passes. A live
credentialed normal push or `gh` pull-request publication is intentionally
scheduled with P2-4 credential/provider calibration; default policy remains
prepare-only until an owner changes it.

A fresh-context pre-PR review also verified that precondition refusals do not
claim accepted-action receipts; Git attention exposes current gate blockers
and accepted receipt counts consistently in the cockpit and `pink` client.

## Command

```sh
npm run test:git-retention
```
