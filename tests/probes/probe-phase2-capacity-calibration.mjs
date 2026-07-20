import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  byteValue,
  processCategory,
  processTotals,
  summarizeCalibration,
  vmBytes,
} from "../../src/server/capacity-calibration.mjs";

assert.equal(byteValue("138.19M"), 144902717);
assert.equal(byteValue("512MiB"), 536870912);
assert.equal(byteValue("1.5GiB"), 1610612736);
assert.equal(byteValue("not-memory"), null);

const vm = vmBytes(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10.
Pages active:                             20.
"Translation faults":                    9999.
Pageins:                                  9999.
Pages occupied by compressor:             5.
`);
assert.deepEqual(vm, {
  pages_free: 163840,
  pages_active: 327680,
  pages_occupied_by_compressor: 81920,
});

assert.equal(processCategory("/Applications/Codex.app/Contents/MacOS/ChatGPT"), "codex");
assert.equal(processCategory("/usr/local/bin/pi"), "pi");
assert.equal(processCategory("/Applications/Docker.app/Contents/MacOS/com.docker.backend"), "docker");
assert.equal(processCategory("/opt/homebrew/bin/node"), "node");
assert.equal(processCategory("/bin/zsh"), null);

const firstProcesses = [
  { category: "codex", cpu_percent: 2.5, rss_bytes: 100 },
  { category: "codex", cpu_percent: 0.5, rss_bytes: 50 },
  { category: "docker", cpu_percent: 1, rss_bytes: 80 },
];
assert.deepEqual(processTotals(firstProcesses), {
  codex: { count: 2, cpu_percent: 3, rss_bytes: 150 },
  docker: { count: 1, cpu_percent: 1, rss_bytes: 80 },
});

const sample = (free, swap, processes, containerMemory, state, errors = []) => ({
  host: {
    free_memory_bytes: free,
    memory_pressure_free_percent: free / 100,
    swap_used_bytes: swap,
  },
  process_totals: processTotals(processes),
  docker: {
    pink_container_ids: containerMemory ? ["abc"] : [],
    containers: containerMemory
      ? [{ memory_bytes: containerMemory, cpu_percent: containerMemory / 10 }]
      : [],
  },
  state_root_bytes: state,
  errors,
});
const summary = summarizeCalibration([
  sample(1_000, 100, firstProcesses, 200, 10_000),
  sample(800, 120, [
    { category: "codex", cpu_percent: 5, rss_bytes: 220 },
    { category: "pi", cpu_percent: 10, rss_bytes: 300 },
  ], 250, 10_500, [{ source: "swap", code: "failed" }]),
], { stateRoot: true });
assert.deepEqual(summary, {
  sample_count: 2,
  minimum_free_memory_bytes: 800,
  average_free_memory_bytes: 900,
  minimum_memory_pressure_free_percent: 8,
  peak_swap_used_bytes: 120,
  peak_process_rss_by_category: { codex: 220, docker: 80, pi: 300 },
  peak_process_cpu_percent_by_category: { codex: 5, docker: 1, pi: 10 },
  peak_container_memory_bytes: 250,
  peak_container_cpu_percent: 25,
  peak_pink_container_count: 1,
  state_root_growth_bytes: 500,
  sample_error_count: 1,
});
assert.equal(
  summarizeCalibration([
    sample(1_000, 100, firstProcesses, 200, 10_000),
    sample(800, 120, firstProcesses, 200, null, [{ source: "state_root", code: "failed" }]),
  ], { stateRoot: true }).state_root_growth_bytes,
  null,
  "missing state-root samples must not be coerced into a fabricated growth measurement",
);

const serialized = JSON.stringify({ summary, samples: [] });
for (const forbidden of ["argv", "command", "environment", "access_token", "api_key"]) {
  assert(!serialized.includes(forbidden));
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pink-capacity-calibration-"));
const artifactPath = join(temporaryRoot, "signal.json");
try {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      join(repositoryRoot, "scripts", "calibrate.mjs"),
      "--label", "probe-signal",
      "--duration", "10",
      "--interval", "1",
      "--output", artifactPath,
    ], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    let interrupted = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error("calibration artifact probe timed out"));
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!interrupted && output.includes("sample 1/")) {
        interrupted = true;
        child.kill("SIGINT");
      }
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`calibration artifact probe exited ${code}: ${errorOutput}`));
    });
  });
  const emitted = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.equal(emitted.schema_version, "1.0.0");
  assert.equal(emitted.completion_reason, "owner_sigint");
  assert(emitted.summary.sample_count >= 1);
  assert.equal(typeof emitted.metadata.git_working_tree_dirty, "boolean");
  if (emitted.metadata.docker) {
    assert.deepEqual(
      Object.keys(emitted.metadata.docker).sort(),
      ["architecture", "cpu_count", "memory_bytes", "operating_system", "server_version"],
    );
  }
  assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
  for (const forbidden of ["access_token", "api_key", "environment", "argv"]) {
    assert(!JSON.stringify(emitted).includes(forbidden));
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  phase: "P2-4-capacity-calibration",
  deterministic_metrics: true,
  artifact_output: true,
  owner_stop_retained: true,
  provider_requests: 0,
  secret_bearing_fields: 0,
}, null, 2)}\n`);
