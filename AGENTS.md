# AGENTS.md — Hoard

Canonical, tool-agnostic orientation for any AI coding agent or human contributor working in this
repo (Claude Code, Codex, Cursor, Aider, Zed, Gemini CLI, …). This file is self-contained: you can
run, build, test, and navigate Hoard from what's here without following any link. Links point to
`docs/` for depth, never for a baseline.

> Claude Code users: `CLAUDE.md` imports this file and adds a Claude-only section. Don't duplicate
> content here into `CLAUDE.md`.

---

## What Hoard is

A self-hosted web app for tracking game deals, managing a Steam library/backlog, and making
informed purchasing decisions from price history, review scores, and play-time estimates. Single
user, runs in Docker (typically a Synology NAS behind a Caddy reverse proxy). Status: all phases
shipped; active work is incremental.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) + React 19, TypeScript (strict) |
| Runtime | Node 22 LTS (`.nvmrc`), npm |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives, Lucide icons) |
| Tests | Vitest |
| Lint | ESLint 9 flat config (`eslint.config.mjs`) |
| Price data | IsThereAnyDeal API v2 |
| Durations | HowLongToBeat (unofficial npm package) |
| Library data | Steam Web API |
| Notifications | In-app + Discord webhooks (unified dispatcher) |
| Scheduling | node-cron, in-process |
| Deploy | Docker Compose (Synology + Caddy) |

## Commands

All commands run from the repo root. Use `npm`, not yarn/pnpm/bun.

```bash
npm install              # install dependencies (Node 22)
npm run dev              # dev server (http://localhost:3000)
npm run build            # production build
npm start                # serve a production build

npm run lint             # eslint . --max-warnings 0  (zero-warning gate, matches CI)
npm test                 # vitest run (one-shot)
npm run test:watch       # vitest watch mode
npm run test:coverage    # vitest with coverage

npm run db:push          # apply schema to the SQLite file (dev)
npm run db:generate      # generate a migration into drizzle/
npm run db:migrate       # apply migrations (prod-style)
npm run db:studio        # Drizzle Studio DB browser
npm run db:seed          # seed dev data (scripts/seed.ts)
```

There is no `tsc`-only script; `npm run build` is the type-check gate. CI runs lint, test, and build
(see `.github/workflows/ci.yml`).

## Repo map

```
src/
├── app/                      # Next.js App Router
│   ├── layout.tsx            # root layout + sidebar
│   ├── page.tsx              # dashboard
│   ├── library/  wishlist/  backlog/  games/[id]/  settings/   # pages
│   └── api/                  # route handlers, one dir per domain:
│       alerts auth backup games health hltb notifications
│       onboarding search settings setup steam sync version
├── components/
│   ├── ui/                   # shadcn/ui base components
│   ├── layout/ games/ prices/ filters/   # feature components
├── hooks/                    # client hooks (useInfiniteScroll, useScrollRestoration, …)
├── lib/
│   ├── config.ts             # env config + validateConfig()
│   ├── db/                   # schema.ts (all tables) + index.ts (singleton, WAL, FK pragma)
│   ├── steam/ itad/ hltb/    # external API clients (getXxxClient() singletons)
│   ├── discord/ notifications/   # outbound notification dispatch
│   ├── sync/                 # sync orchestration (writes external data → DB)
│   ├── scoring/              # value-scoring engine
│   ├── backlog/              # backlog query logic, presets, moods
│   ├── onboarding/           # wizard + drain orchestrator
│   ├── scheduler/            # cron task registry
│   └── utils/                # shared helpers
├── instrumentation.ts        # registers + starts the scheduler on server boot (Node runtime)
├── proxy.ts                  # auth + rate-limit + CSP nonce + demo-mode blocking (replaces middleware.ts)
└── types/index.ts            # shared types (EnrichedGame, GameFilters, ApiResponse<T>, …)
```

Path alias: `@/` → `src/`.

## Architecture in brief

**Cache-first.** All external data syncs into SQLite; the UI and API read exclusively from the DB
and never call Steam/ITAD/HLTB at request time. This keeps pages fast and resilient to upstream
outages.

```
Steam / ITAD / HLTB → sync (src/lib/sync) → SQLite ← UI + API reads → Discord (outbound only)
```

**Service layer.** Each external API has a client in `src/lib/{source}/` exposing a
`getXxxClient()` singleton with isolated error handling — one failing source never breaks another.
Rate limiting lives in the sync modules, not the clients.

**Scheduler.** `src/instrumentation.ts` registers cron tasks (price check, library sync, backup,
etc.) once on server boot. Tasks are skipped entirely in demo mode.

**Scoring.** `src/lib/scoring/` rates deals on configurable weights: price (closeness to all-time
low), review %, value ($/hour vs per-review-tier thresholds), and personal interest. Weights are
editable in Settings.

## Database

