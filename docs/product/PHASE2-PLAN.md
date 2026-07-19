# Phase 2 delivery plan

Status: Active — P2-1 through P2-3 implemented; P2-4 calibration next

Last updated: 2026-07-19

## Objective

Move Pink Guy from a supervised local development tool to a dependable
candidate for sustained dogfood. Phase 2 closes when routine work survives
process/provider interruption, Git integration and cleanup are governed,
resource policies are measured, and retained work can be exported and restored
into an isolated state root without direct SQLite repair. Phase 2D then proves
the workflow and Phase 2U accepts its usability before the full-time switch.

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
| **P2-1 Execution custody and recovery — complete** | Remove split command/run authority; add fencing, paused/reconciliation states, fast failure classification, restart reconciliation, and late-evidence actions. | Phase 1 | Model-less fault matrix plus two live failure/recovery drills completed without duplicate work or SQLite edits. |
| **P2-2 Governed Git integration — implemented** | Prepare and optionally execute merge/rebase/push/PR under project/branch policy, with conflict and reconciliation attention. | P2-1 settlement/fencing | Model-less merge/squash/rebase and conflict probes pass. Remote push/PR remains an owner-credential live drill in P2-4. |
| **P2-3 Runtime lifecycle and retention operations — implemented** | Retire settled worktrees/containers safely, implement explicit session artifact deletion, quotas, storage-pressure visibility, and restore-friendly manifests. | P2-1; coordinates with P2-2 worktree custody | Holds, cleanup, deletion manifests, idempotent retry, and storage-pressure dispatch blocking pass model-less acceptance. |
| **P2-4 Capacity, credentials, and provider resilience** | Measure host/provider limits, widen concurrency only where safe, exercise model switching and local routes, and classify provider exhaustion/failure. | P2-1; P2-3 quotas useful | Sustained mixed-project run stays within measured CPU/RAM/Docker/provider budgets; provider loss pauses or reroutes only under explicit policy. |
| **P2-5 Continuity export and restore** | Export canonical state/custody/artifacts without a model and restore into an isolated state root. | P2-1 through P2-4 storage/config contracts | Same-host isolated restore recovers tasks, native sessions, prompts/routes, artifacts, Git custody, and audit checksums; one retained task resumes. |

P2-1 through P2-3 now fix the authority, Git, and retention contracts needed
for measurement. P2-4 is deliberately collaborative: the owner selects the
acceptable host/provider envelope from observed data instead of receiving an
invented concurrency limit. P2-5 is then a bounded continuity proof rather
than a general-purpose backup product.

## P2-1 — execution custody and recovery

Canonical specs:

- [`../features/execution-recovery/PRODUCT.md`](../features/execution-recovery/PRODUCT.md)
- [`../features/execution-recovery/TECH.md`](../features/execution-recovery/TECH.md)

Implementation increments:

1. **Execution identity and async acceptance — implemented**
   - durable command-execution record;
   - one idempotent accepted execution per command;
   - short project-daemon start request;
   - central settlement authority.
2. **Fence, stop, and failure taxonomy — implemented**
   - capability/generation fence;
   - immediate process/protocol detection;
   - activity-aware inactivity and hard deadline;
   - idempotent cleanup receipts;
   - explicit Paused, Failed, Cancelled, and Needs reconciliation projection.
3. **Restart reconciliation — implemented**
   - reconcile nonterminal executions before new dispatch;
   - no automatic replay;
   - safe-stop + native/context custody rather than unproven live reattach.
4. **Late-evidence recovery — implemented**
   - verified checkpoint candidates;
   - owner accept/reject with consequence preview;
   - stale-task protection;
   - fresh validation/review after acceptance.
5. **Attention UX and live acceptance — complete**
   - cockpit and `boss` parity;
   - replace broad reset with valid state-aware actions;
   - controlled observer-loss and late-checkpoint drills.

The model-less recovery matrix and both authenticated live drills are green.
P2-1 is complete.

## P2-2 — governed Git integration

Use accepted D-007, D-009, D-028, and D-045 as the boundary:

- Pink Guy—not the task agent—owns merge/rebase/push/PR side effects.
- Default policy is prepare-only.
- A project may opt into automatic clean integration for named branches only
  after validation, independent approval, no unresolved decision/recovery
  gate, and an up-to-date target.
- Conflicts always create visible attention; no LLM silently chooses a
  conflict resolution under the integration command.
- Push authorization, remote identity, target branch, history policy, and
  force-push prohibition are explicit configuration.

Implemented behavior:

- every project begins in `prepare_only` mode with merge-commit history,
  `origin`, its detected default branch, no remote writes, and no force push;
- an owner can select prepare-only, local integration, or pull-request mode,
  plus merge, squash, or rebase history;
- execution rechecks completion, current validation, independent approval,
  unresolved decisions/dependencies/recovery, policy version, source revision,
  and target revision;
- Pink Guy creates integration results in isolated worktrees and updates a
  local target only with compare-and-swap semantics;
- conflicts and interrupted side effects remain visible and are never
  automatically replayed;
- push and `gh pr create` adapters exist only behind explicit project policy.

The model-less acceptance probe exercises two clean repository contexts, all
three history policies, a deterministic conflict, source-revision retention,
and restart reconciliation. A real remote push/PR drill is intentionally
paired with P2-4 credential calibration.

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

Implemented behavior:

