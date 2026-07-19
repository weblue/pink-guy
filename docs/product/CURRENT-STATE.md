# Pink Guy v2 current state

Status: Phase 2 active — P2-1 through P2-3 implemented in PR #17

Last updated: 2026-07-19

## Current position

The thin direct-Pi foundation is selected and Phase 0 is complete for the
local-smoke profile. Phase 1 closed on 2026-07-18 with the durable local
control loop. The central API can enqueue idempotent phase-scoped commands,
let only the active
project orchestrator claim them in FIFO order, retain structured terminal
results, and hold claimed work for explicit reconciliation after lease loss.
The project-orchestrator process now consumes `start_task` commands through the
existing managed task-session boundary. The loopback cockpit shows recent
command state without becoming chat-first. The owner can now create a
revision-bound task with acceptance criteria and atomically assign/schedule
one explicit agent phase from the board.

The active product direction is now implemented through its first runtime
boundary: a durable scoped orchestrator conversation is the primary way to
create and refine work. It must
support a pre-repository top-level topic, existing private repository intake,
optional owner description, and immutable external work-item snapshots. The
board remains authoritative and direct task controls remain a
fast path. The owner approved the first-class topic, system-intake
orchestrator, and read-only source-snapshot directions as D-039 through D-041
on 2026-07-17. The topic/turn substrate, persistent Pi RPC bridge, sanitized
event projection, cockpit, and provenance-linked task-graph mutations are
implemented. The dependency-free `pink` client now reopens the same durable
topic by topic, project, or repository and exposes the same history, task
changes, model route, browser deep link, and orchestrator process endpoint as
the cockpit. Terminal scrollback remains a client view rather than a second
conversation authority.

The first P1-1 through P1-3 increments are also implemented. Human-readable
profile defaults, platform policy envelopes, and phase kickoffs live as simple
text files under `config/prompts/`; editable profile revisions remain
versioned in the central store. Conversation route changes require
a checksum-verified model-less custody bundle and restart Pi against the same
native session. The owner can import a host-owned Git clone, attach immutable
external context, edit task description and acceptance criteria, resolve
decisions, stop/resume runs, and explicitly retry or reset failed or uncertain
commands.

P1-4 now executes each scheduled task phase through Pi settlement instead of
stopping at container creation. Implementation checkpoints advance the
authoritative task revision through an idempotent host receipt; test and review
runs receive fresh worktrees rooted at that exact commit. A test-scoped
validator records pass/fail evidence without commit authority, an independently
identified reviewer submits the disposition, and the project orchestrator
records completion when every gate passes. The task inspector retains phase
commands, runs, models/prompts, workspaces, committed diffs, Git provenance,
validation, review, context receipts, artifacts, decisions, activity, and
source snapshots. A model-less observer baseline proves the policy flow.

Successful implementation now continues automatically to test and then
independent review without another LLM turn or owner click. The central API
reconciles durable phase evidence after command completion and before command
claims, so an API/daemon restart cannot lose the transition. Failed validation,
non-approved review, missing required phase evidence, decisions, and
dependencies stop for explicit recovery. Untouched Ready tasks are never
auto-started.

Both repository dogfood scenarios now pass. The local `doc-map` prototype
completed new-project intake and requested-changes recovery. The imported
`inspector-gadget` repository completed a bounded maintenance task at fixed
revision `30f1cc551de44b08cf5d8573ea54ee7f40c8fb66`: validation passed,
independent review approved, completion recorded a merge request, and host
smoke passed all six tracked Bash scripts. The canceled PowerToys import was
removed through the audited safe-delete path without direct state edits.

Initial Ready selection is now model-less after explicit release. Accepted
D-046 keeps Pi responsible for refinement and release intent, while durable
manual/automatic/paused policy, priority/release ordering, lease and capacity
checks, atomic command creation, and sub-agent dispatch belong to the central
scheduler. Existing tasks remain manual; the cockpit and terminal show rank
and wait reasons. Direct phase scheduling remains an explicit recovery path.

