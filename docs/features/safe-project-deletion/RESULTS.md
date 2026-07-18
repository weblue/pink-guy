# Safe managed-project deletion — results

Status: Implemented

Last updated: 2026-07-18

The loopback control plane now exposes one narrow cleanup path for unused
managed imports. It retains project/import/deletion receipts and archives
empty generated topics while removing only the exact
`<stateRoot>/repositories/<projectId>` checkout.

Implemented surfaces:

- additive project tombstones and durable deletion receipts;
- active-project filtering and source re-import after a tombstone;
- conservative task/source/context/command/lease/memory/evidence blockers;
- prepared → tombstoned → complete filesystem/database recovery;
- exact-name and reason confirmation;
- idempotent API replay;
- `boss delete-project`; and
- an eligibility-gated cockpit action.

## Verification

`npm test` passes all 13 core probes. The dedicated
`probe-phase1-project-deletion.mjs` covers:

- direct-repository refusal;
- exact-name confirmation;
- task, conversation, and active-lease blockers;
- empty-topic archival and retained tombstone audit;
- checkout quarantine/removal;
- idempotent replay and source re-import;
- quarantine restoration after injected tombstone failure;
- cleanup-pending replay after injected removal failure; and
- terminal/cockpit parity with zero provider requests.

The running local service was upgraded to this schema and deleted the canceled
PowerToys import through `boss delete-project`.

- project: `f6276523-97e4-4451-ba2c-1668ac46d4c3`
- deletion receipt: `b29cc052-979c-482c-be61-f60cae1e7b87`
- receipt state: `complete`
- checkout state: `removed`
- active project projection: absent
- retained reason: Windows-only scope was unsuitable for the Phase 1
  maintenance scenario

The live control plane also reported direct `boss-man` and history-bearing
`doc-map` as ineligible without altering either repository.
