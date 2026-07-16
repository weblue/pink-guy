# Phase 0 executable research assets

This directory contains architecture-neutral fixtures, schemas, and scripts used by the research program in [`specs/boss-man-v2/PHASE0.md`](../specs/boss-man-v2/PHASE0.md).

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
