# Host and provider capacity calibration

Status: Approved for P2-4 implementation

Last updated: 2026-07-19

## Initial implementation

`scripts/calibrate.mjs` is an explicit calibration-window recorder. It samples
with model-less host commands:

- Node `os` metrics for total/free memory and load averages;
- `vm_stat`, `memory_pressure -Q`, and `sysctl vm.swapusage` for macOS memory
  pressure;
- `ps` for PID/PPID, CPU, RSS, and executable classification only;
- `docker stats --no-stream` for active container CPU/memory;
- `docker ps --filter label=pink-guy.run` for Pink Guy identity; and
- `du` for the selected state-root size.

The artifact includes the exact Git revision and configuration metadata.
Process arguments are never retained because they can contain paths or future
secret-bearing flags. Repeatable `--pid LABEL:PID` selectors classify known
Pink Guy processes independently from unrelated Node helpers.
`SIGINT`/`SIGTERM` finish the current sample and write an
`owner_sigint`/`owner_sigterm` artifact. Metadata states whether the source
worktree was dirty, so exploratory evidence cannot masquerade as a
reproducible committed revision.

## Command

```sh
npm run calibrate -- \
  --label idle \
  --duration 60 \
  --interval 5 \
  --state "$HOME/.local/share/pink-guy/dev" \
  --pid control-plane:1234 \
  --pid project-orchestrator:5678
```

The initial recorder intentionally stays outside SQLite so a broken or stopped
control plane can still be measured. After the first controlled runs, P2-4
will decide whether durable API/SQLite projection adds operational value.

## Staged runs

1. idle host with Codex and Docker Desktop;
2. Pink Guy API plus one project orchestrator;
3. one task execution;
4. multiple project orchestrators with serialized OAuth task work;
5. controlled overlap only after the earlier evidence is healthy.
