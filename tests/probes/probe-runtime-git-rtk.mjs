#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const fixture = process.argv[2];
const image = process.argv[3] ?? "boss-man:pi-0.80.9-rtk-0.42.3";
if (!fixture?.startsWith("/")) {
  console.error("usage: probe-runtime-git-rtk.mjs /absolute/path/to/generated/fixture [local-image]");
  process.exit(64);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolvePromise({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr });
    });
  });
}

async function listFiles(root) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return files;
}

async function contains(root, needle) {
  for (const path of await listFiles(root)) {
    if ((await readFile(path)).includes(Buffer.from(needle))) return true;
  }
  return false;
}

const root = await mkdtemp(join(tmpdir(), "boss-man-runtime-git-rtk-"));
const worktree = join(root, "worktree");
const artifacts = join(root, "artifacts");
const credentialRoot = join(root, "credentials");
const canonicalCredential = join(credentialRoot, "canonical", "auth.json");
const rtkHome = join(root, "rtk-home");
const rtkConfigDirectory = join(rtkHome, "Library", "Application Support", "rtk");
await Promise.all([artifacts, dirname(canonicalCredential), rtkConfigDirectory].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));

const fixtureBranch = `phase0/runtime-git-rtk-${process.pid}-${Date.now()}`;
const gitWorktree = await run("git", ["-C", fixture, "worktree", "add", "-b", fixtureBranch, worktree, "HEAD"]);
assert(gitWorktree.code === 0, `failed to create worktree: ${gitWorktree.stderr}`);
for (const path of await listFiles(worktree)) await chmod(path, 0o666);
for (const path of [worktree, join(worktree, "src"), join(worktree, "test"), artifacts]) await chmod(path, 0o777);

const imageInspect = await run("docker", ["image", "inspect", image, "--format", "{{.Id}} {{.Architecture}} {{.Os}}"]);
assert(imageInspect.code === 0, `sandbox image is unavailable: ${imageInspect.stderr}`);
const [imageId, imageArchitecture, imageOs] = imageInspect.stdout.trim().split(/\s+/);
assert(imageArchitecture === "arm64" && imageOs === "linux", "sandbox image is not ARM64 Linux");

const containerCommand = [
  "set -eu",
  "test \"$(id -u)\" = 65532",
  "test ! -S /var/run/docker.sock",
  "test ! -e /host-home",
  "test ! -e /root/.ssh/id_rsa",
  "test ! -e /root/.pi",
  "test \"$(pi --version)\" = 0.80.9",
  "test \"$(rtk --version)\" = 'rtk 0.42.3'",
  "printf '\\n// phase0 container edit\\n' >> /workspace/src/slugify.js",
  "if git -C /workspace add src/slugify.js >/tmp/git.out 2>&1; then exit 91; fi",
  "printf 'git-metadata-denied\\n' > /artifacts/git-boundary.txt",
  "printf 'container-policy-ok\\n'",
].join("; ");
const container = await run("docker", [
  "run", "--rm", "--entrypoint", "sh", "--user", "65532:65532", "--read-only",
  "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
  "--memory", "512m", "--cpus", "1.0", "--pids-limit", "128",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m", "--env", "HOME=/tmp/home",
  "--mount", `type=bind,src=${worktree},dst=/workspace`,
  "--mount", `type=bind,src=${artifacts},dst=/artifacts`,
  image, "-lc", containerCommand,
]);
assert(container.code === 0 && container.stdout.includes("container-policy-ok"), `container policy failed: ${container.stderr}`);
assert((await readFile(join(artifacts, "git-boundary.txt"), "utf8")).trim() === "git-metadata-denied", "container unexpectedly mutated Git metadata");

