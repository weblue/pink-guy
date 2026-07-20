# Phase 2 closure and adoption plan

Status: Active — P2-5 complete; P2-4 live closure remains before Phase 2D

Last updated: 2026-07-19

## Purpose

This is the short operational plan between the implemented P2-1 through P2-3
foundation and preferring Pink Guy over a direct coding client. Detailed
contracts remain in [`PHASE2-PLAN.md`](PHASE2-PLAN.md); this document owns the
order, evidence, and stop conditions for closure, dogfood, and UX acceptance.

## Current gate

[PR #17](https://github.com/weblue/pink-guy/pull/17) is merged. P2-4 began from
merge revision `760b43d`. Its first increment adds Pi-backed model discovery,
provider/model selectors, non-secret authentication state, and a host-TTY
`/login` handoff. Capacity/resource measurement and the remaining live
side-effect drills are next.

The first P2-4 lifecycle and the three-orchestrator idle window pass on the
target Mac. A serialized two-project maintenance window kept one container at
a time and healthy host pressure, but exposed two Phase 2 reliability gates:
the fixed ten-minute hard deadline fenced active work while it was finishing,
and tool-loop lifecycle snapshots amplified 3 MiB of final native sessions
into about 79 MiB. Provider-failure/model-switch drills, corrected
state-growth measurement, cleanup, and publication remain. The owner approved
D-057/D-058; their implementation and deterministic regressions pass.

P2-5 is complete behind a short live export gate. Its standalone,
model-less probe proves checksummed export, credential exclusion, corruption
rejection, Git reconstruction, isolated restore, audit preservation, and
restored-task scheduling. The live rehearsal passed with 3 projects, 3,603
files, preserved audit/count evidence, zero source-path findings, and one
retained task queued on the isolated API with no provider or container start.

## 1. Close P2-4 — measured operating policy

Use the target 64 GB M1 Max and normal Docker/Pi authentication. Do not widen
defaults before measurement.

1. Retain the measured three-idle-orchestrator envelope and serialized
   OAuth-backed task capacity of one.
2. Repeat the two-project serialized run against the accepted D-057/D-058
   supervision and custody cadence. A task must safely pass
   ten minutes and retained growth must no longer copy full JSONL on each
   internal tool-loop turn.
3. Keep OAuth-backed phase work globally serialized unless a controlled
   overlapping two-run authentication/refresh test passes without shared
   writable credentials or lost refresh state.
4. Exercise a safe-boundary model switch, provider exhaustion, and—when the
   owner configures one—a Pi-compatible local-model route. No silent fallback.
5. Select warning/hard storage limits from corrected observed growth; hard pressure must
   pause dispatch and preserve retained evidence.
6. Perform one owner-authorized normal remote Git publication using either SSH
   Git or `gh`, while prepare-only remains the default for other projects.
7. Perform the pending live Docker cleanup drill against a settled disposable
   task and verify its manifest, receipt, retry behavior, and retained audit.

Exit evidence is a dated calibration record containing the selected
orchestrator/task concurrency, OAuth lane size, allowed provider responses,
storage thresholds, publication method, and any policy left deliberately
conservative.

## 2. P2-5 — bounded continuity (complete)

The accepted D-054 scope is implemented and verified:

1. Export a consistent SQLite snapshot, Pi-native session JSONL,
   custody/context manifests, retained artifacts, prompt/model-route
   references, Git provenance, and checksums without an LLM.
2. Exclude credentials, ephemeral containers, and undeclared host paths.
3. Verify the bundle before restore and restore it into a new isolated state
   root on this Mac without modifying the active root.
4. Confirm tasks, sessions, artifacts, Git custody, and audit hashes, then
   resume one retained task from the restored root.
5. Retain the export/restore report and cleanup instructions.

All five checks pass. Evidence is in
[`../features/continuity-export/RESULTS.md`](../features/continuity-export/RESULTS.md).

Cloud backup, scheduled encryption/retention, cross-platform migration, and a
second physical host are not Phase 2 exit requirements.

## 3. Phase 2D — sustained dogfood

Entry requires P2-4 and P2-5 evidence. Use Pink Guy for meaningful work in at
least three repositories, including one maintenance import and one
new-project topic, and complete at least ten executable tasks.

The window must exercise:

- deterministic dispatch and fixed-revision implementation/test/review;
- governed Git preparation or integration and lifecycle cleanup;
- browser reconnect, control-plane restart, custody/compaction, and model
  change during long orchestrator conversations;
- provider exhaustion, Git conflict, paused owner audit, late evidence,
  retention hold, cleanup retry, and isolated-root restore.

For every direct Codex/Pi escape, record the journey, reason, workaround,
whether work could resume in Pink Guy, and classification: missing capability,
reliability defect, UX friction, or preference. Record UX friction using the
schema in [`UI.md`](UI.md).

Phase 2D exits after an owner-approved measured window with no direct SQLite
repair, no manual artifact reconstruction, and no routine direct-client repair
path. Blocking reliability defects return to Phase 2 work. Usability findings
continue to Phase 2U rather than being redesigned ad hoc.

## 4. Phase 2U — interview, mockup, and accepted redesign

Start with the evidence, not a replacement UI:

1. Interview the owner around the most common journeys: intake/refinement,
   board triage, task evidence, attention/recovery, Git integration, retention,
   and multi-project switching.
2. Reproduce the chat bounceback and unbounded panel/page scrolling reports.
3. Inventory elements the owner cannot explain or use confidently; decide
   whether each needs clearer language, hierarchy, progressive disclosure, or
   removal.
4. Produce a mockup that evolves the current three-region cockpit and includes
   desktop behavior first. Do not add a browser terminal unless dogfood records
   a workflow Pi RPC plus tmux/SSH cannot satisfy.
5. Review the mockup with the owner and record accepted behavior before code.
6. Implement the accepted high-frequency changes with focused scrolling,
   navigation, and state-comprehension regression coverage.

Exit requires owner acceptance of the implemented UX baseline and another
short regression dogfood run proving that long conversations and task
operations remain stable. This is the gate for preferring Pink Guy as the
full-time local coding environment.

## 5. Remaining phase

Phase 3 adds authenticated remote access through the existing SWAG host:
single-owner session and/or API-key authentication, trusted proxy and
Host/Origin validation, CSRF, WebSocket/stream/upload reconnect behavior, rate
limits, rotation/revocation, and deployment/runbook artifacts. The human owns
DNS, SWAG, router, production secrets, and long-lived service deployment.

The following remain needs-driven rather than planned phases: a browser
terminal, LiteLLM/OpenRouter intermediary, RAG/vector retrieval, cloud backup,
second-host scheduling, notifications, ticket write-back, shared credential
broker, team accounts, and high availability.

## Pending owner decisions

D-057 and D-058 are approved and no longer block implementation.

The remaining P2-4 choices are:

- measured concurrency and OAuth lane size;
- allowed pause/retry/manual-route behavior per provider class;
- useful restrictions for any configured local-model outage lane;
- storage warning/hard limits;
- SSH Git versus `gh` for the first remote publication.

Phase 2U later requires owner approval of the mockup and its hard-to-change
interaction hierarchy. Docker engine replacement, remote authentication mode,
cloud backup, and multi-host operation are not current decisions.
