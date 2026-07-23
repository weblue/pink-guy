import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function canonicalSha256(value) {
  return sha256(JSON.stringify(value));
}

export function assertStatePath(stateRoot, path) {
  const root = resolve(stateRoot);
  const target = resolve(path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw Object.assign(new Error(`destructive path is outside the Pink Guy state root: ${target}`), {
      code: "unsafe_path",
    });
  }
  return target;
}

const GENERATED_DEPENDENCY_DIRECTORIES = new Set(["node_modules", ".pnpm", ".yarn"]);

function isGeneratedDependencyPath(root, path) {
  return relative(root, path).split(sep).some((segment) =>
    GENERATED_DEPENDENCY_DIRECTORIES.has(segment)
  );
}

async function walk(root, path, files, generatedSymlinks) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    if (isGeneratedDependencyPath(root, path)) {
      generatedSymlinks.push(relative(root, path));
      return;
    }
    throw Object.assign(new Error(`state inventory refuses symbolic link: ${path}`), {
      code: "unsafe_symlink",
    });
  }
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) {
      await walk(root, join(path, entry), files, generatedSymlinks);
    }
    return;
  }
  if (!info.isFile()) return;
  files.push({
    path,
    relativePath: relative(root, path),
    size: Number(info.size),
  });
}

export async function inventoryStateRoot({
  stateRoot,
  warningBytes = null,
  hardBytes = null,
}) {
  const root = resolve(stateRoot);
  const files = [];
  const generatedSymlinks = [];
  if (await exists(root)) await walk(root, root, files, generatedSymlinks);
  const categoryNames = new Map([
    ["repositories", "repositories"],
    ["workspaces", "workspaces"],
    ["runs", "runs"],
    ["orchestrator-sessions", "orchestrator_sessions"],
    ["context", "custody"],
    ["conversation-custody", "custody"],
    ["project-trash", "trash"],
    ["retention-manifests", "retention_manifests"],
  ]);
  const categories = {};
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    const top = file.relativePath.split(sep)[0];
    const category = categoryNames.get(top) ?? "other";
    categories[category] = (categories[category] ?? 0) + file.size;
  }
  const warning = Number.isFinite(warningBytes) && warningBytes > 0 ? warningBytes : null;
  const hard = Number.isFinite(hardBytes) && hardBytes > 0 ? hardBytes : null;
  return {
    root,
    totalBytes,
    fileCount: files.length,
    categories,
    limits: {
      warningBytes: warning,
      hardBytes: hard,
    },
    warning: Boolean(warning && totalBytes >= warning),
    hardBlocked: Boolean(hard && totalBytes >= hard),
    skippedGeneratedSymlinkCount: generatedSymlinks.length,
    skippedGeneratedSymlinks: generatedSymlinks.slice(0, 100),
    generatedAt: new Date().toISOString(),
  };
}

export function sessionDeletionPaths(stateRoot, projection) {
  const paths = new Set();
  if (projection.session.native_path) {
    paths.add(assertStatePath(stateRoot, projection.session.native_path));
  }
  for (const run of projection.runs) {
    paths.add(assertStatePath(stateRoot, join(stateRoot, "runs", run.id)));
  }
  for (const artifact of projection.artifacts) {
    paths.add(assertStatePath(stateRoot, artifact.path));
  }
  return [...paths].sort();
}

async function manifestEntries(root, target, entries) {
  if (!(await exists(target))) return;
  const info = await lstat(target);
  if (info.isSymbolicLink()) {
    throw Object.assign(new Error(`session deletion refuses symbolic link: ${target}`), {
      code: "unsafe_symlink",
    });
  }
  if (info.isDirectory()) {
    for (const entry of await readdir(target)) {
      await manifestEntries(root, join(target, entry), entries);
    }
    return;
  }
  if (!info.isFile()) return;
  const content = await readFile(target);
  entries.push({
    path: target,
    relativePath: relative(root, target),
    size: Number(info.size),
    sha256: sha256(content),
  });
}

export async function writeSessionDeletionManifest({
  stateRoot,
  receiptId,
  sessionId,
  paths,
  reason,
}) {
  const root = resolve(stateRoot);
  const entries = [];
  for (const path of paths) {
    await manifestEntries(root, assertStatePath(root, path), entries);
  }
  const uniqueEntries = [...new Map(entries.map((entry) => [entry.path, entry])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: "pink-guy-session-deletion-v1",
    receiptId,
    sessionId,
    reason,
    paths,
    entries: uniqueEntries,
    totalBytes: uniqueEntries.reduce((total, entry) => total + entry.size, 0),
    createdAt: new Date().toISOString(),
  };
  const manifestPath = assertStatePath(
    root,
    join(root, "retention-manifests", `${receiptId}.json`),
  );
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  await writeFile(manifestPath, `${JSON.stringify({
    ...manifest,
    manifestSha256: canonicalSha256(manifest),
  }, null, 2)}\n`, { mode: 0o600 });
  return { manifestPath, manifest };
}

export async function deleteDeclaredPaths(stateRoot, paths) {
  const results = [];
  for (const rawPath of paths) {
    const path = assertStatePath(stateRoot, rawPath);
    try {
      if (await exists(path)) {
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
          throw Object.assign(new Error(`session deletion refuses symbolic link: ${path}`), {
            code: "unsafe_symlink",
          });
        }
        await rm(path, { recursive: true, force: true });
      }
      results.push({ path, state: "removed" });
    } catch (error) {
      results.push({
        path,
        state: "failed",
        error: { code: error.code ?? "cleanup_failed", message: error.message },
      });
    }
  }
  return {
    complete: results.every((result) => result.state === "removed"),
    results,
  };
}
