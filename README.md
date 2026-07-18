# Boss Man

Boss Man is a local-first, remote-ready developer cockpit for orchestrating
[Pi](https://pi.dev/) across multiple Git repositories. One central API owns
projects, tasks, audit history, worktrees, agent runs, and context artifacts.
Each project can run one orchestrator plus phase-scoped implementation, test,
and review agents.

Phase 1 currently includes a loopback web cockpit, durable SQLite state,
persistent Pi RPC conversations, an agile task board, a shared terminal
client, host-owned repository intake, editable agent profiles, safe model
switching, task/reconciliation controls, fixed-revision implementation/test/
review handoffs, task workspace evidence inspectors, managed worktrees/
containers, and model-less context custody.
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
  --model-config "$PWD/config/model-routes.json" \
  --credential-source "$HOME/.pi/agent/auth.json"
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
npm run boss -- import --repo-url git@github.com:OWNER/REPO.git
npm run boss -- bind --topic TOPIC_ID --project PROJECT_ID
npm run boss -- profiles
```

A practical cmux layout is one central-API pane, one orchestrator pane per
active repository, and optional `boss chat` panes. Closing a chat pane does
not stop Pi or lose history.

## Select and swap models

Model selection is a central, observable policy—not an agent-controlled
choice. Boss Man persists the provider, model, and thinking level when a
conversation is created and passes that exact route to Pi.

Conversation routes can be selected and changed. Every task phase also resolves
and records its own provider, model, thinking level, policy source, and billing
class. The owner can select that route in the task workspace, and the
orchestrator can select it when scheduling a sub-agent.

List models available to the authenticated Pi installation:

```sh
pi --list-models
```

A local model uses the same provider/model fields when it is exposed by the
configured Pi installation; Boss Man does not require a separate routing
service.

Edit [`config/model-routes.json`](config/model-routes.json) to set the default
and optional `orchestrator`, `implementation`, `test`, or `review` overrides.
Command-line values override only the configured default:

```sh
npm start -- \
  --repo "$PWD" \
  --model-config "$PWD/config/model-routes.json" \
  --provider PROVIDER \
  --model MODEL_ID \
  --thinking low
```

Safely switch an existing conversation. This first writes and verifies a
model-less custody snapshot, then restarts Pi against the same native session
before its next turn:

```sh
npm run boss -- model \
  --topic TOPIC_ID \
  --provider PROVIDER \
  --model MODEL_ID \
  --thinking medium
```

Edit the orchestrator or phase-agent role guidance without changing source:

```sh
npm run boss -- profiles
npm run boss -- profile --key orchestrator
npm run boss -- profile \
  --key implementation \
  --prompt-file ./config/prompts/profiles/implementation.txt
```

Human-readable defaults live under `config/prompts/`. Profile files are
owner-editable guidance; policy-envelope and kickoff files are source-controlled
platform behavior. Apply an edited profile through the command above or the
cockpit. Prompt edits apply to new or restarted processes, and every run records
the exact profile version and checksum it consumed.

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
npm run test:workflow
npm run test:baseline
curl --fail http://127.0.0.1:4310/api/health
```

The core and workflow observer suites are model-less and make no provider
requests. `test:workflow` prints each implementation, checkpoint, test, review,
and completion transition as it verifies fixed-revision custody.

## Documentation

Start with [the documentation index](docs/README.md), then see:

- [current capabilities and next steps](docs/product/CURRENT-STATE.md)
- [delivery roadmap](docs/product/ROADMAP.md)
- [architecture decisions](docs/architecture/DECISIONS.md)
- [local development runbook](docs/operations/local-development.md)

Tracked files never contain credentials, SSH keys, provider transcripts,
native user sessions, runtime databases, unredacted command logs, worktrees,
or container filesystems.
