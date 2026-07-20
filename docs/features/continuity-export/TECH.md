# Model-less continuity export and isolated restore

Status: Validated — deterministic and live same-host acceptance pass

Last updated: 2026-07-20

## Context

P2-5 implements D-054 against the behavior in [PRODUCT.md](PRODUCT.md).
Current durable ownership is split across:

- `src/server/store.mjs` — the open `node:sqlite` authority and append-only
  task/execution/audit records;
- `src/server/context-service.mjs` — task and conversation custody bundles;
- `src/server/resource-lifecycle.mjs` — state-root traversal, safe-path, and
  deletion-manifest primitives;
- `src/server/control-plane.mjs` — scheduling, orchestration claims, and the
  only live authority able to establish a short export quiescence window;
- `src/server/git-service.mjs` — host-owned repository/worktree operations;
  and
- `scripts/pink.mjs` / `scripts/serve.mjs` — current operator surfaces.

Node 24+ exposes `backup()` from `node:sqlite`, so the live WAL database can be
copied transactionally without shelling out or stopping the API. The state
tree contains credential-bearing directories and linked Git worktrees that
must not be copied wholesale. Project Git history therefore uses `git bundle`
rather than filesystem copies.

## Implementation

### 1. Continuity service and format

Add `src/server/continuity.mjs` with:

```text
exportBundle({ store, stateRoot, outputPath, platformRevision })
verifyBundle(bundlePath)
restoreBundle({ bundlePath, targetRoot })
```

The format is `pink-guy-continuity-v1`, an atomic directory with:

```text
manifest.json
checksums.sha256
database/pink-guy.sqlite
state/orchestrator-sessions/**
state/runs/<run-id>/sessions/**
state/runs/<run-id>/artifacts/**
state/context/**
state/conversation-context/**
state/retention-manifests/**
git/<project-id>.bundle
```

All traversal rejects symlinks and non-regular files. A fixed allowlist owns
the state payload; a forbidden basename/path check rejects credentials even
inside an allowed subtree. Files are copied byte-for-byte with private modes.

The service uses `node:sqlite.backup(store.database, destination)` and records
`PRAGMA integrity_check`, `foreign_key_check`, sorted application-table counts,
and SHA-256 digests for critical append-only/audit tables. Digests canonicalize
ordered rows without depending on SQLite file-page layout.

For each non-deleted project, `git status --porcelain` must be empty. The
service creates `git bundle create <path> --all`, verifies it with
`git bundle verify`, and records HEAD plus a checksum of sorted refs. No remote
URL or working-tree-only content enters the manifest.

### 2. Quiescence

`DirectControlPlane` owns `continuityExportActive`. The export endpoint:

1. asserts local-owner scope and a destination outside `stateRoot`;
2. rejects nonterminal command executions, running task/conversation runs,
   queued/running conversation turns, and unverified credential runs;
3. flips the in-memory export gate;
4. rechecks blockers;
5. enables SQLite `query_only` for the complete capture boundary;
6. exports and verifies the pending bundle; and
7. restores write access and clears the gate in `finally`.

All API mutations return `continuity_export_active` while gated. Claims return
their normal empty response and heartbeats are acknowledged as deferred so
existing daemons wait rather than treating the maintenance window as a
failure. Reads remain available. SQLite `query_only` is the final guard
against an internal or already-admitted asynchronous write racing the backup.

Add:

```text
POST /api/continuity/exports
  { outputPath }
```

The response contains only the bundle ID/path, manifest digest, file/byte
counts, project count, and verification result.

### 3. Verification and restore

Verification enumerates the bundle without following links and requires exact
agreement with the manifest. It opens the bundled database read-only, runs
integrity/foreign-key checks, recomputes counts/audit digests, and invokes
`git bundle verify` for every declared project. The active project IDs in
SQLite must exactly match the unique project IDs with declared Git bundles.
The pending bundle is verified before its atomic rename, so failed
verification never occupies the requested destination.

Restore writes to a pending sibling directory. It copies the declared state,
clones each Git bundle into `repositories/<project-id>`, then updates a bounded
list of path-bearing columns in the restored database:

- project repository paths point to reconstructed repositories;
- included session, artifact, and custody paths replace the source-root
  prefix with the target-root prefix;
- historical workspaces and unavailable external/destructive paths point
  below `unavailable/` in the target rather than back to the source.

All capabilities are revoked; current/legacy orchestration leases become
inactive; runtime flags are cleared. Restore then runs integrity, foreign-key,
count, audit-digest, and repository-revision checks before writing
`continuity-restore.json` and atomically renaming the target.

### 4. Operator command

Add `scripts/continuity.mjs` and:

```text
npm run continuity -- export --output /absolute/bundle --api http://127.0.0.1:4310
npm run continuity -- verify --bundle /absolute/bundle
npm run continuity -- restore --bundle /absolute/bundle --target /absolute/state
```

Export calls the live API so quiescence is authoritative. Verify and restore
are standalone/model-less and work when the API is unavailable. Output is
concise by default with `--json` for the complete non-secret receipt.

## Testing and validation

Add `tests/probes/probe-phase2-continuity.mjs` to cover PRODUCT invariants:

- build a fixture state with a managed repository, retained task/session,
  prompt/model route, artifact, custody file, and audit history (1, 5, 8);
- prove active execution/turn and dirty repository blockers (2, 3, 6);
- attempt both an API project import and a direct SQLite write during export,
  proving the full capture boundary rejects durable mutations;
- plant a credential canary only in excluded directories and assert it is not
  present in the bundle (7, 9);
- export and independently verify SQLite, files, audit digests, and Git
  history with zero provider calls (4, 10–11);
- corrupt a copied file and prove verification fails (10);
- rewrite a copied manifest with a mismatched project set and prove
  verification fails, then inject a pre-publication verification failure and
  prove the requested destination remains reusable;
- restore into a new root, assert the source hashes are unchanged, paths never
  reference the source state, ephemeral authority is inactive, and no process
  starts (12–16, 18–20);
- start a restored control plane and schedule the retained task against the
  restored repository without a provider request (17).

Add the probe to `tests/run-core.mjs`. Run `npm test`, the direct Pi lifecycle
probe for D-058, and a live same-host export/verify/restore after deterministic
coverage passes.

## Parallelization

No parallel sub-agent split is proposed. Quiescence, manifest contents,
restore path rewriting, and the end-to-end probe share one format contract and
the same small set of files; splitting them before the first bundle passes
would add merge/coordination risk rather than reduce elapsed time.

## Risks and mitigations

- **Credential inclusion:** fixed allowlist, forbidden-path checks, canary
  regression, and no whole-root copy.
- **Inconsistent live files:** authoritative quiescence plus transactional
  SQLite backup; no active sessions/turns/runs.
- **Source-root mutation:** restore target must not exist, Git reconstruction
  reads bundle files only, and post-restore path audit rejects the source
  prefix.
- **Large repositories:** Git bundles are explicit and measured; compression,
  incremental export, LFS/submodule expansion, and remote backup remain
  follow-ups.
- **Future schema changes:** versioned manifest plus bounded path-column map;
  unsupported manifest/schema versions fail closed.
