# Boss Man local development runbook

Status: Current local cockpit and shared terminal client; Phase 1 complete

The current application can be served locally for multi-project observability
and durable project-orchestrator command delivery. The local-smoke profile
intentionally has no application authentication and binds only to loopback.
Authenticated SWAG/public access is Phase 3; there is no unauthenticated
network-listener profile.

## Prerequisites

- macOS on ARM64;
- Node.js 24 or newer;
- Git;
- Pi on `PATH`;
- Docker Desktop only when running task-container probes or starting a managed task run.

SQLite is embedded, project orchestrators are dynamic per-project processes,
and the host daemon creates task containers per run. Task containers do not
receive the Docker socket and do not spawn other containers.

## Serve the central API and operator shell

From this repository:

```sh
npm start -- \
  --repo "$PWD" \
  --state "$HOME/.local/share/boss-man/dev" \
  --port 4310 \
  --provider openai-codex \
  --model gpt-5.4-mini \
  --thinking medium
```

Pass `--repo` more than once to register multiple repositories:

```sh
npm start -- \
  --repo /absolute/path/to/project-one \
  --repo /absolute/path/to/project-two \
  --port 4310 \
  --model-config "$PWD/config/model-routes.json" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The central API binds to `127.0.0.1` intentionally. Runtime state is stored under the selected `--state` directory and retained across restarts.

No password or API key is required in this profile. Do not change the listener
to `0.0.0.0` as a shortcut. Use loopback until the authenticated remote
profile exists.

Provider/model/thinking defaults and phase overrides live in
`config/model-routes.json`. CLI provider/model/thinking flags override the
configured default. Existing conversations change route through the
custody-backed browser or `boss model`; task and phase controls pin their
resolved route independently.

Useful checks:

```sh
curl --fail http://127.0.0.1:4310/api/health
curl --fail http://127.0.0.1:4310/api/projects
curl --fail http://127.0.0.1:4310/api/orchestrators
curl --fail http://127.0.0.1:4310/api/board
curl --fail http://127.0.0.1:4310/api/commands
curl --fail http://127.0.0.1:4310/api/model-routes
```

Stop the server with `Ctrl-C`.

## Start one project orchestrator

Each project may hold one active orchestrator lease. The process can run directly or inside tmux/cmux:

```sh
npm run orchestrator:project -- \
  --api http://127.0.0.1:4310 \
  --repo "$PWD" \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --credential-source "$HOME/.pi/agent/auth.json"
```

The one project process registers both the compatibility command lease and
the new conversation-scope lease, keeps their bearer tokens private,
heartbeats them, consumes task commands, and runs persistent project
conversation turns through Pi RPC. It releases both leases on a normal stop.
A second orchestrator for the same project is rejected until the first leases
are released or expire. Use `--poll-ms` to change the local polling interval;
the default is 1000 ms.

The owner-managed Pi login file is copied into private runtime-owned
configuration; Pi never writes the canonical source. Do not put credentials
in topic/task text or pass them through the browser. OAuth-backed task-agent
runs are serialized by the configured task credential profile. Orchestrator
processes use private copies of the same owner-managed source; provider-turn
concurrency remains a measured Phase 2 policy question.

To process pre-project topics instead, run the system-intake orchestrator
while no other OAuth-backed provider run is active:

```sh
npm run orchestrator:system -- \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

For cmux, create or select a tmux-backed workspace and run the same command there. cmux/tmux and SSH are attach and process-management transports; they do not own durable Boss Man state.

## Use the shared browser and terminal conversation

The cockpit and terminal client consume the same central API projection and
submit to the same persistent Pi conversation. Open the project conversation
from a terminal or dedicated cmux pane:

```sh
npm run boss -- chat --repo "$PWD"
```

The client reuses the first active project topic, just like **Ask
orchestrator**, and prints:

- topic, conversation, scope, model, and thinking identity;
- current orchestrator online/offline state and its tmux pane or process
  endpoint;
- durable owner/Pi turn history and structured task changes; and
- the exact cockpit deep link.

Terminal input is sent once to the central turn queue. Existing Pi context is
neither copied into the request nor reconstructed from terminal output. If the
matching orchestrator is offline, the message remains queued and the client
returns with an explicit status.

Useful commands:

```sh
npm run boss -- status
npm run boss -- topics
npm run boss -- import --repo-url git@github.com:OWNER/REPOSITORY.git
npm run boss -- delete-project --project PROJECT_ID \
  --confirm "Exact project name" --reason "Canceled unused import"
npm run boss -- chat --topic TOPIC_ID
npm run boss -- chat --repo "$PWD" --message "Refine the acceptance criteria."
printf '%s\n' "Create a test task." | npm run boss -- chat --repo "$PWD"
npm run boss -- profiles
npm run boss -- profile --key review
npm run boss -- model --topic TOPIC_ID --provider PROVIDER --model MODEL_ID --thinking medium
```

