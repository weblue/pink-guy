#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, freemem, loadavg, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  byteValue,
  processCategory,
  processTotals,
  summarizeCalibration,
  vmBytes,
} from "../src/server/capacity-calibration.mjs";

const execFileAsync = promisify(execFile);

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: calibrate --label NAME [--duration 60] [--interval 5] [--state PATH] "
    + "[--pid LABEL:PID] [--output PATH]\n",
  );
  process.exit(64);
}

const options = { duration: 60, interval: 5, state: null, output: null, trackedPids: [] };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  const value = () => process.argv[++index] ?? usage(`missing value for ${argument}`);
  if (argument === "--label") options.label = value();
  else if (argument === "--duration") options.duration = Number(value());
  else if (argument === "--interval") options.interval = Number(value());
  else if (argument === "--state") options.state = resolve(value());
  else if (argument === "--pid") {
    const tracked = value().match(/^([a-z0-9][a-z0-9._-]{0,63}):(\d+)$/);
    if (!tracked || Number(tracked[2]) < 1) usage("invalid --pid; expected LABEL:PID");
    options.trackedPids.push({ label: tracked[1], pid: Number(tracked[2]) });
  }
  else if (argument === "--output") options.output = resolve(value());
  else usage(`unknown option: ${argument}`);
}
if (
  !options.label?.match(/^[a-z0-9][a-z0-9._-]{0,63}$/)
  || !Number.isInteger(options.duration) || options.duration < 10 || options.duration > 3600
  || !Number.isInteger(options.interval) || options.interval < 1 || options.interval > 60
  || options.interval > options.duration
) usage("invalid label, duration, or interval");
if (new Set(options.trackedPids.map(({ label }) => label)).size !== options.trackedPids.length) {
  usage("duplicate --pid label");
}
if (new Set(options.trackedPids.map(({ pid }) => pid)).size !== options.trackedPids.length) {
  usage("duplicate --pid process");
}

const stamp = new Date().toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
options.output ??= resolve("artifacts", "benchmarks", `${stamp}-${options.label}.json`);

async function command(commandName, args, fallback = "") {
  try {
    const { stdout } = await execFileAsync(commandName, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    return { ok: false, error: error.code ?? "command_failed", stdout: fallback };
  }
}

async function sample() {
  const [vm, pressure, swap, processes, dockerStats, pinkContainers, disk] = await Promise.all([
    command("vm_stat", []),
    command("memory_pressure", ["-Q"]),
    command("sysctl", ["-n", "vm.swapusage"]),
    command("ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="]),
    command("docker", ["stats", "--no-stream", "--format", "{{json .}}"]),
    command("docker", ["ps", "--filter", "label=pink-guy.run", "--format", "{{.ID}}"]),
    options.state ? command("du", ["-sk", options.state]) : Promise.resolve({ ok: true, stdout: "" }),
  ]);
  const trackedByPid = new Map(options.trackedPids.map(({ label, pid }) => [pid, label]));
  const selectedProcesses = processes.stdout.split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) return null;
    const pid = Number(match[1]);
    const category = trackedByPid.get(pid) ?? processCategory(match[5]);
    return category ? {
      pid, ppid: Number(match[2]), category,
      cpu_percent: Number(match[3]), rss_bytes: Number(match[4]) * 1024,
    } : null;
  }).filter(Boolean);
  const pinkContainerIds = pinkContainers.stdout.split("\n").filter(Boolean);
  const containers = dockerStats.stdout.split("\n").filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      if (!pinkContainerIds.some((id) => value.Container === id || value.Container?.startsWith(id))) return [];
      const [used] = String(value.MemUsage ?? "").split("/");
      return [{
        id: value.Container,
        name: value.Name,
        cpu_percent: Number.parseFloat(value.CPUPerc) || 0,
        memory_bytes: byteValue(used),
      }];
    } catch {
      return [];
    }
  });
  const swapUsed = byteValue(swap.stdout.match(/used\s*=\s*([\d.]+\s*[KMGT]?(?:i?B)?)/i)?.[1] ?? "");
  const pressureFreePercent = Number(
    pressure.stdout.match(/System-wide memory free percentage:\s*(\d+)%/)?.[1] ?? Number.NaN,
  );
  return {
    observed_at: new Date().toISOString(),
    host: {
      total_memory_bytes: totalmem(),
      free_memory_bytes: freemem(),
      load_average: loadavg(),
      vm: vmBytes(vm.stdout),
      memory_pressure_free_percent: Number.isFinite(pressureFreePercent) ? pressureFreePercent : null,
      swap_used_bytes: swapUsed,
    },
    processes: selectedProcesses,
    process_totals: processTotals(selectedProcesses),
    docker: {
      pink_container_ids: pinkContainerIds,
      containers,
    },
    state_root_bytes: disk.stdout ? Number(disk.stdout.split(/\s+/)[0]) * 1024 : null,
    errors: [
      ...(!vm.ok ? [{ source: "vm_stat", code: vm.error }] : []),
      ...(!pressure.ok ? [{ source: "memory_pressure", code: pressure.error }] : []),
      ...(pressure.ok && !Number.isFinite(pressureFreePercent)
        ? [{ source: "memory_pressure", code: "format_changed" }]
        : []),
      ...(!swap.ok ? [{ source: "swap", code: swap.error }] : []),
      ...(!processes.ok ? [{ source: "ps", code: processes.error }] : []),
      ...(!dockerStats.ok ? [{ source: "docker_stats", code: dockerStats.error }] : []),
      ...(!pinkContainers.ok ? [{ source: "docker_ps", code: pinkContainers.error }] : []),
      ...(!disk.ok ? [{ source: "state_root", code: disk.error }] : []),
    ],
  };
}