SQLite via Drizzle ORM. Schema is the single source of truth in `src/lib/db/schema.ts`; connection
singleton (WAL mode, foreign keys on) in `src/lib/db/index.ts`. Key tables: `games`, `tags`,
`game_tags`, `user_games`, `price_snapshots`, `price_alerts`, `settings`, `sync_log`.

Schema-change flow: edit `schema.ts` → `npm run db:generate` → review SQL in `drizzle/` →
`npm run db:push` (dev). SQLite notes: no `ALTER COLUMN`; timestamps stored as ISO TEXT
(`datetime('now')` default); booleans as INTEGER (`{ mode: 'boolean' }`); `settings` values are
JSON strings.

## Conventions

- **TypeScript strict, no `any`.** Annotate params and returns. Use types from `src/types/` or
  co-located `types.ts`. `import type` for type-only imports — and note it can't carry value exports
  (e.g. `DEFAULT_WEIGHTS`), so import those separately.
- **React:** Server Components by default; add `'use client'` only for interactivity. Stable `key`
  props; Next.js `<Image>` for images.
- **Styling:** Tailwind only, no inline styles. There is **no `cn()` helper** — concatenate classes
  with template literals (the established pattern). Use the theme tokens (`steam-*`, `deal-*`).
- **API routes:** App Router handlers, wrapped in try/catch, validate bodies with Zod `.safeParse()`,
  return the consistent `ApiResponse<T>` shape (`{ data, error?, meta? }`), guard non-public routes
  with `requireUserId` / `requireUserIdFromRequest`.
- **Naming:** Components `PascalCase.tsx`; utilities/clients `camelCase.ts`; types co-located in
  `types.ts`.
- **Next.js 16:** route/page `params` are a `Promise` — `await params` before use.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). Feature
  branches off `main` (the repo has branch protection — no direct pushes to `main`).

## Testing

Vitest. Tests are co-located as `*.test.ts` / `*.test.tsx` next to the code (≈86 files today). Match
the nearest existing test's structure. Cover business logic (scoring, sync, queries) and route
input/output. `npm test` must be green before a PR; `npm run lint` and `npm run build` must also
pass.

## Critical gotchas — read before changing these areas

- **Demo mode blocking.** When you add a **mutation endpoint**, also add its method + path prefix to
  `DEMO_BLOCKED` in `src/proxy.ts` — otherwise it leaks into the public demo. The proxy returns 403
  for matching requests when `DEMO_MODE=true`.
- **Migrations run on container boot** via `scripts/start.mjs` (tracked in `__drizzle_migrations`).
  **Never pre-apply a schema change manually on prod** — `start.mjs` will then fail with "duplicate
  column" and crash-loop. Trust the container's migration runner.
- **Back up before destructive schema changes.** `./scripts/backup.sh` (WAL-safe atomic SQLite
  `.backup`). A nightly `CRON_BACKUP` task also runs at 4am.
- **`proxy.ts`, not `middleware.ts`.** Next 16 renamed it (same API, Node runtime). Auth, rate
  limiting, CSP nonce, and demo blocking all live there.
- **Clients are server-only.** Never import a `src/lib/{source}/client.ts` from a `'use client'`
  component.

## Environment

Config is read in `src/lib/config.ts` (`validateConfig()` logs missing required vars). Copy
`.env.example` → `.env.local` (dev) or `.env.production` (prod); both are gitignored. Required:
`STEAM_API_KEY`, `STEAM_USER_ID`, `BETTER_AUTH_SECRET`. Recommended: `ITAD_API_KEY` (prices),
`DISCORD_WEBHOOK_URL` (alerts), `NEXT_PUBLIC_APP_URL` (must be set at **Docker build time** — it's
inlined by Next.js). `DEMO_MODE` / `NEXT_PUBLIC_DEMO_MODE` gate the public demo. Full reference:
[`docs/.../self-hosting/configuration.md`](docs/src/content/docs/self-hosting/configuration.md).

## Deeper reference (`docs/`)

The docs site (Astro Starlight) is the reference altitude — exhaustive detail this file only
summarizes:

- [Architecture & data flow](docs/src/content/docs/architecture/index.md)
- [Scoring engine](docs/src/content/docs/architecture/scoring-engine.md)
- [Design decisions](docs/src/content/docs/design-decisions.md)
- [Data sources](docs/src/content/docs/data-sources.md)
- [Features: backlog](docs/src/content/docs/features/backlog.md) · [alerts](docs/src/content/docs/features/alerts.md) · [value received](docs/src/content/docs/features/value-received.md)
- [Self-hosting](docs/src/content/docs/self-hosting/index.md) · [configuration](docs/src/content/docs/self-hosting/configuration.md) · [backups](docs/src/content/docs/self-hosting/backups.md) · [upgrading](docs/src/content/docs/self-hosting/upgrading.md)
- [Demo mode](docs/src/content/docs/demo.md)
- [Changelog](docs/src/content/docs/changelog.md)
