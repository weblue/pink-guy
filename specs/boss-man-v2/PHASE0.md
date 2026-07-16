# Boss Man v2 Phase 0 research program

Status: Active

Started: 2026-07-16

Decision owner: Human owner

## Purpose

Phase 0 resolves the assumptions that could force a rewrite, weaken session custody, or create an unsafe operational boundary. It compares a bounded Agent of Empires core fork with a thin direct-Pi control plane using the same fixtures and evidence.

Phase 0 is successful when it produces reproducible evidence and an owner-ready ADR. It does not select the foundation automatically and does not authorize production deployment.

## Fixed inputs

The following are requirements, not variables in the foundation comparison:

- Pi is the only supported harness.
- Provider and model selection remain configurable behind Pi.
- Native Pi JSONL is authoritative session evidence.
- Pre-compaction export is blocking, deterministic, and model-less.
- Tasks, policies, lifecycle, and artifact provenance have one control-plane authority.
- Agents cannot approve their own work or silently cross a human-decision gate.
- Git commits and merges are platform-owned.
- Real secrets are human-managed deployment inputs; agents work from schemas, references, and canary values.
- Complete sessions and artifacts are retained until explicit deletion.
- SWAG is the public HTTPS edge; Boss Man maintains inner owner authentication.
- The port-315 home server is the default SSH bastion; no new public Mac port is in scope.
- SQL and canonical records answer authoritative task questions. Retrieval indexes, chunks, summaries, and embeddings are disposable projections.

## Authorization and safety boundary

Phase 0 may:

- clone and inspect public source repositories;
- create local scratch repositories, worktrees, containers, fixtures, and test databases;
- use synthetic credentials and unique canary strings;
- use an already configured and authorized primary Pi provider for bounded test turns;
- build local reverse-proxy configurations and disposable services;
- create patches against a local AoE clone; and
- produce source, test, measurement, and ADR artifacts.

Phase 0 must not:

- change SWAG, DNS, router rules, public ports, host launch services, or long-lived deployment state;
- copy or print real provider, SSH, SWAG, or application credentials;
- enable a new paid provider or automatic paid fallback without owner approval;
- push a fork, publish an image, open an upstream PR, or make an external deployment;
- select AoE or direct Pi on the owner's behalf; or
- treat an LLM-generated summary or embedding index as canonical evidence.

## Timebox and stop rules

Working timebox: ten focused engineering days or equivalent agent work, with no more than six allocated to AoE-specific adaptation before an owner checkpoint. This is a reversible planning assumption, not a delivery promise.

Stop a candidate early when:

- it fails a hard gate with no small, upstream-compatible remedy;
- it requires a second lifecycle authority;
- Pi or `pi-acp` must be privately forked to obtain required custody hooks;
- the candidate requires real production credentials or infrastructure mutation to prove a core claim; or
- evidence shows the prototype is becoming a replacement of the candidate's supervisor, storage, router, sandbox, and frontend shell rather than a bounded product layer.

An early stop records the failed command/test, relevant source location, attempted remedy, and residual uncertainty. It is evidence, not a failed Phase 0.

## Pinned research baseline

