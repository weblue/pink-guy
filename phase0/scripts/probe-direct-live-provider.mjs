#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DirectControlPlane } from "../direct/control-plane.mjs";

const [fixture, credentialPath, provider = "openai-codex", model = "gpt-5.4-mini"] = process.argv.slice(2);
if (!fixture?.startsWith("/") || !credentialPath?.startsWith("/")) {
  console.error("usage: probe-direct-live-provider.mjs /absolute/generated-fixture /absolute/pi-auth.json [provider] [model]");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
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

const canonicalBefore = sha256(await readFile(credentialPath));
const root = await mkdtemp(join(tmpdir(), "boss-man-direct-live-provider-"));
const stateRoot = join(root, "runtime");
const authority = new DirectControlPlane({
  databasePath: join(root, "boss-man.sqlite"),
  stateRoot,
  fixturePath: fixture,
  runtimeProvider: provider,
  runtimeModel: model,
  runtimeOffline: false,
  credentialProfile: {
    id: "owner-live-smoke",
    authType: "oauth_snapshot",
    billingMode: "subscription",
    sourcePath: credentialPath,
    maxConcurrentRuns: 1,
  },
});

let sessionId = null;
let runId = null;
let sessionPath = null;
try {
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
    role: "worker", actorId: "live-provider-worker", taskId: "phase0-task", runId: "live-provider-claim",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  let response = await request("/api/tasks/phase0-task/actions/claim", {
    method: "POST", token: claimant.token, key: "live-provider-claim", body: { expectedVersion: 1, payload: {} },
  });
  assert(response.status === 201, "live-provider task claim failed");

  response = await request("/api/tasks/phase0-task/sessions", { method: "POST", body: {} });
  assert(response.status === 201, `live-provider session start failed: ${JSON.stringify(response.value)}`);
  sessionId = response.value.session.id;
  runId = response.value.run.id;
  sessionPath = response.value.session.native_path;
  const managed = authority.sessions.get(sessionId);
  const container = await managed.runtime.inspect();
  assert(container.running && container.id === response.value.run.container_id, "live-provider Pi is not in the recorded container");
  assert(!container.mounts.some((item) => item.destination === "/var/run/docker.sock"), "live-provider container received the Docker socket");

  const prompt = [
    "This is a bounded runtime smoke test.",
    "Use the bash tool exactly once to run: printf 'BOSS_MAN_PI_RTK_OK\\n'",
    "After the tool returns, reply with exactly: BOSS_MAN_LIVE_PROVIDER_OK",
    "Do not inspect files, environment variables, credentials, or network configuration.",
  ].join(" ");
  response = await request(`/api/sessions/${sessionId}/prompt`, { method: "POST", body: { message: prompt } });
  assert(response.status === 200, `live provider prompt failed: ${JSON.stringify(response.value)}`);

  const nativeSession = await readFile(sessionPath, "utf8");
  assert(nativeSession.includes("BOSS_MAN_LIVE_PROVIDER_OK"), "live provider completion marker is absent");
  assert(nativeSession.includes("BOSS_MAN_PI_RTK_OK"), "Pi Bash tool marker is absent");
  const artifacts = authority.store.artifacts(sessionId);
  const piRtkArtifacts = artifacts.filter((item) => JSON.parse(item.metadata_json).source === "pi_bash_tool");
  assert(piRtkArtifacts.some((item) => item.kind === "rtk_raw_redacted"), "Pi Bash raw RTK artifact is absent");
  assert(piRtkArtifacts.some((item) => item.kind === "rtk_filtered"), "Pi Bash filtered RTK artifact is absent");
  assert(piRtkArtifacts.some((item) => item.kind === "rtk_receipt"), "Pi Bash RTK receipt is absent");

  await authority.stopSession(sessionId);
  sessionId = null;
  assert(sha256(await readFile(credentialPath)) === canonicalBefore, "live smoke changed the owner credential source");
  assert(!(await exists(join(stateRoot, "credential-runs", runId))), "read-only run credential copy survived cleanup");
  assert(!(await exists(join(stateRoot, "runs", runId, "pi-config", "auth.json"))), "private Pi auth copy survived cleanup");
  const credentialReceipt = authority.store.credentialRun(runId);
  assert(credentialReceipt?.canonical_unchanged === true, "live credential verification receipt is missing");

  process.stdout.write(`${JSON.stringify({
    status: "pass",
    provider,
    model,
    live_provider_turn: true,
    pi_bash_tool_call: true,
    pi_rtk_raw_artifact: true,
    pi_rtk_filtered_artifact: true,
    pi_rtk_receipt: true,
    canonical_credential_unchanged: true,
    private_credential_copies_removed: true,
    docker_socket_absent: true,
    container_removed_after_stop: true,
    isolated_root: root,
  }, null, 2)}\n`);
} finally {
  if (sessionId) await authority.stopSession(sessionId).catch(() => undefined);
  await authority.close().catch(() => undefined);
}
