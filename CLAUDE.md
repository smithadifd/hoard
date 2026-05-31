# CLAUDE.md — Hoard (Claude Code)

@AGENTS.md

Everything about Hoard — stack, commands, repo map, architecture, conventions, testing, and the
critical gotchas (DEMO_BLOCKED, boot-time migrations, backup-before-schema) — lives in the imported
[`AGENTS.md`](AGENTS.md). It is tool-agnostic and self-contained; read it first. This file adds only
the Claude-Code-specific bits. Personal/secret config lives in the gitignored `CLAUDE.local.md`.

---

## Custom agents (`.claude/agents/`)

| Agent | Purpose |
|-------|---------|
| `phase-implementer` | Implements features/phases per the roadmap |
| `api-integrator` | External API work — Steam, ITAD, HLTB, Discord |
| `ui-builder` | React components following the design system |
| `db-assistant` | Schema changes, queries, migrations |
| `pre-commit-check` | Type-check, lint, build verification |
| `code-reviewer` | Code-quality review before merging |
| `plan-generator` | Audits **one focus area** and writes a single structured plan into `plans/` |
| `audit-orchestrator` | **Deprecated** — redirects to the `audit-sweep` workflow (see below) |

Invoke with `/agent <name>`. Each agent reads `AGENTS.md` for project context.

## Full-codebase audit — `audit-sweep` (default)

The default, preferred way to audit Hoard is the **multi-agent `audit-sweep`
workflow**, not the old single-agent `audit-orchestrator`. It fans out one
read-only sub-agent per concern (security, testing, maintainability, performance,
dependencies, error-handling, accessibility, consistency, correctness, docs),
then writes one `plans/NN-*.md` per concern and updates `plans/README.md` +
`memory/audit-state.md`.

- **Run it:** the `/audit-sweep` skill, or
  `Workflow({ scriptPath: ".claude/workflows/audit-sweep.js" })` (Hoard-tuned
  wrapper — injects Hoard lens hints + the memory audit-state path).
- **Source of truth:** the generic script lives in the toolkit
  (`~/claude-toolkit/workflows/audit-sweep.js`, symlinked to
  `~/.claude/workflows/`); the Hoard wrapper only adds project hints.
- **After it runs:** spot-check a few findings against cited `file:line`, confirm
  numbering continues cleanly, and report the roll-up. Plans are gitignored.
- Use `plan-generator` instead for a quick single-area pass.

---

## End-of-session workflow

When the user says "commit, push, check GH actions, deploy" (or similar):

1. **Branch** — feature branch (`feat/…`, `fix/…`) off `main` (branch protection; no direct push).
2. **Commit** — stage relevant files, Conventional Commit message.
3. **Push** — `git push -u origin <branch>`.
4. **PR** — `gh pr create` with summary + test plan.
5. **CI** — `gh run watch <run-id> --exit-status`; wait for "Lint & Build" and "Docker Build".
6. **Merge** — `gh pr merge <n> --squash --delete-branch`, then `git checkout main && git pull`.
7. **Deploy** — after main CI is green, `./scripts/deploy.sh` (builds + deploys to the Synology NAS).
8. **Migrations** — applied automatically on container boot by `scripts/start.mjs`; never pre-apply
   on prod (see AGENTS.md gotchas).
9. **Docs** — update `MEMORY.md`, this file (if status changed), and `plans/README.md` (if a plan
   completed) in the same PR as the code change.

---

## Notes for Claude

- Run `/review` (or the `reviewer`/`code-reviewer` agent) on the diff before declaring work done;
  apply mechanical fixes silently, surface real questions.
- Doc updates (CLAUDE.md / AGENTS.md / MEMORY.md / `plans/README.md`) ship in the same PR as the
  code, not a follow-up.
- `plans/` is gitignored — local workflow reference only.
- Conventional commits; never auto-push; confirm before destructive ops (`rm -rf`,
  `git reset --hard`, force-push, dropping tables). No emojis unless asked.