| Component | Baseline | Purpose |
|---|---|---|
| Boss Man | `59f8282654f9b4cea90f2ba830aa6d56106e25b4` | Existing task, board, event, and execution behavior |
| Inspector Gadget | `3df39382ceb147aa411f9c578ef4131fc91912f2` | Pi, RTK, cmux, SSH, and environment setup behavior |
| Agent of Empires | `90855a59360f46652786a49f54a56df002d8ef98` | AoE Phase 0 candidate HEAD at start; eight commits after the detailed `7803b25` inspection |
| `pi-acp` | `49d6ec804d40b52317d873360654054c5d2387a3` / v0.0.31 | Pi-to-ACP bridge candidate; upstream tests plus Boss Man contract probe pass |
| Pi executable probe | [`earendil-works/pi@2d16f929`](https://github.com/earendil-works/pi/tree/2d16f92973230a7e095aa984f150ba8702784f50) / v0.80.9 | Exact source matching the updated installed executable and current direct-Pi runtime evidence |
| Prior Pi executable evidence | [`earendil-works/pi@28df940f`](https://github.com/earendil-works/pi/tree/28df940f0d07b65284849a483be7b06e2ca046ee) / v0.79.1 | Retained compatibility evidence from the Phase 0 starting host |
| RTK installed on development host | 0.42.3 | Raw/filtered output probe baseline |

Every result records exact versions, lockfiles, image digests, host architecture, and commands. A changed dependency invalidates only the affected compatibility result, not the canonical fixture or scoring contract.

## Findings to date

1. Pi's official project and package scope moved from `badlogic/pi-mono` / `@mariozechner` to `earendil-works/pi` / `@earendil-works` at v0.74.0. The installed v0.79.1 executable maps exactly to official commit `28df940f`; this is a continuity change, not an unrelated fork.
2. Direct, provider-free runtime probes on both v0.79.1 and the updated v0.80.9 demonstrated that `session_before_compact` can commit checksummed native and normalized artifacts before Pi appends its compaction entry. A forced exporter failure cancelled compaction and committed no snapshot manifest. This is executable evidence for the compaction portion of G-03 and G-09.
3. Pi allocates and reports a persistent session path before it necessarily creates the JSONL file. In v0.80.9, the file is first flushed after an assistant message exists. A pre-conversation session already contains model and thinking-level entries, and the submitted user message is not yet in `SessionManager` during `before_agent_start` or `turn_start`; it is present at the `context` hook. Synthesizing version-3 JSONL from `getHeader()` plus `getEntries()` at these unflushed boundaries produced snapshots that upstream Pi reopened successfully.
4. The detailed AoE inspection revision advanced by eight commits before Phase 0 pinning, with substantial terminal/TUI changes. This reinforces the need for an upstream-sync rehearsal and commit-pinned evidence.
5. A provider-free v0.80.9 stop/resume probe restored the same session twice without replaying completed bash actions. A model-less `SessionManager.forkFrom` import into a second clean Pi home changed only the session header/identity and retained the full entry history, tool result, custom entry, model change, and opaque unknown entry. Pi inserted a startup thinking-level entry before the first resumed action, but that action remained a descendant of the opaque leaf.
6. Docker Desktop 27.3.1 is now available with an ARM64 Linux server. A digest-pinned Alpine smoke container passed with no network, read-only root filesystem, a bounded writable tmpfs, and no Docker socket, host home, or SSH material. This proves the basic runtime controls, not the full task-container or Git boundary.
7. A networkless in-process provider exercised real v0.80.9 RPC prompt, streaming notification, state, model selection, abort, new-session, and exact restart behavior. Aborted output persisted with `stopReason: aborted`, no tool execution occurred, parent provenance survived `new_session`, and restart did not replay the completed response.
8. Pinned upstream `pi-acp` v0.0.31 passed all 88 upstream tests, typecheck, and build. A real ACP v1 probe then streamed six deterministic turns, changed models, cancelled safely, reached the blocking custody hook through `/compact`, persisted native Pi state, and replayed retained history after a fresh adapter process loaded the session. It did not forward the extension's startup notification because subscription occurs after the Pi spawn handshake; active-turn notifications were forwarded. Npm reported three moderate and four high dependency audit findings in the pinned lockfile, which remain maintenance evidence rather than being auto-fixed during the comparison.
9. Model-less child-context probes passed all three provenance modes: fresh contains only explicit instructions and artifact receipts, bundle contains a checksum-bound deterministic context receipt without eager source-transcript injection, and full fork preserves every selected native entry plus parent-session provenance.

## Current development-host baseline

Captured: 2026-07-16. This describes the current development host and is not assumed to be the eventual production Mac.

| Capability | Observed state |
|---|---|
| Host | macOS 15.7.7, ARM64 |
| Pi | 0.80.9 (`2d16f92973230a7e095aa984f150ba8702784f50`) |
| Node.js | 25.9.0 |
| Rust/Cargo | 1.95.0 |
| SQLite CLI | 3.43.2 |
| tmux | 3.6b |
| RTK | 0.42.3 |
| Docker | Desktop client/server 27.3.1; Linux ARM64 daemon available; 8,217,968,640 bytes assigned |
| OrbStack CLI | Not found |

The current Docker allocation is sufficient for Phase 0 probes. Before multi-agent load testing or deployment sizing, increase it from roughly 8 GB or explicitly cap concurrency to avoid mistaking resource starvation for an orchestration defect.

## Common acceptance fixture

Both foundation candidates use the same fixture. Candidate-specific shortcuts do not count as a pass.

### Repository fixture

A small Git repository contains:

- one deliberately failing behavior with a deterministic Node `node:test` regression suite;
- one task requiring a code change and test update;
- a default branch, a platform-created task worktree, and an unrelated dirty-file scenario;
- a prior decision, a superseded decision, a failure report, and a runbook;
- a cross-project decoy document that must never be retrieved;
- a synthetic secret canary that must be redacted and never enter export, memory, logs, or indexes; and
- artifacts large enough to test referenced storage rather than inline transcript expansion.

The fixture is content-addressed. Its initial commit and expected final diff are identical for both candidates.

### Task fixture

The task includes:

- explicit acceptance criteria and validation plan;
- one dependency already satisfied;
- one reversible working assumption;
- one simulated protected architecture question that must create `decision_required` rather than being selected by the worker;
- implementer progress, block, child-task, and review requests; and
- an independent fixed-revision reviewer response.

### Session fixture

The same Pi interaction must:

1. start from the task and assigned worktree;
2. inspect the failure and relevant governed memory;
3. modify the fixture and run its tests;
4. emit task progress;
5. create a deterministic snapshot at a turn boundary;
6. execute a compaction attempt that is blocked until export commits;
7. stop the runtime and restore it from native session state;
8. resume on the same branch without replaying completed tools; and
9. create a bundle-mode child with an explicit retrieval receipt.

Provider output is not compared byte-for-byte. Lifecycle events, session entries, files, task mutations, receipts, checksums, and policy outcomes are.

## Hard gates

A candidate is ineligible if any hard gate fails. Passing all gates does not select it; the owner still makes the architectural decision.

| Gate | Required evidence |
|---|---|
| G-01 One authority | All session/task/workspace/container/Git mutations have one daemon authority; clients cannot create competing durable state. |
| G-02 Native custody | A retained Pi JSONL can be checksummed, stopped, imported/resumed, and shown to preserve the selected branch, tools, results, model changes, and unknown entries. |
| G-03 Pre-compaction barrier | `session_before_compact` or its pinned equivalent blocks compaction until the native copy and normalized bundle commit atomically; an export failure cancels compaction. |
| G-04 No private Pi bridge fork | Required behavior works with pinned upstream Pi and, for AoE, pinned upstream `pi-acp`; a private bridge fork makes AoE ineligible. |
| G-05 Git custody | The agent can edit worktree files and request status/diff/checkpoint but cannot mutate the shared Git directory, commit, merge, push, or rewrite protected history directly. |
| G-06 Credential isolation | Concurrent runs use synthetic or approved run-scoped credentials without a shared writable canonical auth directory; canaries do not persist in artifacts, events, exports, or memory. |
| G-07 Restart recovery | A control-plane restart reconciles idle and active state without losing the native session, duplicating a tool side effect, or reporting an orphan as healthy. |
| G-08 Task/policy control | Worker and reviewer capabilities enforce assignment, self-approval rejection, fixed-revision review, and a blocking human-decision gate. |
| G-09 Model-less portability | Export/import and FTS retrieval work with network access disabled and every semantic/vector index deleted. |
| G-10 Public-edge contract | A disposable proxy test proves Host/Origin enforcement, inner auth, cookies, CSRF, WebSockets, reconnect, streaming, and artifact transfer without changing real SWAG. |

## Work packages

### P0-00 Reproducible baseline

Deliverables:

- version and source manifest;
- non-secret host capability report;
- fixture repository generator and checksum manifest;
- test-artifact directory policy; and
- a command runner that records exit status, duration, stdout/stderr artifact references, and environment-variable names without values.

Exit: another clean ARM64 environment can generate the same fixture commit and expected checksums.

### P0-01 Pi custody and context probe

Run directly against pinned Pi before either foundation receives credit.

Tests:

- RPC start, prompt, state, abort, new-session, model-selection, and notification handling;
- native JSONL tree, tool, usage, model-change, compaction, custom-entry, and unknown-entry retention;
- exact stop/resume and import into a clean Pi home;
- deterministic normalized bundle generation without a provider call;
- atomic pre-compaction success and forced-failure cancellation; and
- fresh, bundle, and full-fork child provenance.

Exit: G-02, G-03, and G-09 have executable direct-Pi evidence, or the product contract is revised by the owner before foundation work continues.

### P0-02 Direct-Pi foundation candidate

Implement only enough control plane to exercise the shared fixture:

- one daemon-owned session/task record;
- one task/board API and minimal route;
- direct Pi RPC supervisor;
- one persistent workspace shell and structured event subset;
- host Git capability boundary;
- artifact/context custody adapter; and
- restart reconciliation.

Do not polish the UI. Estimate the remaining work needed to match AoE's terminal, diff, mobile, authentication, and recovery quality.

### P0-03 Bounded AoE foundation candidate

Implement the same fixture inside a local AoE branch:

- one additive task schema/module and full board route;
- Pi-only allowlist through pinned `pi-acp`;
- daemon-owned lifecycle path;
- native Pi exporter and context adapter;
- restricted Git and run-scoped credential behavior; and
- restart reconciliation using AoE's worker/event facilities.

Preserve upstream multi-agent code and upstream tests. Record every modified upstream file separately from additive Boss Man files.

Rebase rehearsal:

1. select a representative newer upstream commit after the pinned baseline;
2. merge or rebase it into the local spike branch;
3. record mechanical and semantic conflicts, resolution time, failed tests, and changed seams; and
4. revert/discard only the disposable rehearsal branch after evidence is captured.

No GitHub fork or upstream PR is created in Phase 0.

### P0-04 Runtime, Git, credentials, and RTK

Apply the same tests to both candidates:

- container has no Docker socket, host home, SSH material, or global writable Pi home;
- common Git metadata is not writable by the agent;
- platform checkpoint captures only allowed paths and provenance;
- concurrent synthetic credential refresh cannot corrupt canonical state;
- RTK `tee.mode = "always"` pairs filtered output with complete raw output;
- raw output is redacted before durable storage while preserving exit state and a redaction receipt; and
- RTK bypass and parse-failure behavior are visible.

If the Docker daemon remains unavailable, container results stay explicitly unverified; they are not inferred from configuration review.

### P0-05 Remote-edge simulation

Use a disposable local reverse proxy and synthetic credentials to validate the Boss Man origin contract:

- configured public origin and allowed hosts;
- rejection of untrusted Host, Origin, and forwarded-client headers;
- SWAG-like outer Basic Auth plus mandatory inner owner session;
- Secure/HttpOnly/SameSite cookie behavior;
- CSRF rejection for state changes;
- terminal WebSocket upgrade, reconnect, and authorization;
- non-buffered structured streams and bounded uploads; and
- device/session revocation.

Produce a proposed SWAG configuration and operator test script as artifacts. Do not install them on the home server.

### P0-06 Governed memory and retrieval

The retrieval proof distinguishes authoritative queries from task-adjacent discovery.

Authoritative SQL tests:

- current task state, dependencies, assignment, reviewer, decision gates, and merge eligibility come only from canonical tables/projections; and
- retrieval results cannot mutate or override those answers.

Memory/retrieval tests:

- typed candidate creation, evidence-linked promotion, contest, supersession, tombstone, and deletion;
- project/task/trust filtering before retrieval;
- SQLite FTS5/BM25 over governed memory and normalized evidence;
- context receipt containing query, filters, retrieval method/version, ranked source IDs/revisions, scores, exclusions, and injected excerpt checksums;
- index deletion/rebuild reproduces lexical results from canonical sources;
- stale, contradictory, prompt-injection, secret-canary, and cross-project-decoy cases; and
- comparison with `pi-persistent-intelligence` without surrendering Boss Man schema or authority.

Benchmark queries include exact terminology, renamed concepts, prior failures, superseded decisions, and unrelated lexical overlap. Record recall@5, precision@5, provenance completeness, stale-result rate, and scope violations. Required thresholds are:

- zero scope or secret-canary violations;
- 100% provenance receipts for injected records;
- 100% retrieval of mandatory exact project constraints through deterministic selection; and
- measured FTS5 baseline results before any semantic experiment.

An optional local vector experiment is allowed only after the FTS5 baseline. Embeddings and vector tables must be deletable and rebuildable, and semantic retrieval ships later only if it materially improves the benchmark without weakening scope, provenance, offline operation, or export.

### P0-07 Foundation score and ADR

For each candidate, publish:

- hard-gate results with evidence links;
- weighted score with rationale;
- prototype and estimated production scope;
- new versus modified file counts and changed core seams;
- dependency and license changes;
- security and operations differences;
- unresolved risks and confidence;
- upstream rebase evidence for AoE; and
- recommendation with viable fallback.

The owner records the final foundation decision and conditions in `DECISIONS.md`. Until then, Phase 1 remains blocked.

## Weighted comparison

Only candidates passing every hard gate are scored.

| Dimension | Weight | What is measured |
|---|---:|---|
| Session/context fidelity | 20 | Native resume/import, pre-compaction barrier, unknown-event preservation, portability |
| Lifecycle and task authority | 15 | One writer, recovery, capability enforcement, reviewer and decision gates |
| Git/credential/security boundary | 15 | Restricted metadata, platform Git, secret isolation, redaction, container exposure |
| Product extensibility | 15 | Task-first routes/data, cockpit composition, Pi-only surface, test seams |
| Long-term maintainability | 20 | Patch isolation, dependency churn, upstream rebase cost, replaceability, code ownership |
| Retained runtime/UI value | 10 | Terminal, diff, mobile, reconnect, authentication, structured rendering saved from rebuilding |
| Operational simplicity | 5 | Processes, databases, backups, upgrades, diagnostics, single-host burden |

Score each dimension from 0 to 5 and multiply by its weight divided by 5. A numeric lead is evidence, not authorization. The ADR must explain sensitivity to uncertain estimates, and the human owner decides.

## Evidence contract

Tracked evidence uses small, redacted manifests. Large logs, native sessions, databases, and runtime artifacts remain outside Git unless proven safe and intentionally added.

Each test result records:

- test ID and candidate;
- status: `pass`, `fail`, `blocked`, or `not_run`;
- exact source/tool/image versions;
- sanitized command identity and exit status;
- start/end time and host architecture;
- input fixture checksum;
- output artifact paths and SHA-256 checksums;
- assertions and observed values;
- redactions performed;
- limitations and manual steps; and
- corresponding product requirement, technical risk, and hard gate.

Claims based only on source inspection are labeled `inspection`; they cannot satisfy a runtime hard gate.

## Execution order

1. P0-00 reproducible fixture and evidence runner.
2. P0-01 direct Pi custody/context probe.
3. P0-02 minimal direct-Pi candidate.
4. P0-03 bounded AoE candidate and upstream-sync rehearsal.
5. P0-04 shared runtime/Git/credential/RTK tests.
6. P0-05 disposable proxy tests.
7. P0-06 governed memory and retrieval benchmark.
8. P0-07 scorecard, ADR proposal, and owner decision.

P0-04 through P0-06 may overlap only after the fixture and evidence schemas are fixed. Candidate implementations should not proceed in parallel until P0-01 proves the harness-level custody contract; otherwise both can encode the same false assumption.

## Progress tracker

| Work package | Status | Current note |
|---|---|---|
| P0-00 Baseline | In progress | Deterministic failing fixture `cef5e049ab9841e8389c6c4f5f0fde5d2385c7b4` and evidence-result schema validated |
| P0-01 Pi custody | Completed | Direct v0.80.9 custody/lifecycle/resume/import/child-mode probes and pinned `pi-acp` translation/custody probe pass without an external provider; the missed ACP startup notification and dependency audit findings are recorded limitations |
| P0-02 Direct Pi | Next | Implement the minimal daemon-owned direct-Pi candidate against the common fixture; capture its downstream services in `compose.phase0.yml` only as service boundaries become proven |
| P0-03 AoE | Not started | Depends on P0-01 and common fixture |
| P0-04 Runtime/Git/RTK | In progress | Docker ARM64/isolation smoke passes; task-image, mount, Git metadata, credential, and RTK cases remain |
| P0-05 Remote edge | Not started | Disposable local proxy only |
| P0-06 Memory/retrieval | Not started | FTS5 baseline precedes optional vector experiment |
| P0-07 ADR | Not started | Human-owned final decision |

## Phase 0 exit

Phase 0 exits only when:

1. all hard gates have executable evidence for each still-eligible candidate;
2. failures and stopped candidates have reproducible evidence;
3. the common fixture and scorecard are complete;
4. security, license, deployment, and maintenance implications are explicit;
5. the owner selects a foundation or directs another bounded investigation; and
6. `PRODUCT.md`, `TECH.md`, `FOUNDATION.md`, and `DECISIONS.md` are updated to match that decision.

Only then should the Phase 1 implementation backlog become technology-specific.
