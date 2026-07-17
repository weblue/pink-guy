import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { redactValue, redactionCount } from "./credentials.mjs";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function files(root) {
  try {
    const output = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) output.push(...await files(path));
      else if (entry.isFile()) output.push(path);
    }
    return output;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export class RtkArtifactIngestor {
  constructor({ store, sessionId, runId, artifactRoot, secrets = [] }) {
    this.store = store;
    this.sessionId = sessionId;
    this.runId = runId;
    this.artifactRoot = artifactRoot;
    this.secrets = secrets;
    this.ingested = new Set();
  }

  sanitize(value) {
    return redactValue(value, this.secrets);
  }

  async ingestCommand({ command, output, status, durationMs, filter = null }) {
    const id = randomUUID();
    const directory = join(this.artifactRoot, "rtk", id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const rawArtifacts = [];
    let replacements = redactionCount(command, this.secrets) + redactionCount(output, this.secrets);
    for (const source of (await files(join(this.artifactRoot, "rtk-tee")))
      .filter((path) => basename(path).startsWith("supervisor-") && path.endsWith(".log"))) {
      if (this.ingested.has(source)) continue;
      const raw = await readFile(source, "utf8");
      replacements += redactionCount(raw, this.secrets);
      const redacted = this.sanitize(raw);
      const destination = join(directory, `raw-${basename(source)}`);
      await writeFile(destination, redacted, { mode: 0o600 });
      const hash = sha256(redacted);
      rawArtifacts.push({ path: destination, sha256: hash });
      this.store.recordArtifact({ sessionId: this.sessionId, kind: "rtk_raw_redacted", path: destination, sha256: hash, metadata: { runId: this.runId } });
      this.ingested.add(source);
      await unlink(source);
    }
    const filtered = this.sanitize(output);
    const filteredPath = join(directory, "filtered.txt");
    await writeFile(filteredPath, filtered, { mode: 0o600 });
    this.store.recordArtifact({
      sessionId: this.sessionId, kind: "rtk_filtered", path: filteredPath, sha256: sha256(filtered),
      metadata: { runId: this.runId, status, durationMs, filter },
    });
    const receipt = {
      schema_version: "boss-man-rtk-receipt-v1", run_id: this.runId,
      command: this.sanitize(command), command_sha256: sha256(this.sanitize(command)),
      status, duration_ms: durationMs, filter, filtered_sha256: sha256(filtered), raw_artifacts: rawArtifacts,
      redaction_replacements: replacements,
    };
    const receiptContent = `${JSON.stringify(receipt, null, 2)}\n`;
    const receiptPath = join(directory, "receipt.json");
    await writeFile(receiptPath, receiptContent, { mode: 0o600 });
    this.store.recordArtifact({
      sessionId: this.sessionId, kind: "rtk_receipt", path: receiptPath, sha256: sha256(receiptContent),
      metadata: { runId: this.runId, rawArtifacts: rawArtifacts.length, replacements },
    });
    return { ...receipt, receipt_path: receiptPath, filtered_path: filteredPath };
  }

  async ingestPiArtifacts() {
    const receipts = [];
    const teeRoot = join(this.artifactRoot, "rtk-tee");
    const metadataFiles = (await files(teeRoot)).filter((path) => path.endsWith(".json") && basename(path).startsWith("pi-"));
    for (const metadataPath of metadataFiles) {
      if (this.ingested.has(metadataPath)) continue;
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      const sourcePath = (name) => {
        if (typeof name !== "string" || basename(name) !== name || !name.startsWith(`pi-${metadata.id}.`)) {
          throw Object.assign(new Error("RTK metadata contains an invalid source path"), { code: "invalid_rtk_receipt" });
        }
        return join(teeRoot, name);
      };
      const scriptSource = sourcePath(metadata.script_name);
      const rawSource = sourcePath(metadata.raw_name);
      const filteredSource = sourcePath(metadata.filtered_name);
      const [command, raw, filtered] = await Promise.all([
        readFile(scriptSource, "utf8"),
        readFile(rawSource, "utf8"),
        readFile(filteredSource, "utf8"),
      ]);
      if (sha256(command) !== metadata.command_sha256) {
        throw Object.assign(new Error("RTK command checksum does not match its receipt"), { code: "invalid_rtk_receipt" });
      }
      const directory = join(this.artifactRoot, "rtk", `pi-${metadata.id}`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const safeCommand = this.sanitize(command);
      const safeRaw = this.sanitize(raw);
      const safeFiltered = this.sanitize(filtered);
      const replacements = redactionCount(command, this.secrets)
        + redactionCount(raw, this.secrets) + redactionCount(filtered, this.secrets);
      const rawPath = join(directory, "raw.txt");
      const filteredPath = join(directory, "filtered.txt");
      await Promise.all([
        writeFile(rawPath, safeRaw, { mode: 0o600 }),
        writeFile(filteredPath, safeFiltered, { mode: 0o600 }),
      ]);
      this.store.recordArtifact({
        sessionId: this.sessionId, kind: "rtk_raw_redacted", path: rawPath, sha256: sha256(safeRaw),
        metadata: { runId: this.runId, source: "pi_bash_tool" },
      });
      this.store.recordArtifact({
        sessionId: this.sessionId, kind: "rtk_filtered", path: filteredPath, sha256: sha256(safeFiltered),
        metadata: { runId: this.runId, source: "pi_bash_tool", status: metadata.status, filter: metadata.filter },
      });
      const receipt = {
        schema_version: "boss-man-rtk-receipt-v1", run_id: this.runId, source: "pi_bash_tool",
        command: safeCommand, command_sha256: metadata.command_sha256,
        status: metadata.status, filter: metadata.filter,
        filtered_sha256: sha256(safeFiltered), raw_artifacts: [{ path: rawPath, sha256: sha256(safeRaw) }],
        redaction_replacements: replacements,
      };
      const receiptContent = `${JSON.stringify(receipt, null, 2)}\n`;
      const receiptPath = join(directory, "receipt.json");
      await writeFile(receiptPath, receiptContent, { mode: 0o600 });
      this.store.recordArtifact({
        sessionId: this.sessionId, kind: "rtk_receipt", path: receiptPath, sha256: sha256(receiptContent),
        metadata: { runId: this.runId, source: "pi_bash_tool", replacements },
      });
      for (const source of [scriptSource, rawSource, filteredSource, metadataPath]) {
        this.ingested.add(source);
        await unlink(source);
      }
      receipts.push({ ...receipt, receipt_path: receiptPath });
    }
    return receipts;
  }
}
