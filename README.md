# Boss Man v2

This repository contains the specification, selected direct-Pi foundation, and
executable local application for Boss Man v2. Phase 0 is complete for the
unauthenticated loopback-smoke profile. Phase 1 is in progress: a task-first
cockpit now opens durable topic/project conversations backed by persistent Pi
RPC sessions, projects structured task changes onto the authoritative board,
and retains the existing phase-scoped project-orchestrator command loop. Serve
it using [`RUNBOOK.md`](RUNBOOK.md).

Current code also includes deterministic fixtures, Pi lifecycle/custody
probes, authoritative task policy, governed memory and FTS retrieval, atomic
context export/import, a pinned task image, host-owned Git and credential
boundaries, RTK evidence, and the Phase 0 manifests used to select the
foundation.

Start with the [`specification index`](specs/README.md), then use
[`specs/boss-man-v2/CURRENT-STATE.md`](specs/boss-man-v2/CURRENT-STATE.md) for
the current capability and next-step inventory. The longer-lived design is
organized under [`specs/boss-man-v2`](specs/boss-man-v2):

- [`PRODUCT.md`](specs/boss-man-v2/PRODUCT.md) defines the intended user experience and behavioral contract.
- [`TECH.md`](specs/boss-man-v2/TECH.md) proposes the architecture and implementation sequence.
- [`UI.md`](specs/boss-man-v2/UI.md) defines the developer cockpit and evaluates existing dashboard foundations.
- [`ROADMAP.md`](specs/boss-man-v2/ROADMAP.md) is the canonical local-first phase sequence and exposure/authentication boundary.
- [`FOUNDATION.md`](specs/boss-man-v2/FOUNDATION.md) evaluates Agent of Empires against the specification and defines the fork/no-fork decision gate.
- [`PHASE0.md`](specs/boss-man-v2/PHASE0.md) is the active feasibility program, shared fixture, hard-gate scorecard, evidence contract, and execution tracker.
- [`PHASE0-RESULTS.md`](specs/boss-man-v2/PHASE0-RESULTS.md) is the evidence-linked owner checkpoint and remaining-gate audit.
- [`ADR-FOUNDATION.md`](specs/boss-man-v2/ADR-FOUNDATION.md) records the approved thin direct-Pi foundation and its pre-production conditions.
- [`PHASE0-CLOSURE.md`](specs/boss-man-v2/PHASE0-CLOSURE.md) turns those conditions into the ordered implementation milestone before broad Phase 1 work.
- [`RESEARCH.md`](specs/boss-man-v2/RESEARCH.md) records source inspection, current provider policy, comparable projects, and the memory/context-management landscape.
- [`DECISIONS.md`](specs/boss-man-v2/DECISIONS.md) separates proposed decisions, assumptions, and questions that still need owner input.
- [`phase1-local-control-loop`](specs/phase1-local-control-loop) defines and
  verifies the first Phase 1 product slice.
- [`phase1-local-task-controls`](specs/phase1-local-task-controls) defines and
  verifies the local create/claim/schedule slice.
- [`phase1-orchestrator-conversations`](specs/phase1-orchestrator-conversations)
  is the approved and active conversation-first topic, task-graph, repository,
  and work-item intake slice.

The upstream source reviewed for this baseline was:

- `weblue/boss-man` at `59f8282654f9b4cea90f2ba830aa6d56106e25b4`
- `weblue/inspector-gadget` at `3df39382ceb147aa411f9c578ef4131fc91912f2`
- `agent-of-empires/agent-of-empires` inspected at `7803b25451bc836ad40ad9ad9d5efad11de83764`; Phase 0 pinned at `90855a59360f46652786a49f54a56df002d8ef98`
- `svkozak/pi-acp` at `49d6ec804d40b52317d873360654054c5d2387a3`
- `earendil-works/pi` at v0.80.9 / `2d16f92973230a7e095aa984f150ba8702784f50`, matching the current Phase 0 executable
- prior Pi v0.79.1 / `28df940f0d07b65284849a483be7b06e2ca046ee` evidence retained as a compatibility baseline

Research was last verified on 2026-07-16.
