# Boss Man local development runbook

Status: Phase 1 local cockpit (first control-loop slice)

The current application can be served locally for multi-project observability
and durable project-orchestrator command delivery. The local-smoke profile
intentionally has no application authentication and binds only to loopback.
Trusted-LAN binding is later Phase 1 work; authenticated SWAG/public access is
Phase 3.

## Prerequisites

- macOS on ARM64;
- Node with `node:sqlite` support (the current machine uses Node 25);
- Git;
- Pi on `PATH`;
- Docker Desktop only when running task-container probes or starting a managed task run.

No Compose file is required. SQLite is embedded, project orchestrators are dynamic per-project processes, and task containers are created per run rather than treated as fixed downstream services.

## Serve the central API and operator shell

From this repository:

```sh
node ./phase0/scripts/serve-direct.mjs \
  --repo /Users/ND139178/Documents/boss-man \
  --state "$HOME/.local/share/boss-man/dev" \
  --port 4310
```

Pass `--repo` more than once to register multiple repositories:

```sh
node ./phase0/scripts/serve-direct.mjs \
  --repo /absolute/path/to/project-one \
  --repo /absolute/path/to/project-two \
  --port 4310
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The central API binds to `127.0.0.1` intentionally. Runtime state is stored under the selected `--state` directory and retained across restarts.

No password or API key is required in this profile. Do not change the listener to `0.0.0.0` as a shortcut. Phase 1 will add an explicit private-interface/CIDR-aware trusted-LAN profile.

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
node ./phase0/scripts/project-orchestrator.mjs \
  --api http://127.0.0.1:4310 \
  --repo /Users/ND139178/Documents/boss-man \
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
node ./phase0/scripts/conversation-orchestrator.mjs \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/boss-man/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

For cmux, create or select a tmux-backed workspace and run the same command there. cmux/tmux and SSH are attach and process-management transports; they do not own durable Boss Man state.

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

Use the deterministic probes to test both control layers without starting a
provider or task container:

```sh
node ./phase0/scripts/probe-phase1-command-loop.mjs \
  /Users/ND139178/Documents/boss-man
node ./phase0/scripts/probe-phase1-local-task-controls.mjs \
  /Users/ND139178/Documents/boss-man
node ./phase0/scripts/probe-phase1-orchestrator-conversations.mjs \
  /Users/ND139178/Documents/boss-man
node ./phase0/scripts/probe-phase1-conversation-runtime.mjs \
  /Users/ND139178/Documents/boss-man
```

## Current execution boundary

The served Phase 1 shell shows projects, tasks, sessions, project-orchestrator
leases, recent commands, and local create/schedule controls. The existing
automated probes exercise real task claiming, Pi RPC, containers, worktrees,
host Git checkpoints, RTK evidence, and context export. The shell does not yet
provide task editing/dependencies, reconciliation actions, or the Pi RPC
conversation workspace. Those are the next local-product slices, not
authentication prerequisites. A browser PTY is conditional on D-043;
tmux/SSH remains the current exact-session attach path.

To exercise the complete model-less C0-04 context path:

```sh
./phase0/scripts/create-fixture.sh /tmp/boss-man-context-fixture
node ./phase0/scripts/probe-direct-context-custody.mjs \
  /tmp/boss-man-context-fixture
```

The context probe uses no provider, network request, embedding, or vector index.

To exercise the container path, first build the pinned image and then run the direct probes described in [`phase0/README.md`](phase0/README.md).

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
