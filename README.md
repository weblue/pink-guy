# Pink Guy

Pink Guy is a local-first developer cockpit for orchestrating
[Pi](https://pi.dev/) across multiple Git repositories. One loopback control
plane owns projects, tasks, conversations, agent runs, worktrees, Git actions,
artifacts, retention, and audit history. The browser and `pink` terminal client
are views of that same durable state.

Pink Guy is usable today for **supervised local development**. Phase 1 and the
Phase 2 implementation/closure gates are complete. Current work is the Phase
2D sustained-dogfood window: long turns and routine work across several real
repositories must prove that a direct coding client is an emergency fallback,
not a repair path. Authenticated remote access is planned for Phase 3; the
current server is loopback-only and has no application authentication.

See [current state](docs/product/CURRENT-STATE.md) for the exact capability and
readiness boundary, or use the [documentation index](docs/README.md).

## How it works

```text
browser / pink CLI
        |
loopback control plane + SQLite authority
        |
        +-- one persistent Pi orchestrator per active project or intake scope
        +-- deterministic Ready scheduler
        +-- phase-scoped implementation, test, and review runs
        +-- host-owned Git, worktrees, artifacts, custody, and retention
                 |
                 +-- managed Docker container per task phase
```

The central API, not an LLM or client transcript, decides task eligibility,
phase transitions, recovery state, and side effects. Implementation records a
fixed Git revision; test and independent review run from that revision.
Provider, model, thinking level, prompt revision, and provenance are recorded
per conversation and phase.

## Run locally

Requirements:

- macOS on Apple Silicon;
- Node.js 24 or newer;
- Git;
- Pi installed on `PATH` and authenticated for the routes you intend to use;
- Docker Desktop only for sandboxed task-phase runs.

There are no npm dependencies to install.

### 1. Start the control plane

From the repository root:

```sh
PINK_GUY_STORAGE_WARN_BYTES=10737418240 \
PINK_GUY_STORAGE_HARD_BYTES=16106127360 \
npm start -- \
  --repo "$PWD" \
  --state "$HOME/.local/share/pink-guy/dev" \
  --port 4310 \
  --model-config "$PWD/config/model-routes.json" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Repeat `--repo /absolute/path` for additional existing repositories. Open
[http://127.0.0.1:4310](http://127.0.0.1:4310).

`--repo` must name a Git worktree root. `--credential-source` is required for
OAuth-backed task-agent runs; Pink Guy copies it into private per-run Pi state
and does not let Pi mutate the canonical file.

Task execution defaults to one run globally. After a controlled concurrency
drill validates the provider credential and host envelope, opt into bounded
parallel work with `--project-capacity 2 --global-capacity 2
--credential-capacity 2`. All three limits must allow a run; keep the default
for an untested OAuth login.

The local profile binds only to `127.0.0.1`. Do not expose it through a public
listener or reverse proxy.

### 2. Start an orchestrator

Run one project orchestrator per active repository, preferably in its own
cmux/tmux pane:

```sh
npm run orchestrator:project -- \
  --api http://127.0.0.1:4310 \
  --repo "$PWD" \
  --state-root "$HOME/.local/share/pink-guy/dev" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

For a topic that does not yet have a repository, run the single system-intake
orchestrator:

```sh
npm run orchestrator:system -- \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/pink-guy/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Closing a browser or terminal chat does not stop Pi or lose the conversation.
Stopping the orchestrator releases its lease; queued turns remain durable.

### 3. Use the cockpit or terminal

```sh
npm run pink -- status
npm run pink -- topics
npm run pink -- chat --repo "$PWD"
npm run pink -- chat --new-topic "Prototype a new tool"
npm run pink -- attention
```

The normal flow is conversational refinement followed by explicit task
release. The model-less scheduler selects eligible Ready tasks by priority,
release time, and task ID, then automatically continues successful
implementation through fixed-revision test and independent review. Manual
phase start is a recovery override.

The cockpit also exposes task evidence, model routes, recovery actions, Git
policy and integration, cleanup, retention holds, session deletion, storage,
and project intake. The [local development runbook](docs/operations/local-development.md)
documents those controls.

## Models and provider authentication

Pink Guy discovers the configured Pi catalog directly:

```sh
pi --list-models
npm run pink -- models
npm run pink -- models --refresh
```

To add or refresh a subscription or API-key provider, use **Models + provider
authentication** in the cockpit. It gives a copyable command that opens Pi
against the same owner-managed credential directory. Run that command in a
host TTY, enter `/login`, finish Pi's provider flow, then refresh the catalog.
Pink Guy never accepts a raw API key or OAuth token in the browser.

Defaults and optional phase overrides live in
[`config/model-routes.json`](config/model-routes.json). Startup
`--provider`, `--model`, and `--thinking` flags override only the configured
default. A Pi-compatible local model uses the same route fields; there is no
separate Pink Guy routing service or silent fallback.

Switch an existing conversation only at the custody-backed boundary:

```sh
npm run pink -- model \
  --topic TOPIC_ID \
  --provider PROVIDER \
  --model MODEL_ID \
  --thinking medium
```

Pink Guy first verifies a model-less custody snapshot, then restarts Pi
against the same native session before the next turn. Each task phase resolves
and records its own route independently.

## Continuity

Export uses the live API so it can briefly block new claims and require a
quiescent control plane:

```sh
npm run continuity -- export \
  --output "/absolute/backups/pink-guy-$(date +%Y%m%d)"
npm run continuity -- verify \
  --bundle /absolute/backups/pink-guy-YYYYMMDD
npm run continuity -- restore \
  --bundle /absolute/backups/pink-guy-YYYYMMDD \
  --target /absolute/restores/pink-guy
```

The export and restore destinations must not already exist. Export must be
outside the live state root and managed repositories. Restore is standalone:
it verifies checksums, reconstructs Git into a new isolated state root,
revokes ephemeral leases/capabilities, and starts no agent or container.
Credentials and ephemeral containers are excluded.

## Task-agent image

The cockpit, terminal client, and host orchestrators do not need Docker. Build
the pinned ARM64 image before running task phases:

```sh
docker build \
  --platform linux/arm64 \
  --tag pink-guy:pi-0.80.9-rtk-0.42.3 \
  ./infra/container
```

Containers are damage containment, not a malicious-code security boundary.
They receive minimal mounts and no Docker socket.

## Verify

```sh
npm test
npm run test:workflow
npm run test:baseline
curl --fail http://127.0.0.1:4310/api/health
```

The core and workflow suites are deterministic, model-less, and make no
provider request. The selected 10/15 GiB storage profile pauses dispatch at
hard pressure and never deletes retained evidence. See
[testing and probes](docs/operations/testing.md) for focused,
container-backed, and opt-in live checks.

## Project status and documentation

- [Documentation index](docs/README.md)
- [Current state and adoption readiness](docs/product/CURRENT-STATE.md)
- [Local development runbook](docs/operations/local-development.md)
- [Technical architecture](docs/architecture/TECH.md)
- [Roadmap](docs/product/ROADMAP.md)
- [Phase 2 closure plan](docs/product/PHASE2-CLOSURE.md)

Tracked files never contain credentials, SSH keys, provider transcripts,
native user sessions, runtime databases, unredacted command logs, worktrees,
or container filesystems.
