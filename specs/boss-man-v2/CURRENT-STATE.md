# Boss Man v2 current state

Status: Phase 1 in progress — local control loop implemented

Last updated: 2026-07-17

Branch: `codex/phase1-local-control-loop`

## Current position

The thin direct-Pi foundation is selected and Phase 0 is complete for the
local-smoke profile. Phase 1 has begun with the durable local control loop. The
central API can enqueue idempotent phase-scoped commands, let only the active
project orchestrator claim them in FIFO order, retain structured terminal
results, and hold claimed work for explicit reconciliation after lease loss.
The project-orchestrator process now consumes `start_task` commands through the
existing managed task-session boundary. The loopback cockpit shows recent
command state without becoming chat-first.

## Capability map

| Area | Current capability | Remaining boundary |
|---|---|---|
| Authority and tasks | One central Node API owns the SQLite task projection, capability-scoped mutations, audit events, review, protected decisions, validation, merge-request records, and per-project orchestrator leases. Its durable FIFO command lifecycle supports idempotent enqueue, project-scoped single claim, structured success/failure, and no-replay reconciliation after lease expiry/release. The project-orchestrator consumes `start_task` commands and preserves implementation/test/review phase scope. | Local task create/edit/claim controls, dependency scheduling, stop/reconcile commands, and attention UX remain Phase 1. Actual merge/rebase/push is Phase 2. |
| Pi sessions | Upstream Pi runs in RPC mode inside the recorded task container. Native JSONL lifecycle, model-less resume/import, child provenance, blocking pre-compaction custody, one owner-authorized OpenAI Codex turn, native-byte preservation, and C0-04 bundle-child consumption pass. | True in-flight RPC reattachment and production session controls remain. |
| Containers | The daemon creates, inspects, stops, and removes pinned Linux/ARM64 containers with a non-root user, read-only root, resource limits, minimal mounts, and no Docker socket. Restart reconciliation proves recorded ID, image, label, and liveness before cleanup. | True process reattachment and explicit production egress policy remain. Containers are damage containment, not a malicious-code boundary. |
| Git and workspaces | The daemon creates a worktree; the container edits files without usable shared Git metadata. Capability routes expose host-generated status/diff and idempotent host-owned checkpoint/commit requests with provenance trailers. A commit made immediately before daemon loss is recovered from parent/provenance identity without duplication. | Checkpoint-versus-final-commit policy, actual merge/rebase/push, conflicts, and worktree cleanup remain. |
| Credentials | A human-owned auth file is materialized read-only per run, copied into private writable Pi state, checksum-verified, concurrency-limited to one for OAuth, and both run copies are deleted on a normal stop. Synthetic canaries and one owner-authorized OpenAI Codex turn pass without changing the canonical source. Reconciliation deletes known per-run copies. | Post-crash canonical-checksum receipt and OAuth refresh reconciliation or a credential broker are required before parallel OAuth-backed runs. |
| RTK and command evidence | RTK 0.42.3 is pinned with telemetry disabled. Supervisor-managed commands and an actual Pi Bash tool call execute once and produce filtered output, redacted raw output, indexed artifacts, and receipts. | Production quotas, savings presentation, and operator bypass UX remain. |
| Context custody | One atomic 11-file bundle retains native Pi bytes and unknown entry types, the selected branch, task/audit/context items, decisions, canonical and selected memory, complete retrieval receipt, artifacts, Git state, manifest, and checksums. Clean import and transcript-free bundle children use no model or network. | Production deletion/quota/backup UX and the final supervisor-to-blocking-compaction handoff remain. |
| Memory and retrieval | The canonical memory/evidence schema and FTS5 projection are integrated into the central SQLite store. Eligibility is filtered before BM25 rank; receipts retain filters, scores, revisions, source refs, exclusions, excerpt checksums, and token use. A clean import rebuilds FTS from canonical JSON. | Semantic/vector retrieval remains deferred and rebuildable. Promotion UI and production mutation policy remain. |
| Restart recovery | SQLite records immutable intent/completion/reconciliation receipts. Startup checks container identity/liveness, pauses verified idle runs, holds uncertain response/tool effects without replay, recovers checksum-valid snapshots, and recovers parent/provenance-valid Git commits without duplication. | The prototype conservatively stops the old container; true Pi RPC reattachment and host/Docker power-cycle coverage remain production work. |
| Remote edge | A disposable SWAG-style contract passes HTTP, WebSocket/reconnect, streaming, upload, Host/Origin, outer/inner auth, CSRF, and revocation cases. | Retained as Phase 3 research evidence. No production SWAG, DNS, router, authentication, or launch-service work blocks local Phase 1. |
| Developer cockpit | Product behavior and a task-first information architecture are specified. The loopback Phase 1 shell shows projects, orchestrator leases, the multi-project board, sessions, recent durable commands, context status, and terminal/attach positioning without a chat-first layout. | Local mutations, PTY/reconnect, diffs/tests/review/context inspectors, and optional trusted-LAN access without application auth remain. |

## Artifact and data layout

```text
specs/boss-man-v2/
  PRODUCT.md, TECH.md, UI.md       desired behavior and architecture
  ROADMAP.md                       canonical local-first delivery sequence
  ADR-FOUNDATION.md, DECISIONS.md accepted direction and decision history
  PHASE0*.md, FOUNDATION.md        research contract, results, and closure plan
  CURRENT-STATE.md                 current capability/inventory index

specs/phase1-local-control-loop/
  PRODUCT.md, TECH.md, RESULTS.md  first Phase 1 behavior, design, and verification

phase0/
  baseline/                        artifact retention policy and source manifest
  fixtures/                        deterministic task and cross-project decoy inputs
  schemas/                         evidence and provider-profile JSON Schemas
  runtime/                         pinned Dockerfile, container/RTK policy, redacted provider example
  direct/                          executable daemon/store/runtime/Git/credential/artifact prototype
  pi/                              Pi lifecycle, custody, task/Git, and RTK extensions
  memory/                          canonical memory schema, benchmark fixture, dependency assessment
  edge/                            inert SWAG example and disposable operator test
  scripts/                         reproducible probes and evidence runner
  evidence/                        21 redacted, schema-valid evidence manifests
RUNBOOK.md                         exact localhost serve and project-orchestrator instructions
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

1. **Phase 1 — next local task-control slice.** Add task creation/editing,
   acceptance criteria, local claim/start actions, phase selection, and command
   state to the task workspace.
2. **Phase 1 — terminal and workspace surfaces.** Add a persistent
   PTY/reconnect path, then diff/test/review/context/artifact inspectors.
3. **Phase 2 — autonomy, recovery, and portability.** Add merge/rebase/push, recovery UX, retention/backup, resource limits, and second-host reproduction.
4. **Phase 3 — authenticated remote access.** Add the SWAG path and a locally configured password verifier or API-key hash after the local product is mature.

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
- **Provider fallback:** manual safe-boundary switching comes first; automatic OpenRouter routing and paid-spend policy remain deferred.
- **Project orchestration:** the durable command protocol and conservative
  lease-loss policy are implemented. Per-project task concurrency, scheduling
  priority, stop/reconcile commands, and global host-pressure limits remain to
  be specified and measured.
- **Trusted LAN:** the selected private interface/CIDR configuration and host-firewall enforcement need a Phase 1 design before binding beyond loopback.
- **Remote credential UX:** Phase 3 must choose password-session mode, API-key mode, or both. Browser `localStorage` persistence remains an explicit convenience/security decision, not the default.
