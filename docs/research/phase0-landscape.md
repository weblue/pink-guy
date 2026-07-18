# Boss Man v2 research record

Roadmap note (2026-07-17): the owner subsequently made delivery local-first. The SWAG/authentication findings below remain relevant to Phase 3 remote exposure, but they no longer block Phase 0 closure or Phase 1 local/trusted-LAN development.

Verified: 2026-07-16

Purpose: preserve source, policy, and ecosystem evidence used by the product and technical drafts.

## Executive conclusions

1. The current projects contain strong primitives worth retaining conceptually: SQLite task state, a board, structured run events, Docker isolation, worktrees, and proven Tailscale/SSH operations.
2. Worker task mutation is intentionally absent rather than accidentally missing. V2 needs capability-scoped task authority, not a broadly writable endpoint.
3. Current Boss Man continuation is a newly seeded prompt backed by an LLM summary and recent turns. It is not an exact native-session resume or portable pre-compaction export.
4. Pi already exposes the necessary low-level primitives: RPC control, durable JSONL sessions, import/resume/fork, model changes, context hooks, and a pre-compaction hook.
5. Pi does not ship a core subagent system, but active extensions already demonstrate full-context forks, artifacts, worktrees, and fallbacks. This reduces invention but does not remove the need for a Boss Man authority/context contract.
6. Claude subscription use from third-party harnesses is not a safe included-usage assumption. Pi currently warns that Anthropic subscription auth in Pi draws paid extra usage per token. Claude should remain optional paid capacity, not the default free fallback.
7. Pi should own provider/model selection in v1. OpenRouter remains the preferred paid fallback candidate, but automatic routing can wait until manual safe-boundary switching is proven. LiteLLM adds useful organization-scale controls, but duplicates routing and recently had a serious package supply-chain incident.
8. Session-fleet management is substantially solved by other products. Agent of Empires plus `pi-acp` is a strong substrate but not the Boss Man application: its supported extension surface cannot supply the required task/control plane, and its current Git/credential defaults conflict with custody requirements. A bounded AoE core fork and a direct Pi RPC build are equal Phase 0 candidates.
9. RTK is useful when filtered model context and retained evidence are deliberately separated. Managed runs should preserve full raw command output even when Pi sees a compressed representation.
10. Memory must be split into canonical evidence, governed durable records, and rebuildable retrieval. The closest Pi-native design is `pi-persistent-intelligence`, but no current third-party memory package is mature enough to own Boss Man's custody contract.
11. The established SWAG subdomain changes the design from private-tailnet-only to a public HTTPS edge with single-owner authentication, reverse-proxy trust controls, and WebSocket requirements.

## Upstream inspection

### Boss Man

