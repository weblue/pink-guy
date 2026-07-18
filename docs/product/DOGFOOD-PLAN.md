# Phase 1 dogfood plan

Status: Active dogfood — first project workflow completed with recovery defects

Last updated: 2026-07-18

## Objective

Prove that Boss Man can replace a direct coding client for supervised,
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
   **Snapshot + transfer** (or `boss bind`) after choosing the repository.
2. Converse with the project orchestrator until acceptance criteria and any
   decision gates are explicit.
3. Let the orchestrator schedule implementation after refinement and observe
   its container, worktree, progress, host checkpoint, artifacts, and final
   fixed revision. Use the manual phase control only as an explicit override
   or recovery action.
4. Schedule test and verify that its fresh worktree base equals that revision
   and that exact pass/fail evidence is recorded.
5. Schedule independent review and inspect reviewer identity, findings,
   disposition, diff, validation, context receipts, and artifacts.
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
  turn ended; and
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

The source revision is retained in its managed task worktree. Phase 1 records
the merge request but does not yet push or merge it; external integration
remains an owner action until Phase 2 policy is implemented.

## Exit evidence

Phase 1 can close when both scenarios have:

- complete task and command audit trails;
- one fixed implementation revision shared by test and review;
- reproducible validation evidence and independent review;
- inspectable context/artifact/Git custody;
- no manual database repair or unrecorded state transition;
- a human smoke result; and
- documented defects classified as fixed, Phase 2, or explicitly deferred.

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
