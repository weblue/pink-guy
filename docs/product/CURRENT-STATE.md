# Boss Man v2 current state

Status: Phase 1 in progress — P1-1 through P1-3 dogfood controls landed

Last updated: 2026-07-17

## Current position

The thin direct-Pi foundation is selected and Phase 0 is complete for the
local-smoke profile. Phase 1 has begun with the durable local control loop. The
central API can enqueue idempotent phase-scoped commands, let only the active
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
optional owner description, and immutable external work-item snapshots such
as Jira. The board remains authoritative and direct task controls remain a
fast path. The owner approved the first-class topic, system-intake
orchestrator, and read-only source-snapshot directions as D-039 through D-041
on 2026-07-17. The topic/turn substrate, persistent Pi RPC bridge, sanitized
event projection, cockpit, and provenance-linked task-graph mutations are
implemented. The dependency-free `boss` client now reopens the same durable
topic by topic, project, or repository and exposes the same history, task
changes, model route, browser deep link, and orchestrator process endpoint as
the cockpit. Terminal scrollback remains a client view rather than a second
conversation authority.

The first P1-1 through P1-3 increments are also implemented. Agent role
guidance is editable through versioned browser/terminal profiles while the
platform policy envelope remains immutable. Conversation route changes require
a checksum-verified model-less custody bundle and restart Pi against the same
native session. The owner can import a host-owned Git clone, attach immutable
manual/Jira context, edit task description and acceptance criteria, resolve
decisions, stop/resume runs, and explicitly retry or reset failed or uncertain
commands.

The repository has graduated from its Phase 0 research layout. Live platform
code now has stable product paths under `src/`, operator entry points live
under `scripts/`, and current documentation is indexed from `docs/`. Completed
feasibility plans and evidence remain available as history without defining
the runtime structure.

## Capability map

| Area | Current capability | Remaining boundary |
|---|---|---|
| Authority and tasks | One central Node API owns the SQLite task projection, capability-scoped agent mutations, audited loopback-owner task creation/scheduling/editing/decision resolution, review, validation, merge-request records, and per-project orchestrator leases. Explicit stop/resume and retry/reset controls preserve the no-automatic-replay rule. | Owner dependency editing, a consolidated attention queue, and richer command/run inspection remain. Actual merge/rebase/push is Phase 2. |
| Pi sessions | Upstream Pi runs in RPC mode inside recorded task containers and as a host-managed persistent orchestrator session. Native JSONL lifecycle, model-less resume/import, child provenance, task and conversation custody, custody-backed model switching, and C0-04 bundle-child consumption pass. Runs pin provider/model/thinking and prompt key/version/checksum; deterministic two-turn coverage proves no transcript resend across a route restart. | Orchestrator pre-compaction/transfer triggers, true in-flight RPC reattachment, and production session controls remain. |
| Containers | The daemon creates, inspects, stops, and removes pinned Linux/ARM64 containers with a non-root user, read-only root, resource limits, minimal mounts, and no Docker socket. Restart reconciliation proves recorded ID, image, label, and liveness before cleanup. | True process reattachment and explicit production egress policy remain. Containers are damage containment, not a malicious-code boundary. |
| Git and workspaces | The daemon creates a worktree; the container edits files without usable shared Git metadata. Capability routes expose host-generated status/diff and idempotent host-owned checkpoint/commit requests with provenance trailers. A commit made immediately before daemon loss is recovered from parent/provenance identity without duplication. | Checkpoint-versus-final-commit policy, actual merge/rebase/push, conflicts, and worktree cleanup remain. |
| Credentials | A human-owned auth file is materialized read-only per run, copied into private writable Pi state, checksum-verified, concurrency-limited to one for OAuth, and both run copies are deleted on a normal stop. Synthetic canaries and one owner-authorized OpenAI Codex turn pass without changing the canonical source. Reconciliation deletes known per-run copies. | Post-crash canonical-checksum receipt and OAuth refresh reconciliation or a credential broker are required before parallel OAuth-backed runs. |
| RTK and command evidence | RTK 0.42.3 is pinned with telemetry disabled. Supervisor-managed commands and an actual Pi Bash tool call execute once and produce filtered output, redacted raw output, indexed artifacts, and receipts. | Production quotas, savings presentation, and operator bypass UX remain. |
| Context custody | Task bundles retain native Pi bytes, branch, task/audit/context, decisions, memory/retrieval, artifacts, Git, manifest, and checksums. Conversation bundles retain topic, turns/events/runs, tasks/origins, used prompts, and native bytes. Clean import, bundle children, and route changes use no model or network. | Orchestrator pre-compaction/intake-transfer triggers plus production deletion/quota/backup/restore UX remain. |
| Memory and retrieval | The canonical memory/evidence schema and FTS5 projection are integrated into the central SQLite store. Eligibility is filtered before BM25 rank; receipts retain filters, scores, revisions, source refs, exclusions, excerpt checksums, and token use. A clean import rebuilds FTS from canonical JSON. | Semantic/vector retrieval remains deferred and rebuildable. Promotion UI and production mutation policy remain. |
| Restart recovery | SQLite records immutable intent/completion/reconciliation receipts. Startup checks container identity/liveness, pauses verified idle runs, holds uncertain response/tool effects without replay, recovers checksum-valid snapshots, and recovers parent/provenance-valid Git commits without duplication. | The prototype conservatively stops the old container; true Pi RPC reattachment and host/Docker power-cycle coverage remain production work. |
| Remote edge | A disposable SWAG-style contract passes HTTP, WebSocket/reconnect, streaming, upload, Host/Origin, outer/inner auth, CSRF, and revocation cases. | Retained as Phase 3 research evidence. No production SWAG, DNS, router, authentication, or launch-service work blocks local Phase 1. |
| Developer cockpit | The loopback cockpit combines projects/topics, persistent Pi conversation, multi-project board, repository import, immutable source intake, versioned prompt editor, custody-backed model switch, task detail/decisions/activity, session stop/resume, command retry/reset, and tmux/SSH attach guidance. The dependency-free `boss` client shares conversation, import, prompt, and model operations. | Diff/test/review/context/artifact workspace inspectors and optional trusted-LAN access remain. D-043 defers a browser PTY. |
| Orchestrator interaction | First-class topic/conversation projections, central versioned model and prompt policy, ordered turns/events, scoped leases, persistent Pi RPC, sanitized reconnect streams, audited task-graph mutations, host-owned repository intake, and immutable source snapshots are implemented. | Intake-to-project transfer custody, source refresh semantics, scheduling priority, and resource-pressure controls remain. |

