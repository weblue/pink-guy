# Phase 1 dogfood plan

Status: Complete — Phase 1 accepted for supervised local development

Last updated: 2026-07-18

This is the retained Phase 1 acceptance record. The current sustained-dogfood
gate and UX evidence protocol are defined in
[`PHASE2-CLOSURE.md`](PHASE2-CLOSURE.md).

## Objective

Prove that Pink Guy can replace a direct coding client for supervised,
low-risk local work across multiple repositories using only the normal
cockpit, project orchestrators, Pi task agents, and audited controls.

## Entry gates

- The fixed-revision workflow PR is merged to `main`.
- `npm test`, `npm run test:workflow`, and `npm run test:baseline` pass from a
  clean checkout.
- Docker is available, the pinned task image exists, and the owner-managed Pi
  credential source is readable by the host process.
- The API runs on loopback and each selected repository has one active project
  orchestrator.
- `probe-phase1-dogfood-readiness` proves plain-text prompt loading,
  per-subagent route selection, blocking orchestrator pre-compaction custody,
  and model-less system-intake → project transfer.
- `probe-direct-live-provider` passes against the owner-managed login and
  pinned ARM64 task image.

## Scenarios

1. **Maintenance repository:** one refined, low-risk bug or external work-item
   snapshot with deterministic regression coverage.
2. **New work:** one bounded feature or prototype whose orchestrator must
   clarify material ambiguity and create or refine the task graph.

Use different repositories. Avoid production deployment, secret rotation,
schema migration, public networking, or major architecture decisions.

## Run sequence

For each scenario:

1. Attach or select the repository and provide an immutable request/source
   snapshot. For the prototype scenario, begin in system intake and use
   **Snapshot + transfer** (or `pink bind`) after choosing the repository.
2. Converse with the project orchestrator until acceptance criteria and any
   decision gates are explicit.
3. Let the orchestrator schedule implementation after refinement and observe
   its container, worktree, progress, host checkpoint, artifacts, and final
   fixed revision. Use the manual phase control only as an explicit override
   or recovery action.
4. Observe automatic test scheduling and verify that its fresh worktree base
   equals that revision and that exact pass/fail evidence is recorded.
5. Observe automatic independent review scheduling and inspect reviewer
   identity, findings, disposition, diff, validation, context receipts, and
   artifacts.
6. Confirm the orchestrator marks the task Done only when every completion
   gate passes and records—not executes—the merge request.
7. Smoke-test the resulting revision outside the agent container, then record
   usability, missing evidence, recovery friction, and resource observations.

Run the two repositories concurrently only if credentials permit it. The
current OAuth snapshot policy intentionally serializes OAuth-backed task runs.

## Failure policy

- Do not edit SQLite or use probe-only helpers to make a dogfood run pass.
- Do not silently replay an uncertain command or provider side effect.
- Use normal retry/reset, decision, block, and resume controls.
- Treat missing or misleading task/diff/test/review/custody evidence as a
  product defect even when the code change itself is correct.
- A direct Pi/Codex client remains the recovery path during Phase 1.

## First-run findings

The first live project conversation successfully refined a reversible UI
request into acceptance criteria and attempted automatic implementation. It
then exposed three defects that must remain regression gates:

- an orchestrator could name a syntactically valid but unconfigured provider,
  causing a predictable authentication failure;
- task settlement inherited a 30-second generic RPC timeout even while Pi was
  emitting active progress; and
- a terminal command failure remained visually `in_progress` instead of
  projecting blocked attention.
- task-run storage retained thousands of repeated partial `message_update`
  payloads, including reasoning metadata that belongs only in native Pi
  custody; and
- the conversational orchestrator announced that test/review would follow,
  but no event-driven continuation scheduled those phases after the original
  turn ended (addressed by the model-less automatic phase coordinator); and
- independent test scheduling accepted a task in `review`, while task startup
  rejected that same state before a container or provider request.

Runtime supervision must not rely only on a long wall-clock timeout. Pi or
container exit and explicit protocol errors should fail immediately; a
progress-aware inactivity watchdog should reset on meaningful RPC activity;
and a longer hard ceiling should remain only as a final bound for an agent
that is still demonstrably active.

Normal operation should continue implementation → test → review from durable
task events when gates become satisfied. The owner phase control remains an
explicit override/recovery path, not the expected way to advance ordinary
work.

After applying the bounded recovery fixes, the same live task completed:

- implementation produced host checkpoint
  `fa2ceab26a529f7f032ea6e080e7e41811e298e7`;
- independent test passed from that exact fixed revision;
- independent review approved that revision with no findings;
- completion gates moved the task to `done` and recorded a merge request; and
- sanitized test/review projections retained 188 and 55 structured events,
  respectively, instead of thousands of raw partial deltas.

The source revision is retained by its task branch, recorded checkpoint, and
artifact provenance. Completed run worktrees are disposable and may be removed
after settlement; automatic worktree retirement remains Phase 2. Phase 1
records the merge request but does not yet push or merge it, so external
integration remains an owner action until Phase 2 policy is implemented.

## New-project scenario result

The `doc-map` prototype exercised system intake, model-less custody transfer
to a newly initialized local repository, task creation, implementation,
validation, requested-changes recovery, independent re-review, and completion.

- System intake narrowed v1 to local file-existence checks and explicitly
  deferred Markdown fragment/heading validation.
- The bound project created one executable `prototype`, `cli`, `markdown`
  task with concrete acceptance criteria.