The Phase 1 closure task
`94613637-58af-4ba5-ae4e-b03503bf5a54` proved that path live: the orchestrator
released it, the central scheduler dispatched implementation two milliseconds
later, validation passed the resulting fixed revision, independent review
approved it, and completion recorded the merge request. Its lease-observability
change was merged in PR #15. The same run exposed the first Phase 2 recovery
priority: a transport-failed command left its Pi run alive long enough to emit
late evidence, requiring the owner to use supported stop/reset controls.

Task lifecycle is now explicit and orthogonal to execution status. Executable
tasks can run phases; umbrella and intake artifacts cannot. Tags are optional,
normalized organization labels. Archive/restore operations are versioned and
audited, preserve status and all evidence, and keep settled planning records
out of the active board. Splitting a task converts its parent to Umbrella.
The retained UI dogfood queue verified the migration: its umbrella, superseded
review child, and bootstrap intake are now inspectable under Archived and the
Ready column is empty.

The final pre-dogfood gates are implemented. Every task phase resolves its own
provider/model/thinking/billing route before command creation, the orchestrator
can select that route for a sub-agent, and the effective route is checked
against Pi and retained on the run. Orchestrator compaction blocks on verified
model-less custody. An unbound topic can be snapshotted, transferred to a
project, and resumed from the same native Pi session without resending its
transcript.

The repository has graduated from its Phase 0 research layout. Live platform
code now has stable product paths under `src/`, operator entry points live
under `scripts/`, and current documentation is indexed from `docs/`. Completed
feasibility plans and evidence remain available as history without defining
the runtime structure.

## Capability map

