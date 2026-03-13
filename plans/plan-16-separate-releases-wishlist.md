# Plan 16: Separate Releases from Wishlist

**Status**: Complete
**Created**: 2026-03-10
**Motivation**: Wishlisted games often include upcoming/unreleased titles that clutter the actual wishlist. These are conceptually different — "games I'm tracking for release" vs "games I want to buy." Currently unreleased games are hidden by default (`hideUnreleased=true`) but have no dedicated home.

---

## Current State

- `games.isReleased` field exists: `true` (released), `false` (coming soon), `null` (unknown)
- `games.releaseDate` is a text field (stores Steam's release date string)
- Wishlist page defaults to `hideUnreleased=true`, so unreleased games are already hidden
- Unreleased games can be revealed via "Show all" link but feel out of place
- No structured way to browse upcoming releases or track release timelines
- Mobile bottom bar renders all 7 nav items at `text-[11px]` — already at the limit

## Design Goals

1. **New `/releases` page** — dedicated view for upcoming/unreleased wishlisted games
2. **Timeline layout** — games grouped by release window (month/quarter/year)
3. **TBD section** — games with no release date shown separately
4. **Clean wishlist** — wishlist stays focused on purchasable, released games
5. **Zero schema changes** — everything needed already exists in the DB
6. **Navigation overhaul** — redesign mobile nav to scale beyond 7 items
7. **Release notifications** — Discord alert when a tracked game launches

---

## Implementation Plan

### Step 1: Navigation overhaul (desktop + mobile)

**Problem**: 7 items already maxes out the mobile bottom bar. Adding Releases makes 8. This won't be the last feature either — the nav needs to scale.

**Desktop sidebar — grouped with section headers**:

```
── BROWSE ──────────────────
  Dashboard

── MY GAMES ────────────────
  Library
  Backlog

── TRACKING ────────────────
  Wishlist
  Releases        ← NEW
  Watchlist

── TOOLS ───────────────────
  Triage
  Settings
```

This groups related pages and makes the mental model clear:
- **My Games** = stuff I own
- **Tracking** = stuff I want / am watching
- **Tools** = workflow utilities

Section headers are muted, small text — not clickable, just visual grouping.

**Mobile bottom bar — 5 tabs + "More" overflow**:

```
┌──────────────────────────────────────────────┐
│  🏠       📚       ❤️       🎮      •••     │
│ Home    Library  Wishlist  Backlog   More     │
└──────────────────────────────────────────────┘
```

The "More" tab opens a bottom sheet / slide-up menu with:
- Releases
- Watchlist
- Triage
- Settings

**Why these 5?**
- Dashboard, Library, Wishlist, Backlog are the daily-use pages
- Everything else is secondary (check occasionally, configure rarely)
- 5 tabs is the iOS/Android standard — proven pattern
- "More" menu is instantly familiar (Instagram, Spotify, etc.)

**Implementation**:
- `src/components/layout/Sidebar.tsx` — add section headers to desktop nav, separate `primaryNav` and `secondaryNav` arrays
- New `src/components/layout/MobileMoreMenu.tsx` — bottom sheet component for overflow items
- Use existing shadcn Sheet component (or a simple slide-up div) for the More menu
- "More" tab highlights when any of its children routes are active
- More menu shows a compact list with icons, tapping navigates and closes the sheet

### Step 2: Release date parsing utility

**File**: `src/lib/utils/releaseDate.ts`

```typescript
interface ParsedReleaseDate {
  date: Date | null;       // Exact or estimated date (null if unparseable)
  precision: 'day' | 'month' | 'quarter' | 'year' | 'unknown';
  label: string;           // Display string: "Mar 15, 2026" or "Q2 2026" or "TBD"
}

function parseReleaseDate(raw: string | null): ParsedReleaseDate

// Grouping helper
type ReleaseBucket =
  | 'overdue'           // Date has passed but game still marked unreleased
  | 'this-month'
  | 'next-month'
  | 'later-this-year'
  | 'next-year'
  | 'future'            // 2+ years out
  | 'tbd';

function getReleaseBucket(parsed: ParsedReleaseDate, now?: Date): ReleaseBucket
```

- Handle common Steam formats: "Mar 15, 2026", "2026", "Q1 2026", "Coming Soon", "To be announced"
- "Overdue" bucket catches games where the listed date has passed but Steam still says `coming_soon=true` (delays, bad data)
- For grouping: map to timeline buckets based on precision and date

### Step 3: New `/releases` page (server component)

**File**: `src/app/releases/page.tsx`

- Query: `isWishlisted = true AND isReleased = false` (only games explicitly marked unreleased by Steam's `coming_soon` flag — avoids showing released games with `isReleased = null`)
- Parse each game's `releaseDate` and assign to a bucket
- Render grouped timeline layout

**Layout concept**:

```
Releases                                    12 upcoming
Track upcoming games from your wishlist

── Overdue ────────────────────────── (1) ──
  [GameCard - was supposed to be out already]

── March 2026 ─────────────────────── (2) ──
  [GameCard] [GameCard]

── April 2026 ─────────────────────── (3) ──
  [GameCard] [GameCard] [GameCard]

── Later in 2026 ──────────────────── (1) ──
  [GameCard]

── 2027 ───────────────────────────── (1) ──
  [GameCard]

── TBD ────────────────────────────── (4) ──
  [GameCard] [GameCard] [GameCard] [GameCard]
```

- Reuse existing `GameCard` component (already shows "Coming Soon" badge)
- Each section header: time period label + count badge
- "Overdue" section in a subtle warning style (amber border/text) — signals stale data or delays
- TBD section at bottom — these are the "who knows when" games
- Simple search bar at top (no full filter bar needed — this is a small, focused list)
- Optional: collapsible sections for when the list gets long

### Step 4: Release status auto-refresh during sync

**Problem**: `isReleased` only updates on full wishlist re-sync, which fetches every game from the Steam Store API (slow, rate-limited). Games can release between syncs.

**Solution**: Piggyback on the price sync (runs every 12h).

**File**: `src/lib/sync/prices.ts` (or new `src/lib/sync/releaseCheck.ts`)

- After the ITAD price sync completes, query all games where `isReleased = false`
- For each, make a lightweight Steam Store API call to check `release_date.coming_soon`
- If `coming_soon` flipped to `false`, update `isReleased = true` in the DB
- This is a small batch (typically <20 games) so rate limiting is minimal
- Log transitions in `sync_log`

**Rate limiting consideration**: With 3-second delays between Steam Store calls and typically <20 unreleased games, this adds ~1 minute to the 12h price sync. Negligible.

### Step 5: Discord release notifications

**File**: `src/lib/discord/notifications.ts` (extend existing)

When Step 4 detects a game transitioning `isReleased: false → true`:

```
🎮 Game Released!
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hollow Knight: Silksong is now available!

💰 Best price: $24.99 (Steam)
📊 Reviews: Overwhelmingly Positive (96%)
⏱️ Main story: ~25 hours

🔗 Steam | ITAD
```

- Use existing Discord webhook infrastructure
- Include price data if available (game may need a price sync first)
- Include HLTB/review data if enriched
- Link to Steam store page and ITAD page

### Step 6: Update wishlist page messaging

**File**: `src/app/wishlist/page.tsx`

- When unreleased games exist, replace generic "X hidden" with a targeted message:
  - `"42 wishlisted games (5 upcoming → view releases)"`
- The "view releases" link goes to `/releases`
- Keep the existing "show all" link for data-completeness filtering (separate concern)

### Step 7: Dashboard integration

**File**: `src/app/page.tsx` (or new `src/components/dashboard/UpcomingReleases.tsx`)

- Add an "Upcoming Releases" card showing the next 3-5 games by release date
- Compact layout: game title + release date + countdown ("in 12 days")
- "View all →" link to `/releases`
- Only shows if user has unreleased wishlisted games

---

## Resolved Questions

1. **Release date refresh**: ✅ Yes — piggyback on price sync (Step 4). Lightweight check, runs every 12h, catches releases within half a day.

2. **Navigation**: ✅ Desktop gets grouped sections, mobile gets 5-tab + "More" bottom sheet (Step 1). Future-proof for additional pages.

3. **Which games show on Releases page**: Only `isWishlisted = true AND isReleased = false` — games explicitly marked unreleased by Steam's `coming_soon` flag. Games with `isReleased = null` stay on the wishlist (they're likely released, just not confirmed).

4. **Release notifications**: ✅ Yes — Discord alert when a game transitions to released (Step 5).

---

## Scope & Complexity

- **Schema changes**: None required
- **New files**: ~5-6 (releases page, release date utility, more menu component, notification extension, dashboard card)
- **Modified files**: ~4 (sidebar, wishlist page, price sync, discord client)
- **Risk**: Low — additive feature, doesn't change existing behavior
- **Estimated effort**: Medium

### Implementation order

1. Navigation overhaul (Step 1) — do this first since it's independent and benefits the whole app
2. Release date parser (Step 2) — small utility, testable in isolation
3. Releases page (Step 3) — the core feature
4. Wishlist crosslink (Step 6) — quick win after page exists
5. Release status sync (Step 4) — background infrastructure
6. Discord notifications (Step 5) — builds on Step 4
7. Dashboard card (Step 7) — polish, do last

---

## Future Enhancements

- Calendar view (month grid showing release dates)
- Release date change tracking (alert when a game gets delayed)
- "Notify me on release" toggle per game (vs. notifying for all)
- Integration with SteamDB for more accurate release date tracking
- Countdown timers on game cards for games releasing within 7 days
