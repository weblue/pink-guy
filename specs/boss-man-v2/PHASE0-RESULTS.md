# Boss Man v2 Phase 0 results

Status: Foundation selected; closure gates active

Evidence date: 2026-07-16

## Outcome

Phase 0 now has an executable direct-Pi control-plane slice and reusable contracts for Pi custody, task policy, task containers, host-owned Git checkpoints, run-scoped credentials, RTK evidence, the remote edge, and governed FTS retrieval.

The bounded Agent of Empires candidate is stopped. At the pinned revision, AoE has competing durable lifecycle writers and deliberately mounts the main repository plus shared Git metadata read-write so agents can use Git. Its supported plugin capabilities cannot introduce the required task/Git/session authority. Correcting those constraints while adding the task database, board route, policy, memory, and task-first navigation is a core product fork across the storage, server, sandbox, and frontend seams, not a bounded product layer.

This checkpoint does not claim that every direct-Pi hard gate is closed. The owner accepted the direct-Pi foundation and its documented integration conditions on 2026-07-16. Broad Phase 1 work remains blocked until the independent contracts are transactionally integrated into the selected candidate and the second-host reproduction is complete.

## Evidence inventory

| Evidence | Result | What it proves | Important limit |
|---|---|---|---|
| `P0-BASELINE` | Pass | Deterministic fixture, checksums, artifact policy, sanitized command runner | Second clean ARM64 reproduction outstanding |
| Pi lifecycle/custody/resume/child probes | Pass | Native JSONL custody, exact resume/import, blocking compaction export, child provenance | Harness-level evidence, not candidate integration |
| `P0-PI-ACP-0031-CONTRACT` | Pass | Upstream `pi-acp` reaches required Pi seams | Does not repair AoE authority or Git custody |
| `P0-DIRECT-FOUNDATION` | Pass | One daemon owns its SQLite task/session/run state, Pi RPC, shell, events, custody ingestion, orphan reconciliation | Host subprocess and component slice; no production auth/container reconciliation |
| `P0-TASK-POLICY` | Pass | Assignment scope, independent review, protected human decision, completion gate | In-memory contract not wired transactionally into the direct store |
| `P0-RUNTIME-GIT-RTK` | Pass | Pinned ARM64 task image, restricted mounts, host Git checkpoint, credential isolation, RTK raw/redacted evidence | Shared mechanic not yet invoked by either candidate daemon |
| `P0-REMOTE-EDGE` | Pass | Host/Origin/forwarding, outer+inner auth, cookies, CSRF, WebSocket reconnect, streaming, uploads, revocation | Disposable synthetic proxy/auth; no SWAG deployment |
| `P0-MEMORY-FTS` | Pass | Canonical SQL plus model-less scoped FTS, receipts, deletion/rebuild, adversarial cases | Standalone benchmark not wired into candidate context assembly |
| `P0-AOE-FOUNDATION-STOP` | Fail/stop | Exact pinned source builds, but conflicts with G-01/G-05 and requires a broad core fork | Source-level stop evidence; no fork patch existed to rebase |

## Hard-gate matrix

`Pass` closes the stated gate. `Component` means its required primitive passes but candidate integration is still open. `Partial` means only a narrower behavior passed. A mapped evidence manifest is not automatically a whole-gate pass.

| Gate | Direct Pi | AoE | Decision consequence |
|---|---|---|---|
| G-01 one authority | Partial | Fail/stop | Direct owns its slice; task container/Git operations still need to enter the same transaction boundary. AoE CLI and daemon both mutate durable session storage. |
| G-02 native custody | Pass | Bridge-only | Direct consumes native Pi custody. ACP translation passes independently, but no AoE product layer was built. |
| G-03 compaction barrier | Pass | Bridge-only | Upstream Pi and `pi-acp` both reach the blocking hook without private forks. |
| G-04 upstream bridge | Pass | Pass at adapter seam | No private Pi or `pi-acp` fork is required. |
| G-05 Git custody | Component | Fail/stop | Shared host-owned checkpoint passes. AoE's sandbox path mounts main Git metadata read-write. |
| G-06 credentials | Component | Not run | Shared concurrent run-scoped isolation passes; direct-daemon delivery remains to be wired. |
| G-07 restart recovery | Partial | Not run | Direct marks a deliberately interrupted run orphaned; active side-effect/container reconciliation remains. |
| G-08 task/policy | Component | Not run | Direct policy passes independently; transactional store integration remains. |
| G-09 model-less portability | Component | Bridge-only | Native import/export and independent FTS rebuild both pass; one governed context path still must combine them. |
| G-10 public edge | Component | Contract only | The origin contract passes; the selected application's real owner session must run through it. |

## Scoring decision

The Phase 0 contract permits numeric scoring only after every hard gate passes. Neither candidate qualifies, so publishing weighted totals would create false precision.

The directional comparison is nevertheless decisive:

- Direct Pi preserves native custody, has one small control-plane authority, and lets the already-proven task, Git, credential, memory, and edge contracts be integrated without replacing another supervisor.
- AoE retains much more terminal, diff, mobile, authentication, and reconnect value, but the product's defining authority and custody constraints collide with its current storage and sandbox design. The fork would be meaningful, but broad and permanently coupled to high-churn core seams.

## Recorded decision

The human owner selected the thin direct-Pi control plane as the Boss Man v2 foundation on 2026-07-16, with AoE retained as a UI/runtime reference rather than a dependency. The decision retains these required integration gaps before production use:

1. transact task policy with the authoritative SQLite store;
2. make task-container, credential, and host-Git requests daemon capabilities;
3. reconcile active containers and side-effect receipts after restart;
4. combine native custody and governed FTS through one context receipt path;
5. run the real owner authentication implementation through the remote-edge suite; and
6. reproduce the fixture and task image on a second clean ARM64 environment.

## Compose decision

Do not add `compose.phase0.yml`. There is no fixed multi-service boundary: SQLite is embedded, Pi and workspace shells are supervised subprocesses, task containers are per-run daemon resources, and the proxy is a disposable contract test. Add Compose only if a later fixed service such as a credential broker or separately deployed control plane is intentionally selected.