| Area | Current capability | Remaining boundary |
|---|---|---|
| Authority and tasks | One central Node API owns the SQLite task projection and every accepted task execution. Short idempotent acceptance, central asynchronous settlement, execution generations, explicit stop/pause/resume/retry/cancel, and shared recovery/Git attention remove daemon transport from completion authority. Model-less and live observer-loss/late-checkpoint acceptance pass. | Capacity/provider calibration and sustained dogfood remain. |
| Pi sessions | Upstream Pi runs in RPC mode inside recorded task containers and as a host-managed persistent orchestrator session. Native JSONL lifecycle, model-less resume/import, child provenance, task and conversation custody, custody-backed model switching, blocking orchestrator pre-compaction export, safe intake transfer, and C0-04 bundle-child consumption pass. Runs pin provider/model/thinking and prompt key/version/checksum; deterministic transfer and route-restart coverage proves no transcript resend. | True in-flight RPC reattachment and production session controls remain. |
| Containers | The daemon creates, inspects, stops, and removes pinned Linux/ARM64 containers with a non-root user, read-only root, resource limits, minimal mounts, and no Docker socket. Restart reconciliation proves recorded identity/liveness; settled resources have previewed, held, audited, idempotent cleanup. | Measured capacity and explicit production egress policy remain. Containers are damage containment, not a malicious-code boundary. |
| Git and workspaces | Every phase worktree starts from the task revision. Host checkpoints carry provenance and invalidate stale validation/review. Project policy defaults to prepare-only and supports merge/squash/rebase, guarded local integration, optional normal push/PR, deterministic conflicts, compare-and-swap publication, and no force push. | Live credentialed remote push/PR acceptance and dogfood policy calibration remain. |
| Credentials | A human-owned auth file is materialized read-only per run, copied into private writable Pi state, checksum-verified, concurrency-limited to one for OAuth, and both run copies are deleted on a normal stop. Synthetic canaries and one owner-authorized OpenAI Codex turn pass without changing the canonical source. Reconciliation deletes known per-run copies. | Parallel OAuth-backed execution remains disabled until a simpler independently verifiable refresh strategy is proven. API-key and local-model routes may use separate explicit limits. |
| RTK and command evidence | RTK 0.42.3 is pinned with telemetry disabled. Supervisor-managed commands and an actual Pi Bash tool call execute once and produce filtered output, redacted raw output, indexed artifacts, and receipts. | Production quotas, savings presentation, and operator bypass UX remain. |
| Context custody | Task bundles retain native Pi bytes, branch, task/audit/context, decisions, memory/retrieval, artifacts, Git, manifest, and checksums. Conversation bundles retain topic, turns/events/runs, tasks/origins, prompts, and native bytes. Retention holds, explicit session deletion manifests/tombstones, and storage inventory are model-less. | A complete continuity export and isolated-root restore remain. |
| Memory and retrieval | Canonical memory/evidence and artifact records are integrated into the central SQLite store. Eligibility is filtered before FTS5/BM25 rank; receipts retain filters, scores, revisions, source refs, exclusions, excerpt checksums, and token use. A clean import rebuilds FTS from canonical JSON. | Promotion UI and production mutation policy remain. Retrieval changes require a measured dogfood failure; retrieval never becomes storage authority. |
| Restart recovery | SQLite records execution identity/events, mutation generations, action/stop receipts, side-effect reconciliation, and quarantined late checkpoints. Startup fences nonterminal executions before cleanup, never replays uncertain work, pauses proven retained runs, and fails or quarantines other boundaries. Both live P2-1 drills pass. | Host/Docker power-cycle coverage remains. True Pi RPC process reattachment is intentionally out of scope; retained native custody supplies resume. |
| Remote edge | A disposable SWAG-style contract passes HTTP, WebSocket/reconnect, streaming, upload, Host/Origin, outer/inner auth, CSRF, and revocation cases. | Retained as Phase 3 research evidence. No production SWAG, DNS, router, authentication, or launch-service work blocks local Phase 1. |
| Developer cockpit | The loopback cockpit combines persistent Pi conversation, multi-project board, repository/source intake, prompt/model controls, phase/workspace evidence, execution and Git attention, project Git policy, integration actions, retention holds, cleanup, session deletion, storage, and tmux/SSH guidance. `pink` exposes the same durable state. | Richer artifact navigation and owner dependency editing remain usage-driven. D-043 defers a browser PTY. |
| Orchestrator interaction | The project daemon claims and idempotently accepts work, then immediately returns to observation. The central API—not the daemon request—owns phase settlement and model-less continuation. Late Git evidence is quarantined from scheduling until an owner accepts or rejects it. Observer-drop and post-fence checkpoint drills pass through fresh validation/review. | Source refresh semantics and wider measured resource-pressure/concurrency controls are later work. |

## Adoption readiness

Pink Guy is now a **supervised local development tool**, not yet a dependable
full-time replacement for a direct Codex or Pi coding session.

| Checkpoint | Required capability | Recommended use |
|---|---|---|
| Phase 1 (current) | Complete implementation → fixed checkpoint → test → review flow across multiple real repositories, with deterministic initial dispatch, context custody, and inspectable evidence | Prefer Pink Guy for supervised local development; retain a direct client as recovery fallback |
| Phase 2 exit | Dependable recovery/Git/cleanup, measured host/provider limits, failure drills, and an isolated-root continuity restore | Enter sustained long-turn dogfood |
| Phase 2D exit | Multiple real repositories and long conversations complete without routine direct-client repair; journey/friction evidence is retained | Enter the owner UX interview and mockup review |
| Phase 2U exit | Owner-approved cockpit mockup and high-frequency usability fixes, including stable scrolling and clearer information hierarchy | Prefer Pink Guy as the full-time local coding environment |
| Phase 3 exit | Authenticated SWAG deployment with proxy, session/key, streaming, reconnect, rate-limit, and recovery controls | Use the intended remote-first experience |

Phase 1 completion is the earliest reasonable point to prefer Pink Guy for
ordinary supervised work. Phase 2 closes the remaining implementation and
continuity gates. Phase 2D proves Codex-like long turns and recovery through
sustained real work; Phase 2U then turns that evidence into an owner-reviewed
usability baseline before the full-time switch.

