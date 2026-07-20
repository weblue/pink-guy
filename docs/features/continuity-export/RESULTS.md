# P2-5 continuity acceptance results

Status: Pass

Evidence date: 2026-07-19 America/New_York / 2026-07-20 UTC

## Outcome

Pink Guy exported, independently verified, and restored its live development
state without an LLM, provider request, container, or direct SQLite repair.
The isolated central API opened all three live projects and queued one retained
blocked task for resume without starting its task container.

## Live rehearsal

| Evidence | Result |
|---|---|
| Platform revision | `a28d5cca9b6ca6b4d5a841429d4a1da82789a5d1` |
| Bundle ID | `e30b60c1-b69e-4588-82b9-a277b7e0b99c` |
| Manifest SHA-256 | `efe49da7c1204fb48c54fa36f33b23141e553fe244a960e73cad3731de83f595` |
| Payload | 3,603 files; 474,000,475 bytes; 3 live projects |
| Restored projects | Pink Guy `a28d5cc`; doc-map `bd3c180`; inspector-gadget `3df3938` |
| Restore report SHA-256 | `d7fde27c72ba7f8c94ceccbb0d2e9a81f2e909aac226d2aa5a62c309e6c6aa9b` |
| SQLite | Integrity pass; zero foreign-key findings; expected row counts preserved |
| Audit | All declared critical audit-table digests preserved |
| Paths | Zero source-state-root findings after bounded rebase |
| Authority | Capabilities revoked; project/conversation leases inactive |
| Resume proof | Retained task `45f5c442-7b83-410d-92ab-41f0ee4bb8b6` queued on the isolated API |
| Side effects | Zero provider requests; zero task containers started |

The retained local rehearsal artifacts are:

- `/Users/ND139178/Documents/pink-guy-p2-5-rehearsal-a28d5cc.bundle`
- `/Users/ND139178/Documents/pink-guy-p2-5-restored-a28d5cc`

These are operator-owned evidence outside the repository and live state root,
not prerequisites for the checked-in regression suite.

## Fail-closed findings

The live rehearsal exposed two cases absent from the first simple fixture:

1. `git bundle --all` includes linked-worktree pseudo-refs that ordinary
   `for-each-ref` omits. The manifest now derives and verifies ref evidence
   from the completed portable bundle; the regression creates a linked
   worktree.
2. A tombstoned project retained an old repository path even though only live
   projects receive Git bundles. Restore now maps every non-live project to an
   explicit `unavailable/projects/<id>` path; the regression seeds a deleted
   project and rejects any source-root authority.

Both attempts stopped before publishing an invalid restore. Pending
directories were removed and source state was unchanged.

## Deterministic acceptance

`probe-phase2-continuity.mjs` runs with zero model/provider calls and covers:

- active run/command and dirty-repository blockers;
- the dispatch/turn-claim export gate;
- a forbidden credential canary in excluded run configuration;
- exact files, checksums, SQLite evidence, Git refs, and corruption rejection;
- source immutability, deleted/historical path rebasing, audit/count
  preservation, and revoked ephemeral authority; and
- opening the restored control plane and scheduling a retained task.

The probe is part of the 20-probe `npm test` core suite.

A release-readiness review added three race regressions after the live
rehearsal: API imports and direct SQLite writes are rejected throughout the
capture boundary, SQLite and manifest project sets must agree, and a failed
pre-publication verification leaves no final bundle behind. Early
`pink-guy-continuity-v1` bundles remain verifiable by deriving the project-set
evidence from their manifest when that evidence predates the dedicated
database field.

## Limits retained by D-054

This proves an explicit same-host format and recovery path. It does not add
encryption, scheduled rotation, cloud upload, cross-platform migration, a
second physical host, Git LFS/submodule materialization, or in-place restore.
Those remain needs-driven follow-ups after dogfood.
