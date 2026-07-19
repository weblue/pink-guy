# Safe managed-project deletion — technical specification

Status: Approved for implementation

Last updated: 2026-07-18

## Context

The behavior contract is in [PRODUCT.md](./PRODUCT.md).

- `src/server/store.mjs` owns the additive SQLite schema, project/import
  records, topics, task state, commands, leases, memory, and evidence.
- `src/server/control-plane.mjs` clones imports beneath
  `<stateRoot>/repositories/<projectId>` and owns filesystem effects.
- `src/client/pink-client.mjs`, `scripts/pink.mjs`, and
  `src/ui/cockpit.html` provide the shared terminal and browser surfaces.

The current platform has no project lifecycle state or deletion receipt.
Deleting a canceled import therefore requires unsafe direct database and
filesystem edits.

## Proposed changes

### Tombstone and receipt schema

Add nullable `deleted_at`, `deleted_by`, and `deletion_reason` columns to
`projects`. Active project lookups, source-URL matching, and project lists
exclude tombstones.

Add `project_deletion_receipts` with the request hash, exact project snapshot,
original and quarantine paths, reason, actor, operation state, checkout cleanup
state, idempotency key, and timestamps. The retained import receipt continues
to describe where the project came from.

Replace the source-URL uniqueness index with an active-project partial index.
A later import of the same source can create a new project with a new
idempotency key without rewriting the tombstone.

### Eligibility and transaction boundaries

The store computes durable-state blockers for PRODUCT invariants 1 and 6.
The control plane adds the exact managed-path invariant because it owns
`stateRoot`.

`beginProjectDeletion()` validates the confirmation and reason, rechecks all
blockers in an immediate transaction, and inserts a `prepared` receipt. The
control plane then:

1. renames the exact managed checkout into
   `<stateRoot>/project-trash/<receiptId>`;
2. calls `tombstoneProjectDeletion()` to recheck blockers, tombstone the
   project, archive zero-turn topics/conversations, and mark the receipt
   `tombstoned` in one transaction;
3. removes the quarantined tree; and
4. calls `completeProjectDeletion()` to record `complete/removed`.

If step 2 fails, the control plane attempts to rename quarantine back to the
original path. If step 3 fails, it returns a cleanup-pending receipt. Replaying
the same request advances only the incomplete receipt state. Ambiguous path
states return `reconciliation_required`.

### API and clients

- `GET /api/projects` adds `deletion_eligible` and `deletion_blockers`.
- `DELETE /api/projects/:projectId` requires `Idempotency-Key` and:

```json
{
  "confirmName": "PowerToys",
  "reason": "Canceled unsuitable maintenance scenario"
}
```

The route remains guarded by the loopback owner profile. The terminal command
is:

```sh
npm run pink -- delete-project --project PROJECT_ID \
  --confirm "PowerToys" --reason "Canceled unsuitable maintenance scenario"
```

The cockpit shows Delete only when `deletion_eligible` is true and asks for
the exact name and reason before submitting.

## Testing and validation

- A model-less isolated probe imports a local Git fixture and verifies active
  path/list state, confirmation rejection, deletion receipt, topic archival,
  checkout removal, active-list removal, tombstone retention, idempotent
  replay, source re-import, and zero provider requests (PRODUCT 3–7, 12).
- The probe verifies direct projects, task-bearing imports, source-bearing
  imports, conversation-bearing imports, command-bearing imports, active
  leases, and path mismatches are refused without filesystem changes
  (PRODUCT 1–2, 6, 8).
- Fault injection around tombstoning verifies quarantine restoration; an
  injected cleanup failure verifies cleanup-pending replay
  (PRODUCT 9–11).
- The core probe suite and existing terminal/cockpit probes remain regression
  coverage.
- After local restart, delete the canceled PowerToys import through the public
  API/terminal command and verify its checkout is absent and its tombstone is
  retained.

## Parallelization

Parallel agents are not used. Store state, filesystem transitions, API
behavior, and the destructive-operation probe form one tightly coupled
transactional slice.

## Risks and mitigations

- **Wrong-directory deletion:** only the exact resolved managed path is moved;
  arbitrary repository paths never reach recursive removal.
- **Database/filesystem split brain:** quarantine precedes tombstoning, failed
  tombstoning restores the original, and ambiguous states require
  reconciliation.
- **Hidden retained work:** eligibility enumerates every current
  project-scoped durable record and rejects unknown activity conservatively.
- **Retry deletes another import:** the receipt pins project ID, paths,
  request hash, and idempotency key.
