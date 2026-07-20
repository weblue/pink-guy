# Phase 1 local control loop — product specification

Status: Implemented Phase 1 contract; see `RESULTS.md`

Last updated: 2026-07-17

Figma: none provided. The existing task-first information architecture in
the [developer cockpit specification](../../product/UI.md) remains the visual
direction.

## Goal

Give the local Pink Guy owner a durable, observable path for sending
phase-scoped work to the one active orchestrator for a project. This is the
first Phase 1 slice; it establishes the control loop before task editing,
persistent terminals, and the full task workspace are added.

## Behavior

1. A local owner can queue a command for a task in a managed project and must
   choose exactly one phase: `implementation`, `test`, or `review`.
2. A command is accepted only when the task belongs to the addressed project
   and that project has one active orchestrator lease.
3. Repeating the same request with the same idempotency key returns the
   original command. Reusing that key for different work is rejected.
4. Only the active orchestrator for the command's project can claim it. Each
   command can be claimed once, and queued commands are offered in creation
   order.
5. The orchestrator reports either success or failure with structured,
   durable result information. A terminal command is never offered again.
6. If the owning orchestrator lease expires or is released while a command is
   claimed, the command becomes `reconciliation_required`. Pink Guy does not
   automatically replay it.
7. The local cockpit shows recent command state alongside projects,
   orchestrator leases, tasks, and sessions. Command observability is not
   presented as a chat transcript.
8. The orchestrator executes a `start_task` command by requesting the existing
   phase-scoped task-session operation through the central API. Execution
   failures are recorded on the command rather than causing an automatic
   retry.
9. The command API is part of the loopback-only local profile in this slice.
   It does not add remote access, application authentication, deployment, or
   provider fallback.

## Out of scope

- creating, editing, assigning, or dependency-linking tasks in the cockpit;
- automatic task claiming on behalf of a worker;
- stop/restart commands and in-flight Pi process reattachment;
- persistent PTY controls;
- merge, rebase, push, or autonomous retry;
- network exposure or remote access.
