# Safe managed-project deletion — product specification

Status: Approved for implementation

Last updated: 2026-07-18

Figma: none provided. The control extends the existing project list.

## Summary

Let the local owner remove a canceled, unused repository import without
editing SQLite or manually deleting platform state. The first version is a
narrow cleanup operation, not a general retention-deletion feature.

## Behavior

1. A project is eligible for deletion only when it is a Boss Man-managed
   repository import with no retained work:
   - no tasks, including archived tasks;
   - no source snapshots, memories, or normalized evidence;
   - no conversation turns, runs, custody snapshots, model changes, or
     intake-to-project bindings;
   - no queued or retained project commands; and
   - no active project-orchestrator or scoped orchestration lease.
2. A directly registered local repository is never eligible. A managed
   checkout whose path is not exactly the platform-owned repository path for
   its project is never eligible.
3. The project list identifies eligible imports and exposes a Delete action.
   Ineligible projects do not offer the action.
4. Deletion requires the exact current project name and a non-empty reason.
   A name mismatch or malformed reason changes nothing.
5. A successful deletion:
   - removes the managed checkout;
   - removes the project and its generated empty topic from active views;
   - retains a project tombstone, import receipt, deletion reason, project
     snapshot, timestamps, and cleanup state for audit; and
   - does not delete or alter any repository outside the managed checkout.
6. Generated project topics with zero turns are archived as part of deletion.
   Any topic with a turn or other durable conversation activity blocks the
   operation instead.
7. The operation is idempotent. Retrying the same request and idempotency key
   returns its current receipt without deleting anything else. Reusing the key
   for different project, confirmation, or reason content is rejected.
8. Deletion rechecks eligibility immediately before filesystem changes. A
   concurrent task, source, command, conversation, or lease prevents deletion.
9. The managed checkout is first moved to a platform-owned quarantine path.
   If the database cannot record the tombstone, Boss Man attempts to restore
   the checkout to its original path and leaves the project active.
10. If tombstoning succeeds but final checkout removal fails, the project
    remains deleted from active views and the receipt reports cleanup pending.
    Repeating the same deletion request retries only that cleanup.
11. If both the original and quarantine paths exist, or neither exists before
    tombstoning, Boss Man stops with reconciliation required and does not guess
    which copy is authoritative.
12. The loopback terminal client exposes the same operation and refusal
    reasons as the cockpit. This feature does not enable remote deletion.

## Non-goals

- Deleting projects that contain work, conversations, context, or evidence.
- Deleting individual tasks, sessions, artifacts, memories, or audit events.
- Storage quotas, scheduled garbage collection, or retention-policy expiry.
- Deleting or rewriting upstream Git remotes.