## Artifact and data layout

```text
src/
  server/                          API, SQLite authority, runtime, Git, credentials, context
  ui/                              browser developer cockpit
  pi/                              Pi orchestration, custody, task, and RTK extensions
  policy/                          isolated task-policy reference

scripts/                           stable server and orchestrator entry points
config/                            model routes, plain-text prompts, schemas, RTK, provider example
infra/
  container/                       pinned task-agent image and policy
  edge/                            inert SWAG example and disposable edge test
tests/
  run-core.mjs                     deterministic core regression entry point
  probes/                          individual integration and feasibility probes
  fixtures/                        deterministic task, memory, and cross-project inputs
  evidence/                        reproducibility source metadata

docs/
  product/                         current state, product, UI, and roadmap
  architecture/                    technical design, ADR, and decision register
  features/                        implemented feature contracts and results
  operations/                      local run and testing instructions
  research/                        provider, ecosystem, and memory assessments
  history/phase0/                  completed plans, closure, and 21 evidence manifests
```

The repository holds small reviewed specifications, schemas, deterministic fixtures, executable probes, redacted configuration examples, and evidence manifests with SHA-256 references. It intentionally does not hold real credentials, SSH keys, provider responses, native user sessions, runtime databases, unredacted command logs, temporary worktrees, or container filesystems.

During a prototype run, data outside Git consists of:

- SQLite rows for projects, one-project-orchestrator leases, tasks, task context items, capabilities, phase-scoped sessions/runs, ordered run/task/audit events, immutable side-effect intent/completion/reconciliation receipts, reviews, decisions, validations, merge requests, canonical memory/evidence, retrieval receipts, workspaces, Git operations, credential-delivery receipts, and artifact indexes;
- Pi-native session JSONL and custody snapshots;
- atomic unified context directories containing native/branch/task/decision/memory/receipt/artifact/Git/checksum files;
- redacted raw command output, RTK-filtered output, checksums, and receipts;
- task worktrees, branches, and host-owned checkpoint commits; and
- ephemeral credential copies, which are deleted after canonical-source verification on the normal stop path.

The durable evidence manifest is the checked-in claim; a disposable path in a
manifest does not promise that the referenced temporary file still exists.
Complete sessions and artifacts remain retained until explicit deletion.
Holds, safe resource cleanup, session deletion manifests/tombstones, storage
inventory, and hard-pressure dispatch pause are implemented; continuity
export/restore and production backup policy remain.

## Next steps

The active delivery map is
[`PHASE2-PLAN.md`](PHASE2-PLAN.md), and the executable closure/adoption
sequence is [`PHASE2-CLOSURE.md`](PHASE2-CLOSURE.md). Phase 1 dogfood evidence
remains in [`DOGFOOD-PLAN.md`](DOGFOOD-PLAN.md).

1. **Merge PR #17 and verify main.** Run the complete model-less suite and
   local cockpit smoke against one recorded mainline revision.
2. **Calibrate P2-4 together.** Measure host, Docker, provider, credential, and
   local-model behavior before changing concurrency/fallback policy.
3. **Run the remaining live side-effect drills.** Exercise one explicitly authorized
   normal push or pull-request publication without widening default policy.
   Verify cleanup against a settled disposable Docker task.
4. **Build the bounded P2-5 continuity proof.** Export and restore into an
   isolated state root on this Mac, excluding credentials and containers.
5. **Enter Phase 2D dogfood.** Exercise long conversations and at least ten
   tasks across multiple repositories while logging every direct-client exit
   and recurring UX friction.
6. **Run Phase 2U UX review.** Interview the owner, mock up changes from the
   existing cockpit, and fix accepted high-frequency scrolling,
   comprehension, and navigation problems.
7. **Phase 3 — authenticated remote access.** Add the SWAG path and a locally
   configured password verifier or API-key hash after the local product is
   mature.

## Questions exposed by implementation

Resolved or narrowed:

