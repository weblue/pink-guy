# Boss Man v2 Phase 0 results

Status: Foundation selected; local-smoke closure complete

Evidence date: 2026-07-17

## Outcome

Phase 0 now has an executable direct-Pi control-plane slice and reusable contracts for Pi custody, task policy, task containers, host-owned Git checkpoints, run-scoped credentials, RTK evidence, the remote edge, and governed FTS retrieval. C0-04 combines custody and retrieval into an atomic context bundle and clean-store import.

The bounded Agent of Empires candidate is stopped. At the pinned revision, AoE has competing durable lifecycle writers and deliberately mounts the main repository plus shared Git metadata read-write so agents can use Git. Its supported plugin capabilities cannot introduce the required task/Git/session authority. Correcting those constraints while adding the task database, board route, policy, memory, and task-first navigation is a core product fork across the storage, server, sandbox, and frontend seams, not a bounded product layer.

The owner accepted the direct-Pi foundation and its documented integration conditions on 2026-07-16. The integrated local contracts and operator-shell smoke now close Phase 0 for loopback development. Public-edge/authentication evidence and second-host reproduction remain valuable, but the revised roadmap moves them to Phase 3 and Phase 2 respectively; neither blocks local Phase 1 work.

## Evidence inventory

| Evidence | Result | What it proves | Important limit |
|---|---|---|---|
| `P0-BASELINE` | Pass | Deterministic fixture, checksums, artifact policy, sanitized command runner | Second clean ARM64 reproduction outstanding |
| Pi lifecycle/custody/resume/child probes | Pass | Native JSONL custody, exact resume/import, blocking compaction export, child provenance | Harness-level evidence, not candidate integration |
| `P0-PI-ACP-0031-CONTRACT` | Pass | Upstream `pi-acp` reaches required Pi seams | Does not repair AoE authority or Git custody |
| `P0-DIRECT-FOUNDATION` | Pass | One daemon owns SQLite task/session/run state and a recorded pinned container running Pi RPC plus the workspace shell; it ingests events/custody and safely pauses verified idle state after restart | Deterministic provider only; production auth remains open |
| `P0-TASK-POLICY` | Pass | Assignment scope, independent review, protected human decision, completion gate | Retained as the in-memory reference baseline for the integrated proof below |
| `P0-DIRECT-TASK-POLICY` | Pass | Hashed bearer capabilities and the full worker/reviewer/orchestrator/owner policy pass through the direct HTTP/SQLite transaction and ordered audit stream | Local operator issuance/UI belongs to Phase 1; remote owner authentication belongs to Phase 3 |
| `P0-RUNTIME-GIT-RTK` | Pass | Pinned ARM64 task image, restricted mounts, host Git checkpoint, credential isolation, RTK raw/redacted evidence | Foundation-neutral reference contract retained for comparison |
| `P0-DIRECT-RUNTIME-GIT-RTK` | Pass | The selected daemon owns the container record, credential materialization/lock, host Git capabilities, provenance checkpoint, and RTK artifact receipts | Synthetic reference contract complemented by the live evidence below |
| `P0-DIRECT-LIVE-PROVIDER` | Pass | Owner-authorized OpenAI Codex turn, Pi Bash→RTK interception, canonical credential immutability, run-copy deletion, and container cleanup through the selected daemon | One bounded turn; no parallel refresh, rate-limit, or fallback claim |
| `P0-DIRECT-RESTART-RECONCILIATION` | Pass | Durable intent/completion receipts; verified idle pause; uncertain provider/tool hold; checksum snapshot and provenance Git recovery without replay | Conservative pause, not in-flight Pi RPC reattachment; no host/Docker power-cycle |
| `P0-DIRECT-CONTEXT-CUSTODY` | Pass | Atomic native/task/memory/artifact/Git bundle, complete scoped retrieval receipt, clean-store FTS rebuild, future Pi entry retention, and transcript-free bundle child | Model-less Phase 0 path; production retention/deletion UI and pre-compaction supervisor handoff remain later integration work |
| `P0-REMOTE-EDGE` | Pass | Host/Origin/forwarding, outer+inner auth, cookies, CSRF, WebSocket reconnect, streaming, uploads, revocation | Disposable synthetic proxy/auth; no SWAG deployment |
| `P0-MEMORY-FTS` | Pass | Canonical SQL plus model-less scoped FTS, receipts, deletion/rebuild, adversarial cases | Standalone benchmark not wired into candidate context assembly |
| `P0-AOE-FOUNDATION-STOP` | Fail/stop | Exact pinned source builds, but conflicts with G-01/G-05 and requires a broad core fork | Source-level stop evidence; no fork patch existed to rebase |