const [git, gitStatus, macos, power, dockerInfo] = await Promise.all([
  command("git", ["rev-parse", "HEAD"]),
  command("git", ["status", "--porcelain"]),
  command("sw_vers", ["-productVersion"]),
  command("pmset", ["-g", "batt"]),
  command("docker", ["info", "--format", "{{json .}}"]),
]);
let parsedDockerInfo = null;
try {
  parsedDockerInfo = dockerInfo.stdout ? JSON.parse(dockerInfo.stdout) : null;
} catch {
  parsedDockerInfo = null;
}
const selectedDockerInfo = parsedDockerInfo ? {
  server_version: parsedDockerInfo.ServerVersion ?? null,
  architecture: parsedDockerInfo.Architecture ?? null,
  cpu_count: parsedDockerInfo.NCPU ?? null,
  memory_bytes: parsedDockerInfo.MemTotal ?? null,
  operating_system: parsedDockerInfo.OperatingSystem ?? null,
} : null;
const samples = [];
const startedAt = new Date();
const count = Math.floor(options.duration / options.interval) + 1;
let stopSignal = null;
let wakeSleep = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopSignal ??= signal;
    wakeSleep?.();
  });
}
for (let index = 0; index < count; index += 1) {
  samples.push(await sample());
  process.stdout.write(`sample ${index + 1}/${count} · free ${(samples.at(-1).host.free_memory_bytes / 1024 ** 3).toFixed(1)} GiB\n`);
  if (stopSignal || index + 1 >= count) break;
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, options.interval * 1_000);
    wakeSleep = () => {
      clearTimeout(timer);
      resolvePromise();
    };
  });
  wakeSleep = null;
}
const endedAt = new Date();
const artifact = {
  schema_version: "1.0.0",
  label: options.label,
  started_at: startedAt.toISOString(),
  ended_at: endedAt.toISOString(),
  requested_duration_seconds: options.duration,
  completion_reason: stopSignal ? `owner_${stopSignal.toLowerCase()}` : "duration_elapsed",
  interval_seconds: options.interval,
  metadata: {
    git_revision: git.stdout || null,
    git_working_tree_dirty: Boolean(gitStatus.stdout),
    macos_version: macos.stdout || null,
    architecture: arch(),
    physical_memory_bytes: totalmem(),
    logical_cpu_count: cpus().length,
    power: power.stdout || null,
    docker: selectedDockerInfo,
    state_root: options.state,
    tracked_processes: options.trackedPids,
  },
  summary: summarizeCalibration(samples, { stateRoot: Boolean(options.state) }),
  samples,
};
await mkdir(dirname(options.output), { recursive: true });
await writeFile(options.output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Calibration artifact: ${options.output}\n`);
