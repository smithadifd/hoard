/**
 * One-off backfill: refresh games whose header_image_url is the legacy
 * cdn.akamai.steamstatic.com pattern. Steam migrated to asset-versioned URLs
 * on shared.akamai.steamstatic.com for newer apps; the legacy URL 404s for
 * those titles.
 *
 * For each affected row:
 *   1. HEAD-probe the stored URL.
 *   2. If 200, leave it (legacy URL still works for older apps).
 *   3. If 404, call Steam's appdetails API; if it returns a header_image,
 *      update the row. Otherwise set the URL to NULL so the UI renders a
 *      placeholder instead of a broken image.
 *
 * Usage:
 *   node scripts/refresh-broken-images.mjs [--dry-run]
 *
 * Run inside the prod container:
 *   docker exec hoard_app node scripts/refresh-broken-images.mjs
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');

const DRY_RUN = process.argv.includes('--dry-run');
const LEGACY_URL_PATTERN = 'https://cdn.akamai.steamstatic.com/steam/apps/%/header.jpg';
const STEAM_APPDETAILS = (appId) =>
  `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`;

const RATE_LIMIT_MS = 200; // 5 requests/sec

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function headStatus(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status;
  } catch (err) {
    console.warn(`  HEAD failed for ${url}: ${err.message}`);
    return 0;
  }
}

async function fetchSteamHeaderImage(appId) {
  try {
    const res = await fetch(STEAM_APPDETAILS(appId));
    if (!res.ok) return null;
    const body = await res.json();
    const entry = body?.[String(appId)];
    if (!entry?.success) return null;
    return entry.data?.header_image ?? null;
  } catch (err) {
    console.warn(`  appdetails fetch failed for ${appId}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`[refresh-broken-images] DB: ${DB_PATH}${DRY_RUN ? ' (dry run)' : ''}`);
  const db = new Database(DB_PATH);

  const rows = db
    .prepare(
      `SELECT id, steam_app_id AS appId, title, header_image_url AS url
       FROM games
       WHERE header_image_url LIKE ?`
    )
    .all(LEGACY_URL_PATTERN);

  console.log(`[refresh-broken-images] ${rows.length} games using legacy CDN URL`);

  const update = db.prepare(`UPDATE games SET header_image_url = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();

  let stillWorking = 0;
  let updated = 0;
  let nulled = 0;
  let failed = 0;

  for (const row of rows) {
    const status = await headStatus(row.url);
    if (status === 200) {
      stillWorking++;
      continue;
    }
    if (status !== 404 && status !== 403 && status !== 0) {
      // Transient (5xx, etc.) — leave alone for next run
      console.log(`  ${row.appId} ${row.title}: HEAD ${status}, skipping`);
      failed++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }
    const fresh = await fetchSteamHeaderImage(row.appId);
    await sleep(RATE_LIMIT_MS);
    if (fresh) {
      if (DRY_RUN) {
        console.log(`  ${row.appId} ${row.title}: would update -> ${fresh}`);
      } else {
        update.run(fresh, now, row.id);
      }
      updated++;
    } else {
      if (DRY_RUN) {
        console.log(`  ${row.appId} ${row.title}: would NULL (no header_image from API)`);
      } else {
        update.run(null, now, row.id);
      }
      nulled++;
    }
  }

  console.log(`[refresh-broken-images] done — still working: ${stillWorking}, updated: ${updated}, nulled: ${nulled}, transient/skipped: ${failed}`);
  db.close();
}

main().catch((err) => {
  console.error('[refresh-broken-images] fatal:', err);
  process.exit(1);
});
