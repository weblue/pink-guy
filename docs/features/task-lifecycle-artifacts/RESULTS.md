# Task lifecycle and planning artifact results

Status: Implemented and verified against retained dogfood state

Last updated: 2026-07-18

Boss Man now separates execution status from artifact lifecycle. Tasks carry an
explicit `executable`, `umbrella`, or `intake` kind, optional normalized tags,
and reversible archive provenance. Only active executable tasks can receive
commands or start/resume phase sessions.

The model-less regression suite verifies:

- deterministic compatibility classification without title or LLM inference;
- default and explicit kinds plus normalized/deduplicated tags;
- split-parent conversion to Umbrella and executable children;
- scheduling rejection before command side effects;
- versioned, idempotent, audited archive/restore;
- active-command/status archival and kind-change rejection;
- active-board versus Archived projection and project counts; and
- cockpit create/edit/archive/restore controls.

## Retained Ready-queue verification

The real local SQLite database was restarted through the normal API migration.
It classified:

- `f458b4a7-e59b-4260-8d86-fd569415de26` as Umbrella because it has child
  tasks; and
- `intake-8db7e83de951c15b` as Intake from its stable bootstrap identity.

Normal loopback APIs then reconciled all three formerly Ready records:

| Task | Classification | Tags | Archive reason |
|---|---|---|---|
| UI refresh parent | Umbrella | `planning`, `ui`, `settled` | Implementation child completed; review-only child superseded |
| UX review child | Executable artifact | `superseded`, `review`, `ui` | Automatic fixed-revision review continuation replaced the separate card |
| Repository bootstrap | Intake | `intake`, `bootstrap`, `superseded` | Durable project conversation now owns intake |

The active Ready column is empty. All three retain `status=ready`, complete
history, relationships, tags, and archive provenance in the collapsed Archived
artifacts view. Explicit implementation scheduling against each record returns
HTTP 409 with no command creation.

The owner-editable orchestrator profile was advanced to v2 so new/restarted Pi
processes classify and archive planning artifacts through structured tools.

## Verification

- `npm test` — 12 probes pass.
- `npm run test:workflow` — fixed-revision phase flow passes.
- `npm run test:baseline` — deterministic foundation baseline passes.
- `git diff --check` — passes.
- Live API plus system/project orchestrator tmux sessions run on the retained
  local state.