const changed = (await run("git", ["-C", worktree, "status", "--porcelain=v1"])).stdout.trim().split("\n").filter(Boolean);
assert(changed.length === 1 && changed[0].endsWith("src/slugify.js"), `container changed unexpected paths: ${changed}`);
assert((await run("git", ["-C", worktree, "add", "--", "src/slugify.js"])).code === 0, "host could not stage allowed path");
const checkpoint = await run("git", ["-C", worktree, "-c", "user.name=Boss Man Phase 0", "-c", "user.email=phase0@boss-man.invalid", "commit", "-m", "chore: phase0 host checkpoint", "-m", "Boss-Man-Task: phase0-runtime\nBoss-Man-Run: phase0-runtime-run\nBoss-Man-Evidence: P0-RUNTIME-GIT-RTK"]);
assert(checkpoint.code === 0, `host checkpoint failed: ${checkpoint.stderr}`);
const checkpointCommit = (await run("git", ["-C", worktree, "rev-parse", "HEAD"])).stdout.trim();
const checkpointBody = (await run("git", ["-C", worktree, "show", "-s", "--format=%B", "HEAD"])).stdout;
assert(checkpointBody.includes("Boss-Man-Evidence: P0-RUNTIME-GIT-RTK"), "checkpoint provenance trailer is missing");

const canonicalCanary = "BOSS-CANONICAL-AUTH-MUST-NOT-MOUNT";
await writeFile(canonicalCredential, `${JSON.stringify({ token: canonicalCanary })}\n`, { mode: 0o600 });
const canonicalBefore = sha256(await readFile(canonicalCredential));
const runCanaries = ["BOSS-RUN-A-CANARY", "BOSS-RUN-B-CANARY"];
const credentialRuns = await Promise.all(runCanaries.map(async (canary, index) => {
  const directory = join(credentialRoot, `run-${index + 1}`);
  const path = join(directory, "auth.json");
  await mkdir(directory, { recursive: true, mode: 0o755 });
  await writeFile(path, `${JSON.stringify({ token: canary })}\n`, { mode: 0o444 });
  const result = await run("docker", [
    "run", "--rm", "--entrypoint", "sh", "--user", "65532:65532", "--read-only",
    "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=8m", "--env", "HOME=/tmp/home",
    "--mount", `type=bind,src=${path},dst=/run/secrets/pi-auth.json,readonly`,
    image, "-lc", `cp /run/secrets/pi-auth.json /tmp/private-auth.json; printf '\\nrefreshed-${index + 1}\\n' >> /tmp/private-auth.json; printf 'credential-run-${index + 1}-ok\\n'`,
  ]);
  assert(result.code === 0 && result.stdout.includes(`credential-run-${index + 1}-ok`), `credential run ${index + 1} failed`);
  return result;
}));
assert(sha256(await readFile(canonicalCredential)) === canonicalBefore, "concurrent credential runs changed canonical auth state");
assert(!credentialRuns.some((result) => runCanaries.some((canary) => `${result.stdout}${result.stderr}`.includes(canary))), "credential canary leaked to captured process output");