Inspected revision: [`59f8282654f9b4cea90f2ba830aa6d56106e25b4`](https://github.com/weblue/boss-man/tree/59f8282654f9b4cea90f2ba830aa6d56106e25b4)

Useful existing behavior:

- SQLite stores projects, orchestrator sessions, runs, terminal events, tasks, dependencies, and memories.
- Task dependency queries expose unblocked work.
- The React UI includes Chat, Tasks, Runs, and Spec views; the task board and run history provide real observability.
- Runs execute in Docker through Sandcastle and use Git worktrees.
- Harness output is normalized and streamed to the UI.

Limits relevant to v2:

- The discovery prompt hard-codes eight topics.
- Chat is the default top-level view.
- The MCP route gives the orchestrator task mutations but restricts workers to the read-only `task_prime` tool.
- Task states are only `open`, `in_progress`, and `closed`, and claims are stamped as the literal orchestrator.
- A reply starts a fresh harness run using a seeded prompt assembled from a rolling summary, recent verbatim turns, task state, and memories.
- Context folding first calls an LLM; its fallback is a lossy truncated digest.
- Sandcastle owns container/branch execution decisions and harness configuration files are written into worktrees before being excluded from Git.
- Claude subscription and LiteLLM concepts are mixed into static harness configuration.

Interpretation: keep the state visibility and event-driven UI concepts, but replace execution, task authorization, and session custody contracts.

### Inspector Gadget

Inspected revision: [`3df39382ceb147aa411f9c578ef4131fc91912f2`](https://github.com/weblue/inspector-gadget/tree/3df39382ceb147aa411f9c578ef4131fc91912f2)

Useful existing behavior:

- Repeatable setup for Claude, Codex, and Pi.
- A server path built from Tailscale, native SSH, and tmux.
- A cmux client workflow for connecting to the remote Mac.
- Pi extensions and prompts for Sandcastle-based delegation.
- Pinned, checksum-verified RTK installation plus Pi extension wiring and savings maintenance commands.

Limits relevant to v2:

- The remote experience is terminal-session-centric and cmux is macOS-specific.
- Pi's `copy-all` command exports readable user/assistant content, not the complete typed session, tools, branches, provenance, or a pre-compaction snapshot.
- The usage helper asks an LLM to interpret usage rather than producing deterministic accounting.
- Sandcastle and the harness participate in workspace lifecycle.

Interpretation: preserve SSH/client setup and RTK knowledge, but make a structured developer cockpit and Pi's native session model the primary product path.

## RTK verification

[RTK](https://github.com/rtk-ai/rtk) is an Apache-2.0 Rust CLI proxy that filters noisy command output before it enters an agent context. Its current supported-agent table includes Pi through `rtk init -g --agent pi`, which installs a TypeScript `tool_call` extension. Current configuration supports exclusions, an explicit proxy/bypass, local savings analytics, and a tee mode that can retain full output.

Inspector Gadget's integration is sound in principle: it pins Linux release assets and checksums, wires the Pi extension, teaches explicit filtered commands, reports `rtk gain`, and provides a raw proxy escape hatch. V2 should strengthen the evidence contract:

- use a pinned and verified RTK version in the agent image;
- disable optional telemetry by default;
- use always-on raw teeing for managed runs rather than only failure output;
- ingest raw output as a content-addressed Boss Man artifact;
- present savings and parse/bypass state in the run timeline; and
- make merge/review decisions from exit status plus complete evidence, never a compressed summary alone.

RTK's advertised 60–90% savings are workload-dependent and should be treated as a measured metric, not a guaranteed product claim. The primary benefit is reducing routine tool noise while preserving the ability to inspect everything.

## Pi capability verification

Executable/source baseline: [`earendil-works/pi@v0.79.1`](https://github.com/earendil-works/pi/tree/28df940f0d07b65284849a483be7b06e2ca046ee). Pi [moved from `badlogic/pi-mono` and the `@mariozechner` package scope to Earendil Works](https://pi.dev/news/2026/5/7/pi-has-a-new-home) beginning with v0.74.0; the installed CLI and existing session/config paths remained compatible. Phase 0 reconciled the installed 0.79.1 executable to this exact official tag.

### Structured control

Pi's [RPC mode documentation](https://github.com/earendil-works/pi/blob/28df940f0d07b65284849a483be7b06e2ca046ee/packages/coding-agent/docs/rpc.md) defines JSONL requests for prompt, steer, follow-up, abort, new session, state/messages, and model selection, plus structured notifications. This is a better primary protocol than PTY parsing.

### Native session fidelity

Pi's [session documentation](https://github.com/earendil-works/pi/blob/28df940f0d07b65284849a483be7b06e2ca046ee/packages/coding-agent/docs/session.md) describes append-only JSONL session trees containing messages, tool calls/results, usage, model changes, compaction entries, branch summaries, and custom extension entries. Compaction entries do not erase earlier records in the file.

Pi provides interactive resume, fork/clone, tree navigation, export, and import. Its SDK exposes session managers and JSONL import. Therefore exact same-harness resume should use Pi's native record instead of rebuilding a prompt from summaries.

### Context and compaction hooks

Pi's [extension documentation](https://github.com/earendil-works/pi/blob/28df940f0d07b65284849a483be7b06e2ca046ee/packages/coding-agent/docs/extensions.md) provides hooks for new/switch session, messages, context shaping, and `session_before_compact`, including cancellation or customization. This supports a blocking model-less snapshot before compaction.

### Subagent context

Subagents are an extension concern, not a Pi core feature. The official package directory lists [`pi-subagents`](https://pi.dev/packages/pi-subagents), whose repository documents fresh or forked context, full session forks, artifacts, worktrees, background jobs, context builders, and model fallbacks. MIT alternatives include [`mjakl/pi-subagent`](https://github.com/mjakl/pi-subagent) and [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents).

This means the required context-consumption capability is feasible and partly solved. Boss Man still needs to make context mode, artifact provenance, task capability, and export guarantees first-class. The leading `pi-subagents` repository should undergo license and dependency review before adoption; inspected repository metadata did not identify a license.

## Memory and context-management landscape

Research verified 2026-07-16. The projects below solve different problems under the overloaded word “memory”: exact session retention, durable curated knowledge, retrieval, context-window compression, or semantic relationship extraction. Boss Man needs all of those boundaries to remain explicit.

| Project/library | Useful behavior | Material concern | Boss Man use |
|---|---|---|---|
| [`pi-persistent-intelligence`](https://github.com/Mont3ll/pi-persistent-intelligence) | Pi-native MIT extension; canonical JSONL with rendered Markdown, evidence records, tombstones, patch-governed L1/L2 memory, review inbox, diagnostics, scoped recall, redacted import/export | Very new and currently low-adoption; session consolidation can use the selected model; its schema and Pi compatibility may move quickly | Leading isolated spike and design reference; adopt only behind Boss Man authority and conformance tests |
| [`pi-memctx`](https://github.com/weauratech/pi-memctx) | Local inspectable Markdown packs for context, decisions, observations, runbooks, actions, and rich session snapshots; qmd/grep retrieval; review queue; secret redaction | Automatic learning and deep initialization can call an LLM; author-run benchmarks are workload-specific; Markdown alone lacks Boss Man's event/provenance contract | Reuse taxonomy, pack UX, fallback behavior, and benchmark method; optional adapter, not canonical store |
| [`pi-hermes-memory`](https://github.com/chandra447/pi-hermes-memory) | SQLite FTS5 over Pi sessions, Markdown memory, project/global scopes, failure and procedural memory, secret scanning, JSONL session indexing | Background LLM learning/consolidation can corrupt or overgeneralize durable content; an [open issue reports skill-file corruption](https://github.com/chandra447/pi-hermes-memory/issues/107); opinionated global memory | Reuse session-search/line-anchor, failure-memory, secret-scan, and procedural-skill ideas; do not enable autonomous writes as core policy |
| [`pi-memory`](https://github.com/tickernelz/pi-memory) | Small MIT Markdown memory, user/identity files, and daily append-only logs | Automatically injected global files are broad prompt authority; limited governance/provenance | Simple file-format reference only |
| [Basic Memory](https://github.com/basicmachines-co/basic-memory) | AGPL local Markdown plus SQLite index, MCP interoperability, graph/wikilinks, file/database reconciliation, multi-project use | Larger separate control plane; default-on update checks and opt-out analytics; cloud surface is unnecessary here | Optional human knowledge-base interoperability later; if tested, pin and disable updates/analytics |
| [Graphiti](https://help.getzep.com/graphiti/getting-started/overview) | Open temporal knowledge graph with hybrid time/full-text/semantic/graph retrieval | Adds LLM extraction, embeddings, and graph-database operations; derived claims are not lossless evidence | Later experimental derived relationship index for complex cross-project recall |
| [Mem0](https://docs.mem0.ai/open-source/features/graph-memory) | Vector plus graph memory; extracts entities and relationships on writes | Model and backend dependencies, derived extraction, and greater operational/supply-chain surface | Optional benchmark only, not v1 core |
| [`context-mode`](https://github.com/mksglu/context-mode) | Pi hooks for tool events, session start, and pre-compaction; context routing and persistent session continuity across many harnesses | Overlaps Boss Man's exporter/routing authority and introduces a second context store/control layer | Compatibility and failure-injection reference; do not install alongside the first-party exporter initially |
| SQLite [FTS5](https://www.sqlite.org/fts5.html) | Built-in local full-text/BM25 retrieval, deterministic enough to test, no embedding model or service | Lexical search misses semantic equivalents and requires careful tokenization/ranking | Required v1 retrieval baseline over governed records and normalized session evidence |
| [`sqlite-vec`](https://github.com/asg017/sqlite-vec) | Small MIT/Apache-2.0 local vector extension that composes with SQLite data | Explicitly pre-v1 with expected breaking changes; embeddings still require a model | Optional disposable index after an FTS baseline benchmark; never part of bundle validity |

The strongest ideas are complementary rather than mutually exclusive:

- `pi-persistent-intelligence`: canonical JSONL plus projections, evidence, tombstones, review, and patch governance;
- `pi-memctx`: human-readable context-pack taxonomy and bounded pre-prompt retrieval;
- `pi-hermes-memory`: FTS5 session search, source anchors, secret scanning, and explicit failure/procedural memory;
- Basic Memory: human-editable files, MCP interoperability, and file-to-index health checks; and
- Graphiti/Mem0: optional semantic and temporal relationship indexes when measured lexical retrieval is inadequate.

Boss Man should not adopt an external memory service as the source of truth. The smallest robust core is a first-party typed memory contract projected from append-only events, SQLite FTS5, Markdown/JSONL export, source-linked retrieval receipts, and Pi tools for search/proposal. A Phase 0 spike should determine whether `pi-persistent-intelligence` can implement that contract without creating a second authority; otherwise Boss Man implements the thin layer directly.

Automatic “learn from every turn” is specifically rejected as a default. Model-assisted extraction may enqueue candidates, but promotion depends on type, scope, trust, evidence, and project policy. This is as much a security boundary as a product feature: repository content can contain prompt injection, workers can be wrong, and a false durable instruction amplifies across future sessions.

## Claude subscription and third-party Pi use

The answer is currently nuanced and product-specific:

- Anthropic's June 16, 2026 support update says a planned Agent SDK billing change was paused and that Agent SDK, `claude -p`, and third-party app usage continue to draw from subscription limits “for now.” See [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).
- Anthropic's [Claude Code legal and compliance documentation](https://code.claude.com/docs/en/legal-and-compliance) says subscription OAuth is intended for Claude Code and Claude.ai and that developers building products or services should use API keys rather than offer or route users' subscription credentials.
- Most importantly for this project, Pi 0.80.9 was re-verified locally on
  2026-07-17. Its installed provider documentation and
  [upstream provider documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md#claude-promax)
  display a specific warning that Anthropic subscription authentication used
  by this third-party harness draws from “extra usage” and is billed per token
  rather than Claude plan limits.

Operational conclusion: keep Claude only as an optional paid provider when using Pi. Do not design Boss Man v2 around Claude subscription capacity being included. Native Claude Code may still use the subscription, but native Claude Code is outside the Pi-only harness boundary. Re-verify policy before release because the official general policy and Pi-specific behavior have changed recently and are not perfectly aligned.

Anthropic also offers [prepaid usage bundles](https://support.claude.com/en/articles/14246112-buy-usage-bundles), but they are paid capacity, not a reason to couple the platform to Claude.

## Provider and routing recommendation

### Proposed v1 route

1. Use the OpenAI authentication available through Pi as the primary route while its allowance is available.
2. Support manually selecting another configured Pi model at a safe turn boundary after a deterministic snapshot.
3. Retain prepaid [OpenRouter](https://openrouter.ai/docs/faq) as the leading automatic pay-per-token fallback candidate, but defer automatic continuation until the core switching path is robust.

OpenRouter provides [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [provider routing controls](https://openrouter.ai/docs/guides/routing/provider-selection), and an API for [key limits and credit state](https://openrouter.ai/docs/api/reference/limits). Its FAQ states that underlying provider prices are passed through and credit purchases carry a platform fee. That makes spend visible and contains the number of provider credentials inside agents.

Google's current [Gemini 3 model guide](https://ai.google.dev/gemini-api/docs/gemini-3) positions Gemini 3.1 Pro for complex work and Gemini 3 Flash for lower-cost, high-speed work. Current [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) makes them reasonable initial benchmark candidates, but the models are preview/current products and must remain replaceable configuration.

Claude through OpenRouter or a direct Anthropic API key can also be a fallback when its benchmark result justifies the price. The platform should choose a policy class such as “complex coding fallback” or “cheap worker fallback,” then resolve it to a current model.

### Why not LiteLLM in v1

[LiteLLM](https://docs.litellm.ai/) provides valuable proxy routing, budgets, fallbacks, and virtual keys. Those features matter more for a multi-user organization than for a single-owner Pi-only host, where Pi already abstracts providers and OpenRouter can consolidate paid fallback.

There is also a current supply-chain reason to minimize this dependency: malicious LiteLLM PyPI versions 1.82.7 and 1.82.8 were reported in March 2026 as credential-stealing packages. See the [maintainer incident issue](https://github.com/BerriAI/litellm/issues/24518) and [GitHub advisory GHSA-69fq-xp46-6x23](https://github.com/advisories/GHSA-69fq-xp46-6x23).

This does not mean LiteLLM can never be used. If later requirements need central virtual keys or organization-wide budgets, deploy a reviewed, signed image pinned by digest, and treat the proxy as security-sensitive infrastructure. The current Boss Man deployment should be audited for any affected package before it is run again.

## Comparable projects

| Project | What it already solves | Gap relative to Boss Man v2 | Recommendation |
|---|---|---|---|
| [Agent of Empires](https://github.com/agent-of-empires/agent-of-empires) + [`pi-acp`](https://github.com/svkozak/pi-acp) | MIT PWA/TUI, Pi support, structured ACP view, xterm terminal, diffs, persistent workers, HTTP API, plugins, worktrees, Docker/Podman/Apple Containers, reverse-proxy hardening; adapter preserves Pi sessions | No SQL agile task graph, deterministic pre-compaction bundle, reviewer policy, or Pi-only boundary; supported plugins cannot add full control/session APIs; Git/credential defaults conflict with custody | Historical Phase 0 core-fork candidate; rejected as the foundation and retained as a UI/runtime reference |
| [Lumbergh](https://github.com/voglster/lumbergh) | MIT web terminal, Git diff/graph, file browser, shared files, PWA, React frontend | Claude/tmux/TinyDB-centric, no container authority, manager-chat emphasis, limited documented auth | Strong UI reference, weaker runtime foundation |
| [Coder](https://coder.com/docs/user-guides/workspace-access) | Mature workspace dashboard, persistent web terminal, code-server, SSH, port forwarding | Heavy second workspace/provisioning control plane; no Boss Man task/context semantics | Optional browser IDE/workspace link, not core authority |
| [Agent Deck](https://github.com/asheshgoplani/agent-deck) | tmux agent sessions, remote SSH instances, Docker sandboxing, worktrees, SQLite state, web UI, conductor, forking | Harness-generic and terminal-centric; no required Pi context/task authority model | Operational and TUI reference |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | Popular multi-agent task/worktree UX | Repository announces sunset; not a durable dependency | Study interaction patterns only |
| [agtx](https://github.com/fynnfluegge/agtx) | TUI Kanban, task worktrees, tmux, orchestration tools, spec plugins | TUI/local-first and harness-generic | Reuse task/worktree concepts, not runtime |
| [Agent Canvas](https://github.com/OpenHands/agent-canvas) | Self-hosted browser control center and multiple local/container/cloud backends | Focused on ACP agents; Pi requires a community adapter and Boss Man still needs its own task/context contract | UI and remote-runtime reference |
| [Agent Kanban](https://github.com/saltbo/agent-kanban) | Explicit agent identities/roles, worker task progress, subtasks, review flow, daemon/worktrees | Different license and runtime; browser is largely read-only | Strong reference for capability-scoped task transitions; do not copy without license review |
| [`pi-subagents`](https://pi.dev/packages/pi-subagents) | Pi-native forked context, background agents, artifacts, worktrees, chains, fallbacks | No Boss Man control plane, durable task authority, or guaranteed deterministic export contract | Evaluate public API/dependency; otherwise implement a thin compatible extension |

Agent of Empires materially changes the build-versus-buy decision, but source inspection resolves the plugin question: the required product does not fit as a supported AoE plugin. Its structured workers survive daemon restarts, its web dashboard already supports terminals/diffs/mobile/reverse proxies, and plugins contribute cards, badges, host-rendered panes, filters, and composer actions. They do not expose session create/prompt/stop/resume, transcript replay, worktree/container policy, Git custody, arbitrary REST routes, or a full application route. An external Boss Man sidecar would create two lifecycle authorities. The viable AoE option is therefore a deliberate core fork, assessed in `FOUNDATION.md`, not an unchanged service or cosmetic plugin.

Source inspection used [`agent-of-empires@7803b25`](https://github.com/agent-of-empires/agent-of-empires/tree/7803b25451bc836ad40ad9ad9d5efad11de83764) and [`pi-acp@49d6ec8`](https://github.com/svkozak/pi-acp/tree/49d6ec804d40b52317d873360654054c5d2387a3). It confirmed:

- Agent of Empires already registers Pi as an ACP-capable tool backed by the `pi-acp` command; this is not a speculative integration.
- Its backend has protocol-agnostic persistent workers, a topic-keyed SQLite event log, Axum REST/WebSocket/auth, Docker and Git modules, and versioned migrations.
- Its frontend is React/TypeScript/Tailwind/xterm.js with mocked and live Playwright coverage requirements.
- It captures Pi native session IDs from `~/.pi/agent/sessions`, including sessions inside containers.
- Its documented plugin API and host implementation expose events, scoped metadata, session listing, configuration reads, notifications, and host-rendered UI slots. They do not expose the lifecycle/control and arbitrary-route capabilities Boss Man requires, so a core fork is required.
- Its current sandbox requires writable project and common Git metadata for worktrees; credential sandbox directories are also writable and persistent, and a supplied `GH_TOKEN` permits pushes. Boss Man must replace these defaults with platform-owned Git and run-scoped credentials.
- `pi-acp` maps one ACP session to one `pi --mode rpc` subprocess and exposes model selection, messages, session switching, compaction, and Pi-native session mapping. Pi extensions execute inside that process, but the blocking pre-compaction export still needs an end-to-end test through the bridge.
- General AoE session metadata remains file-backed and can be mutated by both daemon and TUI paths. [AoE issue #2734](https://github.com/agent-of-empires/agent-of-empires/issues/2734) proposes making the daemon the single source of truth, which aligns with Boss Man but is not yet a dependency to assume.
- [AoE issue #1363](https://github.com/agent-of-empires/agent-of-empires/issues/1363) explicitly groups task gates, leader orchestration, persistent memory, Kanban, automated PRs, and review among features AoE does not yet provide. This corroborates that Boss Man's missing layer is a product/control-plane change rather than configuration.

The ecosystem still says not to build another generic “tabs for agent terminals” product. Boss Man should either extend the strongest existing cockpit or build only the missing strict cockpit surfaces around its task/context control plane.

## Remote-first deployment research

LinuxServer's [SWAG documentation](https://docs.linuxserver.io/general/swag/) confirms that SWAG is an Nginx/Certbot/fail2ban gateway, loads subdomain proxy configurations, supports Basic/LDAP/Authelia includes, and can proxy to an IP address when the upstream is on another host. That matches the confirmed same-LAN home-server edge to Boss Man Mac topology. The existing conditional SWAG Basic Auth remains an outer non-local gate; Boss Man still requires its own owner session because local access may bypass that challenge and the application exposes terminals and mutations.

Because the application exposes live terminals and mutations, TLS termination is only one control. Required behavior includes an authenticated owner session, Secure/HttpOnly/SameSite cookies, Host and Origin validation, CSRF defense, controlled proxy-header trust, WebSocket upgrades, non-buffered streaming, upload limits, and an origin not independently reachable from the public internet. Agent of Empires' documented reverse-proxy mode is a useful reference: it requires allowed hosts, sets secure cookies, applies DNS-rebinding checks, rate-limits logins, tracks devices, and supports step-up confirmation.

Use a reserved private address for the confirmed LAN upstream. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) remains useful for private diagnostics but is not the primary public path.

The existing nonstandard, key-only SSH endpoint is separate from SWAG's HTTP proxy. Public port 315 terminates on the home server, which should be the SSH `ProxyJump` bastion to the Boss Man Mac over the LAN. The existing RSA private key must remain client-side; it is not a Boss Man credential or an agent secret. A second public router port to the Mac adds attack and maintenance surface without a current requirement and is deferred. Ordinary Cloudflare-proxied DNS/HTTP does not proxy raw SSH; Cloudflare Tunnel or Spectrum would be a separate, human-approved design.

Recommended split:

- Browser cockpit through the SWAG HTTPS subdomain for daily work.
- Pi RPC, directly or through `pi-acp`, for semantic session control.
- Web terminal for development inspection and smoke testing.
- Key-only SSH, optionally through the home-server bastion, for recovery and host maintenance.
- Ghostty, cmux, or another terminal as a local client preference, never the public server foundation.

## Hardware implications

An M1 Max with 64 GB RAM is adequate for multiple lightweight tool containers, but useful concurrency will usually be constrained by provider rate limits, CPU-heavy builds, disk I/O through macOS container mounts, and credential coordination before memory. Start with a low configurable global concurrency limit (for example four active runs), measure, and tune by workload.

The Mac remains a single failure domain. Model-less artifacts make recovery possible, but only backups make them durable after disk or host failure. SQLite online backup and the artifact store should be copied to a separate encrypted destination on a schedule; that destination is a later deployment choice, not authorization to upload transcripts to a cloud service.

## Research-driven design implications

- Use Pi native JSONL as exact-resume evidence and a normalized bundle as portable context.
- Keep canonical evidence separate from governed memory; keep both separate from disposable search/vector indexes.
- Require FTS5-only retrieval, evidence-linked context receipts, and model-less memory export/import before experimenting with semantic or graph recall.
- Spike `pi-persistent-intelligence`, but make Boss Man's memory schema and authority independent of any package.
- Intercept compaction; do not depend on compaction as retention.
- Make context modes explicit for children instead of pretending every child needs a full transcript.
- Keep task mutation narrow, capability-scoped, versioned, and auditable.
- Own worktree and commit lifecycle outside the model.
- Use Pi RPC, directly or through `pi-acp`, as the semantic session record; use terminals for interactive development and recovery, never as the state source.
- Compare a bounded Agent of Empires core fork and direct Pi RPC as equal Phase 0 candidates; use `FOUNDATION.md` to make the human-owned decision from measured patch/rebase and fidelity evidence.
- Include a real developer terminal and diff/test/review cockpit without making chat the main route.
- Use RTK for model-context compression while retaining complete raw output artifacts.
- Avoid mounting global auth state or the Docker socket into agents.
- Treat provider billing mode as mutable runtime configuration.
- Defer automatic paid fallback until manual safe-boundary model switching is reliable.
- Defer LiteLLM until its additional policy layer is truly needed.
- When Phase 3 enables remote access, serve through SWAG with conditional Basic Auth as an optional outer gate plus Boss Man's simple owner session or API key; use the port-315 home-server SSH bastion and keep SSH keys out of the application. Local and explicitly trusted-LAN profiles do not require application auth.
- Prove the high-risk foundation/runtime seams before investing in polished visual design.
