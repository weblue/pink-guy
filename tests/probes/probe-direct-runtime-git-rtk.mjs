#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-direct-runtime-git-rtk.mjs /absolute/path/to/generated/fixture");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function runHost(command, args) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolvePromise({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

async function files(root) {
  const output = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) output.push(child);
    }
  }
  await visit(root);
  return output;
}

async function contains(paths, needle) {
  for (const root of paths) {
    for (const path of await files(root)) {
      if ((await readFile(path)).includes(Buffer.from(needle))) return true;
    }
  }
  return false;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const root = await mkdtemp(join(tmpdir(), "boss-man-direct-runtime-git-rtk-"));
const credentialPath = join(root, "owner-managed", "auth.json");
await mkdir(dirname(credentialPath), { recursive: true, mode: 0o700 });
const credentialCanary = "BOSS-DIRECT-CREDENTIAL-CANARY";
const rtkCanary = "BOSS-DIRECT-RTK-CANARY";
await writeFile(credentialPath, `${JSON.stringify({ openai: { type: "oauth", refresh: credentialCanary } })}\n`, { mode: 0o600 });
const canonicalCredentialBefore = sha256(await readFile(credentialPath));

const databasePath = join(root, "boss-man.sqlite");
const stateRoot = join(root, "runtime");
const authority = new DirectControlPlane({
  databasePath,
  stateRoot,
  fixturePath: fixture,
  credentialProfile: {
    id: "synthetic-chatgpt",
    authType: "oauth_snapshot",
    billingMode: "subscription",
    sourcePath: credentialPath,
    maxConcurrentRuns: 1,
  },
});
authority.seed();
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

async function request(path, { method = "GET", token, key, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, value: await response.json() };
}

const claimant = authority.store.issueCapability({
  role: "worker", actorId: "runtime-worker", taskId: "phase0-task", runId: "claim-runtime",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
let response = await request("/api/tasks/phase0-task/actions/claim", {
  method: "POST", token: claimant.token, key: "runtime-claim", body: { expectedVersion: 1, payload: {} },
});
assert(response.status === 201, "runtime task claim failed");
response = await request("/api/tasks/phase0-task/sessions", { method: "POST", body: {} });
assert(response.status === 201, `containerized session start failed: ${JSON.stringify(response.value)}`);
const { session, run } = response.value;
const managed = authority.sessions.get(session.id);
const token = managed.capability.token;
let credentialConcurrencyRejected = false;
try {
  await authority.credentialVault.materialize("competing-run");
} catch (error) {
  credentialConcurrencyRejected = error.code === "credential_profile_busy";
}
assert(credentialConcurrencyRejected, "OAuth profile concurrency limit was not enforced");

const inspection = await managed.runtime.inspect();
assert(inspection.running && inspection.id === run.container_id, "recorded task container is not running");
assert(inspection.imageId === run.image_id, "recorded image identity differs from the live container");
for (const forbidden of ["/var/run/docker.sock", "/root", "/host-home"]) {
  assert(!inspection.mounts.some((item) => item.destination === forbidden), `forbidden mount is present: ${forbidden}`);
}
const readonlyExtensions = inspection.mounts.find((item) => item.destination === "/pink-guy/extensions");
const readonlyCredential = inspection.mounts.find((item) => item.destination === "/run/secrets/pi-auth.json");
assert(readonlyExtensions && !readonlyExtensions.readWrite, "Pi extension source is not mounted read-only");
assert(readonlyCredential && !readonlyCredential.readWrite, "credential source is not mounted read-only");

const editCommand = [
  "set -eu",
  "test ! -S /var/run/docker.sock",
  "test ! -e /root/.pi",
  "test ! -e /root/.ssh/id_rsa",
  `grep -q '${credentialCanary}' /config/auth.json`,
  "printf '\\nprivate-refresh-state\\n' >> /config/auth.json",
  "printf '\\n// direct daemon container edit\\n' >> src/slugify.js",
  "if git status >/tmp/git-status.out 2>&1; then exit 91; fi",
  "printf 'container-edit-ok\\n'",
].join("; ");
response = await request(`/api/sessions/${session.id}/shell`, { method: "POST", body: { command: editCommand } });
assert(response.status === 200 && response.value.status === 0, `container edit failed: ${JSON.stringify(response.value)}`);
assert(!JSON.stringify(response.value).includes(credentialCanary), "credential leaked in shell response");

response = await request("/api/tasks/phase0-task/git/status", { token });
assert(response.status === 200 && response.value.dirty && response.value.output.includes("src/slugify.js"), "host Git status missed the agent edit");
response = await request("/api/tasks/phase0-task/git/diff", { token });
assert(response.status === 200 && response.value.diff.includes("direct daemon container edit"), "host Git diff missed the agent edit");

const checkpointBody = { message: "chore: direct daemon checkpoint", evidence: ["P0-DIRECT-RUNTIME-GIT-RTK"] };
response = await request("/api/tasks/phase0-task/git/checkpoint", {
  method: "POST", token, key: "direct-runtime-checkpoint", body: checkpointBody,
});
assert(response.status === 201 && !response.value.replayed, "host checkpoint was not committed");
const checkpointRevision = response.value.operation.new_revision;
const replay = await request("/api/tasks/phase0-task/git/checkpoint", {
  method: "POST", token, key: "direct-runtime-checkpoint", body: checkpointBody,
});
assert(replay.status === 200 && replay.value.replayed && replay.value.operation.new_revision === checkpointRevision, "Git checkpoint replay was not idempotent");
const commitBody = (await runHost("git", ["-C", managed.workspace.workspace_path, "show", "-s", "--format=%B", checkpointRevision])).stdout;
assert(commitBody.includes(`Pink-Guy-Run: ${run.id}`) && commitBody.includes("Pink-Guy-Evidence: P0-DIRECT-RUNTIME-GIT-RTK"), "checkpoint provenance is incomplete");

const rtkCommand = `printf 'all:\\n\\t@echo INFO ordinary-output; echo ERROR ${rtkCanary}; exit 1\\n' > /tmp/BossMakefile; make -f /tmp/BossMakefile`;
managed.credential.redactionValues.push(rtkCanary);
response = await request(`/api/sessions/${session.id}/shell`, { method: "POST", body: { command: rtkCommand, rtkFilter: "log" } });
assert(response.status === 200 && response.value.status !== 0, `RTK failure command unexpectedly passed or ingestion failed: ${JSON.stringify(response.value)}`);
assert(!JSON.stringify(response.value).includes(rtkCanary), "RTK canary leaked in filtered response or receipt");
assert(response.value.rtkReceipt.raw_artifacts.length >= 1, "RTK produced no retained redacted raw artifact");
assert(response.value.rtkReceipt.redaction_replacements >= 1, "RTK secret redaction was not recorded");

await authority.stopSession(session.id);
assert(sha256(await readFile(credentialPath)) === canonicalCredentialBefore, "private run auth mutation changed the canonical credential source");
assert(!(await exists(join(stateRoot, "credential-runs", run.id))), "daemon credential materialization survived run cleanup");
assert(!(await exists(join(stateRoot, "runs", run.id, "pi-config", "auth.json"))), "private Pi auth copy survived run cleanup");
const credentialReceipt = authority.store.credentialRun(run.id);
assert(credentialReceipt.canonical_unchanged === true, "credential source verification receipt is missing");
const artifacts = authority.store.artifacts(session.id);
assert(artifacts.some((item) => item.kind === "rtk_raw_redacted"), "redacted RTK raw artifact was not indexed");
assert(artifacts.some((item) => item.kind === "rtk_filtered"), "RTK filtered artifact was not indexed");
assert(artifacts.some((item) => item.kind === "rtk_receipt"), "RTK receipt was not indexed");
assert(!(await contains([managed.artifactDirectory, managed.workspace.workspace_path], credentialCanary)), "credential canary persisted outside the authorized private auth copy");
assert(!(await contains([managed.artifactDirectory, managed.workspace.workspace_path], rtkCanary)), "RTK canary persisted in durable artifacts or workspace");

const remainingContainer = await runHost("docker", ["ps", "-aq", "--filter", `label=pink-guy.run=${run.id}`]);
assert(!remainingContainer.stdout.trim(), "task container was not removed after the run stopped");

process.stdout.write(`${JSON.stringify({
  status: "pass",
  image_id: run.image_id,
  container_id_recorded: true,
  container_removed_after_stop: true,
  docker_socket_absent: true,
  private_pi_home: true,
  readonly_credential_source: true,
  canonical_credential_unchanged: true,
  private_credential_copies_removed: true,
  credential_concurrency_rejected: credentialConcurrencyRejected,
  credential_canary_violations: 0,
  shared_git_metadata_denied: true,
  host_checkpoint_revision: checkpointRevision,
  host_checkpoint_idempotent: true,
  checkpoint_provenance: true,
  rtk_raw_artifacts: response.value.rtkReceipt.raw_artifacts.length,
  rtk_redaction_replacements: response.value.rtkReceipt.redaction_replacements,
  rtk_canary_violations: 0,
  artifact_receipts: artifacts.length,
  isolated_root: root,
}, null, 2)}\n`);

await authority.close();
