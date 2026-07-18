# Conversation custody and safe model switching results

Status: Model-less implementation verified

Last updated: 2026-07-17

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
