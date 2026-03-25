# Hoard - Game Deal Tracker & Backlog Manager

## Project Overview

Self-hosted web application for tracking game deals, managing a Steam library/backlog, and making informed purchasing decisions based on price history, review scores, and play time estimates. Built for deployment on a Synology NAS via Docker.

**Status**: All phases complete. All 6 polish plans done.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) / TypeScript |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Styling | Tailwind CSS + shadcn/ui |
| Price Data | IsThereAnyDeal API v2 |
| Game Duration | HowLongToBeat (unofficial npm package) |
| Library Data | Steam Web API |
| Notifications | Discord Webhooks |
| Scheduling | node-cron (in-process) |
| Deployment | Docker Compose (Synology NAS + Caddy reverse proxy) |

---

## Directory Structure

```
hoard/
├── CLAUDE.md                    # This file - project context (committed)
├── CLAUDE.local.md              # Personal config/secrets context (gitignored)
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
├── docker-compose.yml           # Development
├── docker-compose.prod.yml      # Production (Synology + Caddy)
├── docker/
│   └── Dockerfile               # Multi-stage production build
├── drizzle/                     # Generated migrations
├── scripts/                     # Utility scripts
├── public/                      # Static assets
├── .claude/
│   └── settings.local.json      # Claude Code local permissions
└── src/
    ├── app/                     # Next.js App Router
    │   ├── layout.tsx           # Root layout with sidebar
    │   ├── page.tsx             # Dashboard
    │   ├── library/             # Owned games browser
    │   ├── wishlist/            # Wishlist with deal indicators
    │   ├── backlog/             # Backlog recommender
    │   ├── games/[id]/          # Game detail page
    │   ├── settings/            # Configuration
    │   └── api/                 # API routes
    │       ├── steam/           # Steam sync endpoints
    │       ├── games/           # Game CRUD
    │       ├── prices/          # Price checking
    │       ├── alerts/          # Alert management
    │       └── sync/            # Sync operations
    ├── components/
    │   ├── ui/                  # shadcn/ui base components
    │   ├── layout/              # Sidebar, Header
    │   ├── games/               # GameCard, GameGrid
    │   ├── prices/              # PriceBadge, DealIndicator
    │   └── filters/             # GameFilters
    ├── lib/
    │   ├── config.ts            # Environment configuration
    │   ├── db/
    │   │   ├── schema.ts        # Drizzle schema (all tables)
    │   │   └── index.ts         # DB connection singleton
    │   ├── steam/               # Steam API client
    │   ├── itad/                # IsThereAnyDeal API client
    │   ├── hltb/                # HowLongToBeat client
    │   ├── discord/             # Discord webhook client
    │   ├── scoring/             # Value scoring engine
    │   └── scheduler/           # Cron task management
    └── types/
        └── index.ts             # Shared TypeScript types
```

---

## Database Schema

SQLite database managed by Drizzle ORM. Key tables:

| Table | Purpose |
|-------|---------|
| `games` | Central game entity - Steam data, reviews, HLTB durations, metadata |
| `tags` | Genres, categories, Steam tags |
| `game_tags` | Many-to-many: games ↔ tags |
| `user_games` | User's relationship to games - owned, wishlisted, playtime, interest |
| `price_snapshots` | Historical price tracking across stores |
| `price_alerts` | Watchlist with price thresholds for notifications |
| `settings` | App configuration (scoring weights, etc.) |
| `sync_log` | Track sync operations and their status |

Schema is defined in `src/lib/db/schema.ts`. Run migrations with `npm run db:push`.

---

## Data Sources

| Source | Purpose | Auth | Notes |
|--------|---------|------|-------|
| Steam Web API | Library, wishlist, reviews, metadata | API key | 100k calls/day, profile must be public |
| IsThereAnyDeal v2 | Prices, historical lows, deals across stores | API key | Free, heuristic rate limits |
| HowLongToBeat | Game duration estimates | None (unofficial) | Scraping-based, cache aggressively |
| Discord Webhooks | Price alert notifications | Webhook URL | Simple POST requests |
| loaded.com/Eneba | Additional pricing | Link-out only | No API, generate search URLs |

