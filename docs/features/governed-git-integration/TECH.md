# Governed Git integration technical design

Status: Implemented — model-less acceptance complete

Last updated: 2026-07-19

## Context

The product behavior is defined in [PRODUCT.md](PRODUCT.md).

- `src/server/git-service.mjs` owns worktree creation, checkpoint commits, and
  Git provenance, but currently has no target-integration boundary.
- `src/server/store.mjs` stores a lightweight `merge_requests` row when a task
  completes, but has no policy, plan, receipt, or conflict state.
- `src/server/control-plane.mjs` is the local owner authority and already
  exposes idempotent recovery/task mutations.
- `scripts/pink.mjs`, `src/client/pink-client.mjs`, and
  `src/ui/cockpit.html` provide terminal/cockpit parity.

## Implemented changes

1. Add versioned `project_git_policies` and durable `git_integrations` tables.
   Policy defaults are derived from repository default-branch evidence and are
   conservative: prepare-only, merge commit, no remote writes.

2. Extend `HostGitService` with:
   - repository identity/default-branch inspection;
   - isolated preview worktrees for merge/squash/rebase feasibility;
   - isolated integration branches;
   - compare-and-swap publication to an allowed local target;
   - optional non-force push and `gh pr create` adapters; and
   - idempotent cleanup of temporary integration worktrees.

3. Preparation persists a snapshot before Git simulation. Execution reloads
   that snapshot, reruns authoritative store gates, resolves the current target
   revision, and refuses any stale input before a Git mutation.

4. Integration operations use explicit states:
   `preparing`, `prepared`, `conflict`, `integrating`, `integrated`,
   `published`, `cancelled`, `failed`, and `reconciliation_required`.
   Conflict/failure evidence remains in the shared attention projection.

5. The control plane exposes owner-only policy, prepare, execute, cancel, and
   attention endpoints. The client, CLI, cockpit task workspace, and recovery
   panel consume the same projections.

6. Existing `merge_requests` rows remain the task-completion request record.
   Successful integration updates that row and links the integration receipt;
   historical rows remain readable.

7. Existing `boss` CLI and `BOSS_MAN_*` environment variables remain
   compatibility aliases during the Pink Guy rename; new documentation and
   surfaces prefer `pink` and `PINK_GUY_*`.

## Testing and validation

- A deterministic probe covers PRODUCT behaviors 1–9 and 11–14 against two
  disposable repositories.
- The probe executes clean merge-commit and squash paths and produces one
  deterministic conflict without touching the target.
- Rebase is verified in a disposable repository and must preserve the source
  revision.
- A local bare remote verifies normal push and rejects any force-push option.
- Existing Phase 1/P2-1 probes remain green and start no additional provider
  request.
- Cockpit module syntax plus a browser smoke validates the new attention and
  task controls.

## Parallelization

Parallel agents are not proposed. Store schema, Git side effects, cleanup
eligibility, and the shared cockpit projection are tightly coupled, and this
checkout already contains uncommitted P2-1 work that must remain coherent.

## Risks and mitigations

- A crash after creating a result commit but before updating the receipt is
  classified as reconciliation-required; the exact integration branch and
  revisions are retained.
- A target branch moving between checks is prevented by compare-and-swap
  publication.
- Owner working-tree changes are never reset or stashed automatically.
- Remote publication remains disabled unless policy and owner action both
  permit it.