- retention holds can target a project, task, session, run, or workspace;
- cleanup previews block active executions, recovery candidates, unsettled
  side effects, unintegrated implementation work, running containers, and
  holds;
- owner-confirmed cleanup retires only eligible managed workspaces/containers,
  records a durable intent first, and safely resumes a partial retry;
- explicit session deletion requires a fresh preview and typed session ID,
  writes a checksummed manifest, removes only declared state-root paths, and
  retains a tombstone and receipt;
- state-root inventory is grouped by resource class; configured warning/hard
  limits are visible, and a hard limit pauses new dispatch rather than
  deleting retained evidence.

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

### Owner calibration worksheet

The next session should answer these questions from measurements on the target
M1 Max:

1. How many simultaneous project orchestrators, task containers, and
   host-managed Pi processes preserve comfortable interactive headroom?
2. Should OAuth-backed runs remain globally serialized, or does a controlled
   two-run refresh/auth test prove a safe higher limit?
3. Which provider/model routes may pause, retry, or switch after exhaustion?
   Silent fallback remains prohibited.
4. Which local Pi-compatible model route is worth keeping as an outage lane,
   and what quality/task restrictions should apply?
5. What observed disk-growth rate justifies warning and hard storage limits?
6. Should normal remote publication use SSH Git, `gh`, or remain prepare-only
   until the post-Phase-2 dogfood gate?

Pink Guy already exposes storage totals and accepts explicit warning/hard
limits through `PINK_GUY_STORAGE_WARN_BYTES` and
`PINK_GUY_STORAGE_HARD_BYTES`. Resource concurrency defaults will not change
until this worksheet has live evidence.

## P2-5 — continuity export and restore

Codex currently provides excellent synced access and long-running task UX, but
it is not Pink Guy's portable backup format. Pink Guy only needs enough P2-5
work to prove that its own durable authority is recoverable:

1. produce a model-less, checksummed export containing a consistent SQLite
   snapshot, Pi-native session JSONL, custody/context manifests, artifacts,
   prompt/model-route references, and Git revision provenance;
2. exclude credentials and ephemeral containers;
3. restore into an isolated state root on the same Mac and verify tasks,
   sessions, artifacts, Git custody, and audit hashes before activation;
4. run one resumed task from the restored root;
5. defer a second-physical-Mac rehearsal and cloud-backup destination until
   the same-host restore proves an actual need and format stability.

This scope creates real portability and recovery value without building
encryption, scheduling, cloud retention, or cross-platform migration before
dogfood produces a requirement.

## Phase 2D — sustained dogfood and long-turn parity

Phase 2 completion starts another dogfood phase; it does not immediately
trigger a full switch from Codex. The proposed acceptance set is:

- complete meaningful work in at least three repositories, including one
  maintenance import and one new-project topic;
- complete at least ten executable tasks through deterministic dispatch,
  fixed-revision test/review, governed Git preparation/integration, and
  lifecycle cleanup;
- sustain multiple long orchestrator conversations across browser reconnect,
  compaction/custody, model changes, and control-plane restart without
  transcript resend or direct SQLite repair;
- exercise provider exhaustion, a Git conflict, paused owner audit, late
  evidence, retention hold, cleanup retry, and continuity restore;
- record every occasion where direct Codex or Pi was needed and classify it as
  missing capability, UX friction, reliability failure, or preference.

The exact duration and numeric long-turn threshold are P2-4 calibration
decisions. Phase 2D closes when direct Codex is an optional fallback for the
measured dogfood window, not a routine repair path, and its UX-friction log is
complete enough to drive the Phase 2U owner review.

## Phase 2U — dogfood-informed UX review

This short post-dogfood slice begins with an owner interview and a mockup built
from the existing cockpit rather than a speculative replacement. It will:

- reproduce and classify orchestrator-chat scroll bouncebacks;
- identify populated panels whose internal or page-level scrolling grows
  without a useful bound;
- inventory visual elements the owner cannot readily interpret and determine
  whether each needs clearer language, hierarchy, progressive disclosure, or
  removal;
- map the most common dogfood journeys across conversation, board, task
  evidence, attention, Git integration, and cleanup;
- validate the revised mockup with the owner before implementation;
- add focused regression coverage for accepted scrolling and navigation
  behavior.

The dogfood evidence log supplies frequency and context, but known scrolling
defects may still receive bounded fixes earlier if they materially obstruct
Phase 2D. Full-time replacement waits for the accepted Phase 2U usability
baseline.

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
8. A complete model-less continuity export restores into a clean isolated
   state root and successfully resumes a retained task.
9. The owner can operate the normal workflow from cockpit or `pink`; sustained
   Phase 2D dogfood and the Phase 2U owner-reviewed usability baseline—not
   Phase 2 implementation alone—decide when Codex becomes an optional
   fallback.

## Accepted P2-1 authority decisions

- **D-047:** the central API owns settlement of every accepted task execution;
  the project daemon performs short idempotent acceptance and observation, not
  long-request success/failure arbitration.
- **D-048:** stop/failure begins with a durable mutation fence; late evidence
  is retained but never advances task state automatically.
- **D-049:** proven late checkpoints enter a dead-letter-style recovery queue
  separate from runnable tasks; only the human owner may accept/reject a
  candidate, and acceptance invalidates stale validation/review and requires
  fresh gates.

The owner approved D-047 through D-049 on 2026-07-18. Their implementation,
model-less fault coverage, and authenticated live acceptance are complete.
