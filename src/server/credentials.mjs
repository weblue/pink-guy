import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function collectSecretStrings(value, output = new Set()) {
  if (typeof value === "string" && value.length >= 6) output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectSecretStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectSecretStrings(item, output));
  return [...output];
}

export class RunCredentialVault {
  constructor({ stateRoot, profile = null }) {
    this.stateRoot = stateRoot;
    this.profile = profile ?? { id: "none", authType: "none", billingMode: "unknown", sourcePath: null, maxConcurrentRuns: 1 };
    this.activeRuns = new Set();
  }

  async materialize(runId) {
    const limit = this.profile.maxConcurrentRuns ?? 1;
    if (this.activeRuns.size >= limit) {
      throw Object.assign(new Error(`credential profile ${this.profile.id} reached its concurrent run limit`), { code: "credential_profile_busy" });
    }
    this.activeRuns.add(runId);
    const directory = join(this.stateRoot, "credential-runs", runId);
    const destination = join(directory, "auth.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let sourceContent = Buffer.from("{}\n");
    try {
      if (this.profile.sourcePath) sourceContent = await readFile(this.profile.sourcePath);
      else await writeFile(destination, sourceContent, { mode: 0o444 });
      if (this.profile.sourcePath) await copyFile(this.profile.sourcePath, destination);
      await chmod(destination, 0o444);
    } catch (error) {
      this.activeRuns.delete(runId);
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(sourceContent.toString("utf8"));
    } catch {
      this.activeRuns.delete(runId);
      throw Object.assign(new Error("credential source must be valid Pi auth JSON"), { code: "invalid_credential_source" });
    }
    return {
      path: destination,
      profileId: this.profile.id,
      authType: this.profile.authType,
      billingMode: this.profile.billingMode,
      sourceSha256: sha256(sourceContent),
      redactionValues: collectSecretStrings(parsed),
    };
  }

  async verifySourceUnchanged(materialized) {
    if (!this.profile.sourcePath) return true;
    return sha256(await readFile(this.profile.sourcePath)) === materialized.sourceSha256;
  }

  async release(runId) {
    this.activeRuns.delete(runId);
    await rm(join(this.stateRoot, "credential-runs", runId), { recursive: true, force: true });
  }
}

export function redactValue(value, secrets) {
  if (typeof value === "string") {
    return secrets.reduce((result, secret) => result.replaceAll(secret, "<redacted:run-secret>"), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]));
  }
  return value;
}

export function redactionCount(value, secrets) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return secrets.reduce((count, secret) => count + serialized.split(secret).length - 1, 0);
}
