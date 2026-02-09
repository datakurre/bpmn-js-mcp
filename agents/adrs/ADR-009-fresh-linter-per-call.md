# ADR-009: Fresh Linter instance per call

## Status

Accepted

## Decision

bpmnlint's `Linter` class caches rule factory results in `this.cachedRules`. Some rules (e.g. `no-duplicate-sequence-flows`) use closure state (`const keyed = {}`) that accumulates across `lint()` calls and never resets. When a single Linter instance was reused, this caused false positives. `createLinter()` creates a fresh instance each time to ensure clean rule closures.
