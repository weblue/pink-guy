# Host and provider capacity calibration

Status: Recorder implemented; initial serialized calibration complete

Last updated: 2026-07-19

## Summary

Pink Guy records explicit, model-less calibration windows on the target Mac so
concurrency, storage, and provider policies come from measurements rather than
guesses. Calibration is owner-started and produces a portable JSON artifact;
it is not permanent telemetry.

## Behavior

1. An owner selects a label, duration, sampling interval, state root, and output
   path.
2. Every sample records host memory/load/pressure, selected Pink Guy/Pi/Docker
   process RSS and CPU, Pink Guy container CPU/memory, container count, and
   state-root size.
   Explicit `LABEL:PID` selectors distinguish control-plane and orchestrator
   processes without retaining their command lines.
3. Metadata records the tested Git revision, macOS/architecture, physical
   memory/CPU count, power state, Docker version and VM memory allocation.
4. The result contains raw samples plus peak/average/growth summaries.
5. Command lines, environment values, credentials, transcript content, and raw
   container output are excluded.
6. Output defaults under ignored `artifacts/benchmarks/`.
7. Sampling failure is retained as a bounded error in that sample rather than
   silently omitted.
8. Calibration itself performs no provider/model request and starts no
   workload.
9. Workload interpretation separates host pressure from retained-state
   amplification. A healthy RAM window does not make quadratic session or
   event retention acceptable.

## Acceptance

- A deterministic probe verifies parsing, redaction boundaries, summaries, and
  artifact output.
- A short idle run succeeds on the target M1 Max.
- Later controlled workload runs use the same recorder and revision.
- A multi-project run classifies state growth by database, native session,
  custody snapshot, artifact, and workspace rather than selecting a quota
  from the aggregate alone.
