# Boss Man v2 current state

Status: Phase 0 closure active

Last updated: 2026-07-17

Branch: `codex/finish-phase0`

## Current position

The thin direct-Pi foundation is selected. C0-01 through C0-03 are complete. The direct daemon has passed synthetic isolation, an owner-authorized OpenAI Codex turn with a real Pi Bash→RTK path, and crash reconciliation across idle, provider, tool, snapshot, and Git states. C0-04 is next; C0-05 and C0-06 remain open. This is an executable control-plane prototype and evidence program, not yet the production cockpit or long-lived deployment.

## Capability map

| Area | Current capability | Remaining boundary |
|---|---|---|
| Authority and tasks | One Node daemon owns the SQLite task projection, capability-scoped mutations, audit events, review, protected decisions, validation, and merge-request records. Workers can read/claim/update/block/create children/request review; reviewers inspect a fixed revision; orchestrator/owner actions are policy-gated. | Owner-authenticated capability issuance is C0-05. Actual merge/rebase/push execution is not implemented. |
| Pi sessions | Pinned upstream Pi 0.80.9 runs in RPC mode inside the recorded task container. Native JSONL lifecycle, model-less resume/import, child provenance, blocking pre-compaction custody, one owner-authorized OpenAI Codex turn, and native-byte preservation across injected restart pass. | Unified context assembly, true in-flight RPC reattachment, and production session controls remain. |
| Containers | The daemon creates, inspects, stops, and removes pinned Linux/ARM64 containers with a non-root user, read-only root, resource limits, minimal mounts, and no Docker socket. Restart reconciliation proves recorded ID, image, label, and liveness before cleanup. | True process reattachment and explicit production egress policy remain. Containers are damage containment, not a malicious-code boundary. |
| Git and workspaces | The daemon creates a worktree; the container edits files without usable shared Git metadata. Capability routes expose host-generated status/diff and idempotent host-owned checkpoint/commit requests with provenance trailers. A commit made immediately before daemon loss is recovered from parent/provenance identity without duplication. | Checkpoint-versus-final-commit policy, actual merge/rebase/push, conflicts, and worktree cleanup remain. |
| Credentials | A human-owned auth file is materialized read-only per run, copied into private writable Pi state, checksum-verified, concurrency-limited to one for OAuth, and both run copies are deleted on a normal stop. Synthetic canaries and one owner-authorized OpenAI Codex turn pass without changing the canonical source. Reconciliation deletes known per-run copies. | Post-crash canonical-checksum receipt and OAuth refresh reconciliation or a credential broker are required before parallel OAuth-backed runs. |
| RTK and command evidence | RTK 0.42.3 is pinned with telemetry disabled. Supervisor-managed commands and an actual Pi Bash tool call execute once and produce filtered output, redacted raw output, indexed artifacts, and receipts. | Production quotas, savings presentation, and operator bypass UX remain. |
| Context custody | Harness probes preserve native Pi JSONL, unknown entries, snapshots before compaction, exact resume/import, and fresh/bundle/fork provenance without an LLM exporter. | C0-04 must atomically combine native session, task, decisions, memory, artifacts, and Git state into one candidate-level manifest and receipt path. |
| Memory and retrieval | Canonical memory/event schemas and a model-less SQLite FTS5 benchmark pass scope, provenance, supersession, deletion/rebuild, poisoning, secret, and cross-project tests. | The memory schema is not yet integrated into the direct store or prompt/context assembler. Semantic/vector retrieval remains deferred and rebuildable. |
| Restart recovery | SQLite records immutable intent/completion/reconciliation receipts. Startup checks container identity/liveness, pauses verified idle runs, holds uncertain response/tool effects without replay, recovers checksum-valid snapshots, and recovers parent/provenance-valid Git commits without duplication. | The prototype conservatively stops the old container; true Pi RPC reattachment and host/Docker power-cycle coverage remain production work. |
| Remote edge | A disposable SWAG-style contract passes HTTP, WebSocket/reconnect, streaming, upload, Host/Origin, outer/inner auth, CSRF, and revocation cases. | C0-05 must run the real direct application and single-owner session through that contract. No production SWAG, DNS, router, or launch-service mutation is authorized. |
| Developer cockpit | Product behavior and a task-first information architecture are specified; chat is one tab among board, diff, tests, review, context, artifacts, and terminal surfaces. | No production web cockpit, PTY/reconnect layer, or browser-IDE integration has been implemented. |

