# Plan 16: Separate Releases from Wishlist

**Status**: Draft
**Created**: 2026-03-10
**Motivation**: Wishlisted games often include upcoming/unreleased titles that clutter the actual wishlist. These are conceptually different — "games I'm tracking for release" vs "games I want to buy." Currently unreleased games are hidden by default (`hideUnreleased=true`) but have no dedicated home.

---

## Current State

- `games.isReleased` field exists: `true` (released), `false` (coming soon), `null` (unknown)
- `games.releaseDate` is a text field (stores Steam's release date string)
- Wishlist page defaults to `hideUnreleased=true`, so unreleased games are already hidden
- Unreleased games can be revealed via "Show all" link but feel out of place
- No structured way to browse upcoming releases or track release timelines

## Design Goals

1. **New `/releases` page** — dedicated view for upcoming/unreleased wishlisted games
2. **Timeline layout** — games grouped by release window (month/quarter/year)
3. **TBD section** — games with no release date shown separately
4. **Clean wishlist** — wishlist stays focused on purchasable, released games
5. **Zero schema changes** — everything needed already exists in the DB

---

## Implementation Plan

### Step 1: New `/releases` page (server component)

**File**: `src/app/releases/page.tsx`

- Query wishlisted games where `isReleased = false` OR (`isReleased IS NULL` AND `releaseDate` looks like a future/TBD date)
- Could reuse `getEnrichedGames` with a new view type `'releases'`, or write a focused query
- Group games into sections:
  - **This Month** — release date within current month
  - **Next Month** — release date within next month
  - **Later This Year** — release date within current year but beyond next month
  - **Next Year+** — release date in a future year
  - **TBD / No Date** — no release date or unrecognizable date string
- Sort within each group by release date ascending
- Show game cards with: title, header image, release date, review info if available

**Key decision**: How to parse `releaseDate`. Steam stores this as a free-text string (e.g., "Mar 15, 2026", "Q2 2026", "Coming Soon", "To be announced"). We'll need a parsing utility that extracts a sortable date or returns null for unparseable strings.

### Step 2: Release date parsing utility

**File**: `src/lib/utils/releaseDate.ts`

```typescript
interface ParsedReleaseDate {
  date: Date | null;       // Exact or estimated date (null if unparseable)
  precision: 'day' | 'month' | 'quarter' | 'year' | 'unknown';
  label: string;           // Display string: "Mar 15, 2026" or "Q2 2026" or "TBD"
}

function parseReleaseDate(raw: string | null): ParsedReleaseDate
```

- Handle common Steam formats: "Mar 15, 2026", "2026", "Q1 2026", "Coming Soon", "To be announced"
- For grouping: map to timeline buckets based on precision and date

### Step 3: Releases page UI

**Layout concept** (timeline-style):

```
Releases                              [Sync button]
Track upcoming games from your wishlist

── March 2026 ─────────────────────────────────
  [GameCard] [GameCard]

── April 2026 ─────────────────────────────────
  [GameCard] [GameCard] [GameCard]

── Q3 2026 ─────────────────────────────────────
  [GameCard]

── 2027 ───────────────────────────────────────
  [GameCard]

── TBD ────────────────────────────────────────
  [GameCard] [GameCard] [GameCard] [GameCard]
```

- Use existing `GameCard` component (already shows "Coming Soon" badge)
- Each section has a header with the time period
- TBD section at the bottom — these are the "I wishlisted it but who knows when" games
- Simple search filter at the top (no need for the full filter bar)
- Optional: count badge per section

### Step 4: Add to navigation

**File**: `src/components/layout/Sidebar.tsx`

- Add "Releases" nav item between Wishlist and Backlog
- Icon: `Calendar` or `CalendarClock` from lucide-react
- Mobile bottom bar: may need to consider which items show (already 7 items)

### Step 5: Update wishlist page messaging

**File**: `src/app/wishlist/page.tsx`

- When unreleased games are hidden, update the "X hidden" message to link to `/releases` instead of (or in addition to) the "show all" link
- e.g., "42 wishlisted games (5 upcoming — view releases)"

### Step 6: Dashboard integration (optional)

- Add an "Upcoming Releases" card to the dashboard showing the next 3-5 games releasing soon
- Would be a nice at-a-glance view

---

## Open Questions

1. **Release date refresh**: Should we periodically re-check `isReleased` status? Games transition from unreleased to released. Currently this only updates on wishlist re-sync. Could add a lightweight check during price sync.

2. **Navigation density**: Adding Releases makes 8 nav items. Mobile bottom bar currently shows a subset. Which items should be in the mobile bar?
   - Option A: Replace Triage with Releases in mobile bar
   - Option B: Keep mobile bar as-is, Releases accessible via sidebar menu only
   - Option C: Collapsible "Lists" group in sidebar (Wishlist, Releases, Watchlist)

3. **Games without release dates that ARE released**: Some games have `isReleased = null` and no useful `releaseDate`. These shouldn't show on the releases page. The filter should be: `isWishlisted = true AND isReleased = false` (explicitly marked as unreleased by Steam's `coming_soon` flag).

4. **Notification on release**: When a game transitions from `isReleased=false` to `isReleased=true`, should we send a Discord notification? "Game X has been released! Current best price: $Y"

---

## Scope & Complexity

- **Schema changes**: None required
- **New files**: ~3-4 (page, component, utility, maybe a query)
- **Modified files**: ~3 (sidebar, wishlist page, possibly queries.ts)
- **Risk**: Low — additive feature, doesn't change existing behavior
- **Estimated effort**: Small-medium

---

## Future Enhancements

- Calendar view (month grid showing release dates)
- Release date change tracking (alert when a game gets delayed)
- "Notify me on release" toggle per game
- Integration with SteamDB for more accurate release date tracking
