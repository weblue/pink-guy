# Repository intake and dogfood controls

Status: Implemented Phase 1 slice

Last updated: 2026-07-17

## Design

The control plane validates repository source syntax, clones with argument
separation and `GIT_TERMINAL_PROMPT=0`, verifies `HEAD`, then records the
project and import receipt. Failed clones are removed. `source_snapshots`
stores immutable content, source reference, checksum, actor, request receipt,
and timestamp; the active project conversation receives these rows in its
authoritative claim context.

Task detail uses the existing task projection and audit stream. Owner actions
receive a short-lived internally issued owner capability so the same policy
engine validates decision resolution and completion gates without weakening
agent authorization.

`command_reconciliations` records explicit owner retry/reset receipts. Retry
links a new queued command through `payload.retryOf`; reset records a
cancelled terminal command and an audited task transition to `ready`.

## API

- `POST /api/projects/import`
- `GET|POST /api/projects/:id/sources`
- `GET|PUT /api/tasks/:id`
- `POST /api/tasks/:id/actions/:action`
- `POST /api/tasks/:id/resume`
- `DELETE /api/sessions/:id`
- `GET /api/commands/:id`
- `POST /api/commands/:id/reconcile`
