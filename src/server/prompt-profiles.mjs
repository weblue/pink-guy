import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROMPT_DIRECTORY = resolve(moduleDirectory, "../../config/prompts");

function promptFile(...segments) {
  return readFileSync(resolve(DEFAULT_PROMPT_DIRECTORY, ...segments), "utf8").trim();
}

export const PROMPT_PROFILE_KEYS = Object.freeze([
  "orchestrator",
  "implementation",
  "test",
  "review",
]);

export const DEFAULT_PROMPT_PROFILES = Object.freeze({
  orchestrator: Object.freeze({
    displayName: "Project orchestrator",
    role: "orchestrator",
    prompt: promptFile("profiles", "orchestrator.txt"),
  }),
  implementation: Object.freeze({
    displayName: "Implementation agent",
    role: "worker",
    prompt: promptFile("profiles", "implementation.txt"),
  }),
  test: Object.freeze({
    displayName: "Test agent",
    role: "validator",
    prompt: promptFile("profiles", "test.txt"),
  }),
  review: Object.freeze({
    displayName: "Review agent",
    role: "reviewer",
    prompt: promptFile("profiles", "review.txt"),
  }),
});

const ORCHESTRATOR_POLICY_ENVELOPE = promptFile("policy", "orchestrator.txt");
const TASK_POLICY_ENVELOPE = promptFile("policy", "task-agent.txt");

export function phaseKickoffPrompt(phase) {
  if (!["implementation", "test", "review"].includes(phase)) {
    throw Object.assign(new Error(`unknown task phase: ${phase}`), { code: "not_found" });
  }
  return promptFile("kickoffs", `${phase}.txt`);
}

export function composeAgentSystemPrompt(profileKey, promptText) {
  if (!PROMPT_PROFILE_KEYS.includes(profileKey)) {
    throw Object.assign(new Error(`unknown prompt profile: ${profileKey}`), { code: "not_found" });
  }
  const envelope = profileKey === "orchestrator"
    ? ORCHESTRATOR_POLICY_ENVELOPE
    : TASK_POLICY_ENVELOPE;
  return `${envelope}\n\nOwner-editable ${profileKey} role guidance:\n\n${promptText}`;
}
