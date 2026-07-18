# Boss Man

Boss Man is a local-first developer cockpit for orchestrating Pi sessions across
multiple Git repositories. One central API owns projects, tasks, audit history,
worktrees, agent runs, and context artifacts; each project may have one active
Pi orchestrator plus phase-scoped implementation, test, and review agents.

The current Phase 1 build provides a loopback-only web UI, durable SQLite
state, persistent Pi RPC conversations, an agile task board, task scheduling,
managed worktrees and containers, and model-less context custody. It is ready
for local development, but it is not yet the authenticated remote deployment.

## Run it locally

### Prerequisites

- macOS on Apple Silicon;
- Node.js 24 or newer;
- Git;
- [Pi](https://pi.dev/) installed and authenticated;
- Docker Desktop when running sandboxed task agents (not required to open the
  cockpit or run the core test suite).

No dependency installation is currently required; the application uses Node's
built-in modules.

### 1. Start the central API and cockpit

From the repository root:

```sh
npm start -- \
  --repo "$PWD" \
  --state "$HOME/.local/share/boss-man/dev" \
  --port 4310 \
  --provider openai-codex \
  --model gpt-5.4-mini \
  --thinking medium
```

Use any absolute Git worktree path for `--repo`. Repeat `--repo` to register
more than one project:

```sh
npm start -- \
  --repo "$HOME/projects/project-one" \
  --repo "$HOME/projects/project-two" \
  --state "$HOME/.local/share/boss-man/dev" \
  --port 4310 \
  --provider openai-codex \
  --model gpt-5.4-mini
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The UI is useful
immediately for project, board, task, session, and command inspection.

The server intentionally listens only on `127.0.0.1` and has no application
authentication in this profile. Do not expose this listener publicly.

### 2. Start a project orchestrator

Start one process per project that should accept conversation turns or launch
task agents:

```sh
npm run orchestrator:project -- \
  --api http://127.0.0.1:4310 \
  --repo "$PWD" \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Run this command in tmux or cmux when you want a reconnectable operational
session. A second orchestrator for the same project is rejected while its
lease is active. Each additional registered project gets its own process.

For a new topic that is not yet attached to a repository, start the shared
system-intake orchestrator instead:

```sh
npm run orchestrator:system -- \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Stop any foreground process with `Ctrl-C`. State survives under the directory
passed to `--state`/`--state-root`.

### 3. Build the task-agent image when needed

The cockpit and project orchestrator do not require Docker. Before starting a
sandboxed task-agent run, build the pinned ARM64 image:

```sh
docker build \
  --platform linux/arm64 \
  --tag boss-man:pi-0.80.9-rtk-0.42.3 \
  ./infra/container
```

## Verify the checkout

Run the deterministic Phase 1 core suite. It creates and removes its own
temporary Git fixture and makes no provider request:

```sh
npm test
```

Check a running server:

```sh
curl --fail http://127.0.0.1:4310/api/health
```

More operational commands and troubleshooting live in the
[local development runbook](docs/operations/local-development.md).

## Repository map

| Path | Purpose |
|---|---|
| `src/server/` | Central API, SQLite authority, conversations, runtime, Git, credentials, artifacts, and context custody |
| `src/ui/` | Browser developer cockpit |
| `src/pi/` | Pi extensions for orchestration, custody, task authority, and RTK |
| `scripts/` | Stable operator entry points |
| `config/` | Versioned schemas and redacted configuration examples |
| `infra/` | Task-container and future remote-edge assets |
| `tests/` | Core runner, deterministic fixtures, probes, and baseline metadata |
| `docs/` | Product, architecture, feature, operations, research, and historical records |

Start with the [documentation index](docs/README.md). The most useful
documents are:

- [current capabilities and next steps](docs/product/CURRENT-STATE.md);
- [delivery roadmap](docs/product/ROADMAP.md);
- [decision log](docs/architecture/DECISIONS.md);
- [active orchestrator conversation contract](docs/features/orchestrator-conversations/PRODUCT.md);
- [local development runbook](docs/operations/local-development.md).

Completed Phase 0 plans and evidence remain under
[`docs/history/phase0/`](docs/history/phase0/). They explain why the platform
uses a direct Pi foundation, but they are no longer the repository's front
door or its code layout.

## Security and retention boundaries

Tracked files must not contain credentials, SSH keys, native user sessions,
runtime databases, provider transcripts, unredacted command output, worktrees,
or container filesystems. Owner-managed Pi authentication remains outside the
repository and is copied into private run state only when needed.

The product direction is to retain complete sessions and artifacts until
explicit deletion. Production deletion, quota, backup, authenticated remote
access, and SWAG deployment are later milestones.
