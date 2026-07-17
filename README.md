# Boss Man v2 planning workspace

This repository contains the planning baseline and executable Phase 0 feasibility work for Boss Man v2. The production application has not started, but the C0-04 central API and localhost operator shell can now be served using the exact instructions in [`RUNBOOK.md`](RUNBOOK.md). Current code includes deterministic fixtures, Pi lifecycle/custody probes, a direct-Pi control-plane slice, project-orchestrator leases, task-policy and governed-memory contracts, atomic context export/import, a pinned task image, Git/credential/RTK probes, a disposable remote-edge test, and evidence manifests used to select the foundation.

The design is organized under [`specs/boss-man-v2`](specs/boss-man-v2):

- [`PRODUCT.md`](specs/boss-man-v2/PRODUCT.md) defines the intended user experience and behavioral contract.
- [`TECH.md`](specs/boss-man-v2/TECH.md) proposes the architecture and implementation sequence.
- [`UI.md`](specs/boss-man-v2/UI.md) defines the developer cockpit and evaluates existing dashboard foundations.
- [`FOUNDATION.md`](specs/boss-man-v2/FOUNDATION.md) evaluates Agent of Empires against the specification and defines the fork/no-fork decision gate.
- [`PHASE0.md`](specs/boss-man-v2/PHASE0.md) is the active feasibility program, shared fixture, hard-gate scorecard, evidence contract, and execution tracker.
- [`PHASE0-RESULTS.md`](specs/boss-man-v2/PHASE0-RESULTS.md) is the evidence-linked owner checkpoint and remaining-gate audit.
- [`ADR-FOUNDATION.md`](specs/boss-man-v2/ADR-FOUNDATION.md) records the approved thin direct-Pi foundation and its pre-production conditions.
- [`PHASE0-CLOSURE.md`](specs/boss-man-v2/PHASE0-CLOSURE.md) turns those conditions into the ordered implementation milestone before broad Phase 1 work.
- [`RESEARCH.md`](specs/boss-man-v2/RESEARCH.md) records source inspection, current provider policy, comparable projects, and the memory/context-management landscape.
- [`DECISIONS.md`](specs/boss-man-v2/DECISIONS.md) separates proposed decisions, assumptions, and questions that still need owner input.

The upstream source reviewed for this baseline was:

- `weblue/boss-man` at `59f8282654f9b4cea90f2ba830aa6d56106e25b4`
- `weblue/inspector-gadget` at `3df39382ceb147aa411f9c578ef4131fc91912f2`
- `agent-of-empires/agent-of-empires` inspected at `7803b25451bc836ad40ad9ad9d5efad11de83764`; Phase 0 pinned at `90855a59360f46652786a49f54a56df002d8ef98`
- `svkozak/pi-acp` at `49d6ec804d40b52317d873360654054c5d2387a3`
- `earendil-works/pi` at v0.80.9 / `2d16f92973230a7e095aa984f150ba8702784f50`, matching the current Phase 0 executable
- prior Pi v0.79.1 / `28df940f0d07b65284849a483be7b06e2ca046ee` evidence retained as a compatibility baseline

Research was last verified on 2026-07-16.
