# Editable agent prompt profiles results

Status: Source-controlled prompt configuration verified

Last updated: 2026-07-18

The core suite proves four seeded profiles, immutable revision history,
optimistic concurrency, replay-safe updates, input limits, browser/terminal
parity, orchestrator claim pinning, exact prompt composition at Pi startup,
and prompt key/version/checksum provenance on conversation and task runs.

All owner-editable default profiles, immutable policy envelopes, and phase
kickoff instructions now live as plain text under `config/prompts/`. The
runtime loads those files rather than embedding prompt prose in JavaScript.
The SQLite revisions remain the durable, auditable active values after a
project has started, so changing a default file cannot silently mutate a
running agent.

Running Pi processes retain their pinned revision. New or restarted processes
use the active owner-editable guidance inside the source-controlled policy
envelope. The dogfood-readiness probe also proves that phase kickoff prompts
and configured model defaults are loaded from disk. No provider request or
task container is used by these deterministic checks.