---

## Architecture Patterns

### Data Flow
All external API data syncs through a cache layer into SQLite. The UI reads exclusively from the database, never making live API calls. This keeps the UI snappy and resilient to API outages.

```
Steam API → sync → SQLite ← UI reads
ITAD API  → sync ↗
HLTB      → sync ↗
```

### Service Layer
Each external API has its own client class in `src/lib/`:
- Singleton pattern via `getXxxClient()` functions
- Independent error handling and retry logic
- Rate limiting built into batch operations
- All clients are imported server-side only

### Scoring Engine
The value scoring engine (`src/lib/scoring/`) evaluates deals based on configurable weights:
- **Price Score**: How close to all-time low
- **Review Score**: Steam review percentage
- **Value Score**: $/hour relative to thresholds per review tier
- **Interest Score**: Personal 1-5 rating

Weights and thresholds are user-configurable via the Settings page.

---

## Development Commands

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Database
npm run db:push          # Apply schema to SQLite
npm run db:generate      # Generate migration files
npm run db:studio        # Open Drizzle Studio (DB browser)

# Docker (development)
docker compose up -d

# Docker (production - Synology)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Linting
npm run lint
```

---

## Code Conventions

### TypeScript
- Strict mode enabled, no `any` types
- Functional components with hooks
- Server Components by default, `'use client'` only when needed
- Path aliases: `@/` maps to `src/`

### File Naming
- Components: `PascalCase.tsx`
- Utilities/clients: `camelCase.ts`
- Types: co-located in `types.ts` next to their client

### API Routes
- Use Next.js App Router route handlers
- Return consistent `{ data, error?, meta? }` shape
- Log errors server-side, return clean messages to client

### Git
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Feature branches from `main`
- `.env.local` and `CLAUDE.local.md` are gitignored

---

## Phased Roadmap

### Phase 1: Foundation + Steam Integration ← COMPLETE
- [x] Project scaffolding, Docker, database schema
- [x] Steam API authentication (API key based)
- [x] Import library with playtime
- [x] Import wishlist
- [x] Basic game list/grid view with search and sort
- [x] Game detail page with Steam data + reviews
- [x] Settings page for API key configuration

### Phase 2: Price Intelligence ← COMPLETE
- [x] ITAD integration for current prices across stores
- [x] Historical low data from ITAD
- [x] Deal quality indicator (current vs. ATL)
- [x] loaded.com/Eneba link-out per game
- [x] Start snapshotting prices on schedule
- [x] Price comparison on game detail page

### Phase 3: Duration & Value Scoring ← COMPLETE
- [x] HowLongToBeat integration with caching
- [x] HLTB backfill for existing library
- [x] $/hour calculations
- [x] Configurable value scoring engine
- [x] Deal score display on game cards and detail page

### Phase 4: Backlog Recommender ← COMPLETE
- [x] Filter by duration, genre, tags, co-op
- [x] "Pick for me" random selection with active filters
- [x] "Date night" preset (co-op + short duration)
- [x] Unplayed/underplayed game highlighting

### Phase 5: Alerts & Discord ← COMPLETE
- [x] Watchlist management (flag games, set thresholds)
- [x] Scheduled price checking via cron (chained after price sync)
- [x] Discord webhook notifications
- [x] Alert history and management
- [x] Dedicated /watchlist page with table view
- [x] Settings: alert throttle config + test webhook button

### Phase 6: PWA & Mobile-Responsive ← COMPLETE
- [x] PWA via @serwist/turbopack with service worker
- [x] Mobile-responsive layout (bottom tab bar, card layouts)
- [x] Touch-friendly controls (44px targets, stacked inputs)

### Polish Plans (all complete)
- [x] Plan 1: Automated Backups (SQLite .backup, retention, cron)
- [x] Plan 2: Security Hardening (Zod validation, rate limiting, security headers)
- [x] Plan 3: Testing Infrastructure (11 files, 208+ tests, Vitest)
- [x] Plan 4: Authentication (Better Auth, credentials-based, setup/login)
- [x] Plan 5: DRY & Consistency (SSE utility, useApiMutation, API helpers)
- [x] Plan 6: Observability & Monitoring (health endpoint, Discord ops alerts, sync history, stale data banner)

### UI Overhaul Plans (all complete)
- [x] Plan 7: Wishlist Revamp (deal score recompute, data completeness filter, isReleased, DataStatus, store links)
- [x] Plan 8: Price Visualization (Recharts AreaChart, best-price-per-day aggregation, time range selector)
- [x] Plan 9: Backlog Overhaul (strict filters, smart threshold, mood picker, slot machine animation)
- [x] Plan 11: User Menu & Settings Split (header user menu, mobile sign-out, settings sub-pages)
- [x] Plan 12: Enrichment Observability (shared SyncStats types, per-game try-catch, success rate alerts, weekly health summary)

### Feature Plans
- [x] Plan 15: Wishlist Game Removal (local removal, sync guard, Steam source-of-truth auto-removal, cascade deactivation)
- [x] Plan 16: Separate Releases from Wishlist (/releases page, nav overhaul, release date parsing, release status sync, Discord notifications)

### Future Ideas
- Price trend visualization (from accumulated snapshots)
- AI-powered game recommendations
- Multi-user support
- SteamDB link integration
- Game comparison tool

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | SQLite path (default: `./data/hoard.db`) |
| `STEAM_API_KEY` | Yes | Steam Web API key |
| `STEAM_USER_ID` | Yes | Your Steam64 ID |
| `ITAD_API_KEY` | Phase 2 | IsThereAnyDeal API key |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for deal alerts |
| `DISCORD_OPS_WEBHOOK_URL` | No | Discord webhook for ops alerts (falls back to deals) |
| `BETTER_AUTH_SECRET` | Yes | Secret key for session encryption |
| `CRON_PRICE_CHECK` | No | Price check schedule (default: every 12h) |
| `CRON_LIBRARY_SYNC` | No | Library sync schedule (default: daily 3am) |
| `TRUSTED_ORIGINS` | No | Comma-separated additional trusted origins for auth |
| `ALERT_THROTTLE_HOURS` | No | Min hours between alerts per game (default: 24) |
| `DEMO_MODE` | No | Set `true` to enable demo mode (blocks mutations, disables cron) |
| `NEXT_PUBLIC_DEMO_MODE` | No | Set `true` for client-side demo UI (credentials on login, settings disabled) |

---

## Demo Mode

For public demo deployment at `https://hoard.smithadifd.com`. Controlled by `DEMO_MODE=true` env var.

