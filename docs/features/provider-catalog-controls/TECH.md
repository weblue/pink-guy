# Provider catalog and authentication guidance

Status: Approved for P2-4 implementation

Last updated: 2026-07-19

## Design

`PiProviderCatalog` is a replaceable host service. It invokes:

```sh
PI_CODING_AGENT_DIR=/owner/managed/pi-directory pi --list-models
```

through `execFile`, with a short timeout and bounded output. The parser treats
Pi's stable six-column table as an external adapter format and returns
normalized model records. Tests inject a fake Pi executable rather than
calling a provider.

The service reads only the top-level provider keys and credential `type` from
the configured `auth.json`. It never returns or logs nested credential values.
The result is cached briefly; explicit refresh bypasses the cache.

## API

- `GET /api/provider-catalog`
- `POST /api/provider-catalog/refresh`

Both are loopback-owner surfaces in the current profile. The response contains:

- `status`, `models`, and grouped `providers`;
- `authenticated_providers` with non-secret authentication type only;
- `configured_routes`;
- `discovered_at`, Pi command/version where available, and an actionable error;
- terminal authentication instructions and a copyable command.

## UI

The cockpit loads the provider catalog with its other shared projections.
Reusable rendering functions populate paired provider/model `<select>`
elements for:

- the durable conversation route editor; and
- manual phase scheduling in the selected task workspace.

The provider-management disclosure lists discovered/authenticated providers,
explains that `/login` handles both OAuth and API-key providers, offers a
copyable TTY command, and refreshes discovery after setup.

If discovery fails or a current route is no longer listed, the UI injects that
route as an explicitly unverified option so custody/recovery remains possible.

## Failure and security properties

- timeout, missing Pi, malformed output, or unreadable auth metadata produces
  `status: unavailable` and a redacted error class/message;
- stdout/stderr are not persisted;
- catalog reads make no model inference request;
- the API never accepts a credential value;
- provider/model selection does not mutate route-policy configuration;
- automatic dispatch continues to validate configured routes.

## Verification

`probe-phase2-provider-catalog.mjs` uses a fake Pi command and temporary
auth/config files to verify discovery, grouping, credential redaction, refresh,
failure behavior, API projection, and cockpit selector/auth guidance.