await cp(join(repositoryRoot, "config/rtk-config.toml"), join(rtkConfigDirectory, "config.toml"));
const rtkEnvironment = {
  ...process.env,
  HOME: rtkHome,
  RTK_TELEMETRY_DISABLED: "1",
  RTK_TEE_DIR: join(rtkHome, "tee"),
  BOSS_RTK_CANARY: "BOSS-RTK-RAW-CANARY",
};
const rtkMakefile = join(root, "rtk-Makefile");
await writeFile(
  rtkMakefile,
  "all:\n\t@i=0; while [ $$i -lt 40 ]; do echo 'INFO ordinary output'; i=$$((i+1)); done; echo \"ERROR $$BOSS_RTK_CANARY\"; exit 1\n",
  { mode: 0o600 },
);
const rtkFiltered = await run("rtk", ["make", "-f", rtkMakefile], { cwd: worktree, env: rtkEnvironment });
assert(rtkFiltered.code !== 0, "RTK failure command unexpectedly passed");
const teeFiles = (await listFiles(rtkHome)).filter((path) => path.endsWith(".log"));
assert(teeFiles.length >= 1, "RTK tee.mode=always produced no raw output artifact");
const redactedDirectory = join(artifacts, "rtk");
await mkdir(redactedDirectory, { recursive: true, mode: 0o700 });
let redactionCount = 0;
const redactedRawPaths = [];
for (const teePath of teeFiles) {
  const raw = await readFile(teePath, "utf8");
  const matches = raw.split(rtkEnvironment.BOSS_RTK_CANARY).length - 1;
  redactionCount += matches;
  const redacted = raw.replaceAll(rtkEnvironment.BOSS_RTK_CANARY, "<redacted:synthetic-secret>");
  const destination = join(redactedDirectory, basename(teePath));
  await writeFile(destination, redacted, { mode: 0o600 });
  redactedRawPaths.push(destination);
  await rm(teePath);
}
const filteredCombined = `${rtkFiltered.stdout}${rtkFiltered.stderr}`;
redactionCount += filteredCombined.split(rtkEnvironment.BOSS_RTK_CANARY).length - 1;
const redactedFiltered = filteredCombined.replaceAll(rtkEnvironment.BOSS_RTK_CANARY, "<redacted:synthetic-secret>");
const filteredPath = join(redactedDirectory, "filtered.txt");
await writeFile(filteredPath, redactedFiltered, { mode: 0o600 });
const receipt = { class: "synthetic_secret", replacements: redactionCount, raw_artifacts: redactedRawPaths.length };
const receiptPath = join(redactedDirectory, "redaction-receipt.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
assert(redactionCount >= 1, "RTK redaction path did not encounter its synthetic canary");
assert(!(await contains(artifacts, rtkEnvironment.BOSS_RTK_CANARY)), "RTK canary persisted in durable artifacts");

const bypass = await run("rtk", ["proxy", "/usr/bin/printf", "proxy-bypass-ok"], { cwd: worktree, env: rtkEnvironment });
assert(bypass.code === 0 && bypass.stdout.includes("proxy-bypass-ok"), "RTK proxy bypass is unavailable");
const parseFailure = await run("rtk", ["rewrite", "printf hi > /tmp/unsupported-redirection"], { cwd: worktree, env: rtkEnvironment });
const failureReport = await run("rtk", ["gain", "--failures"], { cwd: worktree, env: rtkEnvironment });
const telemetry = await run("rtk", ["telemetry", "status"], { cwd: worktree, env: rtkEnvironment });
assert(telemetry.stdout.includes("enabled:       no") || telemetry.stdout.includes("enabled: no"), "RTK telemetry is not disabled");

for (const canary of [canonicalCanary, ...runCanaries, rtkEnvironment.BOSS_RTK_CANARY]) {
  assert(!(await contains(worktree, canary)), `secret canary persisted in worktree: ${canary}`);
  assert(!(await contains(artifacts, canary)), `secret canary persisted in artifacts: ${canary}`);
}

const redactedRawHashes = Object.fromEntries(await Promise.all(redactedRawPaths.map(async (path) => [basename(path), sha256(await readFile(path))])));
process.stdout.write(`${JSON.stringify({
  docker_image: image,
  docker_image_id: imageId,
  docker_architecture: imageArchitecture,
  container_non_root: true,
  container_read_only_root: true,
  container_network: "none",
  forbidden_mounts_absent: true,
  container_pi_version: "0.80.9",
  container_rtk_version: "0.42.3",
  workspace_edit_allowed: true,
  shared_git_metadata_denied: true,
  host_checkpoint_commit: checkpointCommit,
  checkpoint_provenance: true,
  concurrent_run_credentials: credentialRuns.length,
  canonical_credential_unchanged: true,
  credential_canary_violations: 0,
  rtk_version: (await run("rtk", ["--version"], { env: rtkEnvironment })).stdout.trim(),
  rtk_tee_mode: "always",
  rtk_raw_artifacts: redactedRawPaths.length,
  rtk_redaction_replacements: redactionCount,
  rtk_redacted_raw_sha256: redactedRawHashes,
  rtk_filtered_sha256: sha256(await readFile(filteredPath)),
  rtk_redaction_receipt_sha256: sha256(await readFile(receiptPath)),
  rtk_proxy_bypass_visible: true,
  rtk_unsupported_rewrite_exit_code: parseFailure.code,
  rtk_failure_report_available: failureReport.code === 0,
  rtk_telemetry_disabled: true,
  isolated_root: root,
}, null, 2)}\n`);
