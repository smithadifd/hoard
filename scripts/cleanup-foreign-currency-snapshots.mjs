/**
 * One-off cleanup: delete price_snapshots stored in a non-USD currency.
 *
 * ITAD's history/overview feeds return regional storefronts (e.g. GamesPlanet UK in
 * GBP, GamesPlanet DE/FR in EUR) even for a `country: 'US'` query. Those raw foreign
 * amounts were stored verbatim, then charted on the price-history graph's USD axis —
 * a £31.99 deal renders as a phantom "$31.99" dip below the genuine USD all-time low.
 *
 * The sync code now drops non-base-currency rows at ingest (see BASE_CURRENCY in
 * src/lib/sync/types.ts), so this only needs to run ONCE to purge rows inserted before
 * the fix. Run it AFTER deploying the fix, so the old container can't re-insert them.
 *
 * Safe to run: non-USD rows are never flagged is_historical_low=1 (ITAD's reported ATL
 * is region-correct USD), so removing them does not change any ATL flag or alert.
 *
 * Usage (defaults to a dry run — pass --apply to actually delete):
 *   node scripts/cleanup-foreign-currency-snapshots.mjs            # dry run
 *   node scripts/cleanup-foreign-currency-snapshots.mjs --apply    # delete
 *
 * Run inside the prod container (back up first — scripts/backup.sh):
 *   docker exec hoard_app node scripts/cleanup-foreign-currency-snapshots.mjs --apply
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');

const BASE_CURRENCY = 'USD';
const APPLY = process.argv.includes('--apply');

function main() {
  console.log(`[cleanup-fx-snapshots] DB: ${DB_PATH}${APPLY ? ' (APPLY)' : ' (dry run)'}`);
  const db = new Database(DB_PATH);

  const byCurrency = db
    .prepare(
      `SELECT currency, COUNT(*) AS c
       FROM price_snapshots
       WHERE currency IS NOT NULL AND currency != ?
       GROUP BY currency
       ORDER BY c DESC`
    )
    .all(BASE_CURRENCY);

  const target = db
    .prepare(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT game_id) AS games
       FROM price_snapshots
       WHERE currency IS NOT NULL AND currency != ?`
    )
    .get(BASE_CURRENCY);

  // Safety assertion: a non-USD row should never be a flagged historical low.
  const flagged = db
    .prepare(
      `SELECT COUNT(*) AS c FROM price_snapshots
       WHERE currency IS NOT NULL AND currency != ? AND is_historical_low = 1`
    )
    .get(BASE_CURRENCY);

  console.log(`[cleanup-fx-snapshots] non-USD breakdown: ${JSON.stringify(byCurrency)}`);
  console.log(`[cleanup-fx-snapshots] ${target.rows} rows across ${target.games} games would be deleted`);
  console.log(`[cleanup-fx-snapshots] non-USD rows flagged is_historical_low=1: ${flagged.c} (expected 0)`);

  if (flagged.c > 0) {
    console.error('[cleanup-fx-snapshots] ABORT: found flagged historical-low rows in non-USD currency — investigate before deleting.');
    db.close();
    process.exit(1);
  }

  if (!APPLY) {
    console.log('[cleanup-fx-snapshots] dry run — no rows deleted. Re-run with --apply to delete.');
    db.close();
    return;
  }

  const info = db
    .prepare(`DELETE FROM price_snapshots WHERE currency IS NOT NULL AND currency != ?`)
    .run(BASE_CURRENCY);

  console.log(`[cleanup-fx-snapshots] done — deleted ${info.changes} rows`);
  db.close();
}

main();
