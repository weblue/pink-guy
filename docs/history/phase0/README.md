# Phase 0 executable probe record

This document retains the rationale and individual commands used by the
[Phase 0 feasibility program](PLAN.md). The executable assets have graduated
into the repository's stable `src/`, `tests/`, `config/`, and `infra/`
directories; the paths below are their current locations.

The current capability map and next steps are in
[current state](../../product/CURRENT-STATE.md). For ordinary development,
prefer the [local runbook](../../operations/local-development.md) and
[testing guide](../../operations/testing.md).

The current Phase 1 model-less regression probes are:

```sh
node ./tests/probes/probe-phase1-command-loop.mjs \
  /absolute/path/to/git-repository
node ./tests/probes/probe-phase1-local-task-controls.mjs \
  /absolute/path/to/git-repository
node ./tests/probes/probe-phase1-orchestrator-conversations.mjs \
  /absolute/path/to/git-repository
node ./tests/probes/probe-phase1-conversation-runtime.mjs \
  /absolute/path/to/git-repository
node ./tests/probes/probe-phase1-conversation-cockpit.mjs \
  /absolute/path/to/git-repository
node ./tests/probes/probe-phase1-task-graph-mutations.mjs \
  /absolute/path/to/git-repository
```

They use temporary central APIs and deterministic execution endpoints. They
make no provider request and start no task container.

Tracked files must contain no real credentials, native user sessions, provider responses, or unredacted runtime logs. Disposable outputs belong outside the repository and are referenced by redacted manifests plus SHA-256 checksums.

## Create the acceptance fixture

```sh
./tests/support/create-fixture.sh /absolute/path/to/disposable/task-repo
```

The generated repository has a deterministic initial commit and one intentionally failing regression test. A successful candidate run must satisfy `TASK.md` without changing the task's acceptance criteria.

`tests/fixtures/decoy-project` is copied separately by retrieval tests under a
different project identity. It must never appear in task-project retrieval
results.

## Record evidence

Every executable probe produces a JSON result conforming to
`config/schemas/evidence-result.schema.json`. Commands are sanitized before
storage; artifact bodies remain outside Git unless they have been reviewed
and intentionally admitted.

The generator and schema are foundation-neutral. Candidate-specific code must not alter them without an owner-visible change to the Phase 0 contract.

## Run the direct Pi pre-compaction probe

The probe uses an isolated Pi home, synthetic session records, no inherited provider credentials, and no provider request:

```sh
./tests/support/create-fixture.sh /absolute/path/to/disposable/task-repo
node ./tests/probes/probe-pi-custody.mjs /absolute/path/to/disposable/task-repo
node ./tests/probes/probe-pi-custody.mjs /absolute/path/to/disposable/task-repo --force-failure
```

The success path verifies checksums and ordering around the compaction commit. The forced-failure path verifies that compaction is cancelled and no snapshot manifest is committed.

## Run the direct Pi resume/import probe

The resume probe uses two isolated Pi homes and synthetic session entries. It verifies exact stop/resume, tool-result retention, model-less clean-home import, append continuity, and byte-equivalent preservation of a future unknown entry without making a provider request:

```sh
node ./tests/probes/probe-pi-resume.mjs /absolute/path/to/disposable/task-repo
```

## Run the direct Pi lifecycle probe

The lifecycle probe registers an in-process deterministic provider, so real RPC prompt, notification, model-selection, abort, new-session, and restart behavior can be tested without network access or provider credentials. It also proves that header-only and user-only state can be serialized from Pi's in-memory `SessionManager` before the native JSONL exists, then reopened by upstream Pi:

```sh
node ./tests/probes/probe-pi-lifecycle.mjs /absolute/path/to/disposable/task-repo
```

## Run the pinned pi-acp contract probe

Build the pinned upstream `pi-acp` checkout without modifying its source, then pass its absolute path to the probe. The probe runs ACP v1 over stdio against real Pi RPC with isolated homes and the deterministic local provider. It verifies streaming, notification translation, model selection, cancellation, native-session mapping/load, and that the blocking Pi custody extension is still reached through the adapter:

```sh
node ./tests/probes/probe-pi-acp.mjs \
  /absolute/path/to/disposable/task-repo \
  /absolute/path/to/pi-acp-at-49d6ec804d40b52317d873360654054c5d2387a3
```

## Run child-context provenance modes

The child-context probe uses upstream Pi's `SessionManager` without a model. It verifies that fresh mode receives only explicit instructions and artifact references, bundle mode receives a checksum-bound deterministic bundle receipt without eager transcript injection, and fork mode preserves the complete selected native history plus parent provenance:

```sh
node ./tests/probes/probe-pi-child-context.mjs /absolute/path/to/disposable/task-repo
```

## Run the reproducibility baseline

The baseline verifies tracked fixture checksums, generates the fixture twice, and checks that the evidence command runner records environment-variable names without persisting values:

```sh
node ./tests/probes/probe-baseline.mjs
```

P0-00 is complete on this development Mac only. Its cross-host exit criterion remains open until a second clean ARM64 environment reproduces the same fixture commit and checksums.

## Run the direct foundation slice

The direct candidate runs one daemon-owned SQLite store, task API and minimal board, direct Pi RPC session, persistent workspace shell, structured event stream, custody ingestion, and verified-idle restart pause. It uses a deterministic local provider and makes no network request:

```sh
node ./tests/probes/probe-direct-foundation.mjs /absolute/path/to/disposable/task-repo
```

## Run the task policy contract

```sh
node ./tests/probes/probe-task-policy.mjs
```

