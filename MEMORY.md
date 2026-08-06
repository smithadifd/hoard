# MEMORY.md — Hoard

Facts-only reference, seeded 2026-08-06. Named as a doc surface in `CLAUDE.md:22` ("Doc updates
(CLAUDE.md / AGENTS.md / MEMORY.md) ship in the same PR as the code") long before this file existed.
See `AGENTS.md` for the full project guide and `CLAUDE.md` for Claude-specific notes.

## Identity

- Public GitHub repo, MIT license (`LICENSE`).
- `package.json`: name `hoard`, version `1.0.0`.
- Node 22 LTS pinned in `.nvmrc` (`22`); package manager is npm, not yarn/pnpm/bun (AGENTS.md,
  CONTRIBUTING.md).
- Stack: Next.js 16 (App Router) + React 19, TypeScript strict, SQLite via Drizzle ORM +
  better-sqlite3, Tailwind + shadcn/ui, Vitest, ESLint 9 flat config (AGENTS.md § Tech stack).

## Deployment

- Production runs on the Synology NAS via Docker Compose, behind a Caddy reverse proxy at a
  `*.home` hostname.
- `docker-compose.prod.yml` maps host port **3001** to container port 3000; `APP_URL` defaults to
  `https://hoard.home`.
- `scripts/deploy.sh` deploys the `main` branch to the NAS over SSH (`ssh synology`), remote path
  `/volume3/docker/hoard`, and its preflight check aborts if the local branch isn't `main`.
- Migrations apply automatically on container boot via `scripts/start.mjs` — never pre-apply a
  schema change manually on prod (AGENTS.md § Critical gotchas).
- A separate public demo runs from `docker-compose.demo.yml` (host port 3011, `DEMO_MODE=true`,
  deployed on AWS EC2 per the file's own comment). README.md lists the live URL as
  hoard.smithadifd.com.
- `main` has branch protection; no direct pushes (AGENTS.md § Conventions, CONTRIBUTING.md).

## CI (`.github/workflows/`)

- `ci.yml`: on push/PR to `main` — `npm audit --audit-level=high --omit=dev` (warn-only, does not
  fail the job), `npm run lint`, `npm test`, `npm run build`; plus a separate Docker Build job
  (build-only, no push).
- `docs.yml`: builds the `docs/` Astro Starlight site and deploys it to GitHub Pages on push to
  `main` (path-filtered to `docs/**`).

## Commands (`package.json` scripts)

- `npm run dev` / `npm run build` / `npm start`
- `npm run lint` = `eslint . --max-warnings 0` (CI's gate is zero warnings)
- `npm test` = `vitest run`; also `test:watch`, `test:coverage`
- `npm run db:generate` / `db:push` / `db:migrate` / `db:studio` / `db:seed`

## Doc surfaces

- `AGENTS.md` — canonical, tool-agnostic project guide (stack, commands, repo map, architecture,
  gotchas). `CLAUDE.md` is a thin shim that imports it plus Claude-only notes.
- `CLAUDE.local.md` — gitignored, per-machine; shape documented in `CLAUDE.local.md.example`.
- `plans/` is gitignored (`.gitignore:52-53`) — it will not exist in a fresh clone or worktree.
- `docs/` — the Astro Starlight site published by `docs.yml`.
- This file did not exist before this PR, despite being named in `CLAUDE.md:22`.

## History

- `AGENTS.md`'s Testing section states test coverage qualitatively ("a broad automated test suite")
  rather than as a number. PR #293 (`docs: qualitative test-suite wording in AGENTS.md (no drifting
  count)`, merged 2026-07-18) replaced a prior numeric count with that qualitative wording; the PR's
  own body states the reason: the number kept re-drifting across sessions.
