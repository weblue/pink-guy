# Phase 2 delivery plan

Status: Proposed map; recovery contract awaiting owner approval

Last updated: 2026-07-18

## Objective

Move Boss Man from a supervised local development tool to a dependable
full-time local coding environment. Phase 2 closes when routine work survives
process/provider/host interruption, Git integration and cleanup are governed,
resource policies are measured, and retained work can be backed up and moved
to another clean ARM64 host without direct SQLite repair.

Phase 1 is the entry gate and is complete. Authenticated SWAG exposure remains
Phase 3.

## Delivery principles

- Fix authority and recovery before increasing autonomy or concurrency.
- Prefer deterministic state machines and independently verifiable receipts
  over LLM interpretation.
- Keep Pi as the sole harness and direct provider/model boundary.
- Preserve complete sessions and evidence until explicit retention deletion.
- Make risky, long-lived, or hard-to-reverse choices explicit owner decisions.
- Turn each live failure found during dogfood into a bounded regression
  scenario before broadening policy.

## Delivery sequence

| Slice | Objective | Depends on | Exit evidence |
|---|---|---|---|
| **P2-1 Execution custody and recovery** | Remove split command/run authority; add fencing, paused/reconciliation states, fast failure classification, restart reconciliation, and late-evidence actions. | Phase 1 | Model-less fault matrix plus two live failure/recovery drills complete without duplicate work or SQLite edits. |
| **P2-2 Governed Git integration** | Prepare and optionally execute merge/rebase/push/PR under project/branch policy, with conflict and rollback attention. | P2-1 settlement/fencing | Two repositories complete clean integration; one deterministic conflict stops safely; no agent writes protected Git state directly. |
| **P2-3 Runtime lifecycle and retention operations** | Retire settled worktrees/containers safely, implement explicit session/project artifact deletion, quotas, storage-pressure visibility, and restore-friendly manifests. | P2-1; coordinates with P2-2 worktree custody | Cleanup cannot remove active/unmerged/recovery evidence; deletion is previewed, audited, idempotent, and restore tests preserve retained work. |
| **P2-4 Capacity, credentials, and provider resilience** | Measure host/provider limits, widen concurrency only where safe, exercise model switching and local routes, and classify provider exhaustion/failure. | P2-1; P2-3 quotas useful | Sustained mixed-project run stays within measured CPU/RAM/Docker/provider budgets; provider loss pauses or reroutes only under explicit policy. |
| **P2-5 Backup, migration, and second-host reproduction** | Back up canonical state/custody/artifacts, restore atomically, rehearse migration, and reproduce on a clean ARM64 host. | P2-1 through P2-4 storage/config contracts | Fresh host restores projects, task history, native sessions, prompts/routes, artifacts, Git custody, and audit checksums; recovery run succeeds. |

P2-2 and the design portion of P2-3 may proceed in parallel after P2-1's
execution/settlement schema is fixed. P2-4 measurement can begin early, but
policy changes wait for P2-1 and storage-pressure visibility. P2-5 is the
integration gate and remains last.

## P2-1 — execution custody and recovery

Canonical specs:

- [`../features/execution-recovery/PRODUCT.md`](../features/execution-recovery/PRODUCT.md)
- [`../features/execution-recovery/TECH.md`](../features/execution-recovery/TECH.md)

Implementation increments:

1. **Execution identity and async acceptance**
   - durable command-execution record;
   - one idempotent accepted execution per command;
   - short project-daemon start request;
   - central settlement authority.
2. **Fence, stop, and failure taxonomy**
   - capability/generation fence;
   - immediate process/protocol detection;
   - activity-aware inactivity and hard deadline;
   - idempotent cleanup receipts;
   - explicit Paused, Failed, Cancelled, and Needs reconciliation projection.
3. **Restart reconciliation**
   - reconcile nonterminal executions before new dispatch;
   - no automatic replay;
   - safe-stop + native/context custody rather than unproven live reattach.
4. **Late-evidence recovery**
   - verified checkpoint candidates;
   - owner accept/reject with consequence preview;
   - stale-task protection;
   - fresh validation/review after acceptance.
5. **Attention UX and live acceptance**
   - cockpit and `boss` parity;
   - replace broad reset with valid state-aware actions;
   - controlled observer-loss and late-checkpoint drills.

P2-1 is intentionally first. Automatic merge, more concurrency, and aggressive
cleanup would amplify the Phase 1 race if built on the current split authority.

## P2-2 — governed Git integration

Use accepted D-007, D-009, D-028, and D-045 as the boundary:

