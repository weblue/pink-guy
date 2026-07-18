# Boss Man

Boss Man is a local-first, remote-ready developer cockpit for orchestrating
[Pi](https://pi.dev/) across multiple Git repositories. One central API owns
projects, tasks, audit history, worktrees, agent runs, and context artifacts.
Each project can run one orchestrator plus phase-scoped implementation, test,
and review agents.

Phase 1 currently includes a loopback web cockpit, durable SQLite state,
persistent Pi RPC conversations, an agile task board, a shared terminal
client, managed worktrees/containers, and model-less context custody.
Authenticated remote access is a later phase.

## Objectives

- Turn a conversation, repository, or refined work item into observable tasks.
- Run multiple repository orchestrators without splitting durable authority.
- Let agents implement, test, review, commit, and merge within explicit risk
  boundaries.
- Preserve complete sessions and portable context so work can resume across
  provider limits, model changes, and new sessions.
- Provide the same project state through the browser, terminal, cmux/tmux, and
  future remote access.

## Values

- **Durability over transcript replay.** Pi-native sessions and model-less
  artifacts preserve context; clients never rebuild prompts from chat history.
- **Observable autonomy.** Tasks, assumptions, decisions, tests, reviews, and
  side effects are structured and auditable.
- **One authority.** The central API owns leases, task state, artifacts, Git
  operations, and session projections.
- **Constrained execution.** Task agents are phase-scoped and run in managed
  worktrees and containers; high-risk decisions remain human-owned.
- **Model choice without silent routing.** Provider, model, and thinking policy
  are centrally selected and recorded for every conversation and run.

## Run locally

Requirements: macOS on Apple Silicon, Node.js 24+, Git, and an authenticated
Pi installation. Docker Desktop is needed only for sandboxed task agents.
There are currently no npm dependencies to install.

### 1. Start the API and cockpit

```sh
npm start -- \
  --repo "$PWD" \
  --state "$HOME/.local/share/boss-man/dev" \
  --port 4310 \
  --provider openai-codex \
  --model gpt-5.4-mini \
  --thinking medium
```

Repeat `--repo /absolute/path` to register more repositories. Open
[http://127.0.0.1:4310](http://127.0.0.1:4310).

The local profile binds only to `127.0.0.1` and has no application
authentication. Do not expose it publicly.

### 2. Start orchestrators

Run one project orchestrator per active repository, preferably in its own
cmux/tmux pane:

```sh
npm run orchestrator:project -- \
  --api http://127.0.0.1:4310 \
  --repo "$PWD" \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Run the shared intake orchestrator for topics that do not yet have a
repository:

```sh
npm run orchestrator:system -- \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

### 3. Use browser or terminal

The browser and terminal are projections of the same durable conversation:

```sh
npm run boss -- status
npm run boss -- topics
npm run boss -- chat --repo "$PWD"
npm run boss -- chat --topic TOPIC_ID
npm run boss -- chat --repo "$PWD" --message "Refine the next task."
npm run boss -- chat --new-topic "Prototype a new tool"
```

A practical cmux layout is one central-API pane, one orchestrator pane per
active repository, and optional `boss chat` panes. Closing a chat pane does
not stop Pi or lose history.

## Select and swap models

Model selection is a central, observable policy—not an agent-controlled
choice. Boss Man persists the provider, model, and thinking level when a
conversation is created and passes that exact route to Pi.

List models available to the authenticated Pi installation:

```sh
pi --list-models
```

Select the default route for newly created conversations when starting Boss
Man:

```sh
npm start -- \
  --repo "$PWD" \
  --provider PROVIDER \
  --model MODEL_ID \
  --thinking low
```

To change that default, stop the central API and restart it with different
flags. Existing conversations remain pinned to their recorded route.

Safe in-place switching of an existing conversation is a first-class Phase 1
objective, but is intentionally not enabled yet. It will require a successful
atomic, model-less custody snapshot before changing provider/model and
resuming the Pi session. Do not edit SQLite to bypass this boundary.

## Optional task-agent image

```sh
docker build \
  --platform linux/arm64 \
  --tag boss-man:pi-0.80.9-rtk-0.42.3 \
  ./infra/container
```

The cockpit, terminal client, and orchestrators do not require Docker.

## Verify

```sh
npm test
npm run test:baseline
curl --fail http://127.0.0.1:4310/api/health
```

The core suite is model-less and makes no provider requests.

## Documentation

Start with [the documentation index](docs/README.md), then see:

- [current capabilities and next steps](docs/product/CURRENT-STATE.md)
- [delivery roadmap](docs/product/ROADMAP.md)
- [architecture decisions](docs/architecture/DECISIONS.md)
- [local development runbook](docs/operations/local-development.md)

Tracked files never contain credentials, SSH keys, provider transcripts,
native user sessions, runtime databases, unredacted command logs, worktrees,
or container filesystems.
