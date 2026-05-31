---
name: audit-orchestrator
description: DEPRECATED — superseded by the `audit-sweep` workflow/skill. Kept as a redirect so existing references resolve.
tools: Read
model: haiku
---

# Retired — use `audit-sweep` instead

This single-agent, sequential auditor has been **replaced by the multi-agent
`audit-sweep` workflow** (toolkit `workflows/audit-sweep.js`, surfaced as the
`/audit-sweep` skill and the Hoard wrapper at `.claude/workflows/audit-sweep.js`).

The workflow does everything this agent did and more: it fans out one **read-only
sub-agent per concern** (security, testing, maintainability, performance,
dependencies, error-handling, accessibility, consistency, correctness/bug-hunt,
docs) in parallel, then writes **one plan file per concern** into `plans/` (no
3-plan cap) and updates `plans/README.md` + the project audit-state file. The lens
checklists that used to live in this file now live inline in the workflow script,
which is the single source of truth.

**To run an audit:** invoke the `audit-sweep` skill, or
`Workflow({ scriptPath: "/Users/andrew/hoard/.claude/workflows/audit-sweep.js" })`
(Hoard-tuned wrapper) / `~/.claude/workflows/audit-sweep.js` (generic).

For a quick single-area pass instead of a full sweep, the **`plan-generator`**
agent still audits one focus area and writes one plan.
