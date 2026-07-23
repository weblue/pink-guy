# Pink Guy local development runbook

Status: Current Phase 2D local cockpit and shared terminal client

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

There are no npm dependencies to install.

SQLite is embedded, project orchestrators are dynamic per-project processes,
and the host daemon creates task containers per run. Task containers do not
receive the Docker socket and do not spawn other containers.

## Serve the central API and operator shell

From this repository:

```sh
npm start -- \
  --repo "$PWD" \
  --state "$HOME/.local/share/pink-guy/dev" \
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
custody-backed browser or `pink model`; task and phase controls pin their
resolved route independently.

Discover models and refresh the catalog after authentication:

```sh
pi --list-models
npm run pink -- models
npm run pink -- models --refresh
```

The cockpit's **Models + provider authentication** panel gives the exact Pi
command for the configured credential directory. Run it in a host TTY, enter
`/login`, complete Pi's subscription or API-key flow, and refresh. Do not paste
credentials into Pink Guy; the browser never accepts secret values.

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
  --state-root "$HOME/.local/share/pink-guy/dev" \
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
processes use private copies of the same owner-managed source. The calibrated
dogfood policy keeps OAuth-backed provider execution serialized; widening it
requires new measured evidence rather than an operator-side override.

To process pre-project topics instead, run the system-intake orchestrator
while no other OAuth-backed provider run is active:

```sh
npm run orchestrator:system -- \
  --api http://127.0.0.1:4310 \
  --state-root "$HOME/.local/share/pink-guy/dev" \
  --system-intake \
  --credential-source "$HOME/.pi/agent/auth.json"
```

For cmux, create or select a tmux-backed workspace and run the same command there. cmux/tmux and SSH are attach and process-management transports; they do not own durable Pink Guy state.

## Use the shared browser and terminal conversation

The cockpit and terminal client consume the same central API projection and
submit to the same persistent Pi conversation. Open the project conversation
from a terminal or dedicated cmux pane:

```sh
npm run pink -- chat --repo "$PWD"
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
npm run pink -- status
npm run pink -- topics
npm run pink -- import --repo-url git@github.com:OWNER/REPOSITORY.git
npm run pink -- delete-project --project PROJECT_ID \
  --confirm "Exact project name" --reason "Canceled unused import"
npm run pink -- chat --topic TOPIC_ID
npm run pink -- chat --repo "$PWD" --message "Refine the acceptance criteria."
printf '%s\n' "Create a test task." | npm run pink -- chat --repo "$PWD"
npm run pink -- profiles
npm run pink -- profile --key review
npm run pink -- model --topic TOPIC_ID --provider PROVIDER --model MODEL_ID --thinking medium
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
switches have a different boundary: Pink Guy verifies a conversation custody
bundle and restarts Pi against the same native session before processing the
next turn.

For multiple repositories on this laptop, use one central-API pane and one
`npm run orchestrator:project` pane per active repository. Add `pink chat`
panes only where terminal conversation is useful; the browser can open all
topics and boards at once. Closing a chat pane does not stop Pi or lose
history. Stopping an orchestrator pane releases that project's lease, while
the queued conversation remains durable.

## Release work and use manual phase controls

The normal path is to refine an executable task, resolve dependencies and
protected decisions, and explicitly release it to automatic dispatch. The
central scheduler selects eligible Ready work deterministically, then
continues a successful implementation through fixed-revision test and
independent review.

Direct phase scheduling is an owner recovery/override path. In the cockpit,
use **Create task** to choose a project, provide a title and optional acceptance
criteria, and add a `ready` task. On its board card, choose `implementation`,
`test`, or `review` and select **Schedule**.

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

## Governed Git, cleanup, and retention

New projects are prepare-only. Inspect policy and prepare a model-less
integration plan:

```sh
npm run pink -- git-policy --project PROJECT_ID
npm run pink -- integrate --task TASK_ID --action prepare
```

Only after owner policy permits local integration or pull-request publication
can a prepared receipt execute. Force push is unsupported. Conflicts and
uncertain publication appear in `pink attention`.

Inspect state-root storage and preview cleanup before executing it:

```sh
npm run pink -- storage
npm run pink -- cleanup --task TASK_ID
npm run pink -- cleanup --task TASK_ID --execute \
  --reason "Retire settled task resources"
```

Use a retention hold when audit or recovery evidence must remain:

```sh
npm run pink -- hold --project PROJECT_ID --scope-type task \
  --scope-id TASK_ID --reason "Retain through audit"
```

Session artifact deletion is separate from runtime cleanup and requires a
fresh preview, explicit execution flag, exact session ID, and reason. It
retains a deletion manifest, receipt, and session tombstone.

The selected target-Mac dogfood thresholds are environment configuration:

```sh
PINK_GUY_STORAGE_WARN_BYTES=10737418240 \
PINK_GUY_STORAGE_HARD_BYTES=16106127360 \
npm start -- --repo "$PWD"
```

These are 10 GiB warning and 15 GiB hard limits. Hard pressure pauses new
dispatch; it does not delete sessions, artifacts, or workspaces. Change them
only as an explicit operator policy for a host with different capacity.

## Export and restore continuity

Export through the live API only while the control plane is quiescent:

```sh
npm run continuity -- export --output /absolute/backups/pink-guy-YYYYMMDD
npm run continuity -- verify --bundle /absolute/backups/pink-guy-YYYYMMDD
npm run continuity -- restore \
  --bundle /absolute/backups/pink-guy-YYYYMMDD \
  --target /absolute/restores/pink-guy
```

The output and restore target must be new absolute paths. Export must be
outside the live state root and managed repositories. Restore verifies the
bundle, reconstructs repositories in an isolated state root, revokes
ephemeral authority, and starts no Pi process or container. Credentials and
ephemeral containers are not exported. See the
[continuity acceptance results](../features/continuity-export/RESULTS.md).

## Later remote connection

The Phase 3 primary path remains:

```text
remote browser -> HTTPS Pink Guy subdomain -> home-server SWAG -> Pink Guy Mac central API
```

The recovery path remains:

```text
SSH client -> home-server port 315 -> ProxyJump over LAN -> Pink Guy Mac -> tmux/cmux project process
```

For local execution recovery, browser and terminal use the same central
attention projection:

```sh
npm run pink -- attention
npm run pink -- recover --execution EXECUTION_ID --action pause \
  --reason "Pause for owner inspection"
npm run pink -- recover --execution EXECUTION_ID --action retry \
  --reason "Retry from the authoritative revision"
npm run pink -- candidate --candidate CANDIDATE_ID --action reject \
  --reason "Checkpoint provenance is valid but the change is not wanted"
```

These actions require an execution/candidate version and idempotency key; the
terminal client resolves the current version and generates the key. The
cockpit prompts for the required reason. Recovery candidates are quarantined
evidence and are never part of Ready scheduling.

Phase 3 will require a locally configured server-side password verifier or API-key hash for requests through the remote profile. Password login should produce an HttpOnly session; browser `localStorage` is not the default place for a bearer key.

Long-lived SWAG, DNS, router, launch-service, and production-secret changes remain human deployment actions. Do not point SWAG at the current loopback server.
