# Boss Man local development runbook

Status: Phase 1 local cockpit (conversation and task-graph slice)

The current application can be served locally for multi-project observability
and durable project-orchestrator command delivery. The local-smoke profile
intentionally has no application authentication and binds only to loopback.
Trusted-LAN binding is later Phase 1 work; authenticated SWAG/public access is
Phase 3.

## Prerequisites

- macOS on ARM64;
- Node.js 24 or newer;
- Git;
- Pi on `PATH`;
- Docker Desktop only when running task-container probes or starting a managed task run.

No Compose file is required. SQLite is embedded, project orchestrators are dynamic per-project processes, and task containers are created per run rather than treated as fixed downstream services.

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
  --port 4310
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The central API binds to `127.0.0.1` intentionally. Runtime state is stored under the selected `--state` directory and retained across restarts.

No password or API key is required in this profile. Do not change the listener to `0.0.0.0` as a shortcut. Phase 1 will add an explicit private-interface/CIDR-aware trusted-LAN profile.

Provider/model/thinking are central defaults persisted on newly created
orchestrator conversations. The deterministic defaults are
`boss-man-phase0/complete`; pass explicit live values as above before expecting
a real Pi orchestrator to consume turns. Changing an existing conversation's
model remains a later safe-boundary custody operation.

Useful checks:

```sh
curl --fail http://127.0.0.1:4310/api/health
curl --fail http://127.0.0.1:4310/api/projects
curl --fail http://127.0.0.1:4310/api/orchestrators
curl --fail http://127.0.0.1:4310/api/board
curl --fail http://127.0.0.1:4310/api/commands
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
in topic/task text or pass them through the browser. The current OAuth profile
remains limited to one live orchestrator/task-provider run at a time until the
credential concurrency/broker decision is resolved. API-key-backed profiles
can later use a different declared concurrency policy.

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
npm run boss -- chat --topic TOPIC_ID
npm run boss -- chat --repo "$PWD" --message "Refine the acceptance criteria."
printf '%s\n' "Create a test task." | npm run boss -- chat --repo "$PWD"
```

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
automatically.

Run the deterministic core suite without starting a provider or task
container:

```sh
npm test
```

See [testing and probes](testing.md) for individual and container-backed
checks.

## Current execution boundary

The served Phase 1 cockpit shows projects, topics, the task board, sessions,
project-orchestrator leases, recent commands, local create/schedule controls,
and a reconnectable Pi RPC conversation workspace with structured task-change
cards. The orchestrator can create, update, split, link, annotate, and
decision-gate tasks inside its project with exact turn provenance. The
existing automated probes exercise real task claiming, Pi RPC,
containers, worktrees, host Git checkpoints, RTK evidence, and context export.
Conversation custody, owner reconciliation/decision controls, and deeper
diff/test/review/source/custody inspectors are the next local-product slices,
not authentication prerequisites. D-043 defers a browser PTY; tmux/SSH remains
the current exact-session attach path.

To exercise the complete model-less C0-04 context path:

```sh
./tests/support/create-fixture.sh /tmp/boss-man-context-fixture
node ./tests/probes/probe-direct-context-custody.mjs \
  /tmp/boss-man-context-fixture
```

The context probe uses no provider, network request, embedding, or vector index.

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
