# Phase 1 editable agent prompt profiles

Status: Implemented Phase 1 slice

Last updated: 2026-07-17

## Summary

The owner can inspect and edit the role guidance used by the project
orchestrator and implementation, test, and review agents without modifying
source code. Prompt edits are versioned, auditable, and visibly pinned to the
Pi run that consumed them.

## Figma

Figma: none provided. The first implementation uses the existing cockpit
panel patterns.

## Behavior

1. Boss Man provides four built-in profiles: `orchestrator`,
   `implementation`, `test`, and `review`.
2. The browser and terminal can list profiles, inspect the active revision and
   history, and create a new active revision.
3. An edit requires the expected active version and an idempotency key.
   Concurrent edits fail visibly rather than overwriting one another.
4. Prior revisions are retained. Editing never rewrites a revision already
   used by a run.
5. Each orchestrator or task-agent run records the profile key, version, and
   prompt checksum it actually used.
6. A running Pi process keeps its pinned revision. A new or restarted process
   uses the active revision at its start boundary.
7. Editable role guidance is composed inside a platform-owned policy envelope.
   The owner can change workflow, emphasis, output expectations, and
   repository-specific operating style, but the editable text cannot grant
   authority, expose secrets, permit cross-project mutation, bypass
   independent review, or remove protected human decisions.
8. Empty prompts, unknown profile keys, oversized prompts, stale versions,
   reused idempotency keys with different content, and embedded NUL bytes are
   rejected.
9. The UI explains when an edit takes effect and never implies that it changed
   a currently running Pi process.
10. Built-in profile guidance, phase kickoff messages, and platform policy
    envelopes are stored as simple UTF-8 text files under `config/prompts/`.
    Profile files are convenient editable defaults; policy files remain
    source-controlled, non-editable platform policy.

## Non-goals

- repository- or task-specific profile inheritance in the first increment;
- arbitrary new capability roles;
- editing tool schemas or platform policy envelopes;
- silently hot-swapping the system prompt of a running Pi process;
- using an LLM to rewrite or summarize prompt revisions.

## Validation

- Model-less API coverage proves defaults, history, optimistic edits,
  idempotency, stale-write rejection, and input limits.
- Runtime coverage proves the selected orchestrator revision reaches Pi and is
  recorded on its conversation run.
- Task-run coverage proves phase-to-profile selection and run provenance.
- Cockpit and terminal contract coverage proves both owner surfaces expose the
  same profile revisions.
