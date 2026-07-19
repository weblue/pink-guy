# Pink Guy

Pink Guy is a local-first, remote-ready developer cockpit for orchestrating
[Pi](https://pi.dev/) across multiple Git repositories. One central API owns
projects, tasks, audit history, worktrees, agent runs, and context artifacts.
Each project can run one orchestrator plus phase-scoped implementation, test,
and review agents.

Phase 1 is complete and includes a loopback web cockpit, durable SQLite state,
persistent Pi RPC conversations, an agile task board, a shared terminal
client, host-owned repository intake, editable agent profiles, safe model
switching, task/reconciliation controls, fixed-revision implementation/test/
review handoffs, automatic model-less phase continuation, task workspace
evidence inspectors, deterministic Ready scheduling, managed
worktrees/containers, and model-less context custody.
Authenticated remote access is a later phase.

Phase 2 is active. P2-1 through P2-3 are implemented on the current Phase 2
branch and are awaiting merge in
[PR #17](https://github.com/weblue/pink-guy/pull/17). Recovery now provides
durable command execution identity, central asynchronous settlement, mutation
fencing, restart reconciliation, explicit pause/retry/cancel actions, and
owner-only late-checkpoint recovery. Governed Git adds prepare-only defaults,
owner-selected merge/squash/rebase policy, conflict attention, and optional
local/remote publication without force push. Retention adds holds, safe
worktree/container cleanup, explicit session deletion manifests, storage
inventory, and dispatch blocking under configured hard pressure. P2-4 host and
provider calibration is next. See the
[Phase 2 delivery map](docs/product/PHASE2-PLAN.md).
The operational sequence from merge through calibration, continuity, dogfood,
and UX acceptance is in the
[Phase 2 closure plan](docs/product/PHASE2-CLOSURE.md).

After continuity work, Phase 2D will collect long-turn reliability and
UX-friction evidence through sustained dogfood. A Phase 2U owner interview and
mockup built from the existing cockpit will then drive accepted scrolling,
comprehension, and navigation improvements before the full-time switch.

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
  --state "$HOME/.local/share/pink-guy/dev" \
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
  --state-root "$HOME/.local/share/pink-guy/dev" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Run the shared intake orchestrator for topics that do not yet have a
repository:

```sh
npm run orchestrator:system -- \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/pink-guy/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

### 3. Use browser or terminal

The browser and terminal are projections of the same durable conversation:

```sh
npm run pink -- status
npm run pink -- topics
npm run pink -- chat --repo "$PWD"
npm run pink -- chat --topic TOPIC_ID
npm run pink -- chat --repo "$PWD" --message "Refine the next task."
npm run pink -- chat --new-topic "Prototype a new tool"
npm run pink -- import --repo-url git@github.com:OWNER/REPO.git
npm run pink -- delete-project --project PROJECT_ID \
  --confirm "Exact project name" --reason "Canceled unused import"
npm run pink -- dispatch --task TASK_ID --policy automatic --priority 0
npm run pink -- dispatch --task TASK_ID --policy paused
npm run pink -- attention
npm run pink -- recover --execution EXECUTION_ID --action retry \
  --reason "Retry from the authoritative revision"
npm run pink -- candidate --candidate CANDIDATE_ID --action accept \
  --reason "Verified checkpoint; rerun validation and review"
npm run pink -- git-policy --project PROJECT_ID
npm run pink -- integrate --task TASK_ID --action prepare
npm run pink -- storage
npm run pink -- cleanup --task TASK_ID
npm run pink -- hold --project PROJECT_ID --scope-type task \
  --scope-id TASK_ID --reason "Retain for audit"
npm run pink -- delete-session --session SESSION_ID
npm run pink -- bind --topic TOPIC_ID --project PROJECT_ID
npm run pink -- profiles
```

A practical cmux layout is one central-API pane, one orchestrator pane per
active repository, and optional `pink chat` panes. Closing a chat pane does
not stop Pi or lose history.

After the orchestrator refines and explicitly releases concrete work, the
central model-less scheduler selects eligible Ready tasks by priority, release
time, then task ID. It waits visibly for lease or capacity rather than failing.
After implementation records a fixed review-requested revision, the API
automatically schedules test and independent review from durable evidence.
Failed validation, non-approved review, missing phase evidence, decisions, and
dependencies stop the pipeline for explicit recovery. The cockpit's
**Manually start phase** action is an override, not the normal flow.

The active board distinguishes executable work from umbrella and intake
artifacts. Optional task tags are organizational only. Settled planning records
can be archived with an audited reason, remain fully inspectable, and can be
restored without automatically scheduling work.

Only an unused Pink Guy-managed import can be deleted. The control plane
refuses direct repositories and imports with tasks, source/context records,
conversation activity, commands, evidence, or active leases. Successful
deletion removes the managed checkout while retaining a tombstone and audited
receipt.

Git integration is also two-step by design: preparation is model-less and
non-mutating, while execution requires an owner-enabled project policy and
fresh completion/validation/review gates. Cleanup and session deletion first
return a preview; execution requires an explicit reason, and session deletion
also requires the exact session ID. The cockpit provides the same controls.

## Select and swap models

Model selection is a central, observable policy—not an agent-controlled
choice. Pink Guy persists the provider, model, and thinking level when a
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
configured Pi installation; Pink Guy does not require a separate routing
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
npm run pink -- model \
  --topic TOPIC_ID \
  --provider PROVIDER \
  --model MODEL_ID \
  --thinking medium
```

Edit the orchestrator or phase-agent role guidance without changing source:

```sh
npm run pink -- profiles
npm run pink -- profile --key orchestrator
npm run pink -- profile \
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
  --tag pink-guy:pi-0.80.9-rtk-0.42.3 \
  ./infra/container
```

The cockpit, terminal client, and orchestrators do not require Docker.

The preferred product command, package name, state directory, image tag, and
new runtime identifiers are `pink`/`pink-guy`. Legacy `boss`,
`BOSS_MAN_*`, database/schema identifiers, and old state/image references are
accepted only as compatibility inputs so existing sessions remain readable.

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
