import { readFile } from "node:fs/promises";

export const MODEL_ROUTE_PHASES = Object.freeze([
  "orchestrator",
  "implementation",
  "test",
  "review",
]);

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const BILLING_CLASSES = new Set(["subscription", "direct_api", "prepaid", "local", "unknown"]);

export function validateModelRoute(route, label = "model route") {
  const provider = typeof route?.provider === "string" ? route.provider.trim() : "";
  const model = typeof route?.model === "string" ? route.model.trim() : "";
  const thinking = typeof route?.thinking === "string" ? route.thinking.trim() : "";
  let billingClass = typeof route?.billingClass === "string"
    ? route.billingClass.trim()
    : typeof route?.billing_class === "string" ? route.billing_class.trim() : "unknown";
  if (billingClass === "api") billingClass = "direct_api";
  if (!provider || provider.length > 200 || provider.includes("\0")) {
    throw Object.assign(new Error(`${label} provider must be between 1 and 200 characters`), {
      code: "invalid_request",
    });
  }
  if (!model || model.length > 500 || model.includes("\0")) {
    throw Object.assign(new Error(`${label} model must be between 1 and 500 characters`), {
      code: "invalid_request",
    });
  }
  if (!THINKING_LEVELS.has(thinking)) {
    throw Object.assign(new Error(`${label} has an unsupported thinking level`), {
      code: "invalid_request",
    });
  }
  if (!BILLING_CLASSES.has(billingClass)) {
    throw Object.assign(new Error(`${label} has an unsupported billing class`), {
      code: "invalid_request",
    });
  }
  return { provider, model, thinking, billingClass };
}

export function createModelRoutePolicy({
  provider,
  model,
  thinking = "medium",
  billingClass = "unknown",
  phases = {},
  source = "control_plane_default",
}) {
  const defaultRoute = validateModelRoute({ provider, model, thinking, billingClass }, "default model route");
  const phaseRoutes = {};
  for (const [phase, route] of Object.entries(phases)) {
    if (!MODEL_ROUTE_PHASES.includes(phase)) {
      throw Object.assign(new Error(`unsupported model-route phase: ${phase}`), {
        code: "invalid_request",
      });
    }
    phaseRoutes[phase] = {
      ...validateModelRoute(route, `${phase} model route`),
      policySource: `configured_phase:${phase}`,
    };
  }
  return Object.freeze({
    default: Object.freeze({ ...defaultRoute, policySource: source }),
    phases: Object.freeze(phaseRoutes),
  });
}

export async function loadModelRoutePolicy(path, overrides = {}) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (parsed.schema_version !== "1.0.0" || !parsed.default || typeof parsed.phases !== "object") {
    throw Object.assign(new Error("model route config must use schema_version 1.0.0"), {
      code: "invalid_request",
    });
  }
  return createModelRoutePolicy({
    provider: overrides.provider ?? parsed.default.provider,
    model: overrides.model ?? parsed.default.model,
    thinking: overrides.thinking ?? parsed.default.thinking,
    billingClass: overrides.billingClass ?? parsed.default.billing_class,
    phases: parsed.phases,
    source: Object.values(overrides).some((value) => value !== undefined)
      ? "cli_default_override"
      : "configured_default",
  });
}

export function resolveModelRoute(policy, phase, override = null) {
  if (!MODEL_ROUTE_PHASES.includes(phase)) {
    throw Object.assign(new Error(`unsupported model-route phase: ${phase}`), {
      code: "invalid_request",
    });
  }
  if (override && (
    override.provider !== undefined
    || override.model !== undefined
    || override.thinking !== undefined
    || override.billingClass !== undefined
  )) {
    const base = policy.phases[phase] ?? policy.default;
    return {
      ...validateModelRoute({
        provider: override.provider ?? base.provider,
        model: override.model ?? base.model,
        thinking: override.thinking ?? base.thinking,
        billingClass: override.billingClass ?? base.billingClass,
      }, `${phase} model route override`),
      policySource: override.policySource ?? "explicit_run_override",
    };
  }
  return policy.phases[phase] ?? {
    ...policy.default,
    policySource: phase === "orchestrator"
      ? policy.default.policySource
      : `default_for_phase:${phase}`,
  };
}

export function assertConfiguredModelSelection(policy, phase, route) {
  const configured = [
    policy.default,
    ...Object.values(policy.phases),
  ];
  if (!configured.some((candidate) =>
    candidate.provider === route.provider && candidate.model === route.model
  )) {
    throw Object.assign(new Error(
      `${phase} route ${route.provider}/${route.model} is not configured; `
      + "add it to model-routes.json or omit the override",
    ), { code: "invalid_request" });
  }
  return route;
}

export function publicModelRoutePolicy(policy) {
  const route = (value) => ({
    provider: value.provider,
    model: value.model,
    thinking: value.thinking,
    billing_class: value.billingClass,
    policy_source: value.policySource,
  });
  return {
    schema_version: "1.0.0",
    default: route(policy.default),
    phases: Object.fromEntries(
      MODEL_ROUTE_PHASES.map((phase) => [phase, route(resolveModelRoute(policy, phase))]),
    ),
  };
}
