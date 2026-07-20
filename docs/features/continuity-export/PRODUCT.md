# Model-less continuity export and isolated restore

Status: Validated — deterministic and live same-host acceptance pass

Last updated: 2026-07-19

## Summary

Pink Guy can export its durable authority, retained sessions, custody,
artifacts, and committed Git history without an LLM, then verify and restore
that bundle into a new isolated state root on the same Mac. The first version
is an explicit operator action, not scheduled cloud backup.

## Goals

- Preserve the complete recoverable coding state independently from the live
  state root.
- Make bundle validity inspectable through checksums and deterministic
  receipts.
- Prove a restored task can continue without reading or mutating the active
  state root.

## Non-goals

- Credentials, provider authentication, container images, or live process
  migration.
- In-place restore, merge of two state roots, cloud upload, encryption,
  scheduling, retention rotation, or cross-platform migration.
- Capturing uncommitted repository files, ignored build output, worktrees, or
  container filesystems.

## Behavior

1. A local owner starts an export with an absolute output path. Export is
   model-less and makes no provider or external network request.

2. Export refuses to begin while a task execution, task run, conversation
   turn, or per-run credential lease is active. It reports each blocking
   identity and never stops, pauses, or cancels work implicitly.

3. While export is copying durable state, Pink Guy temporarily declines new
   automatic task dispatch and orchestrator-turn claims. Existing idle
   orchestrator leases and heartbeats may remain; they are not exported as
   active authority.

4. The output path must not already exist and must be outside the active state
   root. Export writes through a hidden sibling pending directory and publishes
   the final bundle atomically.

5. A bundle contains:
   - one transactionally consistent SQLite backup;
   - Pi-native task and orchestrator sessions;
   - unified task/conversation custody bundles;
   - retained run artifacts and retention manifests;
   - prompt, model-route, task, audit, memory, and provenance records held in
     SQLite; and
   - one Git bundle containing all committed refs/objects for every live
     project.

6. Repository working trees must be clean. Export reports a dirty repository
   and stops rather than silently omitting uncommitted or untracked work. Git
   bundles contain committed history and refs only.

7. The bundle excludes owner/provider credentials, `credential-runs`,
   orchestrator private configuration, run-private Pi configuration and home
   directories, containers, worktrees, caches, project trash, sockets,
   symbolic links, and undeclared host paths.

8. Every included file has a relative path, byte size, and SHA-256 digest in a
   versioned manifest. The manifest also records the source schema/platform
   revision, table counts, critical audit-table digests, project Git HEAD/ref
   evidence, exclusions, and the quiescence check.

9. A credential-like forbidden path such as `auth.json` causes export to fail
   even if it appears below an otherwise included directory. Transcript and
   artifact contents keep the platform's existing redaction/retention
   contract; P2-5 does not ask an LLM to inspect or summarize them.

10. Verification is a read-only operation. It checks the manifest schema,
    complete declared file set, sizes/checksums, SQLite integrity and foreign
    keys, table counts/audit digests, and each Git bundle. Extra, missing, or
    changed files fail verification.

11. Verification can run after the live API is stopped and does not require
    the source state root, Docker, Pi authentication, or a provider.

12. Restore requires a successfully verified bundle and an absolute target
    path that does not exist. It refuses the active source root and never
    performs an in-place overwrite or partial merge.

13. Restore builds a hidden pending target, copies declared state, reconstructs
    each project repository from its Git bundle, rebases managed paths to the
    target root, and atomically publishes the target.

14. Restored capabilities are revoked, orchestration leases are inactive, and
    runtime pressure/export flags are cleared. No container, process, task
    phase, conversation turn, or provider request starts automatically.

15. Historical worktree and destructive-retention paths cannot point back into
    the source state. Unrestored worktrees become explicit unavailable paths;
    new work creates a fresh managed workspace from the restored repository.

16. The restore report records the source bundle ID, target root, copied
    files, path rebases, revoked ephemeral authority, Git reconstruction,
    post-restore database checks, and its own checksum.

17. The restored control plane can open the database, list the same projects,
    tasks, sessions, prompts/routes, artifacts, and audit history, and schedule
    a retained task against a restored repository after the human separately
    supplies provider authentication.

18. Source critical-audit digests remain equal after restore. Expected
    path/ephemeral-authority changes are listed separately and never rewrite
    task, execution, Git, review, validation, context, or memory history.

19. A failed export or restore never publishes the requested destination.
    Errors identify the failed stage and leave the source root unchanged.

20. Repeating verify is idempotent. Repeating export or restore against an
    existing destination is rejected instead of overwriting earlier evidence.
