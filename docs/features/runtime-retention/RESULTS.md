# Runtime lifecycle and retention results

Status: Model-less acceptance complete

Last updated: 2026-07-19

## Accepted behavior

The deterministic Phase 2 Git/retention probe proves:

- an active retention hold blocks workspace cleanup and release restores
  eligibility;
- only settled, integrated work is retired;
- cleanup intent is durable and idempotent, with safety rechecked on retry;
- session deletion requires an eligible preview and retains a checksummed
  manifest, tombstone, and receipt;
- a lost-response retry after completed deletion returns that original receipt;
- hold scope IDs must exist and belong to the named project;
- a configured hard storage limit becomes a deterministic Ready blocker and
  performs no automatic deletion;
- no provider or container is required for the proof.

Docker stop/remove failures now propagate instead of being recorded as
successful cleanup. A live container cleanup drill remains part of P2-4 host
calibration.

## Command

```sh
npm run test:git-retention
```
