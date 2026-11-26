---
name: audit-orchestrator
description: DEPRECATED — superseded by the `audit-sweep` workflow/skill. Kept as a redirect so existing references resolve.
tools: Read
model: haiku
---

# Retired audit entry point

For a full-codebase audit, use `.claude/workflows/audit-sweep.js`. It checks
security, testing, maintainability, performance, dependencies, error handling,
accessibility, consistency, correctness, and documentation in parallel, then
writes one plan per concern into `plans/` and updates `plans/README.md`.

Invoke the repository wrapper with
`Workflow({ scriptPath: ".claude/workflows/audit-sweep.js" })`.
Its external tooling dependency and default output locations are specified in
that file; those defaults need configuring for a different checkout.

For a single-area audit and one plan, use `.claude/agents/plan-generator.md`.