### What it does
- **DemoBanner**: Amber bar at top of every page ("Demo Mode — data resets weekly. View source on GitHub")
- **Demo credentials**: Shown on login page (`demo@example.com` / `demo1234!`)
- **Mutation blocking**: Proxy returns 403 for sync, steam, prices, backup, settings, setup, alert test endpoints
- **Scheduler disabled**: All cron tasks skip registration in demo mode
- **Settings hidden**: API key fields and sync buttons replaced with "disabled in demo mode" messages
- **Session expiry**: 24h instead of 30 days

### Demo data
- `scripts/export-demo-db.mjs <source-db>` — sanitizes a prod DB copy (strips notes, interest, thresholds, API keys, auth data)
- `data/demo/demo-seed.db` — pre-sanitized SQLite shipped in Docker image (~2.8MB, 538 games, 15k price snapshots)
- `scripts/seed-demo.mjs` — creates demo user account on startup, links exported user_games

### Demo deployment
- `docker-compose.demo.yml` — port 3011, 300MB memory limit
- `scripts/deploy-demo.sh` — SSH to EC2 `demo` host, pull, build, restart
- `.env.demo` on EC2 contains only `BETTER_AUTH_SECRET`

### Guidelines
- Existing Synology production workflow is completely untouched
- Demo data refreshed by re-running `export-demo-db.mjs` against prod
- Weekly reset via EC2 cron (delete volume + restart container)

---

## Known Issues

- **esbuild vulnerability (GHSA-67mh-4wv8-2f99)**: Dev-only vulnerability inherited from better-auth → drizzle-kit → @esbuild-kit/esm-loader. Affects development server only (allows any website to send requests to `localhost:3000` and read responses). Does NOT affect production builds. Mitigation: only run dev server on trusted networks, use firewall rules to block external access to port 3000. Upstream fix pending.

