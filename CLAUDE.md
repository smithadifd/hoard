# CLAUDE.md — Hoard (Claude Code)

@AGENTS.md

Everything about Hoard — stack, commands, repo map, architecture, conventions, testing, and the
critical gotchas (DEMO_BLOCKED, boot-time migrations, backup-before-schema, `proxy.ts` not
`middleware.ts`) — lives in the imported [`AGENTS.md`](AGENTS.md). It's tool-agnostic and
self-contained; read it first. Personal/secret config lives in the gitignored `CLAUDE.local.md`
(shape in `CLAUDE.local.md.example`).

## Notes for Claude

- Custom agents in `.claude/agents/` (invoke `/agent <name>`): `phase-implementer`, `api-integrator`,
  `ui-builder`, `db-assistant`, `pre-commit-check`, `code-reviewer`, `plan-generator`. Each reads
  `AGENTS.md` for context. (`audit-orchestrator` is deprecated — use `audit-sweep`.)
- Full-codebase audits: the multi-agent `audit-sweep` skill (or
  `Workflow({ scriptPath: ".claude/workflows/audit-sweep.js" })`) fans out one read-only sub-agent
  per concern, writes `plans/NN-*.md`, and updates `plans/README.md` + `memory/audit-state.md`. Use
  `plan-generator` for a quick single-area pass. `plans/` is gitignored.
- Run `/review` (or the `reviewer`/`code-reviewer` agent) on the diff before declaring work done;
  apply mechanical fixes silently, surface real questions.
- Doc updates (CLAUDE.md / AGENTS.md / MEMORY.md / `plans/README.md`) ship in the same PR as the code.
- Conventional commits; never auto-push; confirm before destructive ops. No emojis unless asked.
- End-of-session ship steps (deploy script, boot-migration rule) are deploy-specific
  and live in the gitignored `CLAUDE.local.md`, not this committed shim.
