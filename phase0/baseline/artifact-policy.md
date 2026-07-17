# Phase 0 artifact policy

The repository retains small schemas, deterministic fixtures, executable probes, redacted evidence manifests, and reviewed configuration examples. Runtime databases, native sessions, provider output, command logs, credentials, temporary worktrees, container filesystems, and large artifacts remain outside Git.

Every referenced runtime artifact has a SHA-256 checksum, media type, retention owner, and a redacted logical path in its evidence manifest. A manifest is the durable claim; a temporary path is not a promise that the artifact remains on the development host indefinitely.

Probes use isolated temporary homes and must not inherit provider credentials unless a named test explicitly requires synthetic credentials. Real secrets, SSH keys, subscription tokens, and production configuration are prohibited. Environment variables are recorded by name only. Commands are executed without a shell by the shared runner unless a probe explicitly owns and documents shell semantics.

Failed probes may retain disposable output long enough for diagnosis, but no output enters Git until it has been inspected for secrets and intentionally represented by a redacted manifest. Native Pi JSONL and raw command output remain authoritative runtime evidence even when normalized or filtered derivatives exist.
