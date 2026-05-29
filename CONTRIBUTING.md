# Contributing to Hoard

Thanks for your interest in Hoard — a self-hosted game deal tracker and backlog manager. This is a
small, single-maintainer project, but contributions and bug reports are welcome.

## Orientation

Start with **[`AGENTS.md`](AGENTS.md)**. It's the canonical project guide — stack, exact
run/build/test/lint commands, repo map, architecture, conventions, and the gotchas that will bite
you if you skip them. It's written for AI coding agents but reads just as well for humans, and it's
kept current. The [`docs/`](docs/) site (Astro Starlight) holds the deeper reference material.

## Quick start

```bash
nvm use            # Node 22 (see .nvmrc)
npm install
cp .env.example .env.local   # fill in STEAM_API_KEY, STEAM_USER_ID, BETTER_AUTH_SECRET
npm run db:push    # create the SQLite schema
npm run dev        # http://localhost:3000
```

See [`docs/.../self-hosting/configuration.md`](docs/src/content/docs/self-hosting/configuration.md)
for the full environment-variable reference.

## Making a change

1. Branch off `main` (`feat/…`, `fix/…`, `docs/…`). `main` is protected — no direct pushes.
2. Follow the conventions in [`AGENTS.md`](AGENTS.md): TypeScript strict (no `any`), Server
   Components by default, Tailwind-only styling, the `ApiResponse<T>` route shape.
3. Add or update tests next to the code you touch (`*.test.ts` / `*.test.tsx`, run with `npm test`).
4. Before opening a PR, make sure these pass — they're the CI gate:
   ```bash
   npm run lint     # eslint . --max-warnings 0
   npm test
   npm run build
   ```
5. Use [Conventional Commit](https://www.conventionalcommits.org/) messages (`feat:`, `fix:`,
   `docs:`, `refactor:`, `chore:`).
6. Open a PR with a short summary and a test plan. CI runs "Lint & Build" and "Docker Build".

## A few things that will save you time

- **Adding a mutation API endpoint?** Add its method + path prefix to `DEMO_BLOCKED` in
  `src/proxy.ts`, or it leaks into the public demo.
- **Schema change?** Edit `src/lib/db/schema.ts`, then `npm run db:generate` and `npm run db:push`.
  Migrations apply automatically on container boot in production — never hand-apply them on a live
  instance.
- **Touching the DB on a real instance?** Take a backup first: `./scripts/backup.sh`.

Full detail on all of the above lives in [`AGENTS.md`](AGENTS.md). When in doubt, match the
surrounding code.
