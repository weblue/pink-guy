# Runtime lifecycle and retention results

Status: Model-less and live cleanup/storage acceptance complete

Last updated: 2026-07-22

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
successful cleanup.

## Live P2-4 cleanup and pressure drills

The settled responsive-navigation task previewed three eligible phase
workspaces with all recorded containers already absent. Cleanup retired all
three resources, retained operation `e5baa190-7ca3-4edc-8aad-896202d34c67`,
and replayed the exact completed receipt under the same idempotency key. A
second fresh cleanup was a safe empty operation. The later publication fixture
repeated the three-workspace retirement after its PR was published. No Pink
Guy task container remained.

State inventory initially failed on generated `node_modules/.bin` symlinks in
inactive workspaces. It now skips without following known generated dependency
symlinks, reports their bounded relative-path inventory, and continues to
reject an unexpected symlink elsewhere. The live state contained 84 such
symlinks before cleanup and 42 afterward.

Retained state measured 3.56 GB before the first cleanup, 3.33 GB afterward,
and 3.16 GiB after the publication fixture was cleaned. A temporary 1 GiB
warning / 2 GiB hard profile reported both pressure states without deleting
anything. The selected target-Mac dogfood policy is:

- warning: 10 GiB (`10737418240` bytes);
- hard dispatch pause: 15 GiB (`16106127360` bytes); and
- no automatic deletion at either threshold.

The running API reports neither warning nor hard pressure under that policy.

## Command

```sh
npm run test:git-retention
```
