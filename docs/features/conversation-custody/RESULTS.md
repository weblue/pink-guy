# Conversation custody and safe model switching results

Status: Model-less and live-provider switching/recovery verified

Last updated: 2026-07-22

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

The P2-4 live drill refreshed Pi 0.80.9 and found seven authenticated
`openai-codex` routes. The retained Denver orchestrator switched from
`gpt-5.6-sol` to `gpt-5.5`, created a verified custody snapshot, resumed the
same native session, and completed a real turn with `contextResend: false`.
A second snapshot returned it to `gpt-5.6-sol`.

An explicit unavailable-provider route then failed in under one second with
no fallback and no transcript resend. That drill exposed a recovery gap:
selecting a healthy route after a provider-start failure changed the route but
left the conversation failed. Model switching now returns a failed, idle-safe
conversation to `idle`; a regression covers that transition, the JSON terminal
client exits nonzero for failed turns, and the live recovered `gpt-5.6-sol`
turn completed with `contextResend: false`. Unlisted routes remain selectable
because Pi-compatible local/custom providers are first-class, but failure is
explicit and never rerouted silently.
