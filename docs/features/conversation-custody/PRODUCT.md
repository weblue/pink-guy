# Conversation custody and safe model switching

Status: Implemented Phase 1 slice

Last updated: 2026-07-17

## Summary

An owner can change the provider, model, or thinking level of an existing
orchestrator conversation without reconstructing its transcript. Boss Man
first creates and verifies a model-less custody snapshot, updates the central
route with optimistic concurrency, and restarts Pi against the same native
session before processing the next turn.

## Behavior

1. The snapshot retains the topic, conversation, turns, sanitized events,
   runs, project tasks, task origins, used orchestrator prompt revisions, and
   exact native Pi bytes when a native session exists.
2. Every file, including the manifest, is covered by `checksums.sha256`.
3. A route change requires a verified snapshot for that conversation, its
   expected conversation version, and an idempotency key.
4. A route change is rejected while a turn is running. Queued turns may remain
   queued and will use the new route.
5. The existing Pi process is retired at the next claim boundary. Its
   successor resumes the native session with the new provider/model/thinking
   arguments; clients do not resend prior messages.
6. Browser and terminal surfaces show the route and snapshot boundary.

## Remaining boundary

- Export before orchestrator-native compaction and system-intake to project
  transfer.
- Conversation snapshot deletion, quota, backup, and restore UX.
- Provider availability and spend-policy checks before accepting a route.
