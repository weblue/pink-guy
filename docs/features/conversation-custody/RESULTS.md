# Conversation custody and safe model switching results

Status: Model-less switching, pre-compaction, and scope transfer verified

Last updated: 2026-07-18

`probe-phase1-conversation-runtime.mjs` processes two owner turns around a
route change. It proves:

- one checksum-verified pre-switch bundle contains both durable turns and the
  existing native Pi session;
- the first fake Pi process uses the original route and the second uses the
  selected route;
- both processes receive the selected editable prompt inside the immutable
  policy envelope;
- only the new owner message is sent on each turn; and
- conversation-run prompt provenance and credential cleanup remain intact.

No provider request or task container is used.

`probe-phase1-dogfood-readiness.mjs` additionally proves:

- the orchestrator's blocking `session_before_compact` path exports a verified
  current-version custody bundle before Pi may compact;
- binding an intake topic to a repository-backed project requires a fresh
  `scope_transfer` snapshot and changes topic and conversation scope
  atomically;
- the system-intake daemon retires its now-out-of-scope Pi process;
- the project daemon resumes the same native Pi session without replaying
  transcript history; and
- the transferred orchestrator can schedule a task agent with an independently
  resolved provider/model/thinking route.

The deterministic probe uses a fake Pi process and makes no provider request.
The separate bounded live-provider smoke proves that native Pi custody,
private credential copies, task containers, RTK evidence, and cleanup remain
intact with the configured OpenAI Codex route.
