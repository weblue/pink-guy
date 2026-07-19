import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function clippedMessage(error) {
  const message = error?.code === "ENOENT"
    ? "Pi executable was not found on the Pink Guy host."
    : error?.killed || error?.signal === "SIGTERM"
      ? "Pi model discovery timed out."
      : "Pi could not list the configured models.";
  return {
    code: error?.code === "ENOENT"
      ? "pi_not_found"
      : error?.killed || error?.signal === "SIGTERM"
        ? "discovery_timeout"
        : "discovery_failed",
    message,
  };
}

export function parsePiModelList(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) =>
    /^provider\s{2,}model\s{2,}context\s{2,}max-out\s{2,}thinking\s{2,}images\s*$/.test(line)
  );
  if (headerIndex === -1) return [];
  const models = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const columns = line.trim().split(/\s{2,}/);
    if (columns.length !== 6) continue;
    const [provider, id, contextWindow, maxOutput, thinking, images] = columns;
    if (!provider || !id) continue;
    models.push({
      provider,
      id,
      context_window: contextWindow,
      max_output: maxOutput,
      supports_thinking: thinking === "yes",
      supports_images: images === "yes",
    });
  }
  return models;
}

async function credentialSummary(sourcePath) {
  if (!sourcePath) return { status: "not_configured", providers: [] };
  try {
    const parsed = JSON.parse(await readFile(sourcePath, "utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return { status: "invalid", providers: [] };
    }
    return {
      status: "configured",
      providers: Object.entries(parsed)
        .map(([provider, credential]) => ({
          provider,
          auth_type: typeof credential?.type === "string" ? credential.type : "unknown",
        }))
        .sort((left, right) => left.provider.localeCompare(right.provider)),
    };
  } catch (error) {
    return {
      status: error?.code === "ENOENT" ? "missing" : "invalid",
      providers: [],
    };
  }
}

export class PiProviderCatalog {
  constructor({
    piCommand = "pi",
    credentialSource = null,
    environment = process.env,
    timeoutMs = 15_000,
    cacheMs = 30_000,
    execute = execFileAsync,
    now = () => new Date(),
  } = {}) {
    this.piCommand = piCommand;
    this.credentialSource = credentialSource;
    this.environment = environment;
    this.timeoutMs = timeoutMs;
    this.cacheMs = cacheMs;
    this.execute = execute;
    this.now = now;
    this.cached = null;
    this.cachedAt = 0;
  }

  authenticationInstructions() {
    const customDirectory = this.credentialSource
      ? dirname(this.credentialSource)
      : null;
    const command = customDirectory
      ? `PI_CODING_AGENT_DIR=${shellQuote(customDirectory)} ${shellQuote(this.piCommand)}`
      : shellQuote(this.piCommand);
    return {
      mode: "host_tty",
      command,
      slash_command: "/login",
      steps: [
        "Open cmux, tmux, SSH, or another TTY on the Pink Guy host.",
        `Run ${command}.`,
        "Enter /login and select a subscription or API-key provider.",
        "Return to Pink Guy and refresh models.",
      ],
      accepts_browser_secrets: false,
      note: "Pink Guy never receives the API key or OAuth token; Pi stores it in the owner-managed auth file.",
    };
  }

  async discover({ refresh = false } = {}) {
    const now = this.now();
    const timestamp = now instanceof Date ? now.getTime() : Number(now);
    if (!refresh && this.cached && timestamp - this.cachedAt < this.cacheMs) {
      return { ...this.cached, cache: "hit" };
    }
    const credentials = await credentialSummary(this.credentialSource);
    const environment = {
      ...this.environment,
      ...(this.credentialSource ? { PI_CODING_AGENT_DIR: dirname(this.credentialSource) } : {}),
    };
    try {
      const [{ stdout }, versionResult] = await Promise.all([
        this.execute(this.piCommand, ["--list-models"], {
          env: environment,
          timeout: this.timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
        }),
        this.execute(this.piCommand, ["--version"], {
          env: environment,
          timeout: this.timeoutMs,
          maxBuffer: 64 * 1024,
        }).catch(() => ({ stdout: null })),
      ]);
      const models = parsePiModelList(stdout);
      const authenticated = new Map(
        credentials.providers.map((provider) => [provider.provider, provider.auth_type]),
      );
      const providers = [...new Set([
        ...models.map((model) => model.provider),
        ...credentials.providers.map((provider) => provider.provider),
      ])].sort().map((provider) => ({
        id: provider,
        auth_type: authenticated.get(provider) ?? "ambient_or_custom",
        model_count: models.filter((model) => model.provider === provider).length,
      }));
      const result = {
        schema_version: "1.0.0",
        status: models.length ? "available" : "empty",
        pi_version: String(versionResult.stdout ?? "").trim() || null,
        discovered_at: now.toISOString(),
        models,
        providers,
        credential_status: credentials.status,
        authenticated_providers: credentials.providers,
        authentication: this.authenticationInstructions(),
        error: null,
        cache: "miss",
      };
      this.cached = result;
      this.cachedAt = timestamp;
      return result;
    } catch (error) {
      const result = {
        schema_version: "1.0.0",
        status: "unavailable",
        pi_version: null,
        discovered_at: now.toISOString(),
        models: [],
        providers: credentials.providers.map((provider) => ({
          id: provider.provider,
          auth_type: provider.auth_type,
          model_count: 0,
        })),
        credential_status: credentials.status,
        authenticated_providers: credentials.providers,
        authentication: this.authenticationInstructions(),
        error: clippedMessage(error),
        cache: "miss",
      };
      this.cached = result;
      this.cachedAt = timestamp;
      return result;
    }
  }
}

