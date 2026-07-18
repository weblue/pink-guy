# Repository intake and dogfood controls results

Status: Model-less implementation verified; live recovery refinement active

Last updated: 2026-07-18

The core suite verifies a host-owned clone and idempotent reopen, an immutable
external-source snapshot in orchestrator context, owner task description/acceptance
editing, protected decision resolution, explicit command retry, idempotent
reconciliation, and task reset. Cockpit contracts cover repository, prompt,
model, task, session, and command controls. No provider request or task
container is used.

The first live dogfood run found that a failed command was visible in command
history but left its task misleadingly `in_progress`. The recovery refinement
projects deterministic terminal command failure into a blocked task with an
audited error, while preserving explicit owner retry/reset semantics.

The recovered live workflow subsequently completed implementation, independent
test, and independent review against one fixed revision. It also demonstrated
the need for model-less automatic phase continuation. That follow-up is
specified and implemented in
`docs/features/automatic-phase-continuation/`; manual phase start remains only
an override and recovery control.
