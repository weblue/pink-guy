# Pink Guy documentation

This index separates current operating truth from feature contracts, research,
and retained history.

## Start here

- [Local development runbook](operations/local-development.md) — start, access,
  verify, and stop the platform.
- [Current state](product/CURRENT-STATE.md) — implemented capabilities, stored
  artifacts, known gaps, and the next delivery slices.
- [Roadmap](product/ROADMAP.md) — canonical phase and exposure sequence.
- [Phase 2 delivery plan](product/PHASE2-PLAN.md) — recovery-first sequence,
  dependencies, exit evidence, and deferred work.
- [Phase 2 closure and adoption plan](product/PHASE2-CLOSURE.md) — the
  executable path from PR #17 through calibration, continuity, sustained
  dogfood, and the owner-reviewed UX redesign.
- [Phase 1 dogfood plan](product/DOGFOOD-PLAN.md) — entry gates, two real-work
  scenarios, evidence, and explicit non-requirements; retained as the completed
  Phase 1 record.
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
- [Safe managed-project deletion](features/safe-project-deletion/)
- [Deterministic Ready scheduler](features/deterministic-ready-scheduler/) —
  accepted D-046 moves eligibility, ordering, capacity, and sub-agent dispatch
  out of the LLM while keeping conversational task refinement and release.

P1-1 through P1-3 are usable. P1-4 now has its fixed-revision phase protocol,
model-less automatic test/review continuation, workspace inspector, and
observer baseline and deterministic initial Ready dispatch. A live
orchestrator-release task passed implementation, fixed-revision validation,
independent review, and completion, so Phase 1 is complete.

## Active Phase 2 features

These features are merged on `main`.

- [Execution recovery and late evidence](features/execution-recovery/) —
  central accepted-execution settlement, mutation fencing, paused/recovery
  states, and owner-governed checkpoint recovery are implemented and accepted.
- [Governed Git integration](features/governed-git-integration/) —
  prepare-only defaults, owner policy, merge/squash/rebase simulation,
  compare-and-swap local integration, optional push/PR, and conflict/restart
  attention are implemented.
- [Runtime retention](features/runtime-retention/) — retention holds, safe
  worktree/container cleanup, session deletion manifests/tombstones, storage
  inventory, and hard-pressure dispatch blocking are implemented.
- [Provider catalog and authentication guidance](features/provider-catalog-controls/)
  — the first P2-4 increment discovers Pi models, replaces model-ID text
  fields with selectors, and exposes a secret-safe host-TTY `/login` handoff.

## Adoption checkpoints

- **Supervised daily driver:** Phase 1 is complete; prefer Pink Guy for
  noncritical supervised local work while retaining a direct client for
  recovery.
- **Sustained dogfood:** complete P2-4 host/provider calibration and P2-5
  isolated-root continuity restore, then enter Phase 2D.
- **UX acceptance:** use Phase 2D evidence in a Phase 2U owner interview and
  existing-cockpit mockup; fix accepted scrolling, comprehension, and
  navigation friction.
- **Full-time local replacement:** pass Phase 2D and Phase 2U without routine
  direct-client repair.
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