- Initial implementation checkpointed revision
  `e05ea4b9be11a9f35d57a42a1daa9a3caa995a25`; validation passed, but review
  correctly requested changes for balanced-parentheses and escaped-`)` link
  destinations.
- A resumed implementation checkpointed
  `85baf0441c76c89f75cee13c7865e27babcbadfd` with deterministic scanner
  coverage. Its command later failed with `fetch failed`, so the owner used
  normal reset and schedule controls to accept the independently proven
  checkpoint without replaying implementation.
- Recovered validation passed three tests at the fixed revision. Independent
  review approved with no findings, completion moved the task to Done, and a
  merge request was recorded.
- Host-side smoke testing outside the agent container passed `npm test` and
  produced a clean JSON inventory for the repository.

The run exposed four evidence-backed follow-ups:

1. After system-intake binding, the resumed conversation initially retained
   the stale belief that it was unbound until explicitly told to refresh
   authoritative Pink Guy state.
2. The orchestrator can refine a task after requested changes but has no
   structured resume tool; the owner-only resume control was required.
3. A post-checkpoint transport failure has no direct “accept proven
   checkpoint and continue validation” action. Reset plus explicit test
   scheduling works but is unnecessarily indirect.
4. Repository import initially had no normal cancel/delete control. The safe
   managed-project deletion slice now provides an audited, idempotent cleanup
   path for unused imports while refusing projects with retained work.

## Maintenance-repository scenario result

Pink Guy imported the existing
`https://github.com/weblue/inspector-gadget.git` repository into a host-owned
checkout and created its durable project topic. The owner supplied a bounded
maintenance request to add a model-less Bash syntax regression check.

- The orchestrator made one explicit assumption: “tracked Bash scripts” means
  the repository's current Git-tracked `.sh` files.
- It created one executable `maintenance`, `bash`, `regression-test` task with
  five concrete acceptance criteria and scheduled implementation.
- Implementation produced fixed revision
  `30f1cc551de44b08cf5d8573ea54ee7f40c8fb66`, adding
  `check-bash-syntax.sh` and concise README usage in a 52-line diff.
- The model-less coordinator automatically scheduled test at that exact
  revision. Validation passed with inspected script/README evidence and a
  successful syntax run.
- The coordinator then automatically scheduled an independently identified
  reviewer. Review approved the same revision; completion moved the task to
  Done and recorded merge request
  `bbcca053-1f89-4a59-ba66-8f9153815a3c`.
- Host smoke outside the task container reported:
  `bash -n passed for 6 tracked Bash scripts.`

No owner phase button, direct SQLite mutation, probe helper, manual test/review
schedule, remote push, or merge was used. The run proved checkout, scoped
conversation refinement, implementation, fixed-revision validation,
independent review, completion, and observable model-less phase continuation.

That run sharpened the architecture boundary addressed by D-046. The
conversational LLM still expresses release intent, but the implemented central
scheduler now owns Ready eligibility, ordering, capacity, and initial
sub-agent dispatch.

## Automatic-release closure result

The owner asked the live Pink Guy orchestrator to refine the cockpit's lease
observability. The orchestrator created and released executable task
`94613637-58af-4ba5-ae4e-b03503bf5a54` with automatic dispatch policy and
priority 10.

- The `task_released` event was recorded at `2026-07-18T22:03:55.734Z`; the
  model-less scheduler created the implementation command two milliseconds
  later without a manual phase action.
- Implementation produced host checkpoint
  `392df1763419a143523dd3a9512f8371bc6a2de1`.
- Independent validation passed the 15-probe core suite and the new lease
  projection probe at that exact revision.
- An independently identified reviewer approved the same revision with no
  findings.
- Completion moved the task to Done and recorded merge request
  `4c0eb5af-e68a-470f-8aba-0939320f2c17`.
- The resulting lease-observability change was reviewed and merged as
  [PR #15](https://github.com/weblue/pink-guy/pull/15).

The run also found a Phase 2 recovery defect: the implementation command
recorded `TypeError: fetch failed` while its Pi run remained alive and later
emitted a checkpoint. The owner stopped the orphaned session and used the
audited reset control; no SQLite edit, probe helper, or unrecorded transition
was used. Validation and review then settled normally. Phase 2 must couple
command failure to run cancellation and make late-evidence reconciliation
explicit so a reset cannot race a still-running agent.

## Exit evidence

Phase 1 can close when both scenarios have:

- complete task and command audit trails;
- one fixed implementation revision shared by test and review;
- reproducible validation evidence and independent review;
- inspectable context/artifact/Git custody;
- no manual database repair or unrecorded state transition;
- a human smoke result; and
- documented defects classified as fixed, Phase 2, or explicitly deferred.

All exit evidence is now satisfied. Pink Guy is accepted as the preferred
supervised local development path, with direct Pi/Codex retained as the
recovery fallback until Phase 2 closes.

## Deliberate boundaries

- Use Pi's recorded per-run provider/model route, including a local model when
  configured; no separate routing service is assumed. The current host has no
  local provider registered in `pi --list-models`, so local execution is not a
  Phase 1 dogfood prerequisite.
- Keep artifacts, context, native sessions, and memories in canonical storage;
  FTS remains the model-less retrieval projection.
- The host daemon creates task containers dynamically. Task containers do not
  receive the Docker socket or create child containers.
- External work enters through immutable generic source snapshots with no
  synchronization contract.
- Loopback is the only Phase 1 listener.
- Completion and merge-request creation may be automatic after independent
  review; merge/rebase/push remains Phase 2.