- Direct Pi is the foundation and only supported harness integration.
- Pink Guy owns task, container, credential, artifact, and Git authority.
- The host daemon owns dynamic task containers; containers do not receive the
  Docker socket or create other containers.
- OAuth snapshot credentials are single-run and disposable for Phase 0; shared writable Pi auth is rejected.
- RTK needs Pink Guy-managed single-execution capture in the pinned container rather than relying only on RTK's Linux tee behavior.
- A real Pi Bash tool call reaches that RTK capture and artifact-ingestion path through the selected daemon.
- Canonical SQL/session/artifact records remain authoritative; FTS is a
  rebuildable model-less retrieval projection, not storage.
- Side effects use durable intent/completion/reconciliation receipts. Only independently verifiable container, snapshot, and Git facts are recovered; uncertain provider/tool work is never replayed automatically.
- One central API manages all projects; one active daemon/tmux orchestrator lease is allowed per project; task subagent runs are phase-scoped.
- Implementation checkpoints are the custody boundary: test and review start
  from that recorded revision, and a new checkpoint invalidates older
  validation and review evidence.
- Top-level intent uses a first-class pre-project topic. One system-intake
  orchestrator handles unbound conversations and transfers a model-less
  snapshot to the project orchestrator after binding.
- External work items use immutable, explicitly refreshed, read-only generic
  snapshots with no synchronization or write-back contract.
- Pink Guy centrally resolves and persists each orchestrator and task-subagent
  provider/model/thinking assignment, supplies it directly to Pi at startup,
  and gates later changes behind a safe-boundary snapshot. Local model routes
  are first-class when supported by the configured Pi installation.
- The managed conversation runtime sends each new owner message directly to
  one persistent Pi native session and projects sanitized RPC events; it does
  not rebuild or resend prior chat history.
- The ASCII information architecture in `UI.md` is the C0-04 wireframe. Detailed interaction wireframes remain future design work.

Still open, but assigned to explicit gates rather than blocking current work:

- **Credential concurrency:** keep OAuth-backed task runs serialized and
  measure overlapping orchestrator/task provider turns during dogfooding
  before changing the policy.
- **Recovery UX and reattachment:** the closure smoke proved that command
  failure can race a still-running Pi session and late checkpoint. Accepted
  D-047 through D-049 define central settlement, mutation fencing, and
  owner-only late-checkpoint resolution. The first implementation deliberately
  safe-stops and resumes from custody; true in-flight process reattachment
  remains optional unless later measurement justifies its complexity.
- **Optional workspace shell:** D-043 rejects a browser PTY as a Phase 1
  requirement. Add a durable interactive shell only if dogfooding exposes work
  that cannot be performed through Pi RPC, cockpit controls, or tmux/SSH.
- **Git rollout:** which projects may move beyond prepare-only, and whether the
  first live remote publication uses SSH Git or `gh`.
- **Network policy:** which provider/control-plane destinations are allowed and how egress is enforced and displayed.
- **Continuity scope:** same-host isolated restore is the P2-5 minimum; cloud
  destination, encryption, scheduled retention, and a second physical Mac
  remain needs-driven follow-ons.
- **Production dependencies:** supported SQLite binding and migrations plus
  scalable diff/artifact rendering.
- **Model routes:** conversation switching and explicit per-task/phase
  assignment are implemented. The current Pi installation lists hosted
  OpenAI Codex routes but no local provider, so a real local-model smoke awaits
  owner configuration. Add a routing intermediary only for a concrete Pi
  compatibility or policy gap.
- **Project orchestration:** durable model-less initial dispatch and successful
  phase continuation are implemented with explicit policy, bounded priority,
  stable ordering, lease checks, and conservative one-command global/project
  capacity. Wider concurrency, richer recovery diagnosis, and host-pressure
  limits are Phase 2 measurement work.
- **Remote credential UX:** Phase 3 must choose password-session mode, API-key mode, or both. Browser `localStorage` persistence remains an explicit convenience/security decision, not the default.
