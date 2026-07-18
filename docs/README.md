# Boss Man documentation

This index separates current operating truth from feature contracts, research,
and retained history.

## Start here

- [Local development runbook](operations/local-development.md) — start, access,
  verify, and stop the platform.
- [Current state](product/CURRENT-STATE.md) — implemented capabilities, stored
  artifacts, known gaps, and the next delivery slices.
- [Roadmap](product/ROADMAP.md) — canonical phase and exposure sequence.
- [Decision log](architecture/DECISIONS.md) — owner-approved, proposed, and
  deferred decisions.

## Product and architecture

- [Product contract](product/PRODUCT.md)
- [Developer cockpit/UI direction](product/UI.md)
- [Technical architecture](architecture/TECH.md)
- [Foundation ADR](architecture/ADR-FOUNDATION.md)

## Implemented Phase 1 feature contracts

Each feature directory contains its product behavior, technical design, and
verification results.

- [Local control loop](features/local-control-loop/)
- [Local task controls](features/local-task-controls/)
- [Orchestrator conversations](features/orchestrator-conversations/)

The orchestrator-conversation slice is the current implementation frontier.
Browser/terminal parity is complete. Conversation custody and safe model
switching are next, followed by repository/source intake, task-detail
reconciliation, and developer inspectors.

## Adoption checkpoints

- **Dogfood now:** use Boss Man alongside a direct coding client for
  noncritical, supervised work.
- **Supervised daily driver:** complete Phase 1 and validate the full
  implementation → test → review → checkpoint flow across multiple real
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
