# Phase 0 executable research assets

This directory contains architecture-neutral fixtures, schemas, and scripts used by the research program in [`specs/boss-man-v2/PHASE0.md`](../specs/boss-man-v2/PHASE0.md).

The current capability map, data inventory, open questions, and closure sequence are summarized in [`specs/boss-man-v2/CURRENT-STATE.md`](../specs/boss-man-v2/CURRENT-STATE.md).

Tracked files must contain no real credentials, native user sessions, provider responses, or unredacted runtime logs. Disposable outputs belong outside the repository and are referenced by redacted manifests plus SHA-256 checksums.

## Create the acceptance fixture

```sh
./phase0/scripts/create-fixture.sh /absolute/path/to/disposable/task-repo
```

The generated repository has a deterministic initial commit and one intentionally failing regression test. A successful candidate run must satisfy `TASK.md` without changing the task's acceptance criteria.

`fixtures/decoy-project` is copied separately by retrieval tests under a different project identity. It must never appear in task-project retrieval results.

## Record evidence

Every executable probe produces a JSON result conforming to `schemas/evidence-result.schema.json`. Commands are sanitized before storage; artifact bodies remain outside Git unless they have been reviewed and intentionally admitted.

The generator and schema are foundation-neutral. Candidate-specific code must not alter them without an owner-visible change to the Phase 0 contract.

## Run the direct Pi pre-compaction probe

The probe uses an isolated Pi home, synthetic session records, no inherited provider credentials, and no provider request:

```sh
./phase0/scripts/create-fixture.sh /absolute/path/to/disposable/task-repo
node ./phase0/scripts/probe-pi-custody.mjs /absolute/path/to/disposable/task-repo
node ./phase0/scripts/probe-pi-custody.mjs /absolute/path/to/disposable/task-repo --force-failure
```

The success path verifies checksums and ordering around the compaction commit. The forced-failure path verifies that compaction is cancelled and no snapshot manifest is committed.

## Run the direct Pi resume/import probe

The resume probe uses two isolated Pi homes and synthetic session entries. It verifies exact stop/resume, tool-result retention, model-less clean-home import, append continuity, and byte-equivalent preservation of a future unknown entry without making a provider request:

```sh
node ./phase0/scripts/probe-pi-resume.mjs /absolute/path/to/disposable/task-repo
```

## Run the direct Pi lifecycle probe

The lifecycle probe registers an in-process deterministic provider, so real RPC prompt, notification, model-selection, abort, new-session, and restart behavior can be tested without network access or provider credentials. It also proves that header-only and user-only state can be serialized from Pi's in-memory `SessionManager` before the native JSONL exists, then reopened by upstream Pi:

```sh
node ./phase0/scripts/probe-pi-lifecycle.mjs /absolute/path/to/disposable/task-repo
```

## Run the pinned pi-acp contract probe

Build the pinned upstream `pi-acp` checkout without modifying its source, then pass its absolute path to the probe. The probe runs ACP v1 over stdio against real Pi RPC with isolated homes and the deterministic local provider. It verifies streaming, notification translation, model selection, cancellation, native-session mapping/load, and that the blocking Pi custody extension is still reached through the adapter:

```sh
node ./phase0/scripts/probe-pi-acp.mjs \
  /absolute/path/to/disposable/task-repo \
  /absolute/path/to/pi-acp-at-49d6ec804d40b52317d873360654054c5d2387a3
```

## Run child-context provenance modes

The child-context probe uses upstream Pi's `SessionManager` without a model. It verifies that fresh mode receives only explicit instructions and artifact references, bundle mode receives a checksum-bound deterministic bundle receipt without eager transcript injection, and fork mode preserves the complete selected native history plus parent provenance:

```sh
node ./phase0/scripts/probe-pi-child-context.mjs /absolute/path/to/disposable/task-repo
```

## Run the reproducibility baseline

The baseline verifies tracked fixture checksums, generates the fixture twice, and checks that the evidence command runner records environment-variable names without persisting values:

```sh
node ./phase0/scripts/probe-baseline.mjs
```

P0-00 is complete on this development Mac only. Its cross-host exit criterion remains open until a second clean ARM64 environment reproduces the same fixture commit and checksums.

## Run the direct foundation slice

The direct candidate runs one daemon-owned SQLite store, task API and minimal board, direct Pi RPC session, persistent workspace shell, structured event stream, custody ingestion, and verified-idle restart pause. It uses a deterministic local provider and makes no network request:

```sh
node ./phase0/scripts/probe-direct-foundation.mjs /absolute/path/to/disposable/task-repo
```

## Run the task policy contract

```sh
node ./phase0/scripts/probe-task-policy.mjs
```

This retains the original in-memory policy baseline for comparison. The integrated direct-store proof is the next command.

## Run the integrated direct task-policy boundary