## Hard-gate matrix

`Pass` closes the stated gate. `Component` means its required primitive passes but candidate integration is still open. `Partial` means only a narrower behavior passed. A mapped evidence manifest is not automatically a whole-gate pass.

| Gate | Direct Pi | AoE | Decision consequence |
|---|---|---|---|
| G-01 one authority | Pass | Fail/stop | The direct daemon now creates and records the task container, Pi RPC, shell, workspace, capability, credential lease, host Git operations, and artifact receipts. AoE CLI and daemon both mutate durable session storage. |
| G-02 native custody | Pass | Bridge-only | Direct consumes native Pi custody. ACP translation passes independently, but no AoE product layer was built. |
| G-03 compaction barrier | Pass | Bridge-only | Upstream Pi and `pi-acp` both reach the blocking hook without private forks. |
| G-04 upstream bridge | Pass | Pass at adapter seam | No private Pi or `pi-acp` fork is required. |
| G-05 Git custody | Pass | Fail/stop | The direct daemon exposes status/diff/checkpoint/commit-request capabilities; the container can edit files but cannot use the shared Git metadata. AoE's sandbox path mounts main Git metadata read-write. |
| G-06 credentials | Pass | Not run | Synthetic isolation plus an owner-authorized OpenAI Codex turn prove read-only source delivery, private Pi state, one-run OAuth leasing, canonical checksum verification, post-run copy deletion, and no checked-in or printed credential material. |
| G-07 restart recovery | Pass | Not run | Restart proves recorded container identity before cleanup, preserves native Pi bytes, pauses idle state, recovers checksum/provenance-verifiable snapshot and Git effects, and never replays uncertain provider/tool work. |
| G-08 task/policy | Pass | Not run | Direct HTTP/SQLite capability transactions enforce assignment, concurrency, fixed-revision independent review, owner decisions, validation, completion, and merge requests. |
| G-09 model-less portability | Pass | Bridge-only | The selected direct path atomically combines native Pi, canonical task/memory, artifacts, Git, checksums, retrieval receipts, clean-store FTS rebuild, and transcript-free bundle children without a model or network request. |
| G-10 public edge | Deferred | Contract only | The disposable origin/auth contract passes, but the real application path is a Phase 3 remote-profile gate rather than a local Phase 0 gate. |

## Scoring decision

The original Phase 0 contract permitted numeric scoring only after every hard gate passed. The foundation was selected directionally before the roadmap separated local delivery from public-edge delivery, so retroactively publishing a weighted score would create false precision.

The directional comparison is nevertheless decisive:

- Direct Pi preserves native custody, has one small control-plane authority, and lets the already-proven task, Git, credential, memory, and edge contracts be integrated without replacing another supervisor.
- AoE retains much more terminal, diff, mobile, authentication, and reconnect value, but the product's defining authority and custody constraints collide with its current storage and sandbox design. The fork would be meaningful, but broad and permanently coupled to high-churn core seams.

## Recorded decision

The human owner selected the thin direct-Pi control plane as the Boss Man v2 foundation on 2026-07-16, with AoE retained as a UI/runtime reference rather than a dependency. C0-01 through C0-05 are complete under the revised local-smoke closure. Work now proceeds to the Phase 1 local cockpit. Second-host reproduction is Phase 2; real owner authentication and SWAG integration are Phase 3.

## Compose decision

Do not add `compose.phase0.yml`. There is no fixed multi-service boundary: the central API embeds SQLite, project orchestrators are dynamic leased daemon/tmux processes, Pi and workspace shells run inside per-run containers, and the proxy is a disposable contract test. Add Compose only if a later fixed service such as a credential broker or separately deployed proxy is intentionally selected.
