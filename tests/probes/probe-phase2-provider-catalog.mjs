import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DirectControlPlane } from "../../src/server/control-plane.mjs";
import { PinkGuyClient } from "../../src/client/pink-client.mjs";
import {
  parsePiModelList,
  PiProviderCatalog,
} from "../../src/server/provider-catalog.mjs";

const fixture = process.argv[2];
if (!fixture?.startsWith("/")) {
  throw new Error("usage: probe-phase2-provider-catalog.mjs /absolute/git-fixture");
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pink-provider-catalog-"));
const authPath = join(temporaryRoot, "pi-agent", "auth.json");
const canary = "PINK_PROVIDER_SECRET_CANARY";
await mkdir(dirname(authPath), { recursive: true });
await writeFile(authPath, JSON.stringify({
  "openai-codex": { type: "oauth", access: canary },
  anthropic: { type: "api_key", key: canary },
}));

const firstTable = `provider      model         context  max-out  thinking  images
anthropic     claude-sonnet  200K     64K      yes       yes
openai-codex  gpt-5.4-mini  272K     128K     yes       yes
`;
const secondTable = `${firstTable}openai-codex  gpt-5.5       272K     128K     yes       yes
`;

assert.equal(parsePiModelList("No models configured.").length, 0);
assert.deepEqual(parsePiModelList(firstTable)[0], {
  provider: "anthropic",
  id: "claude-sonnet",
  context_window: "200K",
  max_output: "64K",
  supports_thinking: true,
  supports_images: true,
});

let listCalls = 0;
const catalog = new PiProviderCatalog({
  credentialSource: authPath,
  now: () => new Date("2026-07-19T20:00:00.000Z"),
  execute: async (_command, args, options) => {
    assert.equal(options.env.PI_CODING_AGENT_DIR, dirname(authPath));
    if (args[0] === "--version") return { stdout: "0.80.9\n", stderr: "" };
    listCalls += 1;
    return { stdout: listCalls === 1 ? firstTable : secondTable, stderr: "" };
  },
});

const discovered = await catalog.discover();
assert.equal(discovered.status, "available");
assert.equal(discovered.models.length, 2);
assert.equal(discovered.providers.length, 2);
assert.equal(discovered.authenticated_providers[0].provider, "anthropic");
assert.equal(discovered.authenticated_providers[0].auth_type, "api_key");
assert.equal(discovered.authentication.accepts_browser_secrets, false);
assert.match(discovered.authentication.command, /PI_CODING_AGENT_DIR=/);
assert(!JSON.stringify(discovered).includes(canary), "provider catalog exposed credential material");

const cached = await catalog.discover();
assert.equal(cached.cache, "hit");
assert.equal(listCalls, 1, "cached discovery executed Pi again");
const refreshed = await catalog.discover({ refresh: true });
assert.equal(refreshed.models.length, 3);
assert.equal(listCalls, 2, "explicit refresh did not execute Pi");
const concurrent = await Promise.all([
  catalog.discover({ refresh: true }),
  catalog.discover({ refresh: true }),
]);
assert.equal(concurrent[1].cache, "shared");
assert.equal(listCalls, 3, "concurrent discovery was not coalesced");

const unavailable = await new PiProviderCatalog({
  credentialSource: authPath,
  now: () => new Date("2026-07-19T20:01:00.000Z"),
  execute: async () => {
    throw Object.assign(new Error(`missing ${canary}`), { code: "ENOENT" });
  },
}).discover();
assert.equal(unavailable.status, "unavailable");
assert.equal(unavailable.error.code, "pi_not_found");
assert(!JSON.stringify(unavailable).includes(canary), "discovery error exposed command detail");
const malformed = await new PiProviderCatalog({
  credentialSource: authPath,
  now: () => new Date("2026-07-19T20:02:00.000Z"),
  execute: async (_command, args) => args[0] === "--version"
    ? { stdout: "0.80.9\n", stderr: "" }
    : { stdout: "diagnostic output with no model table\n", stderr: "" },
}).discover();
assert.equal(malformed.status, "unavailable");
assert.equal(malformed.error.code, "catalog_format_changed");

const apiRefreshCalls = [];
const providerCatalog = {
  async discover({ refresh = false } = {}) {
    apiRefreshCalls.push(refresh);
    return refresh ? refreshed : discovered;
  },
};
const authority = new DirectControlPlane({
  databasePath: join(temporaryRoot, "pink.sqlite"),
  stateRoot: join(temporaryRoot, "state"),
  fixturePath: fixture,
  providerCatalog,
});
authority.seed({
  projectId: "provider-project",
  repositoryId: "provider-repository",
  projectName: "provider fixture",
  taskId: "provider-task",
  repositoryPath: fixture,
  title: "Verify provider catalog",
  acceptanceCriteria: ["Catalog is selectable without exposing secrets."],
});
const address = await authority.listen();
const base = `http://127.0.0.1:${address.port}`;

const apiCatalog = await fetch(`${base}/api/provider-catalog`).then((response) => response.json());
assert.equal(apiCatalog.models.length, 2);
assert.equal(apiCatalog.configured_routes.default.provider, "boss-man-phase0");
await fetch(`${base}/api/provider-catalog?refresh=true`);
assert.deepEqual(apiRefreshCalls, [false, false], "GET query bypassed the provider cache");
const refreshedApi = await fetch(`${base}/api/provider-catalog/refresh`, {
  method: "POST",
}).then((response) => response.json());
assert.equal(refreshedApi.models.length, 3);
assert.equal(apiRefreshCalls.at(-1), true);
const clientCatalog = await new PinkGuyClient({ api: base }).providerCatalog();
assert.equal(clientCatalog.models.length, 2);

const cockpit = await readFile(join(repositoryRoot, "src/ui/cockpit.html"), "utf8");
assert.match(cockpit, /<select id="model-provider"/);
assert.match(cockpit, /<select id="model-id"/);
assert.match(cockpit, /id=\\"schedule-model-provider\\"/);
assert.match(cockpit, /id=\\"schedule-model-id\\"/);
assert.doesNotMatch(cockpit, /<input id="model-provider"/);
assert.doesNotMatch(cockpit, /<input id="model-id"/);
assert.match(cockpit, /Add a subscription or API-key provider through Pi on this host/);
assert.match(cockpit, /Pink Guy never receives the secret/);
assert.match(cockpit, /\/api\/provider-catalog\/refresh/);
const refreshHandler = cockpit.slice(
  cockpit.indexOf('document.querySelector("#refresh-provider-catalog")'),
  cockpit.indexOf('document.querySelector("#create-task")'),
);
assert.doesNotMatch(refreshHandler, /renderTaskDetail\(\)/);

await authority.close();
await rm(temporaryRoot, { recursive: true, force: true });

process.stdout.write(`${JSON.stringify({
  phase: "P2-4-provider-catalog",
  models_discovered: discovered.models.length,
  providers_discovered: discovered.providers.length,
  refresh_models_discovered: refreshed.models.length,
  credential_values_exposed: false,
  browser_secret_input: false,
  provider_requests: 0,
}, null, 2)}\n`);