## Artifact and data layout

```text
specs/boss-man-v2/
  PRODUCT.md, TECH.md, UI.md       desired behavior and architecture
  ADR-FOUNDATION.md, DECISIONS.md accepted direction and decision history
  PHASE0*.md, FOUNDATION.md        research contract, results, and closure plan
  CURRENT-STATE.md                 current capability/inventory index

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
  evidence/                        20 redacted, schema-valid evidence manifests
```

The repository holds small reviewed specifications, schemas, deterministic fixtures, executable probes, redacted configuration examples, and evidence manifests with SHA-256 references. It intentionally does not hold real credentials, SSH keys, provider responses, native user sessions, runtime databases, unredacted command logs, temporary worktrees, or container filesystems.

During a prototype run, data outside Git consists of:

- SQLite rows for projects, tasks, capabilities, sessions, runs, ordered run/task/audit events, immutable side-effect intent/completion/reconciliation receipts, reviews, decisions, validations, merge requests, workspaces, Git operations, credential-delivery receipts, and artifact indexes;
- Pi-native session JSONL and custody snapshots;
- redacted raw command output, RTK-filtered output, checksums, and receipts;
- task worktrees, branches, and host-owned checkpoint commits; and
- ephemeral credential copies, which are deleted after canonical-source verification on the normal stop path.

The durable evidence manifest is the checked-in claim; a disposable path in a manifest does not promise that the referenced temporary file still exists. The product retention direction remains complete sessions and artifacts until explicit deletion, but deletion workflows, quotas, backups, and production storage layout are not yet implemented.

## Next steps

1. **C0-04 — unified context custody and retrieval.** Join native Pi snapshots, task/audit state, governed memory/FTS selections, Git state, and artifact references into one atomic, model-less export/import and child-context path.
2. **C0-05 — real owner auth and edge integration.** Implement the single-owner application session, CSRF/rate limits/revocation/recovery, then rerun the disposable SWAG contract against the actual application.
3. **C0-06 — clean-host reproduction and owner checkpoint.** Rebuild and rerun the closure suite on a second ARM64 host, measure resources, choose initial concurrency, and obtain owner approval for Phase 1.
4. **Phase 1 — production cockpit.** Only after closure, implement the task-first remote UI, persistent PTY/reconnect, diffs/tests/review/context/artifact surfaces, and optional browser IDE link.

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

Still open, but assigned to explicit gates rather than blocking current work:

- **Credential refresh:** locked reconciliation versus a host broker before parallel OAuth runs.
- **Recovery UX and reattachment:** how the owner resolves uncertain effects, how a paused session starts a new Pi RPC process, and whether true in-flight process reattachment is worth its operational complexity.
- **Terminal semantics:** the current shell preserves filesystem state but executes each API command in a subshell; production needs a true PTY with durable `cwd`, environment, resize, scrollback, and reconnect behavior.
- **Git policy:** distinction between checkpoints and final commits, squash/history policy, merge/rebase execution, conflicts, push authorization, and worktree cleanup.
- **Network policy:** which provider/control-plane destinations are allowed and how egress is enforced and displayed.
- **Retention operations:** deletion semantics, quotas, backup destination, encryption, and storage-pressure behavior while honoring retain-until-delete.
- **Production dependencies:** supported SQLite binding and migrations, web/PTY/diff components, and whether a credential broker creates a Compose-worthy service boundary.
- **Reproduction:** which second clean ARM64 host will close P0-00/C0-06.
- **Provider fallback:** manual safe-boundary switching comes first; automatic OpenRouter routing and paid-spend policy remain deferred.
