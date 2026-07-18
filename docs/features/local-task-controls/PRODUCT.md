# Phase 1 local task controls — product specification

Status: Approved for implementation

Last updated: 2026-07-17

Figma: none provided. Controls extend the task-first wireframe in
the [developer cockpit specification](../../product/UI.md).

## Goal

Let the owner create and start useful tasks from the loopback cockpit without
editing SQLite, minting capabilities by hand, or calling probe helpers.

## Behavior

1. The local cockpit lets the owner choose a managed project and create a task
   with a non-empty title and zero or more acceptance-criteria lines.
2. A created task appears in `ready`, is bound to the selected project and its
   current repository revision, and records a durable owner audit event.
3. Retrying task creation with the same idempotency key returns the original
   task. Reusing the key for different task content is rejected.
4. For a `ready` or `backlog` task, the owner can choose `implementation`,
   `test`, or `review` and schedule the task from its board card.
5. Scheduling atomically assigns the task to a phase-scoped task-agent
   identity, moves it to `in_progress`, and queues exactly one
   `start_task` command for the active project orchestrator.
6. A task is not changed when its project lacks an active orchestrator, the
   requested phase is invalid, or the scheduling request conflicts.
7. Retrying the same scheduling request returns the original task and command
   without another task transition or command.
8. A failed or reconciliation-required command remains visible with its
   result. This slice does not retry it automatically or silently release its
   task.
9. These mutations are enabled only by the loopback local profile. This slice
   does not add remote access or application authentication.

## Out of scope

- task description editing, dependencies, priority, due dates, or deletion;
- automatic retry and owner reconciliation controls;
- stop/pause/resume commands;
- provider/model selection;
- persistent terminal and full task workspace.