This retains the original in-memory policy baseline for comparison. The integrated direct-store proof is the next command.

## Run the integrated direct task-policy boundary

```sh
node ./tests/probes/probe-direct-task-policy.mjs \
  /absolute/path/to/disposable/task-repo
```

This C0-01 probe exercises opaque hashed bearer capabilities through the real HTTP and SQLite transaction boundary. It verifies server-derived actor/run scope, idempotency, competing-writer conflicts, child tasks, independent fixed-revision review, validation, owner-only decisions, completion, merge requests, and one ordered audit stream. The direct Pi session also loads the same worker/reviewer actions as upstream `pi.registerTool()` tools.

## Build and probe the task runtime

The task image is pinned to ARM64 Node, Pi 0.80.9, and checksum-verified RTK 0.42.3:

```sh
docker build --platform linux/arm64 \
  --tag boss-man:pi-0.80.9-rtk-0.42.3 \
  ./infra/container
node ./tests/probes/probe-runtime-git-rtk.mjs \
  /absolute/path/to/disposable/task-repo
```

The probe verifies the container policy, denies access to shared Git metadata, creates a host-owned checkpoint with provenance, isolates two concurrent synthetic credentials, and preserves redacted RTK raw evidence with a receipt.

## Run the direct daemon runtime/Git/credential/RTK slice

After building the pinned image, run the selected candidate's C0-02 integration probe:

```sh
node ./tests/probes/probe-direct-runtime-git-rtk.mjs \
  /absolute/path/to/disposable/task-repo
```

This starts Pi and the workspace shell in a daemon-created task container, proves that the Docker socket and shared Git metadata are unavailable, copies a synthetic human-owned credential into a private writable run directory from a read-only source, enforces the OAuth profile's one-run limit, removes both run copies after checksum verification, creates an idempotent host-owned checkpoint, and ingests filtered plus redacted raw RTK artifacts and receipts. It never reads a real provider credential or makes a provider request.

`config/provider-profile.example.json` and
`config/schemas/provider-profile.schema.json` define the redacted
owner-managed provider profile contract. Real provider login is an explicit
owner operation outside the repository; the live-auth smoke is intentionally
separate from this synthetic proof.

## Run the owner-authorized live-provider smoke

This command spends one bounded provider turn and must only be run after the owner has populated the isolated Pi auth directory:

```sh
node ./tests/probes/probe-direct-live-provider.mjs \
  /absolute/path/to/disposable/task-repo \
  "$HOME/.config/boss-man/provider-auth/chatgpt-primary/auth.json" \
  openai-codex \
  gpt-5.4-mini
```

The probe never prints or checks in the auth contents. It verifies a real provider response inside the daemon-owned container, one Pi Bash tool call through the managed RTK extension, redacted raw/filtered/receipt ingestion, canonical credential immutability, post-run credential-copy deletion, and container removal.

## Run restart and side-effect reconciliation

```sh
node ./tests/probes/probe-direct-restart-reconciliation.mjs \
  /absolute/path/to/disposable/task-repo
```

This C0-03 probe injects daemon loss after a provider response, workspace tool execution, snapshot index write, and host Git commit but before their completion receipts. It proves that idle state pauses only after container identity/liveness checks, uncertain provider and tool work is never replayed, checksum-valid snapshots and provenance-valid Git commits are recovered, native Pi bytes remain unchanged, and no completed side effect is duplicated. The selected conservative policy does not claim in-flight Pi RPC reattachment.

## Run the remote-edge contract

```sh
node ./tests/probes/probe-remote-edge.mjs
```

This uses a disposable local HTTP/WebSocket origin and proxy. It does not
change SWAG, DNS, router state, or the production Mac. The proposed inert SWAG
snippet and operator test live under `infra/edge/`.

## Run the governed FTS benchmark

```sh
node ./tests/probes/probe-memory-fts.mjs \
  /absolute/path/to/disposable/task-repo
```

The benchmark uses canonical SQLite records and an FTS5 projection with network/model/vector access absent. It validates scope filters, provenance receipts, supersession, deletion/rebuild, exact constraints, stale records, injection text, secret canaries, and cross-project decoys.

## Run the integrated context-custody path

```sh
node ./tests/probes/probe-direct-context-custody.mjs \
  /absolute/path/to/disposable/task-repo
```

This C0-04 proof atomically exports the native Pi session, selected branch, task/audit/context items, decisions, canonical and selected memory, complete FTS receipt, artifact references, Git state, manifest, and checksums. It verifies native-byte and future-entry preservation, scoped exclusions before rank, canonical clean-store import and FTS rebuild, and a phase-scoped Pi bundle child that receives provenance without the source transcript. It uses no provider, network request, embedding, or vector index.

## Inspect the pinned AoE candidate

```sh
node ./tests/probes/probe-aoe-foundation.mjs \
  /absolute/path/to/agent-of-empires-at-90855a59360f46652786a49f54a56df002d8ef98
```

This is a reproducible source-level stop-rule probe, not an AoE runtime pass. It records the competing durable lifecycle writers, writable shared Git mounts, and missing supported plugin authority that make the required product layer a core fork.

## Why there is no Compose file

No stable fixed multi-service deployment boundary has emerged. The central API
embeds SQLite; project orchestrators are dynamic per-project daemon/tmux
processes with central leases; task containers are created per run; the edge
probe is disposable. A Compose file would imply fixed service lifecycle
ownership that the architecture has not selected. Add one when a fixed broker,
proxy, or other independently deployed service boundary is proven.
