# Workspace inspectors and phase flow results

Status: Implemented and live-dogfooded; Phase 1 complete

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

- `npm test` — the current 15-probe Phase 1 suite passes with zero provider
  requests (nine probes existed when this slice first landed).
- `npm run test:workflow` — implementation → checkpoint → test → review →
  completion passed against one immutable revision.
- `npm run test:baseline` — reproducibility baseline passed.
- `probe-direct-runtime-git-rtk.mjs` — ARM64 Docker isolation, host checkpoint
  custody/replay, RTK redaction/artifacts, credential cleanup, and container
  cleanup passed.
- Local browser smoke on port 4311 rendered authoritative phase controls,
  completion gates, validation/review sections, phase timeline, workspace
  inspector, and source snapshot section.

## Phase 1 closure evidence

The workflow passed through the normal cockpit/project daemons on the local
`doc-map` prototype and imported `inspector-gadget` maintenance repository.
The final automatic-release run also proved model-less initial dispatch,
fixed-revision validation, independent review, and completion without SQLite
edits or probe helpers. Actual merge/rebase/push and settled worktree cleanup
remain Phase 2.
