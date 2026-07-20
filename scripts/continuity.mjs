#!/usr/bin/env node

import { resolve } from "node:path";

import { restoreBundle, verifyBundle } from "../src/server/continuity.mjs";

function usage(message = null) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(`Pink Guy model-less continuity

Usage:
  npm run continuity -- export --output /absolute/bundle [--api http://127.0.0.1:4310] [--json]
  npm run continuity -- verify --bundle /absolute/bundle [--json]
  npm run continuity -- restore --bundle /absolute/bundle --target /absolute/state [--json]
`);
  process.exit(message ? 64 : 0);
}

const [command, ...rawArguments] = process.argv.slice(2);
if (!command || ["help", "--help", "-h"].includes(command)) usage();
const options = {};
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index];
  if (argument === "--json") options.json = true;
  else if (argument.startsWith("--")) {
    const value = rawArguments[++index];
    if (!value || value.startsWith("--")) usage(`missing value for ${argument}`);
    options[argument.slice(2)] = value;
  } else usage(`unknown argument: ${argument}`);
}

async function exportContinuity() {
  if (!options.output) usage("export requires --output");
  const outputPath = resolve(options.output);
  const api = (options.api ?? "http://127.0.0.1:4310").replace(/\/$/, "");
  const response = await fetch(`${api}/api/continuity/exports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outputPath }),
  });
  const value = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(`${value.error}: ${value.message}`), { code: value.error });
  }
  return value;
}

let result;
try {
  if (command === "export") result = await exportContinuity();
  else if (command === "verify") {
    if (!options.bundle) usage("verify requires --bundle");
    result = await verifyBundle(resolve(options.bundle));
  } else if (command === "restore") {
    if (!options.bundle || !options.target) usage("restore requires --bundle and --target");
    result = await restoreBundle({
      bundlePath: resolve(options.bundle),
      targetRoot: resolve(options.target),
    });
  } else usage(`unknown continuity command: ${command}`);
} catch (error) {
  process.stderr.write(`${error.code ?? "continuity_failed"}: ${error.message}\n`);
  process.exit(1);
}

if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else if (command === "export") {
  process.stdout.write(`Continuity bundle exported and verified
Path: ${result.path}
Bundle: ${result.bundleId}
Files: ${result.fileCount}
Bytes: ${result.byteCount}
Projects: ${result.projectCount}
Manifest SHA-256: ${result.manifestSha256}
`);
} else if (command === "verify") {
  process.stdout.write(`Continuity bundle verified
Path: ${result.path}
Bundle: ${result.bundleId}
Files: ${result.fileCount}
Bytes: ${result.byteCount}
Projects: ${result.projectCount}
Manifest SHA-256: ${result.manifestSha256}
`);
} else {
  process.stdout.write(`Continuity bundle restored
Target: ${result.targetRoot}
Bundle: ${result.bundleId}
Projects: ${result.projectCount}
Audit digests preserved: ${result.auditDigestsPreserved}
Ephemeral authority revoked: ${result.ephemeralAuthorityRevoked}
`);
}
