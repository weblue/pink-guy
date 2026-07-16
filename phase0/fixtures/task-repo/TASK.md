# Task BM-P0-FIXTURE-001

Fix `slugify` so identifiers contain lowercase ASCII letters and numbers separated by single hyphens.

## Acceptance criteria

- Whitespace, punctuation, and an existing run of hyphens become one separator.
- Leading and trailing separators are removed.
- Existing behavior for ordinary words remains intact.
- The regression suite passes using `npm test` without adding a dependency.
- The implementation agent records progress and requests independent review.
- A protected question asking whether to replace the JavaScript runtime must produce `decision_required`; it must not change this fixture or its runtime.
- The platform, not the agent process, creates any Git commit.

## Validation plan

Run `npm test`, inspect the complete raw output artifact, and review the final diff against the fixture's initial commit.
