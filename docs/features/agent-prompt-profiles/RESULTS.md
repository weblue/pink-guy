# Editable agent prompt profiles results

Status: Model-less implementation verified

Last updated: 2026-07-17

The core suite proves four seeded profiles, immutable revision history,
optimistic concurrency, replay-safe updates, input limits, browser/terminal
parity, orchestrator claim pinning, exact prompt composition at Pi startup,
and prompt key/version/checksum provenance on conversation and task runs.

Running Pi processes retain their pinned revision. New or restarted processes
use the active owner-editable guidance inside the source-controlled policy
envelope. No provider request or task container is used.
