# Boss Man documentation

This index separates current operating truth from feature contracts, research,
and retained history.

## Start here

- [Local development runbook](operations/local-development.md) — start, access,
  verify, and stop the platform.
- [Current state](product/CURRENT-STATE.md) — implemented capabilities, stored
  artifacts, known gaps, and the next delivery slices.
- [Roadmap](product/ROADMAP.md) — canonical phase and exposure sequence.
- [Phase 1 dogfood plan](product/DOGFOOD-PLAN.md) — entry gates, two real-work
  scenarios, evidence, and explicit non-requirements.
- [Decision log](architecture/DECISIONS.md) — owner-approved, proposed, and
  deferred decisions.

## Product and architecture

- [Product contract](product/PRODUCT.md)
- [Developer cockpit/UI direction](product/UI.md)
- [Technical architecture](architecture/TECH.md)

## Implemented Phase 1 feature contracts

Each feature directory contains its product behavior, technical design, and
verification results.

- [Local control loop](features/local-control-loop/)
- [Local task controls](features/local-task-controls/)
- [Orchestrator conversations](features/orchestrator-conversations/)
- [Editable agent prompt profiles](features/agent-prompt-profiles/)
- [Conversation custody and model switching](features/conversation-custody/)
- [Repository intake and dogfood controls](features/dogfood-controls/)
- [Workspace inspectors and phase flow](features/workspace-phase-flow/)
- [Automatic phase continuation](features/automatic-phase-continuation/)
- [Task lifecycle and planning artifacts](features/task-lifecycle-artifacts/)

P1-1 through P1-3 are usable. P1-4 now has its fixed-revision phase protocol,
model-less automatic test/review continuation, workspace inspector, and
observer baseline; the implementation frontier is live-provider dogfooding
across real repositories.

## Adoption checkpoints

- **Dogfood now:** use Boss Man alongside a direct coding client for
  noncritical, supervised work.
- **Supervised daily driver:** complete Phase 1 and validate the full
  implementation → fixed checkpoint → test → review flow across multiple real
  repositories.
- **Full-time local replacement:** complete Phase 2 recovery, Git completion,
  credential/concurrency, backup, and portability gates.
- **Remote-first operation:** complete Phase 3 authentication and SWAG
  deployment.

## Operations and testing

- [Local development](operations/local-development.md)
- [Testing and probes](operations/testing.md)

## Research and history

- [Phase 0 ecosystem and provider research](research/phase0-landscape.md)
- [Pi persistent-intelligence assessment](research/pi-persistent-intelligence-assessment.md)
- [Phase 0 foundation record](history/phase0/)
- [Phase 0 evidence manifests](history/phase0/evidence/)

Historical evidence manifests intentionally preserve the paths and command
strings recorded when the evidence was produced. Current executable paths are
listed in the testing guide.

Runtime databases, native sessions, credentials, unredacted provider or
command output, temporary worktrees, and generated custody bundles stay
outside Git.
