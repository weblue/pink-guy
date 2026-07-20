import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { stableJson } from "./memory-service.mjs";

const execFileAsync = promisify(execFile);
const FORMAT = "pink-guy-continuity-v1";
const DATABASE_PATH = "database/pink-guy.sqlite";
const AUDIT_TABLES = [
  "audit_events",
  "capability_actions",
  "command_reconciliations",
  "context_receipts",
  "conversation_events",
  "execution_action_receipts",
  "execution_events",
  "git_integration_actions",
  "memory_events",
  "orchestrator_command_events",
  "project_git_policy_events",
  "retention_hold_events",
  "side_effect_receipts",
  "task_events",
  "topic_events",
];
const PATH_COLUMNS = [
  ["artifacts", "id", "path", "artifacts"],
  ["conversation_custody_snapshots", "snapshot_id", "path", "conversation-custody"],
  ["conversation_runs", "id", "native_session_path", "conversation-runs"],
  ["orchestrator_conversations", "id", "native_session_path", "conversations"],
  ["session_deletion_receipts", "id", "manifest_path", "session-deletions"],
  ["sessions", "id", "native_path", "sessions"],
];
const FORBIDDEN_FILE = /^(?:auth\.json|credentials?(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|.*\.(?:pem|key|p12|pfx))$/i;

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quotedIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw codedError("continuity_schema_unsupported", `unsafe SQLite identifier: ${value}`);
  }
  return `"${value}"`;
}

function portable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item)]));
  }
  return value;
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

function assertAbsoluteNewPath(path, label) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw codedError("invalid_request", `${label} must be an absolute path`);
  }
  return resolve(path);
}

function assertProjectId(value) {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value)
    || value === "."
    || value === ".."
  ) {
    throw codedError("continuity_manifest_invalid", `unsafe project identity: ${value}`);
  }
  return value;
}

function isWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function git(repositoryPath, args, options = {}) {
  try {
    return await execFileAsync("git", ["-C", repositoryPath, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      ...options,
    });
  } catch (error) {
    throw codedError(
      "continuity_git_failed",
      `Git continuity operation failed for ${repositoryPath}: ${error.stderr ?? error.message}`,
    );
  }
}

