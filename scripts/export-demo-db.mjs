/**
 * Export public game/price data with synthetic ownership, never real user data.
 * Auth is empty; seed-demo.mjs creates the demo account on startup.
 *
 * Usage: node scripts/export-demo-db.mjs <source-db-path>
 * Output: data/demo/demo-seed.db
 *
 * The source is opened read-only (including WAL data). Only a private staging
 * copy is sanitized; an atomic rename publishes it after VACUUM succeeds.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'data', 'demo');
const OUTPUT_PATH = join(OUTPUT_DIR, 'demo-seed.db');

// Every application table must be classified here. Mixed tables are scrubbed
// explicitly below; every other sanitized table is emptied.
export const SANITIZED_TABLES = [
  'session', 'account', 'verification', 'user', 'settings', 'sync_log',
  'price_alerts', 'playtime_snapshots', 'notifications', 'recommendation_events',
  'user_games', 'games', 'price_snapshots',
];
export const PUBLIC_TABLES = [
  'tags', 'game_tags', '__drizzle_migrations',
];

async function exportDemoDatabase(sourceDbPath) {
  if (!sourceDbPath || !existsSync(sourceDbPath)) {
    throw new Error('Usage: node scripts/export-demo-db.mjs <existing-source-db-path>');
  }
  if (existsSync(OUTPUT_PATH) && realpathSync(sourceDbPath) === realpathSync(OUTPUT_PATH)) {
    throw new Error('Source database must not be the demo output');
  }

  const source = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
  let staging;
  try {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    staging = mkdtempSync(join(OUTPUT_DIR, '.export-'));
    const stagedPath = join(staging, 'demo-seed.db');
    await source.backup(stagedPath);
    const db = new Database(stagedPath);
    try {
      const classified = new Set([...SANITIZED_TABLES, ...PUBLIC_TABLES]);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all();
      for (const { name } of tables) {
        if (!classified.has(name)) throw new Error(`Unclassified demo export table: ${name}`);
      }

      db.pragma('journal_mode = DELETE');
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        for (const table of SANITIZED_TABLES) {
          if (table !== 'games' && table !== 'price_snapshots') {
            db.exec(`DELETE FROM "${table}"`);
            db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
          }
        }

        // Manual HLTB overrides and browsing/import timestamps are personal,
        // unlike the upstream catalog metadata retained for other games.
        db.exec(`
          UPDATE games SET
            hltb_id = NULL,
            hltb_main = NULL,
            hltb_main_extra = NULL,
            hltb_completionist = NULL,
            hltb_last_updated = NULL
          WHERE hltb_manual = 1;
          UPDATE games SET
            hltb_manual = 0,
            hltb_miss_count = 0,
            last_viewed_at = NULL,
            source = 'sync',
            created_at = '2000-01-01 00:00:00',
            updated_at = '2000-01-01 00:00:00';
        `);
        // Cached deal scores depend on personal interest and scoring settings.
        db.exec('UPDATE price_snapshots SET deal_score = NULL');

        // No real ownership, playtime, purchases, ratings or backlog history.
        // Defaults plus fixed timestamps make all demo relationships synthetic.
        db.exec(`
          INSERT INTO user_games (user_id, game_id, is_owned, created_at, updated_at)
          SELECT 'demo', id, 1, '2000-01-01 00:00:00', '2000-01-01 00:00:00'
          FROM games ORDER BY id
        `);
      })();

      // Remove deleted credentials and personal data from free pages too.
      db.exec('VACUUM');
      console.log(`[export-demo-db] Games: ${db.prepare('SELECT COUNT(*) AS c FROM games').get().c}`);
      console.log(`[export-demo-db] User games (synthetic): ${db.prepare('SELECT COUNT(*) AS c FROM user_games').get().c}`);
    } finally {
      db.close();
    }
    renameSync(stagedPath, OUTPUT_PATH);
    console.log(`[export-demo-db] Output: ${OUTPUT_PATH} (${statSync(OUTPUT_PATH).size} bytes)`);
    console.log('[export-demo-db] Done!');
  } finally {
    source.close();
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportDemoDatabase(process.argv[2]).catch((error) => {
    console.error(`[export-demo-db] ${error.message}`);
    process.exitCode = 1;
  });
}
