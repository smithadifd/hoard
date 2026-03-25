/**
 * Export a sanitized demo database from the production DB.
 *
 * Copies public game data (games, tags, game_tags, price_snapshots, user_games)
 * while stripping personal data (notes, interest ratings, thresholds, API keys).
 * Auth tables are cleared — seed-demo.mjs creates the demo user on startup.
 *
 * Usage:
 *   node scripts/export-demo-db.mjs <source-db-path>
 *
 * Output: data/demo/demo-seed.db
 */

import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'data', 'demo');
const OUTPUT_PATH = join(OUTPUT_DIR, 'demo-seed.db');

const sourceDbPath = process.argv[2];
if (!sourceDbPath) {
  console.error('Usage: node scripts/export-demo-db.mjs <source-db-path>');
  console.error('Example: node scripts/export-demo-db.mjs ./data/hoard.db');
  process.exit(1);
}

if (!existsSync(sourceDbPath)) {
  console.error(`Source database not found: ${sourceDbPath}`);
  process.exit(1);
}

// Create output directory
mkdirSync(OUTPUT_DIR, { recursive: true });

// Remove existing output if present
if (existsSync(OUTPUT_PATH)) {
  unlinkSync(OUTPUT_PATH);
}

console.log(`[export-demo-db] Copying ${sourceDbPath} → ${OUTPUT_PATH}`);
copyFileSync(sourceDbPath, OUTPUT_PATH);

const db = new Database(OUTPUT_PATH);
db.pragma('journal_mode = DELETE'); // No WAL for shipping

console.log('[export-demo-db] Sanitizing...');

db.transaction(() => {
  // Clear auth tables (demo user created on startup)
  db.exec('DELETE FROM session');
  db.exec('DELETE FROM account');
  db.exec('DELETE FROM user');
  try { db.exec('DELETE FROM verification'); } catch { /* may not exist */ }

  // Clear settings (contains API keys)
  db.exec('DELETE FROM settings');

  // Clear sync log (operational data)
  db.exec('DELETE FROM sync_log');

  // Clear price alerts (personal data)
  db.exec('DELETE FROM price_alerts');

  // Sanitize user_games: keep ownership/playtime, strip personal data
  db.exec(`
    UPDATE user_games SET
      notes = NULL,
      personal_interest = 3,
      interest_rated_at = NULL,
      price_threshold = NULL,
      is_watchlisted = 0,
      wishlist_removed_at = NULL,
      auto_alert_disabled = 0,
      last_auto_alert_at = NULL,
      user_id = 'demo'
  `);

  // Update drizzle migrations hash — keep the journal intact
})();

// Count remaining data
const gameCount = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
const userGameCount = db.prepare('SELECT COUNT(*) as c FROM user_games').get().c;
const priceCount = db.prepare('SELECT COUNT(*) as c FROM price_snapshots').get().c;
const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags').get().c;

console.log(`[export-demo-db] Data summary:`);
console.log(`  Games: ${gameCount}`);
console.log(`  User games: ${userGameCount}`);
console.log(`  Price snapshots: ${priceCount}`);
console.log(`  Tags: ${tagCount}`);

// Vacuum to reclaim space
console.log('[export-demo-db] Vacuuming...');
db.exec('VACUUM');

db.close();

const { statSync } = await import('fs');
const size = statSync(OUTPUT_PATH).size;
console.log(`[export-demo-db] Output: ${OUTPUT_PATH} (${(size / 1024 / 1024).toFixed(1)}MB)`);
console.log('[export-demo-db] Done!');
