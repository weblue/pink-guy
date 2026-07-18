# ADR: Boss Man v2 foundation

Status: Accepted historical Phase 0 record

Date: 2026-07-16

## Context

Boss Man v2 needs a Pi-specific, provider-agnostic orchestration control plane with one lifecycle authority, native session custody, task and review policy, platform-owned Git, isolated credentials, governed model-less memory, and a task-first developer cockpit. Delivery is now local-first; remote operation remains a later capability.

Phase 0 compared a bounded Agent of Empires product fork with a thin direct-Pi control plane. The evidence and remaining gaps are summarized in `PHASE0-RESULTS.md`.

## Decision

Build on the thin direct-Pi control plane. Use upstream Pi directly and keep task, policy, session, artifact, container, credential, and Git authority inside one Boss Man daemon. Treat Agent of Empires as a source of tested interaction patterns and possible license-compatible component ideas, not as a runtime dependency or fork base.

## Why

- Native Pi custody, resume/import, and pre-compaction barriers work upstream without a private bridge.
- The direct slice already demonstrates one daemon-owned store, Pi RPC, shell/event streaming, custody ingestion, and honest orphan reconciliation.
- Task policy, runtime/Git/credential custody, recovery, and unified context/memory are integrated behind that authority. Local Phase 1 proceeds without application authentication; clean-host reproduction is Phase 2 and authenticated remote access is Phase 3.
- AoE's retained UI/runtime value is substantial, but meeting Boss Man's invariants requires changes across its durable lifecycle writers, sandbox Git mounts, server routes, task data model, and top-level navigation. That is a broad long-lived fork, not an isolated product layer.

## Conditions before production implementation is considered safe

- Preserve the completed Phase 0 local contracts while building the Phase 1 cockpit.
- Keep the web experience task-first; chat remains one workspace tab, not the application shell.
- Keep SWAG and deployment changes human-operated. Agents may generate inert configuration and test deployments only.
- Retain sessions and artifacts until explicit deletion and keep retrieval indexes rebuildable from canonical records.
- Do not introduce automatic paid-provider failover until manual safe-boundary model switching and spend policy are proven.

## Consequences

Positive:

- minimal fork burden and direct ownership of the product's defining invariants;
- exact Pi-native session semantics and straightforward provider portability;
- freedom to choose an existing web terminal/diff component without adopting a second lifecycle authority; and
- smaller security review surface for Git and credentials.

Negative:

- terminal, diff, mobile, reconnect, authentication, and fleet ergonomics must be assembled or adapted;
- recovery quality must be built to match mature existing tools; and
- Boss Man owns more UI and operational integration code.

## Alternatives

1. Core-fork Agent of Empires. Rejected by this proposal because the bounded spike hit the stop rule: required changes cross storage, supervisor/server, sandbox Git, and frontend navigation seams.
2. Boss Man sidecar plus unchanged AoE. Rejected because it creates two lifecycle authorities and depends on internal APIs for essential behavior.
3. Continue research without selecting a foundation. Available if the owner believes AoE's retained UI value justifies a larger, explicitly funded fork spike.

## Owner record

Decision: Approved. Build Boss Man v2 on the thin direct-Pi control plane and retain Agent of Empires as a UI/runtime reference only.

Conditions changed or added: None. The documented pre-production integration conditions remain in force.

Approved by/date: Human owner, 2026-07-16

Roadmap amendment: On 2026-07-17 the owner moved second-host reproduction to Phase 2 and authenticated remote access to Phase 3. This does not change the selected foundation.
