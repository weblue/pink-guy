# Runtime lifecycle and retention technical design

Status: Implemented — model-less acceptance complete

Last updated: 2026-07-19

## Context

The product behavior is defined in [PRODUCT.md](PRODUCT.md).

- `src/server/control-plane.mjs` stops task containers during execution
  settlement and already has an audited safe-project deletion workflow.
- `src/server/store.mjs` retains workspaces, sessions, runs, artifacts, and
  recovery candidates but does not compute cleanup eligibility or holds.
- `src/server/git-service.mjs` creates worktrees but does not retire them.
- Run files live below the configured state root, enabling bounded inventory
  and explicit session-file deletion without scanning arbitrary owner paths.

## Implemented changes

1. Add `retention_holds`, `resource_cleanup_operations`, and
   `session_deletion_receipts`. Add retirement metadata to workspaces and
   deletion metadata to sessions.

2. Build cleanup eligibility from durable state:
   execution state, run state, phase, integration state, recovery candidates,
   merge request, and active holds. The store produces canonical projections;
   the control plane verifies physical container/worktree state.

3. Add `HostGitService.retireWorkspace`, which verifies the recorded Git
   marker and branch before `git worktree remove`, prunes worktree metadata,
   and deletes only the exact Pink Guy-managed branch.

4. Add a state-root inventory service based on `lstat`/directory traversal.
   It never follows symlinks and reports configured
   `PINK_GUY_STORAGE_WARN_BYTES` and `PINK_GUY_STORAGE_HARD_BYTES` values.

5. Cleanup preview hashes its canonical resource/blocker projection. Execution
   recomputes and requires the same fingerprint, then records per-resource
   results and an idempotent aggregate receipt.

6. Session deletion first writes a JSON manifest under
   `retention-manifests/`, then removes only resolved paths inside the state
   root. The receipt moves through `prepared`, `cleanup_pending`, and
   `complete`; database evidence remains tombstoned.

7. Storage hard-limit state is injected into deterministic Ready dispatch as a
   blocker. No LLM participates in capacity or cleanup decisions.

8. Add owner APIs plus `pink storage`, `pink cleanup`, `pink hold`, and
   `pink delete-session` commands. The cockpit receives storage and retention
   controls without introducing a terminal emulator.

## Testing and validation

- A deterministic probe maps PRODUCT behaviors 1–14.
- Fixtures include active, stopped, test/review, unintegrated implementation,
  integrated implementation, held, and recovery-linked workspaces.
- Fingerprint drift, idempotent replay, symlink refusal, partial cleanup retry,
  and session tombstone/manifest retention are covered.
- Hard-limit dispatch blocking is tested without allocating large files.
- Full regression and browser/syntax checks remain green.

## Delivery note

Resource eligibility landed with the governed Git schema so cleanup decisions
can distinguish integrated implementation work from retained source custody.

## Risks and mitigations

- Path traversal is prevented by resolving every destructive target beneath
  the configured state root and refusing symlink traversal.
- Cleanup never infers that an unavailable container is stopped without an
  inspect receipt.
- Retention manifests are evidence, not a P2-5 backup; deletion remains
  intentionally conservative until backup policy is approved.
