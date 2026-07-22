# Host and provider capacity calibration results

Status: Multi-project calibration and P2-4 operating policy complete

Last updated: 2026-07-22

## Environment

- Target: 64 GB M1 Max, 10 logical CPUs, macOS 15.7.7, AC power.
- Docker Desktop: 10 CPUs and 7.65 GiB VM memory.
- Operator baseline: Codex open and active; other ordinary foreground
  applications closed.
- Route: `openai-codex/gpt-5.4-mini` at medium thinking through the
  subscription credential profile.
- Raw artifacts are retained locally under ignored
  `artifacts/benchmarks/`. They contain no provider request, transcript,
  command-line, environment, or credential content.

These were exploratory runs while the recorder itself was being added. Their
metadata names Git revision `a889c32`, but the Pink Guy worktree was dirty.
The recorder now emits `git_working_tree_dirty`, writes a partial artifact on
owner stop, and records macOS memory-pressure percentage. Repeat any
policy-setting run from a committed revision.

The recorder was then committed as `add1a4e` and a clean-worktree
API-plus-one-orchestrator confirmation was captured. Across seven samples it
reported 94% minimum macOS memory-pressure availability, 138 MiB swap, zero
state growth/errors, 99.6 MiB peak control-plane RSS, and 118.6 MiB peak
orchestrator RSS. This clean run validates the recorder and confirms that the
lower raw-free-memory counter reflected reclaimable cache rather than host
pressure.

The multi-project windows used clean revision `807ddd7`. Raw artifacts are:

- `2026-07-20T020556Z-committed-three-orchestrators-idle.json`
- `2026-07-20T020830Z-serialized-two-project-maintenance.json`

## Measurements

| Window | Evidence |
| --- | --- |
| Codex + Docker idle | 13 samples over 67 seconds; 19.35 GiB minimum raw free memory, 19.40 GiB average, 138 MiB swap, zero Pink Guy containers, zero state growth, zero sample errors. |
| API + one idle project orchestrator | Control plane peaked at 91.2 MiB RSS/0.7% CPU; orchestrator at 108.1 MiB/0.7%; 64 KiB state growth; zero containers and sample errors. |
| Committed API + one orchestrator confirmation | Revision `add1a4e`, clean worktree, seven samples; 94% minimum memory-pressure availability; 99.6 MiB control-plane RSS; 118.6 MiB orchestrator RSS; zero state growth/errors. |
| One complete `doc-map` task lifecycle | 181 samples over 17m22s including quiet tails; one container at a time; 182.6 MiB peak container memory, 44.8% peak container CPU, 4.07 peak one-minute host load, 18.66 GiB minimum raw free memory, unchanged 138 MiB swap, 18.8 MiB retained-state growth, zero sample errors. A post-run `memory_pressure -Q` check reported 94% system-wide memory free. |
| API + three idle project orchestrators | 13 samples over 67 seconds from clean revision `807ddd7`; 94% minimum memory-pressure availability, 18.94 GiB minimum raw free memory, unchanged 138 MiB swap, zero containers/state growth/errors. Control plane peaked at 100.1 MiB RSS; the three orchestrators peaked at 103.3, 119.5, and 104.1 MiB. |
| Two serialized maintenance implementations across projects | 224 samples over 24m22s from clean revision `807ddd7`; 87% minimum memory-pressure availability, 13.40 GiB minimum raw free memory, unchanged 138 MiB swap, one container maximum, 231 MiB peak container memory, 31.74% peak container CPU, 9.14 peak one-minute load, 101.31 MiB state growth, and zero recorder errors. |

The successful task moved automatically through:

| Phase | Wall time | Result |
| --- | ---: | --- |
| implementation | 122.1 s | revision `9d99a60e4ef6`; 182.6 MiB peak container memory |
| test | 67.7 s | passed; 107.9 MiB peak container memory |
| independent review | 60.8 s | approved; 97.8 MiB peak container memory |

Phase handoffs took about two seconds and required no owner action. The final
task is `done`, its validation and approval address the same fixed revision,
and its merge request remains prepare-only. The source repository's `main`
was not changed and nothing was published remotely. Pink Guy's 19-probe core
suite and the generated project's 5-test suite both passed after the run.

## Failure evidence

The first implementation attempt found that Docker retained the runtime image
only under the legacy `boss-man:` tag while the renamed platform requested the
documented `pink-guy:` tag. The command moved from queued to
`reconciliation_required` in 0.87 seconds, before a container or provider
request began. After the identical image was given the current tag, the
uncertain execution was explicitly cancelled and a fresh task completed.

