# Workspace inspectors and phase flow results

Status: Implementation ready for live-provider dogfood

Last updated: 2026-07-18

## Implemented

- Phase-aware scheduling for implementation, test, and independent review.
- Project-orchestrator commands execute a deterministic kickoff to Pi
  settlement and release the task container.
- Host Git checkpoints advance task revision through an idempotent audited
  receipt.
- Test and review worktrees start at the authoritative fixed revision.
- Test-scoped validation capability and Pi tool, without commit authority.
- Automatic orchestrator completion after passed validation, approved
  independent review, resolved decisions, and completed dependencies.
- Loopback task workspace API and cockpit inspector for commands, phase runs,
  models/prompts, workspaces, committed diffs, Git provenance, validation,
  reviews, context custody, artifacts, source snapshots, decisions, and audit.
- Model-less observer baseline available through `npm run test:workflow`.

## Verification

- `npm test` — nine Phase 1 probes passed with zero provider requests.
- `npm run test:workflow` — implementation → checkpoint → test → review →
  completion passed against one immutable revision.
- `npm run test:baseline` — reproducibility baseline passed.
- `probe-direct-runtime-git-rtk.mjs` — ARM64 Docker isolation, host checkpoint
  custody/replay, RTK redaction/artifacts, credential cleanup, and container
  cleanup passed.
- Local browser smoke on port 4311 rendered authoritative phase controls,
  completion gates, validation/review sections, phase timeline, workspace
  inspector, and source snapshot section.

## Remaining Phase 1 evidence

Run the live provider workflow through the normal cockpit and project daemon
on at least two real repositories. Record failures as product gaps rather than
editing SQLite or using probe helpers. Actual merge/rebase/push and worktree
cleanup remain Phase 2.