async function verifyGitBundle(path) {
  const scratch = await mkdtemp(join(tmpdir(), "pink-guy-bundle-verify-"));
  try {
    await execFileAsync("git", ["init", "--bare", scratch], { encoding: "utf8" });
    await git(scratch, ["bundle", "verify", path]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function gitBundleRefs(path) {
  try {
    const { stdout } = await execFileAsync("git", ["bundle", "list-heads", path], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.split("\n").filter(Boolean).map((line) => {
      const match = /^([a-f0-9]+) (.+)$/.exec(line);
      if (!match) {
        throw codedError("continuity_git_failed", `malformed Git bundle ref: ${line}`);
      }
      return `${match[2]}\0${match[1]}`;
    }).filter((ref) => !ref.startsWith("HEAD\0")).sort();
  } catch (error) {
    if (error.code === "continuity_git_failed") throw error;
    throw codedError("continuity_git_failed", `cannot enumerate Git bundle refs: ${error.message}`);
  }
}

function databaseTables(database) {
  return database.prepare(`SELECT name FROM sqlite_schema
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(({ name }) => name);
}

function databaseEvidence(database) {
  const integrity = database.prepare("PRAGMA integrity_check").all().map(portable);
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all().map(portable);
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") {
    throw codedError("continuity_database_invalid", "SQLite integrity check failed", { integrity });
  }
  if (foreignKeys.length) {
    throw codedError("continuity_database_invalid", "SQLite foreign-key check failed", { foreignKeys });
  }
  const tableCounts = {};
  const auditDigests = {};
  for (const table of databaseTables(database)) {
    const quoted = quotedIdentifier(table);
    tableCounts[table] = Number(database.prepare(`SELECT COUNT(*) count FROM ${quoted}`).get().count);
    if (!AUDIT_TABLES.includes(table)) continue;
    const columns = database.prepare(`PRAGMA table_info(${quoted})`).all().map(({ name }) => name);
    const rows = database.prepare(`SELECT * FROM ${quoted}`).all().map(portable);
    rows.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
    auditDigests[table] = sha256(stableJson({ columns, rows }));
  }
  return {
    integrity: "ok",
    foreignKeyViolations: 0,
    tableCounts,
    auditDigests,
  };
}

async function databaseEvidenceFromFile(path) {
  const scratch = await mkdtemp(join(tmpdir(), "pink-guy-database-verify-"));
  const copy = join(scratch, "pink-guy.sqlite");
  try {
    await copyFile(path, copy);
    const database = new DatabaseSync(copy, { readOnly: true });
    try {
      database.exec("PRAGMA foreign_keys=ON");
      return databaseEvidence(database);
    } finally {
      database.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function continuityBlockers(store) {
  const database = store.database;
  const queries = [
    ["orchestrator_commands", "id", "state IN ('queued','claimed','running')"],
    ["command_executions", "id", "state IN ('starting','running','stopping')"],
    ["runs", "id", "state='running'"],
    ["conversation_turns", "id", "state IN ('queued','running')"],
    ["conversation_runs", "id", "state='running'"],
    ["credential_runs", "run_id", "verified_at IS NULL"],
  ];
  return queries.flatMap(([kind, identity, predicate]) => {
    const identities = database.prepare(
      `SELECT ${quotedIdentifier(identity)} id FROM ${quotedIdentifier(kind)}
       WHERE ${predicate} ORDER BY ${quotedIdentifier(identity)}`,
    ).all().map(({ id }) => id);
    return identities.length ? [{ kind, count: identities.length, identities }] : [];
  });
}

function assertAllowedFile(relativePath) {
  const parts = relativePath.split("/");
  const forbidden = parts.find((part) => FORBIDDEN_FILE.test(part));
  if (forbidden) {
    throw codedError(
      "continuity_forbidden_file",
      `credential-like file encountered in continuity allowlist: ${relativePath}`,
    );
  }
}

async function copyAllowedTree(source, destination, bundleRelative, files) {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) {
    throw codedError("continuity_symlink_denied", `symlink in continuity allowlist: ${source}`);
  }
  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(source)) {
      await copyAllowedTree(
        join(source, entry),
        join(destination, entry),
        `${bundleRelative}/${entry}`,
        files,
      );
    }
    return;
  }
  if (!sourceStat.isFile()) {
    throw codedError("continuity_file_type_denied", `unsupported file in continuity allowlist: ${source}`);
  }
  assertAllowedFile(bundleRelative);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  const content = await readFile(destination);
  files.push({ path: bundleRelative, size: content.byteLength, sha256: sha256(content) });
}

async function addStatePayload(stateRoot, pendingRoot, files) {
  const fixed = [
    "orchestrator-sessions",
    "context",
    "conversation-context",
    "retention-manifests",
  ];
  for (const name of fixed) {
    const source = join(stateRoot, name);
    if (await exists(source)) {
      await copyAllowedTree(source, join(pendingRoot, "state", name), `state/${name}`, files);
    }
  }
  const runsRoot = join(stateRoot, "runs");
  if (!(await exists(runsRoot))) return;
  const runEntries = await readdir(runsRoot, { withFileTypes: true });
  for (const run of runEntries) {
    if (run.isSymbolicLink() || !run.isDirectory()) {
      throw codedError("continuity_file_type_denied", `unsupported run entry: ${join(runsRoot, run.name)}`);
    }
    for (const name of ["sessions", "artifacts"]) {
      const source = join(runsRoot, run.name, name);
      if (await exists(source)) {
        await copyAllowedTree(
          source,
          join(pendingRoot, "state", "runs", run.name, name),
          `state/runs/${run.name}/${name}`,
          files,
        );
      }
    }
  }
}

async function addGitPayload(store, pendingRoot, files) {
  const projects = [];
  for (const project of store.projects()) {
    assertProjectId(project.id);
    const status = (await git(project.repository_path, ["status", "--porcelain"])).stdout;
    if (status.trim()) {
      throw codedError(
        "continuity_repository_dirty",
        `project repository must be clean before export: ${project.name}`,
        { projectId: project.id },
      );
    }
    const head = (await git(project.repository_path, ["rev-parse", "HEAD"])).stdout.trim();
    const relativePath = `git/${project.id}.bundle`;
    const destination = join(pendingRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await git(project.repository_path, ["bundle", "create", destination, "--all"]);
    await verifyGitBundle(destination);
    const refs = await gitBundleRefs(destination);
    await chmod(destination, 0o600);
    const content = await readFile(destination);
    files.push({ path: relativePath, size: content.byteLength, sha256: sha256(content) });
    projects.push({
      id: project.id,
      name: project.name,
      bundlePath: relativePath,
      head,
      refsSha256: sha256(refs.join("\n")),
      refCount: refs.length,
    });
  }
  return projects;
}

async function exactBundleFiles(root) {
  const files = [];
  async function walk(path, prefix = "") {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const itemPath = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        throw codedError("continuity_symlink_denied", `symlink in continuity bundle: ${relativePath}`);
      }
      if (entry.isDirectory()) await walk(itemPath, relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw codedError("continuity_file_type_denied", `unsupported bundle entry: ${relativePath}`);
    }
  }
  await walk(root);
  return files.sort();
}

async function writeManifest(pendingRoot, manifest, payloadFiles) {
  payloadFiles.sort((left, right) => left.path.localeCompare(right.path));
  manifest.files = payloadFiles;
  const manifestContent = `${stableJson(manifest, 2)}\n`;
  await writeFile(join(pendingRoot, "manifest.json"), manifestContent, { mode: 0o600 });
  const allChecksums = [
    ...payloadFiles.map((file) => `${file.sha256}  ${file.path}`),
    `${sha256(manifestContent)}  manifest.json`,
  ].sort();
  await writeFile(join(pendingRoot, "checksums.sha256"), `${allChecksums.join("\n")}\n`, { mode: 0o600 });
  return sha256(manifestContent);
}

function parseChecksumFile(value) {
  const entries = new Map();
  for (const line of value.trim().split("\n").filter(Boolean)) {
    const match = /^([a-f0-9]{64})  ([^\0\r\n]+)$/.exec(line);
    if (!match || entries.has(match[2])) {
      throw codedError("continuity_manifest_invalid", "checksums.sha256 is malformed");
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

export async function exportBundle({
  store,
  stateRoot,
  outputPath,
  platformRevision = null,
}) {
  const sourceRoot = resolve(stateRoot);
  const target = assertAbsoluteNewPath(outputPath, "continuity output");
  if (isWithin(sourceRoot, target)) {
    throw codedError("invalid_request", "continuity output must be outside the live state root");
  }
  if (await exists(target)) {
    throw codedError("continuity_target_exists", `continuity output already exists: ${target}`);
  }
  const blockers = continuityBlockers(store);
  if (blockers.length) {
    throw codedError("continuity_not_quiescent", "continuity export requires a quiescent control plane", {
      blockers,
    });
  }
  const containingProject = store.projects().find((project) =>
    isWithin(project.repository_path, target)
  );
  if (containingProject) {
    throw codedError(
      "invalid_request",
      `continuity output must be outside managed repositories: ${containingProject.name}`,
    );
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const pendingRoot = join(dirname(target), `.${basename(target)}.pending-${randomUUID()}`);
  const files = [];
  const exportedAt = new Date().toISOString();
  try {
    await mkdir(pendingRoot, { recursive: true, mode: 0o700 });
    const databaseDestination = join(pendingRoot, DATABASE_PATH);
    await mkdir(dirname(databaseDestination), { recursive: true, mode: 0o700 });
    await backup(store.database, databaseDestination);
    await chmod(databaseDestination, 0o600);
    const databaseContent = await readFile(databaseDestination);
    files.push({
      path: DATABASE_PATH,
      size: databaseContent.byteLength,
      sha256: sha256(databaseContent),
    });
    await addStatePayload(sourceRoot, pendingRoot, files);
    const projects = await addGitPayload(store, pendingRoot, files);
    const databaseSnapshot = await databaseEvidenceFromFile(databaseDestination);
    const manifest = {
      format: FORMAT,
      bundleId: randomUUID(),
      exportedAt,
      sourceStateRoot: sourceRoot,
      platformRevision,
      exclusions: [
        "credentials",
        "credential-runs",
        "orchestrator-config",
        "runs/*/home",
        "runs/*/pi-config",
        "workspaces",
        "project-trash",
        "containers",
        "caches",
        "symlinks",
        "uncommitted Git content",
      ],
      quiescence: {
        checkedAt: exportedAt,
        blockers: [],
      },
      database: {
        path: DATABASE_PATH,
        ...databaseSnapshot,
      },
      projects,
      files: [],
    };
    const manifestSha256 = await writeManifest(pendingRoot, manifest, files);
    await rename(pendingRoot, target);
    const receipt = await verifyBundle(target);
    return {
      bundleId: manifest.bundleId,
      path: target,
      manifestSha256,
      fileCount: files.length,
      byteCount: files.reduce((sum, file) => sum + file.size, 0),
      projectCount: projects.length,
      verified: receipt.verified,
    };
  } catch (error) {
    await rm(pendingRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBundle(bundlePath) {
  const root = resolve(bundlePath);
  const rootStat = await lstat(root).catch((error) => {
    if (error.code === "ENOENT") throw codedError("not_found", `continuity bundle not found: ${root}`);
    throw error;
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw codedError("continuity_manifest_invalid", "continuity bundle must be a real directory");
  }
  const manifestContent = await readFile(join(root, "manifest.json"), "utf8");
  let manifest;
  try {
    manifest = JSON.parse(manifestContent);
  } catch {
    throw codedError("continuity_manifest_invalid", "manifest.json is not valid JSON");
  }
  if (manifest.format !== FORMAT || !Array.isArray(manifest.files)) {
    throw codedError("continuity_format_unsupported", `unsupported continuity format: ${manifest.format}`);
  }
  if (
    manifest.database?.path !== DATABASE_PATH
    || !Array.isArray(manifest.projects)
    || typeof manifest.sourceStateRoot !== "string"
    || !isAbsolute(manifest.sourceStateRoot)
    || new Set(manifest.files.map(({ path }) => path)).size !== manifest.files.length
  ) {
    throw codedError("continuity_manifest_invalid", "continuity manifest structure is invalid");
  }
  const checksums = parseChecksumFile(await readFile(join(root, "checksums.sha256"), "utf8"));
  const declared = new Set(manifest.files.map(({ path }) => path));
  const expected = new Set([...declared, "manifest.json", "checksums.sha256"]);
  const observed = await exactBundleFiles(root);
  if (observed.length !== expected.size || observed.some((path) => !expected.has(path))) {
    const unexpected = observed.filter((path) => !expected.has(path));
    const missing = [...expected].filter((path) => !observed.includes(path));
    throw codedError(
      "continuity_file_set_mismatch",
      `bundle files do not exactly match the manifest (unexpected: ${unexpected.join(",") || "none"}; missing: ${missing.join(",") || "none"})`,
      {
      expected: [...expected].sort(),
      observed,
      },
    );
  }
  if (
    checksums.size !== declared.size + 1
    || checksums.get("manifest.json") !== sha256(manifestContent)
  ) {
    throw codedError("continuity_checksum_mismatch", "manifest checksum does not match");
  }
  let byteCount = 0;
  for (const declaredFile of manifest.files) {
    if (
      typeof declaredFile.path !== "string"
      || declaredFile.path.startsWith("/")
      || declaredFile.path.split("/").includes("..")
    ) {
      throw codedError("continuity_manifest_invalid", "manifest contains an unsafe file path");
    }
    const content = await readFile(join(root, declaredFile.path));
    byteCount += content.byteLength;
    if (
      content.byteLength !== declaredFile.size
      || sha256(content) !== declaredFile.sha256
      || checksums.get(declaredFile.path) !== declaredFile.sha256
    ) {
      throw codedError("continuity_checksum_mismatch", `checksum mismatch: ${declaredFile.path}`);
    }
  }
  const observedDatabase = await databaseEvidenceFromFile(join(root, manifest.database.path));
  if (stableJson(observedDatabase) !== stableJson({
    integrity: manifest.database.integrity,
    foreignKeyViolations: manifest.database.foreignKeyViolations,
    tableCounts: manifest.database.tableCounts,
    auditDigests: manifest.database.auditDigests,
  })) {
    throw codedError("continuity_database_mismatch", "database evidence does not match the manifest");
  }
  for (const project of manifest.projects) {
    assertProjectId(project.id);
    if (
      project.bundlePath !== `git/${project.id}.bundle`
      || !/^[a-f0-9]{40,64}$/.test(project.head)
      || !/^[a-f0-9]{64}$/.test(project.refsSha256)
      || !Number.isInteger(project.refCount)
      || project.refCount < 1
    ) {
      throw codedError("continuity_manifest_invalid", `project Git evidence is invalid: ${project.id}`);
    }
    if (!declared.has(project.bundlePath)) {
      throw codedError("continuity_manifest_invalid", `project Git bundle is undeclared: ${project.id}`);
    }
    const bundle = join(root, project.bundlePath);
    await verifyGitBundle(bundle);
    const refs = await gitBundleRefs(bundle);
    if (refs.length !== project.refCount || sha256(refs.join("\n")) !== project.refsSha256) {
      throw codedError("continuity_git_mismatch", `project Git refs do not match the manifest: ${project.id}`);
    }
  }
  return {
    verified: true,
    bundleId: manifest.bundleId,
    path: root,
    manifestSha256: sha256(manifestContent),
    fileCount: manifest.files.length,
    byteCount,
    projectCount: manifest.projects.length,
    manifest,
  };
}

function rewritePath(value, sourceRoot, targetRoot, includedFiles, unavailablePath) {
  if (!value) return value;
  if (isWithin(sourceRoot, value)) {
    const stateRelative = relative(sourceRoot, resolve(value)).split(sep).join("/");
    if (includedFiles.has(`state/${stateRelative}`)) {
      return join(targetRoot, stateRelative);
    }
  }
  return unavailablePath;
}

function rewriteDatabasePaths(database, manifest, targetRoot) {
  const sourceRoot = resolve(manifest.sourceStateRoot);
  const unavailableRoot = join(targetRoot, "unavailable");
  const includedFiles = new Set(manifest.files.map(({ path }) => path));
  const liveProjects = new Set(manifest.projects.map(({ id }) => id));
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const project of database.prepare("SELECT id FROM projects").all()) {
      database.prepare("UPDATE projects SET repository_path=? WHERE id=?").run(
        liveProjects.has(project.id)
          ? join(targetRoot, "repositories", project.id)
          : join(unavailableRoot, "projects", project.id),
        project.id,
      );
    }
    for (const [table, idColumn, pathColumn, kind] of PATH_COLUMNS) {
      const tableName = quotedIdentifier(table);
      const idName = quotedIdentifier(idColumn);
      const pathName = quotedIdentifier(pathColumn);
      const rows = database.prepare(
        `SELECT ${idName} id,${pathName} path FROM ${tableName} WHERE ${pathName} IS NOT NULL`,
      ).all();
      const update = database.prepare(`UPDATE ${tableName} SET ${pathName}=? WHERE ${idName}=?`);
      for (const row of rows) {
        update.run(
          rewritePath(
            row.path,
            sourceRoot,
            targetRoot,
            includedFiles,
            join(unavailableRoot, kind, row.id),
          ),
          row.id,
        );
      }
    }
    for (const row of database.prepare("SELECT id FROM project_deletion_receipts").all()) {
      database.prepare(`UPDATE project_deletion_receipts
        SET original_path=?,quarantine_path=? WHERE id=?`).run(
        join(unavailableRoot, "project-deletions", row.id, "original"),
        join(unavailableRoot, "project-deletions", row.id, "quarantine"),
        row.id,
      );
    }
    for (const row of database.prepare("SELECT id FROM workspaces").all()) {
      database.prepare("UPDATE workspaces SET repository_path=?,workspace_path=?,state='unavailable' WHERE id=?").run(
        join(unavailableRoot, "workspace-repositories", row.id),
        join(unavailableRoot, "workspaces", row.id),
        row.id,
      );
    }
    const now = new Date().toISOString();
    database.prepare("UPDATE capabilities SET revoked_at=COALESCE(revoked_at,?)").run(now);
    database.prepare("UPDATE orchestration_leases SET status='released',updated_at=? WHERE status='active'").run(now);
    database.prepare("UPDATE project_orchestrators SET status='released',updated_at=? WHERE status='active'").run(now);
    database.exec("DELETE FROM runtime_flags");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function copyRestoredState(bundleRoot, pendingRoot) {
  const source = join(bundleRoot, "state");
  if (await exists(source)) {
    await copyAllowedTree(source, pendingRoot, "restored-state", []);
  }
}

async function auditSourcePrefix(database, sourceRoot) {
  const findings = [];
  for (const [table, idColumn, pathColumn] of PATH_COLUMNS) {
    const rows = database.prepare(
      `SELECT ${quotedIdentifier(idColumn)} id,${quotedIdentifier(pathColumn)} path
       FROM ${quotedIdentifier(table)} WHERE ${quotedIdentifier(pathColumn)} IS NOT NULL`,
    ).all();
    for (const row of rows) {
      if (String(row.path).includes(sourceRoot)) findings.push({ table, id: row.id });
    }
  }
  for (const column of ["repository_path"]) {
    for (const row of database.prepare(`SELECT id,${quotedIdentifier(column)} path FROM projects`).all()) {
      if (String(row.path).includes(sourceRoot)) findings.push({ table: "projects", id: row.id });
    }
  }
  for (const column of ["repository_path", "workspace_path"]) {
    for (const row of database.prepare(
      `SELECT id,${quotedIdentifier(column)} path FROM workspaces`,
    ).all()) {
      if (String(row.path).includes(sourceRoot)) findings.push({ table: "workspaces", id: row.id });
    }
  }
  for (const column of ["original_path", "quarantine_path"]) {
    for (const row of database.prepare(
      `SELECT id,${quotedIdentifier(column)} path FROM project_deletion_receipts`,
    ).all()) {
      if (String(row.path).includes(sourceRoot)) {
        findings.push({ table: "project_deletion_receipts", id: row.id });
      }
    }
  }
  return findings;
}

export async function restoreBundle({ bundlePath, targetRoot }) {
  const verification = await verifyBundle(bundlePath);
  const root = assertAbsoluteNewPath(targetRoot, "continuity restore target");
  if (root === resolve(verification.manifest.sourceStateRoot)) {
    throw codedError("invalid_request", "continuity restore cannot target the recorded source state root");
  }
  if (isWithin(verification.path, root)) {
    throw codedError("invalid_request", "continuity restore target must be outside the source bundle");
  }
  if (await exists(root)) {
    throw codedError("continuity_target_exists", `continuity restore target already exists: ${root}`);
  }
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const pendingRoot = join(dirname(root), `.${basename(root)}.pending-${randomUUID()}`);
  const manifest = verification.manifest;
  try {
    await mkdir(pendingRoot, { recursive: true, mode: 0o700 });
    await copyRestoredState(verification.path, pendingRoot);
    const databasePath = join(pendingRoot, "pink-guy.sqlite");
    await copyFile(join(verification.path, manifest.database.path), databasePath);
    await chmod(databasePath, 0o600);
    const repositoriesRoot = join(pendingRoot, "repositories");
    await mkdir(repositoriesRoot, { recursive: true, mode: 0o700 });
    for (const project of manifest.projects) {
      assertProjectId(project.id);
      const repository = join(repositoriesRoot, project.id);
      await execFileAsync(
        "git",
        ["clone", "--no-checkout", "--", join(verification.path, project.bundlePath), repository],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      );
      await git(repository, ["checkout", "--detach", project.head]);
      await git(repository, ["remote", "remove", "origin"]);
      const head = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
      if (head !== project.head) {
        throw codedError("continuity_restore_git_mismatch", `restored Git HEAD mismatch: ${project.id}`);
      }
    }
    const database = new DatabaseSync(databasePath);
    let restoredEvidence;
    let sourcePrefixFindings;
    try {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE");
      rewriteDatabasePaths(database, manifest, root);
      restoredEvidence = databaseEvidence(database);
      sourcePrefixFindings = await auditSourcePrefix(database, resolve(manifest.sourceStateRoot));
    } finally {
      database.close();
    }
    if (sourcePrefixFindings.length) {
      throw codedError(
        "continuity_restore_source_reference",
        "restored path authority still references the source state root",
        { findings: sourcePrefixFindings },
      );
    }
    if (stableJson(restoredEvidence.auditDigests) !== stableJson(manifest.database.auditDigests)) {
      throw codedError("continuity_restore_audit_mismatch", "restored audit history changed");
    }
    const unexpectedTableCounts = Object.entries(restoredEvidence.tableCounts).filter(
      ([table, count]) => count !== (
        table === "runtime_flags" ? 0 : manifest.database.tableCounts[table]
      ),
    );
    if (unexpectedTableCounts.length) {
      throw codedError(
        "continuity_restore_count_mismatch",
        "restored database row counts changed unexpectedly",
        { unexpectedTableCounts },
      );
    }
    const report = {
      format: FORMAT,
      bundleId: manifest.bundleId,
      restoredAt: new Date().toISOString(),
      sourceBundle: verification.path,
      targetRoot: root,
      copiedFileCount: verification.fileCount,
      copiedByteCount: verification.byteCount,
      projectCount: manifest.projects.length,
      projects: manifest.projects.map(({ id, head }) => ({ id, head })),
      pathRebase: {
        sourceStateRoot: manifest.sourceStateRoot,
        targetStateRoot: root,
        unavailableRoot: join(root, "unavailable"),
      },
      auditDigestsPreserved: true,
      tableCountsPreserved: true,
      ephemeralAuthorityRevoked: true,
      sourcePrefixFindings: [],
      database: restoredEvidence,
    };
    report.reportSha256 = sha256(stableJson(report));
    await writeFile(
      join(pendingRoot, "continuity-restore.json"),
      `${stableJson(report, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(pendingRoot, root);
    return report;
  } catch (error) {
    await rm(pendingRoot, { recursive: true, force: true });
    throw error;
  }
}
