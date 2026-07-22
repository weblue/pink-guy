# Pink Guy documentation

This index separates current operating truth from product contracts, feature
evidence, and retained history.

## Start here

1. [Repository README](../README.md) — shortest setup and usage path.
2. [Current state](product/CURRENT-STATE.md) — implemented capabilities,
   limits, readiness, and next gates.
3. [Local development runbook](operations/local-development.md) — complete
   local operation, model/auth handoff, task controls, recovery, Git, retention,
   and continuity.
4. [Testing and probes](operations/testing.md) — deterministic, Docker-backed,
   and opt-in live checks.

For delivery status, use the [roadmap](product/ROADMAP.md). The
[Phase 2 closure plan](product/PHASE2-CLOSURE.md) records the completed P2-4
gates and owns the active sustained-dogfood criteria. The more detailed
[Phase 2 plan](product/PHASE2-PLAN.md) is the implementation record.

## Current product and architecture

- [Product contract](product/PRODUCT.md) — target behavior; consult Current
  State before assuming every requirement is implemented.
- [Developer cockpit/UI contract](product/UI.md)
- [Technical architecture](architecture/TECH.md)
- [Decision log](architecture/DECISIONS.md)

## Implemented feature contracts

Each feature keeps three kinds of record:

- `PRODUCT.md` defines intended behavior and boundaries;
- `TECH.md` records design and implementation shape;
- `RESULTS.md` records verification and is the source for acceptance claims.

Phase 1:

- [Local control loop](features/local-control-loop/PRODUCT.md)
- [Local task controls](features/local-task-controls/PRODUCT.md)
- [Orchestrator conversations and intake](features/orchestrator-conversations/PRODUCT.md)
- [Editable agent prompt profiles](features/agent-prompt-profiles/PRODUCT.md)
- [Conversation custody and model switching](features/conversation-custody/PRODUCT.md)
- [Repository intake and dogfood controls](features/dogfood-controls/PRODUCT.md)
- [Workspace inspectors and phase flow](features/workspace-phase-flow/PRODUCT.md)
- [Automatic phase continuation](features/automatic-phase-continuation/PRODUCT.md)
- [Task lifecycle and planning artifacts](features/task-lifecycle-artifacts/PRODUCT.md)
- [Safe managed-project deletion](features/safe-project-deletion/PRODUCT.md)
- [Deterministic Ready scheduler](features/deterministic-ready-scheduler/PRODUCT.md)

Phase 2:

- [Execution recovery and late evidence](features/execution-recovery/PRODUCT.md)
- [Governed Git integration](features/governed-git-integration/PRODUCT.md)
- [Runtime lifecycle and retention](features/runtime-retention/PRODUCT.md)
- [Provider catalog and authentication guidance](features/provider-catalog-controls/PRODUCT.md)
- [Host and provider capacity calibration](features/capacity-calibration/PRODUCT.md)
- [Continuity export and isolated restore](features/continuity-export/PRODUCT.md)

P2-1 through P2-5 are complete. P2-4L plus live provider recovery,
publication, cleanup, and storage-pressure acceptance closed on 2026-07-22.
Phase 2D is the active sustained-dogfood gate.

## Adoption records

- [Phase 1 dogfood record](product/DOGFOOD-PLAN.md) — completed historical
  acceptance for supervised local use.
- [Denver DSA website dogfood results](features/denver-dsa-dogfood/RESULTS.md)
  — completed real-project experiment, lessons, and the P2-4L hardening scope.
- [Phase 2 closure and adoption plan](product/PHASE2-CLOSURE.md) — current
  P2-4, Phase 2D, and Phase 2U sequence.
- [UI friction schema](product/UI.md#phase-2d-friction-evidence) — evidence to
  capture during sustained dogfood.

Pink Guy is ready for sustained supervised dogfood. It is not yet the
recommended full-time replacement for a direct coding client, and it must not be exposed
remotely before the Phase 3 authentication profile exists.

## Research and retained history

- [Phase 0 foundation record](history/phase0/)
- [Phase 0 evidence manifests](history/phase0/evidence/)
- [Phase 0 ecosystem/provider research](research/phase0-landscape.md)
- [Pi persistent-intelligence assessment](research/pi-persistent-intelligence-assessment.md)

Research and Phase 0 documents explain earlier decisions; they do not define
current setup, paths, status, or runtime behavior. Historical evidence
manifests intentionally preserve the commands and disposable paths recorded
when they were produced.

Runtime databases, native sessions, credentials, unredacted provider or
command output, temporary worktrees, generated custody bundles, and benchmark
JSON remain outside Git.
