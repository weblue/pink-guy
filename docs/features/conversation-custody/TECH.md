# Conversation custody and safe model switching

Status: Implemented Phase 1 custody contract

Last updated: 2026-07-17

## Design

`ContextCustodyService.exportConversation` writes a temporary directory,
computes deterministic payload checksums and a manifest, atomically renames
the directory, verifies every checksum from disk, and only then records the
snapshot in `conversation_custody_snapshots`.

`conversation_model_changes` retains the prior and new routes, conversation
versions, custody snapshot, actor, request checksum, and idempotency key.
`switchConversationModel` rejects stale versions, active turns, invalid
thinking levels, and snapshots from another conversation.

The managed orchestrator caches the conversation version used to create Pi.
When a later claim contains a different version, it terminates that process
and starts Pi with `--session` against the same native JSONL and the newly
recorded route. Prompt-only edits intentionally do not trigger this restart.

## API

- `GET|POST /api/conversations/:id/custody`
- `POST /api/conversations/:id/model`

The current local profile exposes these as loopback-owner operations.

`src/pi/orchestrator-extension.ts` handles `session_before_compact` by making a
blocking, scope-authorized custody request. An export failure rejects the hook
and prevents automatic compaction from continuing.

`POST /api/topics/:id/project` creates a `scope_transfer` bundle before
atomically changing the topic and conversation scope. The binding receipt
retains prior/new conversation versions and the custody snapshot. A system
intake runtime removes cached sessions that the central API reports as
out-of-scope.
