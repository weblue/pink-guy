#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const fixtureScript = join(scriptDirectory, "create-fixture.sh");
const runner = join(scriptDirectory, "run-evidence-command.mjs");
const expectedCommit = "cef5e049ab9841e8389c6c4f5f0fde5d2385c7b4";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const checksumLines = (await readFile(join(repositoryRoot, "phase0/fixtures/fixture-checksums.sha256"), "utf8"))
  .trim().split("\n");
for (const line of checksumLines) {
  const [expected, path] = line.split(/\s+/, 2);
  const content = await readFile(join(repositoryRoot, path));
  assert(sha256(content) === expected, `fixture source checksum mismatch: ${path}`);
}

const root = await mkdtemp(join(tmpdir(), "boss-man-baseline-"));
const commits = [];
for (const name of ["first", "second"]) {
  const target = join(root, name);
  execFileSync(fixtureScript, [target], { cwd: repositoryRoot, stdio: "ignore" });
  commits.push(execFileSync("git", ["-C", target, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
}
assert(commits.every((commit) => commit === expectedCommit), "fixture commit is not reproducible");

const artifactDirectory = join(root, "command-artifacts");
const runnerOutput = execFileSync(process.execPath, [runner, "--artifact-dir", artifactDirectory, "--", "/usr/bin/printf", "baseline-ok"], {
  encoding: "utf8",
  env: { ...process.env, BOSS_MAN_UNFORWARDED_SECRET: "must-not-appear" },
});
const runnerManifest = JSON.parse(runnerOutput);
assert(runnerManifest.exit_code === 0 && runnerManifest.duration_ms >= 0, "command runner result is invalid");
assert(!JSON.stringify(runnerManifest).includes("must-not-appear"), "command runner persisted an environment value");
assert(runnerManifest.environment_names.every((name) => typeof name === "string"), "environment names were not recorded");
assert(sha256(await readFile(runnerManifest.stdout.path)) === runnerManifest.stdout.sha256, "runner stdout checksum mismatch");
assert(sha256(await readFile(runnerManifest.stderr.path)) === runnerManifest.stderr.sha256, "runner stderr checksum mismatch");

const sourceManifest = JSON.parse(await readFile(join(repositoryRoot, "phase0/baseline/source-manifest.json"), "utf8"));
assert(sourceManifest.fixture_commit === expectedCommit, "source manifest fixture pin is stale");
assert(sourceManifest.host.architecture === process.arch, "host architecture differs from the captured baseline");

process.stdout.write(`${JSON.stringify({
  fixture_commit: expectedCommit,
  fixture_regenerations: commits.length,
  fixture_source_checksums: checksumLines.length,
  environment_values_recorded: false,
  command_runner_exit_code: runnerManifest.exit_code,
  command_runner_stdout_sha256: runnerManifest.stdout.sha256,
  source_count: Object.keys(sourceManifest.sources).length,
  tool_count: Object.keys(sourceManifest.tools).length,
  isolated_root: root,
}, null, 2)}\n`);
