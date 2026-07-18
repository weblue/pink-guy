# Phase 1 editable agent prompt profiles

Status: Implemented Phase 1 slice

Last updated: 2026-07-17

## Architecture

The central SQLite store remains authoritative. Add:

- `agent_prompt_profiles`: stable built-in key, display name, role, and active
  version;
- `agent_prompt_revisions`: immutable prompt text, SHA-256, version, actor,
  request receipt, and timestamp; and
- prompt key/version/checksum provenance on task and conversation runs.

The migration seeds version 1 of all four profiles idempotently. A profile
update runs in one immediate transaction: validate expected version, insert
the immutable revision, and advance the active pointer. An idempotent replay
returns the original revision; a reused key with different content fails.

## Prompt composition

`src/server/prompt-profiles.mjs` owns:

- default editable guidance;
- the orchestrator policy envelope;
- the task-agent policy envelope; and
- deterministic composition of envelope plus active guidance.

The policy envelope is source-controlled platform policy, not an editable
profile. Runtime code resolves the active profile once when creating a Pi
process and retains that resolved object with the managed process.

The orchestrator claim context includes the active profile, but a cached Pi
process keeps its original revision. `conversation_runs.metadata` records the
resolved profile. Task `runs` receive explicit profile columns.

## API and clients

- `GET /api/agent-profiles`
- `GET /api/agent-profiles/:key`
- `PUT /api/agent-profiles/:key`

Mutation remains a loopback-owner operation in the current profile. The
cockpit exposes a compact profile editor and revision metadata. `boss
profiles` and `boss profile --key ...` provide terminal parity.

## Sequencing

1. Profiles, API, runtime pinning, deterministic coverage, and custody
   provenance are implemented.
2. Add project/task overrides only after real dogfooding demonstrates that
   global phase profiles are insufficient.
