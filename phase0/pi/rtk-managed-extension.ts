import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function managedRtkExtension(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = event.input.command;
    if (typeof command !== "string" || !command.trim() || process.env.RTK_DISABLED === "1") return;
    const rawRoot = process.env.RTK_TEE_DIR ?? "/artifacts/rtk-tee";
    const id = randomUUID();
    const scriptName = `pi-${id}.command.sh`;
    const rawName = `pi-${id}.raw.log`;
    const filteredName = `pi-${id}.filtered.log`;
    const scriptPath = `${rawRoot}/${scriptName}`;
    const rawPath = `${rawRoot}/${rawName}`;
    const filteredPath = `${rawRoot}/${filteredName}`;
    const metadataPath = `${rawRoot}/pi-${id}.json`;
    await mkdir(rawRoot, { recursive: true, mode: 0o700 });
    await writeFile(scriptPath, command, { mode: 0o700 });
    const commandSha256 = createHash("sha256").update(command).digest("hex");
    event.input.command = [
      `sh '${scriptPath}' > '${rawPath}' 2>&1`,
      "__boss_rtk_status=$?",
      `rtk log '${rawPath}' | tee '${filteredPath}'`,
      `printf '{"schema_version":"boss-man-pi-rtk-v1","id":"${id}","command_sha256":"${commandSha256}","script_name":"${scriptName}","raw_name":"${rawName}","filtered_name":"${filteredName}","filter":"log","status":%s}\\n' "$__boss_rtk_status" > '${metadataPath}'`,
      "exit \"$__boss_rtk_status\"",
    ].join("; ");
  });
}