Repository import creates a host-owned clone under the selected state root
and opens its durable project topic. The browser also accepts an optional
description and immutable generic source snapshot. SSH authentication is
performed by host Git; never paste private keys or provider credentials into a
topic or source snapshot.

Safe deletion is limited to an activity-free managed import. It removes only
the platform-owned checkout and retains an audited tombstone. Any task,
source/context record, conversation activity, command, evidence, or active
lease blocks deletion.

Prompt profile edits are append-only revisions. They apply when the matching
Pi process next starts; running processes keep their pinned revision. Model
switches have a different boundary: Boss Man verifies a conversation custody
bundle and restarts Pi against the same native session before processing the
next turn.

For multiple repositories on this laptop, use one central-API pane and one
`npm run orchestrator:project` pane per active repository. Add `boss chat`
panes only where terminal conversation is useful; the browser can open all
topics and boards at once. Closing a chat pane does not stop Pi or lose
history. Stopping an orchestrator pane releases that project's lease, while
the queued conversation remains durable.

## Create and schedule phase-scoped work

In the cockpit, use **Create task** to choose a project, provide a title and
optional acceptance criteria, and add a `ready` task. On its board card,
choose `implementation`, `test`, or `review` and select **Schedule**.

Scheduling is one authoritative transaction: it assigns a phase-scoped task
agent, moves the task to `in_progress`, and queues its `start_task` command.
It fails without changing the task when the project has no active
orchestrator.

The equivalent API operation for creating a task is:

```sh
curl --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: owner-task-001' \
  --data '{"title":"Implement the task inspector","acceptanceCriteria":["The owner can inspect a fixed revision."]}' \
  http://127.0.0.1:4310/api/projects/PROJECT_ID/tasks
```

Then atomically schedule it:

```sh
curl --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: owner-schedule-001' \
  --data '{"phase":"implementation"}' \
  http://127.0.0.1:4310/api/tasks/TASK_ID/schedule
```

The project orchestrator calls the existing managed task-session operation.
Success or failure is retained in `/api/commands`. If its lease is lost after
claim, the command becomes `reconciliation_required`; it is not replayed
automatically. The cockpit shows the structured failure and offers explicit
**Retry** (a new linked command) or **Reset task**. Active task sessions can be
stopped and their task detail can queue a new phase-scoped resume command.
Task cards open versioned title/description/acceptance editing, dependencies,
decision resolution, and recent audit activity.

Run the deterministic core suite without starting a provider or task
container:

```sh
npm test
```

See [testing and probes](testing.md) for individual and container-backed
checks.

## Current execution boundary

The served Phase 1 cockpit shows projects, topics, the task board, sessions,
project-orchestrator leases, recent commands, local create/release controls,
and a reconnectable Pi RPC conversation workspace with structured task-change
cards. The orchestrator can create, update, split, link, annotate, and
decision-gate tasks inside its project with exact turn provenance. The
existing automated probes exercise real task claiming, Pi RPC,
containers, worktrees, host Git checkpoints, RTK evidence, and context export.
Conversation custody/model switching, intake-to-project transfer, blocking
pre-compaction export, repository/source intake, plain-text prompt defaults,
per-agent model routes, task detail, owner decisions, and command
reconciliation now have first-class local controls. The fixed-revision
implementation/checkpoint/test/review protocol, deterministic initial Ready
dispatch, and its diff/test/review/context/artifact inspector are implemented
and live-dogfooded. The lease inspector shows active project/conversation
leases by default and keeps inactive history in a collapsed audit section.
D-043
defers a browser PTY; tmux/SSH remains the current exact-session attach path.

Watch the zero-provider baseline before scheduling live work:

```sh
npm run test:workflow
```

To exercise the complete model-less C0-04 context path:

```sh
./tests/support/create-fixture.sh /tmp/boss-man-context-fixture
node ./tests/probes/probe-direct-context-custody.mjs \
  /tmp/boss-man-context-fixture
```

The context probe uses no provider, network request, or derived retrieval
service.

To exercise the container path, first build the pinned image and then follow
the [container test instructions](testing.md#container-tests).

## Later remote connection

The Phase 3 primary path remains:

```text
remote browser -> HTTPS Boss Man subdomain -> home-server SWAG -> Boss Man Mac central API
```

The recovery path remains:

```text
SSH client -> home-server port 315 -> ProxyJump over LAN -> Boss Man Mac -> tmux/cmux project process
```

Phase 3 will require a locally configured server-side password verifier or API-key hash for requests through the remote profile. Password login should produce an HttpOnly session; browser `localStorage` is not the default place for a bearer key.

Long-lived SWAG, DNS, router, launch-service, and production-secret changes remain human deployment actions. Do not point SWAG at the current loopback server.