## Adoption readiness

Boss Man is currently a **development preview suitable for supervised
dogfooding**, not yet a full-time replacement for a direct Codex or Pi coding
session.

| Checkpoint | Required capability | Recommended use |
|---|---|---|
| Current | Durable local API, project conversations, shared browser/terminal view, task graph, phase scheduling, managed runtime/Git/context foundations | Run alongside a direct coding client on noncritical work |
| Phase 1 exit | Complete implementation → test → review → checkpoint flow across multiple real repositories, with diff/test/review/context/artifact inspectors and remaining custody/attention gaps closed | Prefer Boss Man for supervised local development; retain a direct client as recovery fallback |
| Phase 2 exit | Dependable restart/resume, merge/rebase/push/conflicts/cleanup, credential concurrency, retention/backup, measured resource limits, provider drills, and second-host reproduction | Use Boss Man as the full-time local coding environment |
| Phase 3 exit | Authenticated SWAG deployment with proxy, session/key, streaming, reconnect, rate-limit, and recovery controls | Use the intended remote-first experience |

Phase 1 completion is the earliest reasonable point to prefer Boss Man for
ordinary supervised work. Phase 2 completion is the trust threshold for using
it full time instead of Codex: losing the control process, provider access, or
host must not lose work or require direct SQLite repair.

## Artifact and data layout

