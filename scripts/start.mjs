/**
 * Production startup script.
 *
 * Runs Drizzle migrations before starting the Next.js server. The exported
 * runner is also the implementation behind `npm run db:migrate`.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, copyFileSync, mkdirSync, realpathSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  ACCOUNT_ISSUER_MIGRATION_TAG,
  reconcileAccountIssuerSchema,
} from './account-issuer-migration.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');
const MIGRATIONS_DIR = join(ROOT, 'drizzle');
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const DEMO_SEED_PATH = join(ROOT, 'data', 'demo', 'demo-seed.db');

function seedDemoData() {
  if (!DEMO_MODE) return;

  const dataDir = dirname(DB_PATH);
  mkdirSync(dataDir, { recursive: true });

  if (!existsSync(DB_PATH) || isDatabaseEmpty()) {
    if (existsSync(DEMO_SEED_PATH)) {
      console.log('[startup] Demo mode: copying seed database');
      copyFileSync(DEMO_SEED_PATH, DB_PATH);
    } else {
      console.log('[startup] Demo mode: no seed DB found at', DEMO_SEED_PATH);
    }
  }

  console.log('[startup] Demo mode: running seed script');
  execSync(`node ${join(ROOT, 'scripts', 'seed-demo.mjs')}`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: DB_PATH },
  });
}

function isDatabaseEmpty() {
  try {
    const db = new Database(DB_PATH);
    const row = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='games'").get();
    const isEmpty = !row || row.c === 0;
    db.close();
    return isEmpty;
  } catch {
    return true;
  }
}

/**
 * Apply every pending migration and close the runner-owned connection.
 * Hooks are dependency-injected for integration tests; production supplies none.
 */
export async function runMigrations({
  dbPath = DB_PATH,
  afterAppliedTagsRead,
  beforeConnectionClose,
} = {}) {
  console.log('[startup] Running database migrations...');

  const db = new Database(dbPath);
  let completed = false;
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )
    `);

    const journalPath = join(MIGRATIONS_DIR, 'meta', '_journal.json');
    if (!existsSync(journalPath)) {
      console.log('[startup] No migration journal found, skipping migrations');
      completed = true;
      return;
    }

    const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
    const applied = new Set(
      db.prepare('SELECT hash FROM __drizzle_migrations').all().map((row) => row.hash),
    );
    await afterAppliedTagsRead?.({ db, applied });

    let migrationsRan = 0;
    for (const entry of journal.entries) {
      const tag = entry.tag;
      if (applied.has(tag)) continue;

      if (tag === ACCOUNT_ISSUER_MIGRATION_TAG) {
        console.log(`[startup] Applying migration: ${tag}`);
        const result = reconcileAccountIssuerSchema(db, {
          journal: {
            isApplied: (candidate) =>
              db.prepare('SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1').get(candidate) !==
              undefined,
            markApplied: (candidate) => {
              db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
                candidate,
                Date.now(),
              );
            },
          },
        });
        if (result.status === 'applied') migrationsRan++;
        continue;
      }

      const sqlPath = join(MIGRATIONS_DIR, `${tag}.sql`);
      if (!existsSync(sqlPath)) {
        throw new Error(`Migration file missing: ${tag}.sql`);
      }
      const sqlContent = readFileSync(sqlPath, 'utf-8');

      if (entry.idx === 0) {
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
          .get();
        if (tableExists) {
          console.log(`[startup] Tables already exist, marking initial migration as applied: ${tag}`);
          db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
            tag,
            Date.now(),
          );
          continue;
        }
      }

      console.log(`[startup] Applying migration: ${tag}`);
      const statements = sqlContent.split('--> statement-breakpoint');
      const runAll = db.transaction(() => {
        for (const statement of statements) {
          const trimmed = statement.trim();
          if (trimmed) db.exec(trimmed);
        }
        db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
          tag,
          Date.now(),
        );
      });
      runAll();
      migrationsRan++;
    }

    if (migrationsRan > 0) {
      console.log(`[startup] Applied ${migrationsRan} migration(s)`);
    } else {
      console.log('[startup] Database is up to date');
    }
    completed = true;
  } finally {
    try {
      if (completed) await beforeConnectionClose?.(db);
    } finally {
      db.close();
    }
  }
}

async function main() {
  const migrationOnly = process.argv.includes('--migrate-only');
  if (!migrationOnly) {
    try {
      seedDemoData();
    } catch (error) {
      console.error('[startup] Demo seeding failed:', error);
    }
  }

  try {
    await runMigrations();
  } catch (error) {
    console.error('[startup] Migration failed:', error);
    process.exitCode = 1;
    return;
  }

  if (migrationOnly) return;

  console.log('[startup] Starting Next.js server...');
  await import('../server.js');
}

const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) await main();
