/**
 * Production startup script
 *
 * Runs Drizzle migrations before starting the Next.js server.
 * Handles the case where the DB already exists (pre-migration era)
 * by seeding the migration journal so the initial CREATE TABLE
 * migration is skipped.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');
const MIGRATIONS_DIR = join(ROOT, 'drizzle');

function runMigrations() {
  console.log('[startup] Running database migrations...');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Ensure the migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);

  // Read the migration journal
  const journalPath = join(MIGRATIONS_DIR, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    console.log('[startup] No migration journal found, skipping migrations');
    db.close();
    return;
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
  const applied = new Set(
    db.prepare('SELECT hash FROM __drizzle_migrations').all().map((r) => r.hash)
  );

  let migrationsRan = 0;

  for (const entry of journal.entries) {
    const tag = entry.tag;

    if (applied.has(tag)) {
      continue;
    }

    const sqlPath = join(MIGRATIONS_DIR, `${tag}.sql`);
    if (!existsSync(sqlPath)) {
      console.error(`[startup] Migration file missing: ${tag}.sql`);
      process.exit(1);
    }

    const sqlContent = readFileSync(sqlPath, 'utf-8');

    // For the initial migration on an existing DB, check if tables already exist
    if (entry.idx === 0) {
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
        .get();

      if (tableExists) {
        console.log(`[startup] Tables already exist, marking initial migration as applied: ${tag}`);
        db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
          tag,
          Date.now()
        );
        continue;
      }
    }

    // Run the migration — split on Drizzle's statement breakpoint marker
    console.log(`[startup] Applying migration: ${tag}`);
    const statements = sqlContent.split('--> statement-breakpoint');
    const runAll = db.transaction(() => {
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) {
          db.exec(trimmed);
        }
      }
      db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
        tag,
        Date.now()
      );
    });
    runAll();
    migrationsRan++;
  }

  db.close();

  if (migrationsRan > 0) {
    console.log(`[startup] Applied ${migrationsRan} migration(s)`);
  } else {
    console.log('[startup] Database is up to date');
  }
}

// Run migrations then start the server
try {
  runMigrations();
} catch (error) {
  console.error('[startup] Migration failed:', error);
  process.exit(1);
}

console.log('[startup] Starting Next.js server...');

// Import and start the Next.js standalone server
// The standalone build outputs server.js in the same directory
import('../server.js');
