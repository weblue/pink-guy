# Runtime lifecycle and retention operations

Status: Implemented — model-less acceptance complete

Last updated: 2026-07-19

## Summary

Pink Guy separates ephemeral runtime cleanup from retained session evidence.
It can safely retire stopped containers and eligible worktrees, report storage
pressure, preserve explicit holds, and delete retained session artifacts only
through a previewed owner operation.

## Figma

Figma: none provided. The cockpit extends its existing task workspace and
attention patterns.

## Behavior

1. Complete Pi sessions, task evidence, and artifacts are retained until the
   owner explicitly deletes them. Cleanup never treats age alone as deletion
   authorization.

2. A cleanup preview is model-less and lists each container, workspace,
   branch, session, eligibility, and blocker. Storage inventory separately
   reports byte totals. Preview changes no runtime, filesystem, Git, or
   retained record.

3. Settled containers are eligible after a verified stopped/absent inspection.
   Running or identity-ambiguous containers block cleanup.

4. Test/review worktrees are eligible after their execution settles and no
   recovery candidate or retention hold references them.

5. An implementation worktree is eligible only after its task revision is
   integrated/published. Active, unmerged, conflict, and recovery evidence
   always block cleanup.

6. Cleanup requires an idempotency key, reason, and the exact preview
   fingerprint. If eligibility changes after preview, execution refuses and
   returns a fresh preview.

7. Cleanup removes only the resources listed as eligible. It records an
   immutable receipt and marks workspaces retired; it does not delete session
   JSONL, artifacts, audit rows, checkpoints, reviews, or task history.

8. The owner can create and release a named retention hold on a project, task,
   session, run, or workspace. Active holds appear in every affected
   cleanup/deletion preview.

9. Storage inventory reports total bytes and category totals for repositories,
   workspaces, runs, conversation sessions, custody, trash, and other state.
   Configured warning/hard limits are visible. Pink Guy never silently deletes
   evidence in response to pressure.

10. At a configured hard limit, new automatic task dispatch pauses with a
    visible storage-pressure blocker. Owner inspection, export, hold release,
    and cleanup remain available.

11. Retained-session deletion is a distinct owner action. Preview identifies
    all paths and references. Deletion is blocked by an active run, recovery
    evidence, active hold, or unintegrated implementation revision.

12. Session deletion requires typing the exact session ID, a reason, an
    idempotency key, and the preview fingerprint. Before deletion, Pink Guy
    writes a durable manifest containing path, size, and checksum evidence.
    Database/audit tombstones and the manifest remain after files are removed.

13. A partial filesystem failure leaves the operation Cleanup pending and can
    be retried with the same identity. It never reports complete while a
    declared path remains.

14. The cockpit and `pink` CLI show the same storage inventory, holds,
    previews, blockers, receipts, and retry state.

## Non-goals

- Automatic age-based session/artifact deletion.
- Deleting active, unmerged, or recovery evidence to satisfy a quota.
- Replacing the backup/restore contract in P2-5.