```text
src/
  server/                          API, SQLite authority, runtime, Git, credentials, context
  ui/                              browser developer cockpit
  pi/                              Pi orchestration, custody, task, and RTK extensions
  policy/                          isolated task-policy reference

scripts/                           stable server and orchestrator entry points
config/                            schemas, RTK config, and redacted provider example
infra/
  container/                       pinned task-agent image and policy
  edge/                            inert SWAG example and disposable edge test
tests/
  run-core.mjs                     deterministic Phase 1 regression entry point
  probes/                          individual integration and feasibility probes
  fixtures/                        deterministic task, memory, and cross-project inputs
  evidence/                        reproducibility source metadata

docs/
  product/                         current state, product, UI, and roadmap
  architecture/                    technical design, ADR, and decision register
  features/                        implemented Phase 1 contracts and results
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

The durable evidence manifest is the checked-in claim; a disposable path in a manifest does not promise that the referenced temporary file still exists. The product retention direction remains complete sessions and artifacts until explicit deletion, but deletion workflows, quotas, backups, and production storage layout are not yet implemented.

## Next steps

1. **Close residual P1-1 boundaries.** Trigger conversation custody before
   orchestrator compaction and system-intake → project transfer; add restore
   and retention operations after the real workflow is stable.
2. **Close residual P1-2/P1-3 UX.** Add explicit source refresh/diff,
   owner dependency editing, and a consolidated attention queue.
3. **P1-4 — workspace inspectors and real-workflow dogfood.** Add
   source/decision/custody navigation plus diff/test/review/context/artifact
   inspectors. Prove the complete phase flow across at least two real
   repositories without probe helpers or SQLite edits. D-043 keeps a browser
   PTY out of the baseline; tmux/SSH remains the escape hatch.
4. **Phase 2 — autonomy, recovery, and portability.** Add
   merge/rebase/push, recovery UX, credential concurrency, retention/backup,
   measured resource limits, and second-host reproduction.
5. **Phase 3 — authenticated remote access.** Add the SWAG path and a locally
   configured password verifier or API-key hash after the local product is
   mature.

## Questions exposed by implementation

Resolved or narrowed:

- Direct Pi, not an Agent of Empires fork, is the foundation.
- Boss Man owns task, container, credential, artifact, and Git authority.
- No Compose file is warranted until a stable second service boundary exists.
- OAuth snapshot credentials are single-run and disposable for Phase 0; shared writable Pi auth is rejected.
- RTK needs Boss Man-managed single-execution capture in the pinned container rather than relying only on RTK's Linux tee behavior.
- A real Pi Bash tool call reaches that RTK capture and artifact-ingestion path through the selected daemon.
- Canonical SQL/session/artifact records remain authoritative; FTS and future RAG/vector layers are rebuildable projections.
- Side effects use durable intent/completion/reconciliation receipts. Only independently verifiable container, snapshot, and Git facts are recovered; uncertain provider/tool work is never replayed automatically.
- One central API manages all projects; one active daemon/tmux orchestrator lease is allowed per project; task subagent runs are phase-scoped.
- Top-level intent uses a first-class pre-project topic. One system-intake
  orchestrator handles unbound conversations and transfers a model-less
  snapshot to the project orchestrator after binding.
- External tickets use immutable, explicitly refreshed, read-only snapshots;
  Jira write-back, webhooks, and polling are deferred.
- LiteLLM is deferred from v1. Boss Man centrally resolves and persists each
  orchestrator and task-subagent model assignment, supplies it to Pi at
  startup, and gates later changes behind a safe-boundary snapshot.
- The managed conversation runtime sends each new owner message directly to
  one persistent Pi native session and projects sanitized RPC events; it does
  not rebuild or resend prior chat history.
- The ASCII information architecture in `UI.md` is the C0-04 wireframe. Detailed interaction wireframes remain future design work.

Still open, but assigned to explicit gates rather than blocking current work:

- **Credential refresh:** locked reconciliation versus a host broker before parallel OAuth runs.
- **Recovery UX and reattachment:** how the owner resolves uncertain effects, how a paused session starts a new Pi RPC process, and whether true in-flight process reattachment is worth its operational complexity.
- **Terminal semantics:** the current shell preserves filesystem state but executes each API command in a subshell; production needs a true PTY with durable `cwd`, environment, resize, scrollback, and reconnect behavior.
- **Git policy:** distinction between checkpoints and final commits, squash/history policy, merge/rebase execution, conflicts, push authorization, and worktree cleanup.
- **Network policy:** which provider/control-plane destinations are allowed and how egress is enforced and displayed.
- **Retention operations:** deletion semantics, quotas, backup destination, encryption, and storage-pressure behavior while honoring retain-until-delete.
- **Production dependencies:** supported SQLite binding and migrations, web/PTY/diff components, and whether a credential broker creates a Compose-worthy service boundary.
- **Reproduction:** which second clean ARM64 host will be used for Phase 2 portability validation.
- **Provider fallback:** manual custody-backed switching is implemented;
  automatic OpenRouter routing and paid-spend policy remain deferred.
- **Project orchestration:** the durable command protocol and conservative
  lease-loss policy are implemented. Per-project task concurrency, scheduling
  priority, richer recovery diagnosis, and global host-pressure limits remain
  to be specified and measured.
- **Trusted LAN:** the selected private interface/CIDR configuration and host-firewall enforcement need a Phase 1 design before binding beyond loopback.
- **Remote credential UX:** Phase 3 must choose password-session mode, API-key mode, or both. Browser `localStorage` persistence remains an explicit convenience/security decision, not the default.
