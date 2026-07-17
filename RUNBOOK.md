# Boss Man local development runbook

Status: Phase 0 operator shell

The current application can be served locally for multi-project observability. The local-smoke profile intentionally has no application authentication and binds only to loopback. Trusted-LAN binding is Phase 1 work; authenticated SWAG/public access is Phase 3.

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
```

Stop the server with `Ctrl-C`.

## Start one project orchestrator

Each project may hold one active orchestrator lease. The process can run directly or inside tmux/cmux:

```sh
node ./phase0/scripts/project-orchestrator.mjs \
  --api http://127.0.0.1:4310 \
  --repo /Users/ND139178/Documents/boss-man
```

The process registers through the central API, keeps its in-memory bearer token private, heartbeats the lease, and releases it on a normal stop. A second orchestrator for the same project is rejected until the first lease is released or expires.

For cmux, create or select a tmux-backed workspace and run the same command there. cmux/tmux and SSH are attach and process-management transports; they do not own durable Boss Man state.

## Current execution boundary

The served Phase 0 shell shows projects, tasks, sessions, and project-orchestrator leases. The existing automated probes exercise real task claiming, Pi RPC, containers, worktrees, host Git checkpoints, RTK evidence, and context export. The shell does not yet provide full task controls because that product command surface belongs to Phase 1—not because local authentication is missing.

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