This is fast detection but clumsy recovery. A future implementation should
check runtime-image availability before accepting dispatch, and should
consider a governed way to resolve a `container_start` intent when Docker can
prove that no matching labeled container exists. The conservative rule that
ambiguous side effects cannot be retried remains correct.

Run events also retain `phase0-*` notification names and `boss_*` tool names.
They are compatibility/cleanup debt, not a lifecycle failure.

### Ten-minute hard deadline

The Pink Guy maintenance implementation remained active, emitted 931 bounded
run events, and committed checkpoint `3f032d4` after about 9m49s. Its final
assistant response was still streaming when the fixed 10-minute absolute
deadline fenced the execution. Cleanup completed, but the unresolved
`provider_response` intent projected `reconciliation_required` and no recovery
candidate even though the fixed checkpoint was retained. The execution was
then explicitly cancelled without deleting the checkpoint.

The checkpoint's dedicated `runtime_unavailable` probe passes independently in
the pinned task image, and the existing 19-probe core suite passes in its
worktree. It is not promoted: the new probe was omitted from `run-core.mjs`,
and the automatic test/review phases never ran because the execution missed
its deadline.

The inspector-gadget maintenance implementation completed in about 9m55s,
only five seconds before the same deadline. Automatic test and independent
review then passed, and its prepare-only merge request was recorded. An
independent host run of its Bash syntax and test suite also passed.

This is a reliability failure, not a capacity failure. The accepted recovery
contract already says activity/inactivity is the normal detector and a longer
hard deadline is only a final bound. P2-4 must replace the fixed 10-minute
assumption with visible configurable supervision, a bounded final-settlement
grace, and recovery-candidate projection for a proven checkpoint before
dogfood.

### Retained-state amplification

The 101.31 MiB aggregate growth is dominated by custody copies rather than
worktrees or event payloads:

| Run | Final native session | Immutable native copies | Snapshot bytes |
| --- | ---: | ---: | ---: |
| Pink Guy implementation | 2.0 MiB | 101 | 44.4 MiB |
| inspector-gadget implementation | 1.0 MiB | 87 | 34.7 MiB |

Pi emits `turn_start`, `context`, and `turn_end` for internal tool-loop turns.
The lifecycle extension currently captures the growing full native JSONL at
each boundary, producing quadratic-style growth during otherwise normal
agent work. Complete native sessions and mandatory pre-compaction/switch
custody remain required; copying the full session for every internal tool loop
does not.

The database is currently about 160 MiB. Roughly 134 MiB is an older
`message_update` amplification incident that stored cumulative assistant
messages on every delta; the bounded event sanitizer added afterward prevents
the two current runs from repeating it. That historical evidence remains
retained until explicit deletion and must not be mistaken for current event
growth.

## Current policy conclusions

- Keep executable task concurrency and the OAuth lane at **one**. This run
  proves cross-project serialization, not safe credential overlap.
- Three simultaneous idle project orchestrators are within the measured
  envelope. Their measured RSS is not the first constraint on this host.
- The 512 MiB container limit is sufficient for this small Node workload only.
  Do not generalize it to large builds.
- Do not select storage warning/hard thresholds from amplified snapshots.
  Fix the custody cadence, then repeat state-growth measurement.
- Docker's 7.65 GiB VM allocation is a real ceiling even though the host has
  64 GiB. Any future overlap policy must honor both.
- Do not widen active task concurrency while one healthy serialized run can
  be fenced by the fixed wall deadline.
- No evidence yet supports silent fallback, local-model routing, OAuth
  concurrency above one, or automatic remote publication.

## P2-4 closure result

1. D-057 progress-aware supervision and D-058 owner/mandatory-boundary custody
   pass deterministic regression. The earlier 24-minute serialized window
   remains the host envelope; a sustained 10+ minute closed-code task is an
   early Phase 2D confirmation.
2. Safe-boundary `gpt-5.6-sol`/`gpt-5.5` switching, explicit unavailable-route
   failure, and healthy-route recovery pass without transcript resend or silent
   fallback.
3. Two settled three-phase task lifecycles clean up with durable, replayable
   receipts; no Pink Guy task container remains.
4. Corrected retained state is 3.16 GiB after cleanup. Warning/hard thresholds
   are selected at 10/15 GiB and a below-current live profile proved the hard
   dispatch-pressure signal without deletion.
5. Pink Guy's governed adapter opened mergeable
   [Denver DSA PR #1](https://github.com/weblue/denver-dsa-test/pull/1) after
   automatic test and independent review.

Keep OAuth task capacity at one. A concurrent-provider experiment and a local
model route are optional Phase 2D research, not Phase 2 closure requirements.
