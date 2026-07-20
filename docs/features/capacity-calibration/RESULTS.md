# Host and provider capacity calibration results

Status: Initial single-project evidence; P2-4 remains open

Last updated: 2026-07-19

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

## Measurements

| Window | Evidence |
| --- | --- |
| Codex + Docker idle | 13 samples over 67 seconds; 19.35 GiB minimum raw free memory, 19.40 GiB average, 138 MiB swap, zero Pink Guy containers, zero state growth, zero sample errors. |
| API + one idle project orchestrator | Control plane peaked at 91.2 MiB RSS/0.7% CPU; orchestrator at 108.1 MiB/0.7%; 64 KiB state growth; zero containers and sample errors. |
| Committed API + one orchestrator confirmation | Revision `add1a4e`, clean worktree, seven samples; 94% minimum memory-pressure availability; 99.6 MiB control-plane RSS; 118.6 MiB orchestrator RSS; zero state growth/errors. |
| One complete `doc-map` task lifecycle | 181 samples over 17m22s including quiet tails; one container at a time; 182.6 MiB peak container memory, 44.8% peak container CPU, 4.07 peak one-minute host load, 18.66 GiB minimum raw free memory, unchanged 138 MiB swap, 18.8 MiB retained-state growth, zero sample errors. A post-run `memory_pressure -Q` check reported 94% system-wide memory free. |

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

## Current policy conclusions

- Keep executable task concurrency and the OAuth lane at **one**. This run
  proves sequential continuation, not safe credential overlap.
- Multiple idle project orchestrators appear cheap enough for the next
  controlled multi-project window; their measured RSS, not host RAM, is
  unlikely to be the first constraint.
- The 512 MiB container limit is sufficient for this small Node workload only.
  Do not generalize it to large builds.
- Do not select storage warning/hard thresholds from one 18.8 MiB sample.
- Docker's 7.65 GiB VM allocation is a real ceiling even though the host has
  64 GiB. Any future overlap policy must honor both.
- No evidence yet supports silent fallback, local-model routing, OAuth
  concurrency above one, or automatic remote publication.

## Next benchmark

Run three idle project orchestrators together, then execute two tasks
serially across different projects using the same OAuth lane. Only after that
passes should the owner decide whether a controlled two-provider-run overlap
is worth the credential risk.
