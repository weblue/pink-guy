const CURRENT_VM_FIELDS = new Set([
  "pages_free",
  "pages_active",
  "pages_inactive",
  "pages_speculative",
  "pages_throttled",
  "pages_wired_down",
  "pages_purgeable",
  "file-backed_pages",
  "anonymous_pages",
  "pages_stored_in_compressor",
  "pages_occupied_by_compressor",
]);

export function byteValue(value) {
  const match = String(value).trim().match(/^([\d.]+)\s*([kmgt](?:i?b)?|b)?$/i);
  if (!match) return null;
  const units = {
    b: 1,
    k: 1024,
    kb: 1e3,
    kib: 1024,
    m: 1024 ** 2,
    mb: 1e6,
    mib: 1024 ** 2,
    g: 1024 ** 3,
    gb: 1e9,
    gib: 1024 ** 3,
    t: 1024 ** 4,
    tb: 1e12,
    tib: 1024 ** 4,
  };
  return Math.round(Number(match[1]) * units[(match[2] || "b").toLowerCase()]);
}

export function vmBytes(text) {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
  const values = {};
  for (const match of text.matchAll(/^([^:]+):\s+(\d+)\./gm)) {
    const field = match[1].trim().toLowerCase().replaceAll(" ", "_");
    if (CURRENT_VM_FIELDS.has(field)) values[field] = Number(match[2]) * pageSize;
  }
  return values;
}

export function processCategory(executable) {
  const value = executable.toLowerCase();
  if (value.includes("codex")) return "codex";
  if (value.endsWith("/pi") || value === "pi") return "pi";
  if (value.includes("docker")) return "docker";
  if (value.endsWith("/node") || value === "node") return "node";
  return null;
}

export function processTotals(processes) {
  const totals = {};
  for (const process of processes) {
    totals[process.category] ??= { count: 0, cpu_percent: 0, rss_bytes: 0 };
    totals[process.category].count += 1;
    totals[process.category].cpu_percent += process.cpu_percent;
    totals[process.category].rss_bytes += process.rss_bytes;
  }
  return totals;
}

function maximum(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.max(...usable) : null;
}

function minimum(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.min(...usable) : null;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null;
}

export function summarizeCalibration(samples, { stateRoot = false } = {}) {
  const categories = new Set(samples.flatMap((sample) => Object.keys(sample.process_totals)));
  const peakProcessRssByCategory = {};
  const peakProcessCpuByCategory = {};
  for (const category of categories) {
    peakProcessRssByCategory[category] = maximum(
      samples.map((sample) => sample.process_totals[category]?.rss_bytes),
    );
    peakProcessCpuByCategory[category] = maximum(
      samples.map((sample) => sample.process_totals[category]?.cpu_percent),
    );
  }
  const allContainers = samples.flatMap((sample) => sample.docker.containers);
  return {
    sample_count: samples.length,
    minimum_free_memory_bytes: Math.min(...samples.map((sample) => sample.host.free_memory_bytes)),
    average_free_memory_bytes: average(samples.map((sample) => sample.host.free_memory_bytes)),
    minimum_memory_pressure_free_percent: minimum(
      samples.map((sample) => sample.host.memory_pressure_free_percent),
    ),
    peak_swap_used_bytes: maximum(samples.map((sample) => sample.host.swap_used_bytes)),
    peak_process_rss_by_category: peakProcessRssByCategory,
    peak_process_cpu_percent_by_category: peakProcessCpuByCategory,
    peak_container_memory_bytes: maximum(allContainers.map((container) => container.memory_bytes)),
    peak_container_cpu_percent: maximum(allContainers.map((container) => container.cpu_percent)),
    peak_pink_container_count: maximum(samples.map((sample) => sample.docker.pink_container_ids.length)),
    state_root_growth_bytes: stateRoot
      ? samples.at(-1).state_root_bytes - samples[0].state_root_bytes
      : null,
    sample_error_count: samples.reduce((count, sample) => count + sample.errors.length, 0),
  };
}
