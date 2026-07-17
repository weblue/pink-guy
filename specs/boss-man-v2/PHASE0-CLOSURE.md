# Boss Man v2 Phase 0 closure plan

Status: Implementation active

Foundation: Thin direct-Pi control plane

## Objective

Turn the independently passing Phase 0 contracts into one daemon-owned vertical slice. This milestone closes the remaining hard-gate uncertainty; it is not a production UI build or deployment.

## Execution order

### C0-01 Authoritative task and policy transaction

- Move the task-policy transition rules behind the direct control-plane API.
- Persist capabilities, assignments, reviews, protected decisions, validation, and merge requests in the authoritative SQLite transaction.
- Reject competing writers, stale revisions, duplicate idempotency keys, self-approval, and completion with unresolved decisions.

Exit: the current task-policy fixture passes through the real HTTP/store boundary and produces one ordered audit stream.

### C0-02 Daemon-owned run, container, credential, and Git capabilities

- Replace the direct prototype's host Pi/shell processes with the pinned task image.
- Let the daemon create and inspect containers; never expose the Docker socket to the task container.
- Deliver per-run credentials from a human-managed source into an isolated read-only mount.
- Expose status, diff, checkpoint, commit request, and merge request as daemon capabilities while keeping shared Git metadata outside the container.
- Ingest RTK filtered output, redacted raw output, exit state, and receipts into the artifact store.

Exit: the P0-04 fixture runs through the direct daemon, including an agent edit and host-owned provenance checkpoint, with zero credential canary leakage.

### C0-03 Restart and side-effect reconciliation

- Persist intent and completion receipts around container, tool, snapshot, and Git side effects.
- Reconcile idle, active-response, active-tool, snapshot, and checkpoint states after daemon restart.
- Reattach only when identity and liveness are proven; otherwise pause as `reconciliation_required` rather than replaying.

Exit: crash tests lose no native session, duplicate no completed side effect, and never report an ambiguous run as healthy.

### C0-04 Unified context custody and governed retrieval

- Connect native Pi snapshot/export and canonical task/memory export to one atomic manifest.
- Run scoped FTS selection before context assembly and persist the complete context receipt.
- Preserve source revisions, exclusions, scores, excerpt checksums, and unknown Pi entries.
- Prove import and retrieval with network, models, embeddings, and derived indexes absent; rebuild FTS from canonical records.

Exit: a resumed session and a bundle-mode child consume checksum-bound artifacts and receipts without transcript injection or model-assisted export.

### C0-05 Real owner authentication through the edge contract

- Implement the single-owner passphrase verifier, rate limiting, secure device sessions, CSRF, revocation, and recovery/bootstrap boundary.
- Run the real direct application through the disposable SWAG-style proxy suite.
- Keep the checked-in SWAG configuration inert; do not change DNS, router, home-server, or long-lived deployment state.

Exit: HTTP, WebSocket, streaming, artifact, reconnect, Host/Origin, outer/inner auth, CSRF, and revocation cases pass against the selected application.

### C0-06 Reproduction and owner checkpoint

- Reproduce the fixture, task image, and closure suite on a second clean ARM64 host.
- Publish final candidate-level hard-gate manifests and update the scorecard from partial/component to pass or fail.
- Review disk/resource measurements and explicitly choose initial concurrency limits for the 64 GB M1 Max host.

Exit: every still-applicable direct-Pi hard gate has candidate-level evidence, the working tree is reproducible, and the owner authorizes Phase 1.

## Progress

The concise current capability and artifact inventory is maintained in `CURRENT-STATE.md`.

| Work package | Status | Evidence |
|---|---|---|
| C0-01 task and policy transaction | Completed | `P0-DIRECT-TASK-POLICY`: real HTTP/SQLite capability path, 13 ordered committed events, competing-writer conflict, fixed-revision review, owner decision, and gated merge request |
| C0-02 runtime/Git/credentials/RTK | Completed | `P0-DIRECT-RUNTIME-GIT-RTK` proves the synthetic isolation/custody path; `P0-DIRECT-LIVE-PROVIDER` proves one owner-authorized OpenAI Codex turn and Pi Bash→RTK artifact path without changing the canonical credential or retaining run copies |
| C0-03 restart reconciliation | Completed | `P0-DIRECT-RESTART-RECONCILIATION`: intent/completion receipts, verified-idle pause, uncertain response/tool hold, checksum snapshot recovery, and provenance Git recovery with no replay |
| C0-04 context and retrieval | Completed | `P0-DIRECT-CONTEXT-CUSTODY`: atomic 11-file bundle, native-byte and future-entry preservation, scoped FTS receipt/exclusions, canonical clean-store rebuild, transcript-free Pi bundle child, and one-project-orchestrator lease enforcement with no provider/network use |
| C0-05 owner authentication | Pending | Disposable edge contract passes; real application auth pending |
| C0-06 second-host reproduction | Pending | Runs after the integrated closure suite |

## Sequencing

C0-04 joins the already-proven native custody and governed FTS primitives through one authoritative context path and is complete. C0-05 is next. C0-06 runs last.

The integration owner controls schema changes and final merges. Each implementation task includes unit tests for isolated policy/serialization behavior and integration tests at daemon, container, Git, custody, or edge boundaries as appropriate.

## Explicitly out of scope

- production SWAG, DNS, router, launch-service, or secret deployment;
- automatic OpenRouter failover;
- semantic/vector memory;
- broad cockpit visual polish;
- Slack/email notifications; and
- an Agent of Empires fork or runtime dependency.
