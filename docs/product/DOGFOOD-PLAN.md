# Phase 1 dogfood plan

Status: Ready after workspace-phase-flow PR lands

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
- Persistent orchestrator context is captured before Pi compaction. Until that
  final custody gate lands, keep the first dogfood conversations bounded.

## Scenarios

1. **Maintenance repository:** one refined, low-risk bug or small Jira-style
   ticket with deterministic regression coverage.
2. **New work:** one bounded feature or prototype whose orchestrator must
   clarify material ambiguity and create or refine the task graph.

Use different repositories. Avoid production deployment, secret rotation,
schema migration, public networking, or major architecture decisions.

## Run sequence

For each scenario:

1. Attach or select the repository and provide an immutable request/source
   snapshot.
2. Converse with the project orchestrator until acceptance criteria and any
   decision gates are explicit.
3. Schedule implementation and observe its container, worktree, progress,
   host checkpoint, artifacts, and final fixed revision.
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

## Exit evidence

Phase 1 can close when both scenarios have:

- complete task and command audit trails;
- one fixed implementation revision shared by test and review;
- reproducible validation evidence and independent review;
- inspectable context/artifact/Git custody;
- no manual database repair or unrecorded state transition;
- a human smoke result; and
- documented defects classified as fixed, Phase 2, or explicitly deferred.

## Not required for dogfooding

- browser terminal emulator or embedded IDE;
- Agent of Empires fork or runtime dependency;
- LiteLLM or automatic OpenRouter fallback;
- semantic/vector RAG beyond the current canonical evidence plus FTS baseline;
- Jira API synchronization or write-back;
- Docker Compose without a stable separately operated service;
- trusted-LAN or SWAG exposure;
- Slack/email notifications; or
- automatic merge/rebase/push.