```sh
node ./phase0/scripts/probe-direct-task-policy.mjs \
  /absolute/path/to/disposable/task-repo
```

This C0-01 probe exercises opaque hashed bearer capabilities through the real HTTP and SQLite transaction boundary. It verifies server-derived actor/run scope, idempotency, competing-writer conflicts, child tasks, independent fixed-revision review, validation, owner-only decisions, completion, merge requests, and one ordered audit stream. The direct Pi session also loads the same worker/reviewer actions as upstream `pi.registerTool()` tools.

## Build and probe the task runtime

The task image is pinned to ARM64 Node, Pi 0.80.9, and checksum-verified RTK 0.42.3:

```sh
docker build --platform linux/arm64 \
  --tag boss-man-phase0:pi-0.80.9-rtk-0.42.3 \
  ./phase0/runtime
node ./phase0/scripts/probe-runtime-git-rtk.mjs \
  /absolute/path/to/disposable/task-repo
```

The probe verifies the container policy, denies access to shared Git metadata, creates a host-owned checkpoint with provenance, isolates two concurrent synthetic credentials, and preserves redacted RTK raw evidence with a receipt.

## Run the direct daemon runtime/Git/credential/RTK slice

After building the pinned image, run the selected candidate's C0-02 integration probe:

```sh
node ./phase0/scripts/probe-direct-runtime-git-rtk.mjs \
  /absolute/path/to/disposable/task-repo
```

This starts Pi and the workspace shell in a daemon-created task container, proves that the Docker socket and shared Git metadata are unavailable, copies a synthetic human-owned credential into a private writable run directory from a read-only source, enforces the OAuth profile's one-run limit, removes both run copies after checksum verification, creates an idempotent host-owned checkpoint, and ingests filtered plus redacted raw RTK artifacts and receipts. It never reads a real provider credential or makes a provider request.

`runtime/provider-profile.example.json` and `schemas/provider-profile.schema.json` define the redacted owner-managed provider profile contract. Real provider login is an explicit owner operation outside the repository; the live-auth smoke is intentionally separate from this synthetic proof.

## Run the owner-authorized live-provider smoke

This command spends one bounded provider turn and must only be run after the owner has populated the isolated Pi auth directory:

```sh
node ./phase0/scripts/probe-direct-live-provider.mjs \
  /absolute/path/to/disposable/task-repo \
  "$HOME/.config/boss-man/provider-auth/chatgpt-primary/auth.json" \
  openai-codex \
  gpt-5.4-mini
```

The probe never prints or checks in the auth contents. It verifies a real provider response inside the daemon-owned container, one Pi Bash tool call through the managed RTK extension, redacted raw/filtered/receipt ingestion, canonical credential immutability, post-run credential-copy deletion, and container removal.

## Run restart and side-effect reconciliation

```sh
node ./phase0/scripts/probe-direct-restart-reconciliation.mjs \
  /absolute/path/to/disposable/task-repo
```

This C0-03 probe injects daemon loss after a provider response, workspace tool execution, snapshot index write, and host Git commit but before their completion receipts. It proves that idle state pauses only after container identity/liveness checks, uncertain provider and tool work is never replayed, checksum-valid snapshots and provenance-valid Git commits are recovered, native Pi bytes remain unchanged, and no completed side effect is duplicated. The selected conservative policy does not claim in-flight Pi RPC reattachment.

## Run the remote-edge contract

```sh
node ./phase0/scripts/probe-remote-edge.mjs
```

This uses a disposable local HTTP/WebSocket origin and proxy. It does not change SWAG, DNS, router state, or the production Mac. The proposed inert SWAG snippet and operator test live under `edge/`.

## Run the governed FTS benchmark

```sh
node ./phase0/scripts/probe-memory-fts.mjs \
  /absolute/path/to/disposable/task-repo
```

The benchmark uses canonical SQLite records and an FTS5 projection with network/model/vector access absent. It validates scope filters, provenance receipts, supersession, deletion/rebuild, exact constraints, stale records, injection text, secret canaries, and cross-project decoys.

## Inspect the pinned AoE candidate

```sh
node ./phase0/scripts/probe-aoe-foundation.mjs \
  /absolute/path/to/agent-of-empires-at-90855a59360f46652786a49f54a56df002d8ef98
```

This is a reproducible source-level stop-rule probe, not an AoE runtime pass. It records the competing durable lifecycle writers, writable shared Git mounts, and missing supported plugin authority that make the required product layer a core fork.

## Why there is no Phase 0 Compose file

No stable multi-service deployment boundary has emerged. The direct candidate is one process with embedded SQLite and managed subprocesses; task containers are daemon-created per run; the edge probe is disposable. A Compose file would imply services and lifecycle ownership that Phase 0 has not selected. Add one when a fixed control-plane, broker, or proxy service boundary is proven.