---

## Working with This Project

### When starting a new phase:
1. Read this file and the relevant phase requirements above
2. Check existing implementations for patterns to follow
3. Build data layer first (schema changes → client methods)
4. Add API routes
5. Build UI components
6. Test end-to-end

### Adding a new external data source:
1. Create types in `src/lib/{source}/types.ts`
2. Create client in `src/lib/{source}/client.ts` with singleton pattern
3. Add relevant schema changes to `src/lib/db/schema.ts`
4. Create sync API route in `src/app/api/sync/`
5. Register cron task in `src/lib/scheduler/`

### Key design decisions:
- **SQLite over PostgreSQL**: Single-file database, no container needed, perfect for NAS. Swap to PostgreSQL via Drizzle if needed later.
- **In-process cron over separate worker**: Simpler deployment, fine for this scale. node-cron runs inside the Next.js process.
- **Cache-first architecture**: All data goes to DB first, UI reads from DB. Never block UI on external API calls.
- **HLTB via unofficial package**: Fragile but only option. Wrapped in error handling so app works without it.

---

## Backup & Restore

SQLite is a single file, making backups straightforward. Scripts are in `scripts/`.

```bash
# Backup (uses SQLite .backup command for safe, atomic copies)
./scripts/backup.sh                         # Default: ./data/backups/
./scripts/backup.sh /volume1/backups/hoard  # Custom path (e.g., Synology share)

# List available backups
./scripts/restore.sh

# Restore from backup (creates safety backup of current DB first)
./scripts/restore.sh data/backups/hoard_20260206_040000.db
```

Backups include integrity verification and automatic cleanup of old files (default: 30 days retention). For production, add a cron entry:

```bash
# Daily backup at 4am (add to NAS cron or Docker entrypoint)
0 4 * * * cd /path/to/hoard && ./scripts/backup.sh /volume1/backups/hoard
```

**Always backup before destructive schema changes or major upgrades.**

---

## Claude Code Agents

Custom agents in `.claude/agents/` for common development workflows:

| Agent | Command | Purpose |
|-------|---------|---------|
| `phase-implementer` | `/agent phase-implementer` | Implements features phase-by-phase per the roadmap |
| `api-integrator` | `/agent api-integrator` | External API work — Steam, ITAD, HLTB, Discord |
| `ui-builder` | `/agent ui-builder` | React components following the design system |
| `db-assistant` | `/agent db-assistant` | Schema changes, queries, migrations |
| `pre-commit-check` | `/agent pre-commit-check` | Type checking, linting, build verification |
| `code-reviewer` | `/agent code-reviewer` | Code quality review before merging |
| `plan-generator` | `/agent plan-generator` | Audits codebase and generates structured plans for quality work |
| `audit-orchestrator` | `/agent audit-orchestrator` | Post-feature audit — detects changes, scans categories, writes plans |

---

## End-of-Session Workflow

When the user says "commit, push, check GH actions, deploy" (or similar), follow this standard sequence:

1. **Branch**: Create a feature branch (`feat/...`, `fix/...`) from `main` — repo is public with branch protection, no direct push to main
2. **Commit**: Stage relevant files, write a conventional commit message (`feat:`, `fix:`, `refactor:`, etc.)
3. **Push**: `git push -u origin <branch>`
4. **PR**: `gh pr create` with summary and test plan
5. **CI check**: `gh run watch <run-id> --exit-status` — wait for both "Lint & Build" and "Docker Build" jobs to pass
6. **Merge**: `gh pr merge <number> --squash --delete-branch` then `git checkout main && git pull`
7. **Deploy**: Wait for main CI to pass, then `./scripts/deploy.sh` — builds and deploys to Synology NAS
8. **Migrations**: Apply any pending DB migrations on prod (via `docker exec` if schema changed)
9. **Update docs**: Update `MEMORY.md` (and topic files) with anything learned. Update `CLAUDE.md` if project status changed. Update `plans/README.md` if a plan was completed.
