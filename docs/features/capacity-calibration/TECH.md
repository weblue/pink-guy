# Host and provider capacity calibration

Status: Recorder implemented; initial serialized calibration complete

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

1. idle host with Codex and Docker Desktop — complete;
2. Pink Guy API plus one project orchestrator — complete;
3. one task execution — complete;
4. multiple project orchestrators with serialized OAuth task work — complete,
   with deadline and custody-retention defects recorded;
5. controlled overlap — deferred until the serialized path is reliable and an
   overlap would answer a concrete policy question.

Aggregate `du` growth is followed by model-less classification of SQLite
payloads, run directories, native session files, custody snapshots, and
worktrees. Transcript content is not printed or copied during that analysis.
macOS `memory_pressure` is the primary host-memory safety signal; raw free
memory alone includes reclaimable cache and is not used as an out-of-memory
proxy.
