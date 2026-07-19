# Provider catalog and authentication guidance results

Status: Implemented; deterministic and local-browser acceptance complete

Last updated: 2026-07-19

## Evidence

`npm run test:providers` proves:

- multiple providers/models parse from Pi's catalog adapter;
- provider authentication type is projected without credential values;
- discovery caching and explicit refresh;
- unavailable/missing Pi behavior with redacted errors;
- API and terminal-client projection;
- provider/model selectors replace the conversation and manual-phase text
  fields; and
- the cockpit contains the host-TTY `/login` guidance and no browser secret
  input.

The probe makes zero provider/model requests.

Local browser acceptance against Pi 0.80.9 discovered seven authenticated
`openai-codex` models, rendered them in the durable conversation selector,
showed OAuth metadata without token material, displayed the copyable
`PI_CODING_AGENT_DIR=… pi` plus `/login` handoff, and refreshed the catalog
without restarting the server. The browser check also caught and fixed an
async refresh-button state bug.

`npm run pink -- models` and `npm run pink -- models --refresh` expose the same
catalog and authentication handoff for cmux/tmux use.
