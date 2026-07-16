import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path: string, content: Buffer | string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporary, path);
  await syncDirectory(dirname(path));
}

async function writeContentAddressed(
  path: string,
  content: Buffer | string,
  expectedSha256: string,
): Promise<void> {
  try {
    await access(path, constants.F_OK);
    const existing = await readFile(path);
    if (sha256(existing) !== expectedSha256) {
      throw new Error(`content-address collision for ${basename(path)}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await atomicWrite(path, content);
}

export default function custodyProbe(pi: ExtensionAPI): void {
  pi.on("before_provider_request", async () => {
    const outputDirectory = process.env.BOSS_MAN_PHASE0_EXPORT_DIR;
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      await atomicWrite(join(outputDirectory, "provider-request-observed"), "observed\n");
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const outputDirectory = process.env.BOSS_MAN_PHASE0_EXPORT_DIR;
    const sessionFile = ctx.sessionManager.getSessionFile();

    if (!outputDirectory || !sessionFile) {
      console.error("phase0 custody probe: export directory or persistent session is unavailable");
      return { cancel: true };
    }

    try {
      if (process.env.BOSS_MAN_PHASE0_FORCE_EXPORT_FAILURE === "1") {
        throw new Error("forced export failure");
      }

      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

      const nativeContent = await readFile(sessionFile);
      const nativeSha256 = sha256(nativeContent);
      const nativeName = `native-${nativeSha256}.jsonl`;

      const bundle: JsonValue = {
        schema_version: "phase0-0.1.0",
        exporter: "boss-man-phase0-custody-probe",
        source_session: {
          id: ctx.sessionManager.getSessionId(),
          file_name: basename(sessionFile),
          sha256: nativeSha256,
        },
        selected_branch: event.branchEntries as unknown as JsonValue,
        compaction: {
          first_kept_entry_id: event.preparation.firstKeptEntryId,
          tokens_before: event.preparation.tokensBefore,
          is_split_turn: event.preparation.isSplitTurn,
        },
      };
      const bundleContent = `${JSON.stringify(bundle, null, 2)}\n`;
      const bundleSha256 = sha256(bundleContent);
      const bundleName = `bundle-${bundleSha256}.json`;

      await writeContentAddressed(
        join(outputDirectory, nativeName),
        nativeContent,
        nativeSha256,
      );
      await writeContentAddressed(
        join(outputDirectory, bundleName),
        bundleContent,
        bundleSha256,
      );

      const leaf = ctx.sessionManager.getLeafId() ?? "root";
      const manifestName = `snapshot-${safeName(ctx.sessionManager.getSessionId())}-${safeName(leaf)}.json`;
      const manifest: JsonValue = {
        schema_version: "phase0-0.1.0",
        committed: true,
        native: { path: nativeName, sha256: nativeSha256 },
        bundle: { path: bundleName, sha256: bundleSha256 },
      };
      await atomicWrite(
        join(outputDirectory, manifestName),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      return {
        compaction: {
          summary:
            "Phase 0 deterministic compaction probe. Canonical pre-compaction evidence is referenced by the snapshot manifest.",
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details: { snapshotManifest: manifestName },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown export error";
      console.error(`phase0 custody probe: ${message}`);
      return { cancel: true };
    }
  });
}
