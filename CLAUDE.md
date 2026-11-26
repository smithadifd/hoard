# CLAUDE.md — Hoard (Claude Code)

@AGENTS.md

Everything about Hoard — stack, commands, repo map, architecture, conventions, testing, and the
critical gotchas (DEMO_BLOCKED, boot-time migrations, backup-before-schema, `proxy.ts` not
`middleware.ts`) — lives in the imported [`AGENTS.md`](AGENTS.md). It's tool-agnostic and
self-contained; read it first. Personal/secret config lives in the gitignored `CLAUDE.local.md`
(shape in `CLAUDE.local.md.example`).

## Notes for Claude

- Project-specific tooling is documented in `.claude/agents/`; each entry reads
  `AGENTS.md` for project context.
- Full-codebase audits use `.claude/workflows/audit-sweep.js`, which checks concerns
  in parallel, writes `plans/NN-*.md`, and updates `plans/README.md` and audit progress.
  For a single-area audit, use `.claude/agents/plan-generator.md`. `plans/` is gitignored.
- Run `/review` on the diff before declaring work done; apply mechanical fixes
  silently, surface real questions.
- Doc updates (CLAUDE.md / AGENTS.md / MEMORY.md) ship in the same PR as the code.
- Conventional commits; never auto-push; confirm before destructive ops. No emojis unless asked.
- Deployment instructions (deploy script, boot-migration rule) live in the gitignored
  `CLAUDE.local.md`, not this committed file.