- Boss Man—not the task agent—owns merge/rebase/push/PR side effects.
- Default policy is prepare-only.
- A project may opt into automatic clean integration for named branches only
  after validation, independent approval, no unresolved decision/recovery
  gate, and an up-to-date target.
- Conflicts always create visible attention; no LLM silently chooses a
  conflict resolution under the integration command.
- Push authorization, remote identity, target branch, history policy, and
  force-push prohibition are explicit configuration.

Design questions for owner approval before implementation:

- merge commit, squash, or rebase default for Boss Man-owned repositories;
- whether the first implementation may push/create PRs automatically or only
  prepare an integration receipt;
- which repositories/branches may opt into automatic integration;
- whether an independently reviewed conflict-resolution task may later resume
  the original integration command.

## P2-3 — runtime lifecycle and retention

Separate logical retention from physical cleanup:

- Settled task containers may be removed after a verified stop receipt.
- Worktrees/branches remain while referenced by an active execution, pending
  merge request, recovery candidate, unresolved Git operation, or explicit
  retention hold.
- Project/session/task deletion first produces a complete preview and custody
  export; destructive deletion is owner-only and idempotent.
- Storage quotas initially alert and pause new work rather than deleting old
  evidence.
- Automatic age-based deletion remains out of scope unless separately
  approved, preserving D-017.

## P2-4 — capacity, credentials, and providers

Start with measurement, not optimistic limits:

- record per-run peak RSS/CPU, container count, disk growth, duration, model
  route, provider wait/failure class, and OAuth/API-key/local-route class;
- establish a 64 GB M1 Max safety envelope with reserved headroom for macOS,
  Docker, the browser, and the central API;
- retain per-project fairness and explicit priority;
- keep OAuth-backed task execution serialized until concurrent refresh
  behavior is independently safe;
- permit separate API-key/local-model lanes only through configured capacity;
- exercise manual safe-boundary model change and provider-exhaustion pause;
- add LiteLLM/OpenRouter only if a concrete Pi compatibility, accounting, or
  policy gap remains after direct-route drills.

## P2-5 — backup and portability

The backup contract covers:

- central SQLite database and migration version;
- Pi-native session JSONL;
- context/custody manifests and checksums;
- prompts, model-route configuration references, and redacted secret contract;
- artifacts and raw/filtered command evidence;
- Git repository/worktree/branch/revision provenance;
- recovery candidates, decisions, reviews, validations, and audit events.

Real credentials are not included. Restore validates checksums and paths before
making the recovered state active. The second-host rehearsal uses a clean
supported ARM64 Mac, a compatible Docker engine, owner-supplied Pi login, and
no copied transient containers or credential material.

## Explicitly deferred from Phase 2

- authenticated SWAG/public exposure, browser sessions, API keys, CSRF, and
  remote rate limiting (Phase 3);
- Slack/email notifications and external ticket write-back;
- a browser terminal emulator unless dogfood proves Pi RPC + tmux/SSH
  insufficient;
- RAG/vector infrastructure without a measured retrieval failure;
- a shared credential broker;
- multi-host scheduling, high availability, team accounts, or public signup;
- automatic fallback routing through LiteLLM/OpenRouter without a direct Pi
  routing gap.

## Phase 2 exit gate

Phase 2 is complete only when:

1. A command/request disconnect cannot create a failed-command/live-run split
   or duplicate execution.
2. Provider/process/container/control-plane failures stop or pause work within
   measured bounds and preserve auditable recovery choices.
3. Restart and late-evidence drills require no SQLite edits or unrecorded state
   transitions.
4. Governed Git integration handles clean and conflicting targets without
   granting agents direct protected-repository authority.
5. Settled resources can be cleaned and retained data can be explicitly
   deleted without losing active, unmerged, or recovery evidence.
6. Concurrency and storage limits are measured on the target Mac and enforced
   visibly.
7. A provider/model interruption can be resumed or retried from custody under
   explicit policy.
8. A complete backup restores on a clean second ARM64 host and successfully
   resumes a retained task.
9. The owner can operate the normal workflow from cockpit or `boss` and keep a
   direct Pi/Codex session only as an emergency tool, not a routine repair
   path.

## Proposed decisions awaiting approval

- **D-047:** the central API owns settlement of every accepted task execution;
  the project daemon performs short idempotent acceptance and observation, not
  long-request success/failure arbitration.
- **D-048:** stop/failure begins with a durable mutation fence; late evidence
  is retained but never advances task state automatically.
- **D-049:** only the human owner may accept/reject a proven late checkpoint;
  acceptance invalidates stale validation/review and requires fresh gates.

These are hard-to-change authority choices. Implementation should not begin
until the owner accepts or amends them.
