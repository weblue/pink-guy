#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "boss-man-core-tests-"));
const fixture = join(temporaryRoot, "fixture");
const probes = [
  "probe-phase2-capacity-calibration.mjs",
  "probe-phase2-provider-catalog.mjs",
  "probe-phase2-execution-recovery.mjs",
  "probe-phase2-git-retention.mjs",
  "probe-phase2-continuity.mjs",
  "probe-phase1-command-loop.mjs",
  "probe-phase1-local-task-controls.mjs",
  "probe-phase1-orchestrator-conversations.mjs",
  "probe-phase1-conversation-runtime.mjs",
  "probe-phase1-conversation-cockpit.mjs",
  "probe-phase1-orchestrator-lease-history.mjs",
  "probe-phase1-terminal-client.mjs",
  "probe-phase1-task-graph-mutations.mjs",
  "probe-phase1-agent-prompt-profiles.mjs",
  "probe-phase1-dogfood-readiness.mjs",
  "probe-phase1-automatic-continuation.mjs",
  "probe-phase1-ready-scheduler.mjs",
  "probe-phase1-task-lifecycle.mjs",
  "probe-phase1-project-deletion.mjs",
  "probe-phase1-workflow-observer.mjs",
];

try {
  await execFileAsync(join(repositoryRoot, "tests/support/create-fixture.sh"), [fixture], {
    cwd: repositoryRoot,
  });
  for (const probe of probes) {
    process.stdout.write(`Running ${probe}\n`);
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(repositoryRoot, "tests/probes", probe), fixture],
      { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 },
    );
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  process.stdout.write(`Core test suite passed (${probes.length} probes).\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
