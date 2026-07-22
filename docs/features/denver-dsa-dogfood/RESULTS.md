# Denver DSA website dogfood results

Status: Complete

Last updated: 2026-07-22

## Outcome

Pink Guy imported `weblue/denver-dsa-test`, refined a prototype website brief,
implemented the Hugo/Tailwind site, recovered interrupted work, ran independent
test and review phases, integrated approved revisions, and published final
revision `b75c464` to `origin/main`. The completed site passed a clean
container build, 16 required-route checks, validation across 25 generated HTML
documents, link/fragment and accessibility checks, and a deterministic
responsive-navigation regression.

The experiment is complete. The repository is now an external product result
and a retained regression fixture; it is not an open Pink Guy implementation
task.

## What worked

- Project-scoped conversation intake produced executable work without forcing
  the owner through a fixed questionnaire.
- Deterministic scheduling advanced fixed-revision implementation to
  independent test and review without an LLM selecting the next queue item.
- Container isolation and Git worktrees kept implementation, validation, and
  review revisions inspectable and separate.
- Guarded recovery-revision adoption preserved substantial passing work after
  a failed execution without editing SQLite or exposing raw Git authority to a
  task container.
- A focused browser finding became a separate task and repeated the complete
  implementation/test/review/integration lifecycle.
- Clean-container validation caught host/container dependency assumptions and
  produced a reproducible repository-owned test path.

## Lessons learned

1. **A phase outcome must belong to its execution.** Historical task evidence
   cannot satisfy the current run. Context exhaustion or compaction without a
   new checkpoint is incomplete/resumable, never success.
2. **Queue progression should remain model-less.** Once intake has produced
   scoped work, the central scheduler—not the orchestrator model—should start
   test, review, completion, and eligible follow-up phases.
3. **Recovery is a normal lifecycle path.** Checkpoints, retained workspaces,
   revision adoption, stale-worker release, and superseded-attempt
   reconciliation need first-class audited operations.
4. **Orchestrator liveness cannot depend on child duration.** Heartbeats and
   conversation polling must continue while task agents run; an expired lease
   must renew safely or fail-stop for supervised restart.
5. **Tool output is part of the context budget.** Git inspection must cap text,
   summarize binary changes, and offer paged/artifact-backed detail. An 18 MB
   diff should never enter a Pi transcript.
6. **Durable inventory must understand generated trees.** Inactive
   `node_modules/.bin` symlinks must not prevent the whole API from starting,
   while unexpected symlinks in custody and artifact paths remain rejected.
7. **Structural tests do not replace a browser smoke test.** Route, markup,
   link, and accessibility checks all passed while primary navigation was
   invisible at the desktop breakpoint. The browser finding became a
   deterministic regression rather than a one-off visual fix.
8. **Model routing should reflect task risk.** A stronger model rescued the
   broad recovery/finalization task; the smaller default model handled the
   tightly scoped navigation follow-up. Pink Guy should preserve explicit
   per-task routing without silent fallback.
9. **Integration and publication are distinct owner-visible states.** Governed
   local integration worked, but the final remote publication still used an
   owner-side Git push. Pink Guy's push/PR adapter needs a live acceptance
   drill and clearer UI language.
10. **The cockpit needs outcome hierarchy.** The owner primarily needs the
    active task, current revision, gate results, actionable attention, and
    integration/publication state. Historical attempts remain available but
    must not dominate the working view.

## Next Pink Guy iteration: P2-4L lifecycle hardening

Implement and verify this bounded slice before Phase 2D:

1. Fence implementation/test/review evidence to the current execution
   baseline and add context-exhaustion/dirty-workspace regressions.
2. Reconcile stale worker ownership and superseded attention after a proven
   retry while preserving immutable history.
3. Decouple project-orchestrator heartbeats from long child waits and add
   bounded expired-lease recovery or fail-stop behavior.
4. Bound `boss_git_diff`, summarize binary changes, and retain full detail as
   an artifact or paged read rather than transcript payload.
5. Make state inventory classify generated dependency trees without relaxing
   custody-path symlink checks.
6. Re-run the Denver lifecycle fixtures plus the serialized two-project
   long-turn benchmark. No direct SQLite edit or manual artifact reconstruction
   is permitted.

After P2-4L passes, finish provider/model-switch, cleanup, storage-limit, and
Pink-owned publication drills; then enter the three-repository/ten-task Phase
2D window. UX interview and redesign remain Phase 2U, informed by that window.

## Known non-blocking website maintenance

The prototype still reports an npm audit finding, deprecated `glob`, Hugo
`.Site.Data` deprecation, and outdated Browserslist data. These are ordinary
repository maintenance, not unfinished Pink Guy experiment work.
