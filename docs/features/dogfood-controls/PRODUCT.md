# Repository intake and dogfood controls

Status: Implemented; Phase 2 Git and retention follow-up complete

Last updated: 2026-07-22

## Summary

The owner can bring an existing Git repository into Pink Guy without startup
seed flags, attach immutable external-source context, edit authoritative task
detail, resolve protected decisions, stop/resume a task run, and explicitly
retry or reset a failed or uncertain orchestrator command.

## Behavior

- Repository import runs `git clone` on the host into the selected state
  root. HTTPS, SSH, `file://`, and absolute local sources are accepted.
- A source URL maps to one managed project. Re-import reopens that project and
  its durable topic instead of cloning another copy.
- Git authentication remains host-owned; credentials are not submitted in the
  API payload or copied into task containers.
- External inputs are immutable snapshots with content checksums and no
  write-back.
- Task title, description, and acceptance criteria use optimistic versions
  and ordered audit events.
- Loopback owners can inspect task detail and invoke owner-authorized actions;
  agent calls still require their scoped bearer capability.
- Failed and reconciliation-required commands are never replayed silently.
  Retry creates a new linked command; reset cancels the old command and
  restores the task to `ready`.

## Remaining boundary

- Remote repository-host integrations and refresh/diff semantics for external
  source snapshots.
- Owner dependency editing, a consolidated attention queue, and richer
  diff/test/review/context/artifact inspectors.
- Governed merge/rebase/push/PR and settled worktree cleanup are now
  implemented. Broader provider/repository-host integrations remain
  needs-driven work after sustained dogfood.
