# Provider catalog and authentication guidance

Status: Implemented; deterministic and local-browser acceptance complete

Last updated: 2026-07-19

## Summary

Pink Guy shows the models that the configured Pi installation can actually
use. Owners choose providers and models from searchable/selectable controls
instead of remembering identifiers. Provider setup remains owned by Pi, but
the cockpit makes the authentication path obvious and refreshes the catalog
after the owner completes it in cmux, tmux, or another TTY on the Pink Guy
host.

## Behavior

1. The central API discovers available models with the same Pi executable,
   environment, and owner-managed credential directory used by Pink Guy.
2. The response groups models by provider and includes context/output labels,
   thinking support, image support, discovery time, and non-secret credential
   metadata.
3. Conversation model switching and manual task-phase scheduling use provider
   and model selectors populated from that catalog.
4. Changing provider updates the model selector and never leaves an invisible
   free-text value behind.
5. The active/configured route remains selectable even if discovery is
   temporarily unavailable, with a visible warning that availability could
   not be verified.
6. The cockpit provides an **Add or authenticate provider** panel with the
   exact host command and `/login` steps. Pi's interactive login may accept
   either subscription OAuth or an API key, depending on provider.
7. Pink Guy does not accept, proxy, log, or persist raw API keys or OAuth
   tokens through the browser. Credentials remain in the owner-managed Pi
   authentication file and are only represented as provider/type metadata.
8. **Refresh models** reruns discovery after authentication without restarting
   the control plane.
9. A failed/slow Pi discovery returns an actionable unavailable state rather
   than breaking the rest of the cockpit.

## P2-4 boundaries

- Catalog discovery proves configured availability; it is not an automatic
  fallback or spend-policy decision.
- Owner manual model selection may use an available catalog route. Automatic
  orchestrator release continues to use declared Pink Guy route policy.
- OAuth-backed task concurrency remains one until P2-4 measurement proves a
  wider lane safe.
- A browser-native secret-entry flow would create a new credential-custody
  boundary and requires a separate owner-approved design. The TTY handoff is
  the current supported path.

## Acceptance

- A deterministic probe parses multiple providers and models, exposes no
  secret values, handles discovery failure, and verifies refresh behavior.
- The cockpit contains no provider/model free-text inputs for conversation
  switching or manual phase scheduling.
- Existing model-switch custody and phase-route provenance remain intact.
