/**
 * Demo seed script — creates the demo user account.
 * Run after demo-seed.db is copied to the data volume.
 *
 * Usage: node scripts/seed-demo.mjs
 */

import Database from 'better-sqlite3';
import { randomBytes, scryptSync } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');

/**
 * Hash password using the same format as Better Auth:
 * hex(salt):hex(scrypt_key) with N=16384, r=16, p=1, dkLen=64
 */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  // Better Auth passes strings, uses maxmem: 128 * N * r * 2
  const key = scryptSync(
    password.normalize('NFKC'), salt, 64,
    { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }
  );
  return `${salt}:${key.toString('hex')}`;
}

function generateId() {
  return randomBytes(16).toString('hex');
}

function seed() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Check if demo user already exists
  const existing = db.prepare("SELECT id FROM user WHERE email = 'demo@example.com'").get();
  if (existing) {
    console.log('[seed-demo] Demo user already exists, skipping');

    // Update user_games to use demo user's ID
    const demoUserCount = db.prepare(
      "SELECT COUNT(*) as c FROM user_games WHERE user_id = ?"
    ).get(existing.id).c;
    if (demoUserCount === 0) {
      db.prepare("UPDATE user_games SET user_id = ? WHERE user_id = 'demo'").run(existing.id);
      console.log('[seed-demo] Linked user_games to demo user');
    }

    db.close();
    return;
  }

  const now = Date.now();
  const userId = generateId();
  const accountId = generateId();
  const hashedPassword = hashPassword('demo1234!');

  db.transaction(() => {
    // Create demo user
    db.prepare(`
      INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES (?, 'Demo User', 'demo@example.com', 1, ?, ?)
    `).run(userId, now, now);

    // Create account with password
    db.prepare(`
      INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at)
      VALUES (?, ?, ?, 'credential', ?, ?, ?)
    `).run(accountId, userId, userId, hashedPassword, now, now);

    // Link user_games from export (user_id = 'demo') to real demo user
    db.prepare("UPDATE user_games SET user_id = ? WHERE user_id = 'demo'").run(userId);

    console.log('[seed-demo] Created demo user and linked user_games');
  })();

  db.close();
  console.log('[seed-demo] Seeding complete');
}

seed();
