# Phase 2 closure and adoption plan

Status: Phase 2 complete — Phase 2D sustained dogfood is the active gate

Last updated: 2026-07-22

## Purpose

This is the short operational plan between the implemented P2-1 through P2-3
foundation and preferring Pink Guy over a direct coding client. Detailed
contracts remain in [`PHASE2-PLAN.md`](PHASE2-PLAN.md); this document owns the
order, evidence, and stop conditions for closure, dogfood, and UX acceptance.

## Current gate

Phase 2 closed on 2026-07-22. P2-4L, provider/model recovery, settled
cleanup, storage pressure, Pink-owned push/PR publication, and P2-5 isolated
restore all pass. Begin Phase 2D; do not treat implementation closure alone as
the full-time replacement decision.

[PR #17](https://github.com/weblue/pink-guy/pull/17) began P2-4 from merge
revision `760b43d` with Pi-backed model discovery, provider/model selectors,
non-secret authentication state, and a host-TTY `/login` handoff.

The first P2-4 lifecycle and the three-orchestrator idle window pass on the
target Mac. A serialized two-project maintenance window kept one container at
a time and healthy host pressure, but exposed two Phase 2 reliability gates:
the fixed ten-minute hard deadline fenced active work while it was finishing,
and tool-loop lifecycle snapshots amplified 3 MiB of final native sessions
into about 79 MiB. Those findings produced D-057/D-058 and the now-complete
closure drills below.

P2-5 is complete behind a short live export gate. Its standalone,
model-less probe proves checksummed export, credential exclusion, corruption
rejection, Git reconstruction, isolated restore, audit preservation, and
restored-task scheduling. The live rehearsal passed with 3 projects, 3,603
files, preserved audit/count evidence, zero source-path findings, and one
retained task queued on the isolated API with no provider or container start.

The first substantial website dogfood experiment exposed the following
now-closed lifecycle defects. Its concise
outcome and lessons are retained in
[`../features/denver-dsa-dogfood/RESULTS.md`](../features/denver-dsa-dogfood/RESULTS.md):

1. An implementation session reached Pi's context-length stop after writing
   uncommitted files and compacted without recording a new fixed revision or
   review request. The command still settled as `succeeded` because phase
   settlement accepted matching implementation evidence left by an earlier
   run. Phase success must require authoritative evidence created by the
   current run after its execution baseline, not merely evidence that already
   exists for the task.
2. The false success left the task `in_progress`, assigned to a historical
   worker, with no automatic test/review continuation. A stopped or compacted
   implementation with a dirty workspace must remain resumable and visible,
   but cannot be reported as a completed phase. Recovery must either resume
   custody to a checkpoint or fail with a specific protocol outcome.
3. Execution attention continued to foreground a superseded failed attempt
   after its retry succeeded. Historical attempts remain auditable, but a
   successful replacement must reconcile or collapse the older attention item
   so the owner sees the current actionable state first.
4. A project orchestrator awaiting a long task execution stopped renewing its
   lease. The lease expired while the child run remained active, after which
   the daemon emitted repeated authorization failures instead of renewing or
   exiting for supervised restart. Heartbeats and conversation polling must
   remain independent of a long command wait, and an expired lease must have a
   bounded self-recovery or fail-stop path.
5. A host-preserved recovery commit could not be consumed in the task
   container because raw Git metadata is intentionally unavailable and the
   governed Git surface has no apply/adopt-recovery operation. Add a
   checksummed recovery artifact or host-owned revision-adoption path so
   resumable work does not require copying an ad-hoc patch into a live
   workspace or promoting an intermediate baseline manually.
6. `boss_git_diff` returned the full binary deletion diff for the recovered
   website workspace. The resulting 18 MB tool result exceeded the provider's
   10 MB per-field limit, forced compaction, and ended a clean, passing
   implementation without its required phase outcome. Governed Git inspection
   must summarize binary changes and cap projected diff output before it enters
   the Pi transcript.
7. Generated `node_modules/.bin` symlinks left in inactive task workspaces
   caused startup inventory to reject the entire state root. Inventory must
   classify or skip known generated dependency trees without weakening its
   rejection of unexpected symlinks in retained custody and artifact paths.

The current recovery branch adds audited reset of a task after a reconciled
cancelled execution and guarded owner adoption of a clean retained workspace
revision. Adoption requires the same terminal task execution, a clean retained
workspace, a candidate equal to that workspace's `HEAD`, and ancestry from the
current authoritative task revision. The Denver DSA regression verified this
recovery path end to end: revision `d57a221` was adopted, resumed, independently
validated, independently approved, and locally integrated through Pink Guy as
merge commit `2feb884` without direct SQLite edits or a remote push. A browser
smoke test then found the desktop-breakpoint navigation hidden; Pink Guy
created and completed a separate focused task with deterministic responsive
coverage, independent validation/review, and final local integration at
`b75c464`. The owner then enabled project push policy and published that final
revision to `origin/main`. Because publication occurred through an owner-side
Git push after the governed integration had completed, it proves credentials
and remote reachability. The later bounded maintenance fixture closed the
Pink-owned adapter drill through Denver DSA PR #1.

These are tracked as the bounded **P2-4L lifecycle-hardening iteration** because
the completed experiment required a direct-client artifact repair. Denver DSA
now supplies retained recovery/integration and responsive-browser fixtures;
all seven defects are implemented and verified. Defect 5's guarded
recovery-revision adoption also remains live-verified.

## 1. P2-4 — measured operating policy (complete)

Closure evidence:

- All 20 deterministic probes pass, including current-run phase evidence,
  superseded-attention filtering, independent daemon heartbeat/fail-stop,
  bounded binary-safe diffs, generated-tree inventory, provider-failure model
  recovery, and cleanup/storage pressure.
- Pi 0.80.9 exposed seven authenticated `openai-codex` models. A live
  `gpt-5.6-sol` → `gpt-5.5` → `gpt-5.6-sol` conversation switch used verified
  custody snapshots and resumed without transcript resend. An unavailable
  provider failed explicitly; the healthy route recovered the conversation
  without fallback.
- The OAuth task lane stays globally serialized at one; three idle project
  orchestrators remain the measured envelope.
- Live settled cleanup retired two separate three-phase task lifecycles,
  retained receipts, replayed an identical cleanup request, and left no Pink
  Guy task container. Inventory reports generated dependency symlinks without
  following them.
- Corrected retained state is 3.16 GiB. The selected warning/hard profile is
  10/15 GiB. A temporary below-current profile proved visible hard pressure;
  no pressure path deletes evidence.
- Pink Guy implemented, tested, independently reviewed, and published the
  bounded Denver maintenance fixture through its own adapter as
  [Denver DSA PR #1](https://github.com/weblue/denver-dsa-test/pull/1).
  The branch push was normal/non-force and the PR is mergeable.

The prior serialized 24-minute two-project measurement and live workflows
establish the target-host envelope. The first sustained 10+ minute task under
the closed code becomes an early Phase 2D confirmation, not another synthetic
pre-dogfood gate.

Final operating policy on the target 64 GB M1 Max:

1. Retain the measured three-idle-orchestrator envelope and globally
   serialized OAuth-backed task capacity of one.
2. Use D-057 activity-aware supervision and D-058 bounded custody cadence;
   confirm the first sustained 10+ minute closed-code run during Phase 2D.
3. Pause visibly on provider failure and require an explicit custody-backed
   route change or retry. Never fall back silently.
4. Warn at 10 GiB retained state and pause dispatch at 15 GiB; never delete
   evidence automatically.
5. Keep prepare-only as the project default. The first authorized publication
   method is normal Git push plus `gh` PR creation.
6. Retire settled containers/worktrees only through previewed, audited,
   replayable cleanup.

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

D-057 and D-058 are approved and verified. P2-4 keeps the conservative OAuth
lane at one, explicit pause/switch rather than silent fallback, 10/15 GiB
storage pressure, and normal Git push plus `gh` for the first Pink-owned PR.
A useful local-model outage route remains conditional on the owner configuring
one in Pi; it is not a Phase 2 blocker.

Phase 2U later requires owner approval of the mockup and its hard-to-change
interaction hierarchy. Docker engine replacement, remote authentication mode,
cloud backup, and multi-host operation are not current decisions.
