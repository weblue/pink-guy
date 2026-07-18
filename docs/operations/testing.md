# Testing and probes

## Core regression suite

Run the 13 deterministic Phase 1 probes together:

```sh
npm test
```

The runner creates a temporary Git repository, exercises the command loop,
local task controls, conversation/task projections, persistent fake-Pi RPC
runtime, cockpit rendering, browser/terminal conversation parity, task-graph
mutations, plain-text prompt defaults, per-agent model routes,
pre-compaction/scope-transfer custody, and the fixed-revision phase workflow, then
deletes the fixture. The suite also fault-tests safe managed-project deletion,
quarantine restoration, and cleanup retry. It makes no provider request and
starts no task container.

Watch the phase protocol as a standalone model-less baseline:

```sh
npm run test:workflow
```

It prints implementation, host checkpoint, test, independent review, and
completion transitions while asserting that later worktrees use the same
recorded revision.

Run the reproducibility baseline separately:

```sh
npm run test:baseline
```

## Individual probes

Create a reusable disposable fixture:

```sh
./tests/support/create-fixture.sh /tmp/boss-man-fixture
```

Then pass that absolute path to a probe:

```sh
node ./tests/probes/probe-direct-context-custody.mjs /tmp/boss-man-fixture
node ./tests/probes/probe-memory-fts.mjs /tmp/boss-man-fixture
node ./tests/probes/probe-phase1-conversation-runtime.mjs /tmp/boss-man-fixture
node ./tests/probes/probe-phase1-dogfood-readiness.mjs /tmp/boss-man-fixture
```

The context and memory probes are model-less. Provider and container probes
have explicit names and prerequisites; inspect their usage with no arguments
before running them.

After the model-less suite passes, the bounded authenticated task-container
smoke is:

```sh
node ./tests/probes/probe-direct-live-provider.mjs \
  /tmp/boss-man-fixture \
  "$HOME/.pi/agent/auth.json" \
  openai-codex \
  gpt-5.4-mini
```

## Container tests

Build the image first:

```sh
docker build \
  --platform linux/arm64 \
  --tag boss-man:pi-0.80.9-rtk-0.42.3 \
  ./infra/container
```

Then run:

```sh
node ./tests/probes/probe-runtime-git-rtk.mjs /tmp/boss-man-fixture
node ./tests/probes/probe-direct-runtime-git-rtk.mjs /tmp/boss-man-fixture
```

Detailed Phase 0 probe rationale is retained in the
[foundation probe record](../history/phase0/README.md). Checked-in result
manifests are historical evidence, not a substitute for rerunning the current
tests.
