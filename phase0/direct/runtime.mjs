import { execFile, spawn } from "node:child_process";

function runFile(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolvePromise({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr });
    });
  });
}

function dockerError(operation, result) {
  return Object.assign(new Error(`${operation} failed: ${result.stderr || result.stdout}`.trim()), {
    code: "container_runtime_failed",
    operation,
  });
}

function mount(source, destination, readOnly = false) {
  return `type=bind,src=${source},dst=${destination}${readOnly ? ",readonly" : ""}`;
}

export class DockerTaskRuntime {
  constructor({
    image = "boss-man-phase0:pi-0.80.9-rtk-0.42.3",
    dockerCommand = "docker",
    network = "bridge",
    policy = {},
    containerId = null,
  } = {}) {
    this.image = image;
    this.dockerCommand = dockerCommand;
    this.network = network;
    this.policy = {
      user: "65532:65532",
      memory: "512m",
      cpus: "1.0",
      pidsLimit: "128",
      tmpfs: "/tmp:rw,nosuid,nodev,noexec,size=32m",
      ...policy,
    };
    this.containerId = containerId;
    this.imageId = null;
  }

  async inspectImage() {
    const result = await runFile(this.dockerCommand, ["image", "inspect", this.image]);
    if (result.code !== 0) throw dockerError("docker image inspect", result);
    const [image] = JSON.parse(result.stdout);
    if (image.Architecture !== "arm64" || image.Os !== "linux") {
      throw Object.assign(new Error(`task image must be linux/arm64, got ${image.Os}/${image.Architecture}`), { code: "invalid_task_image" });
    }
    this.imageId = image.Id;
    return { id: image.Id, architecture: image.Architecture, os: image.Os };
  }

  async start({ runId, workspacePath, artifactPath, homePath, configPath, sessionPath, extensionPath, credentialPath, environment }) {
    const image = await this.inspectImage();
    const name = `boss-man-${runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 48)}`;
    const args = [
      "create", "--name", name,
      "--label", `boss-man.run=${runId}`,
      "--entrypoint", "sh",
      "--user", this.policy.user,
      "--read-only",
      "--network", this.network,
      "--add-host", "host.docker.internal:host-gateway",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--memory", this.policy.memory,
      "--cpus", this.policy.cpus,
      "--pids-limit", this.policy.pidsLimit,
      "--tmpfs", this.policy.tmpfs,
      "--workdir", "/workspace",
      "--mount", mount(workspacePath, "/workspace"),
      "--mount", mount(artifactPath, "/artifacts"),
      "--mount", mount(homePath, "/home/bossman"),
      "--mount", mount(configPath, "/config"),
      "--mount", mount(sessionPath, "/sessions"),
      "--mount", mount(extensionPath, "/boss-man/extensions", true),
      ...(credentialPath ? ["--mount", mount(credentialPath, "/run/secrets/pi-auth.json", true)] : []),
      ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      this.image,
      "-lc", "trap 'exit 0' TERM INT; while :; do sleep 3600; done",
    ];
    const created = await runFile(this.dockerCommand, args);
    if (created.code !== 0) throw dockerError("docker create", created);
    this.containerId = created.stdout.trim();
    const started = await runFile(this.dockerCommand, ["start", this.containerId]);
    if (started.code !== 0) {
      await this.remove();
      throw dockerError("docker start", started);
    }
    return { containerId: this.containerId, imageId: image.id, name, network: this.network };
  }

  launch(command, args = [], { environment = {}, workdir = "/workspace" } = {}) {
    if (!this.containerId) throw new Error("task container is not running");
    return {
      command: this.dockerCommand,
      args: [
        "exec", "-i", "--workdir", workdir,
        ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        this.containerId, command, ...args,
      ],
    };
  }

  spawn(command, args = [], options = {}) {
    const launch = this.launch(command, args, options);
    return spawn(launch.command, launch.args, { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  }

  async exec(command, args = [], options = {}) {
    const launch = this.launch(command, args, options);
    return runFile(launch.command, launch.args, { env: process.env });
  }

  async inspect() {
    if (!this.containerId) return null;
    const result = await runFile(this.dockerCommand, ["inspect", this.containerId]);
    if (result.code !== 0) {
      if (/No such (object|container)/i.test(`${result.stderr}\n${result.stdout}`)) return null;
      throw dockerError("docker inspect", result);
    }
    const [container] = JSON.parse(result.stdout);
    return {
      id: container.Id,
      imageId: container.Image,
      running: Boolean(container.State?.Running),
      pid: container.State?.Pid ?? null,
      network: container.HostConfig?.NetworkMode ?? null,
      mounts: (container.Mounts ?? []).map((item) => ({ destination: item.Destination, readWrite: item.RW })),
      labels: container.Config?.Labels ?? {},
    };
  }

  async stop() {
    if (!this.containerId) return;
    await runFile(this.dockerCommand, ["stop", "--time", "2", this.containerId]);
    await this.remove();
  }

  async remove() {
    if (!this.containerId) return;
    await runFile(this.dockerCommand, ["rm", "--force", this.containerId]);
    this.containerId = null;
  }
}
