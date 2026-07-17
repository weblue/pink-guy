#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(64);
}

const separator = process.argv.indexOf("--");
if (separator < 0) fail("usage: run-evidence-command.mjs --artifact-dir <absolute-path> [--env NAME] -- command [args...]");
const options = process.argv.slice(2, separator);
const command = process.argv.slice(separator + 1);
if (!command.length) fail("command is required");

let artifactDirectory;
const requestedEnvironmentNames = [];
for (let index = 0; index < options.length; index += 1) {
  if (options[index] === "--artifact-dir") artifactDirectory = options[++index];
  else if (options[index] === "--env") requestedEnvironmentNames.push(options[++index]);
  else fail(`unknown option: ${options[index]}`);
}
if (!artifactDirectory || !isAbsolute(artifactDirectory)) fail("--artifact-dir must be absolute");
if (requestedEnvironmentNames.some((name) => !/^[A-Z_][A-Z0-9_]*$/.test(name))) fail("invalid environment variable name");

function sanitizedArgument(value) {
  return /(?:token|secret|password|passwd|api[_-]?key|authorization)=/i.test(value)
    ? `${value.slice(0, value.indexOf("=") + 1)}<redacted>`
    : value;
}

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
const id = randomUUID();
const stdoutPath = join(artifactDirectory, `${id}.stdout`);
const stderrPath = join(artifactDirectory, `${id}.stderr`);
const startedAt = new Date();
const environmentNames = [...new Set(["PATH", "LANG", "TMPDIR", ...requestedEnvironmentNames])].sort();
const environment = Object.fromEntries(environmentNames.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));

const child = spawn(command[0], command.slice(1), { env: environment, stdio: ["ignore", "pipe", "pipe"] });
const stdout = [];
const stderr = [];
child.stdout.on("data", (chunk) => stdout.push(chunk));
child.stderr.on("data", (chunk) => stderr.push(chunk));
const result = await new Promise((resolvePromise, rejectPromise) => {
  child.once("error", rejectPromise);
  child.once("exit", (code, signal) => resolvePromise({ code, signal }));
});
const endedAt = new Date();
const stdoutContent = Buffer.concat(stdout);
const stderrContent = Buffer.concat(stderr);
await Promise.all([
  writeFile(stdoutPath, stdoutContent, { mode: 0o600 }),
  writeFile(stderrPath, stderrContent, { mode: 0o600 }),
]);

const manifest = {
  schema_version: "1.0.0",
  command: command.map(sanitizedArgument),
  environment_names: environmentNames,
  started_at: startedAt.toISOString(),
  ended_at: endedAt.toISOString(),
  duration_ms: endedAt.getTime() - startedAt.getTime(),
  exit_code: result.code,
  signal: result.signal,
  stdout: { path: stdoutPath, bytes: stdoutContent.length, sha256: checksum(stdoutContent) },
  stderr: { path: stderrPath, bytes: stderrContent.length, sha256: checksum(stderrContent) },
};
const manifestPath = join(artifactDirectory, `${id}.manifest.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
if (checksum(await readFile(stdoutPath)) !== manifest.stdout.sha256 || checksum(await readFile(stderrPath)) !== manifest.stderr.sha256) {
  throw new Error("artifact checksum verification failed");
}
process.stdout.write(`${JSON.stringify({ ...manifest, manifest_path: manifestPath }, null, 2)}\n`);
process.exitCode = result.code ?? 1;
