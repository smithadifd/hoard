#!/usr/bin/env node
/**
 * Onboarding Reset & Seed (dev only)
 *
 * Wipes the per-user `onboarding_state:${userId}` row (and optionally other
 * setup-adjacent state) so the wizard can be walked from scratch. Or, with
 * `--seed-state`, stamps a known onboarding state so we can iterate on a
 * specific wizard step without re-walking the prior ones.
 *
 * USAGE
 *   node scripts/reset-onboarding.mjs --user <email> [--seed-state <name>] [--wipe-games] [--yes]
 *
 * --seed-state names:
 *   fresh             clear onboarding state entirely (default if omitted)
 *   steam-connected   stamp steamConnectedAt only
 *   drain-pending     stamp through steamConnectedAt + drainMode=full, drainStartedAt set
 *   drain-paused      same as drain-pending but with rate-limit pause
 *   drain-complete    every milestone stamped except wizardCompletedAt
 *   wizard-complete   everything stamped — used to skip wizard
 *
 * --wipe-games    also delete the user's user_games + price_snapshots so the
 *                 dashboard "no data" path fires. Use with care.
 *
 * GUARDS
 *   - Refuses if NODE_ENV === 'production'
 *   - Refuses if DATABASE_URL points anywhere other than the dev default
 *     (./data/hoard.db) or an explicit override via HOARD_DEV_DB_PATH
 *   - Prompts for the literal word RESET before proceeding (skipped with --yes)
 *
 * Examples
 *   node scripts/reset-onboarding.mjs --user andrew@example.com
 *   node scripts/reset-onboarding.mjs --user andrew@example.com --seed-state drain-pending
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- argv parsing ---
const args = process.argv.slice(2);
const argMap = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--yes') argMap.yes = true;
  else if (a === '--wipe-games') argMap.wipeGames = true;
  else if (a === '--user') argMap.user = args[++i];
  else if (a === '--seed-state') argMap.seedState = args[++i];
  else if (a === '--help' || a === '-h') {
    showUsage();
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${a}`);
    showUsage();
    process.exit(1);
  }
}

function showUsage() {
  console.error(
    'Usage: node scripts/reset-onboarding.mjs --user <email> [--seed-state <name>] [--wipe-games] [--yes]',
  );
  console.error('Seed states: fresh, steam-connected, drain-pending, drain-paused, drain-complete, wizard-complete');
}

if (!argMap.user) {
  console.error('Missing --user <email>');
  showUsage();
  process.exit(1);
}

// --- guard 1: NODE_ENV ---
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production. Unset NODE_ENV or run from your dev environment.');
  process.exit(2);
}

// --- guard 2: must be a dev clone (.env.local only exists locally; the prod
// Docker image ships .env.production and the NAS bind-mount doesn't include
// .env.local). If you bring this file into prod, the script bails. ---
const DEV_MARKER = join(ROOT, '.env.local');
if (!existsSync(DEV_MARKER)) {
  console.error(
    'Refusing to run — .env.local not found. This script only runs in a local dev clone.',
  );
  console.error(`Expected marker file: ${DEV_MARKER}`);
  process.exit(2);
}

// --- guard 3: DB path is dev-shaped ---
const DEFAULT_DEV_PATH = resolve(ROOT, 'data', 'hoard.db');
const ALLOW_OVERRIDE = process.env.HOARD_DEV_DB_PATH
  ? resolve(process.env.HOARD_DEV_DB_PATH)
  : null;
const envDbPath = process.env.DATABASE_URL
  ? resolve(process.env.DATABASE_URL.replace(/^sqlite:/, ''))
  : DEFAULT_DEV_PATH;

if (envDbPath !== DEFAULT_DEV_PATH && envDbPath !== ALLOW_OVERRIDE) {
  console.error(`Refusing to act on ${envDbPath}.`);
  console.error(`Expected ${DEFAULT_DEV_PATH} (or override via HOARD_DEV_DB_PATH).`);
  process.exit(2);
}

if (!existsSync(envDbPath)) {
  console.error(`Database not found at ${envDbPath}.`);
  process.exit(2);
}

// --- look up the user + counts so the prompt is informative ---
const db = new Database(envDbPath);
db.pragma('journal_mode = WAL');

const userRow = db.prepare('SELECT id, email FROM user WHERE email = ?').get(argMap.user);
if (!userRow) {
  console.error(`No user found with email ${argMap.user}.`);
  process.exit(2);
}

const gameCountRow = db
  .prepare(
    `SELECT COUNT(*) AS c FROM user_games WHERE user_id = ?`,
  )
  .get(userRow.id);
const snapshotCountRow = db
  .prepare(
    `SELECT COUNT(*) AS c FROM price_snapshots`,
  )
  .get();

const seedState = argMap.seedState ?? 'fresh';
const validSeedStates = [
  'fresh',
  'steam-connected',
  'drain-pending',
  'drain-paused',
  'drain-complete',
  'wizard-complete',
];
if (!validSeedStates.includes(seedState)) {
  console.error(`Invalid --seed-state value: ${seedState}`);
  console.error(`Valid: ${validSeedStates.join(', ')}`);
  process.exit(1);
}

// --- guard 3: interactive confirm ---
const summary = [
  `Database:      ${envDbPath}`,
  `User:          ${userRow.email} (id=${userRow.id})`,
  `Owned/Wish:    ${gameCountRow?.c ?? 0} user_games rows`,
  `Snapshots:    ~${snapshotCountRow?.c ?? 0} (global)`,
  `Seed state:    ${seedState}`,
  `Wipe games:    ${argMap.wipeGames ? 'YES (destroys user_games + price_snapshots)' : 'no'}`,
];
console.log('');
console.log(summary.join('\n'));
console.log('');

if (!argMap.yes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) =>
    rl.question('Type RESET to proceed: ', (a) => {
      rl.close();
      res(a);
    }),
  );
  if (answer.trim() !== 'RESET') {
    console.log('Aborted.');
    process.exit(0);
  }
}

// --- compute the seeded state JSON ---
const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const SEED = {
  fresh: null, // delete the row entirely
  'steam-connected': {
    wizardCompletedAt: null,
    steamConnectedAt: yesterday,
    drainStartedAt: null,
    drainCompletedAt: null,
    drainMode: null,
    drainPauseReason: null,
    drainPausedUntil: null,
    checklistDismissed: false,
    triagePromptDismissedAt: null,
  },
  'drain-pending': {
    wizardCompletedAt: null,
    steamConnectedAt: yesterday,
    drainStartedAt: yesterday,
    drainCompletedAt: null,
    drainMode: 'full',
    drainPauseReason: null,
    drainPausedUntil: null,
    checklistDismissed: false,
    triagePromptDismissedAt: null,
  },
  'drain-paused': {
    wizardCompletedAt: null,
    steamConnectedAt: yesterday,
    drainStartedAt: yesterday,
    drainCompletedAt: null,
    drainMode: 'full',
    drainPauseReason: 'rate-limit',
    drainPausedUntil: tomorrow,
    checklistDismissed: false,
    triagePromptDismissedAt: null,
  },
  'drain-complete': {
    wizardCompletedAt: null,
    steamConnectedAt: yesterday,
    drainStartedAt: yesterday,
    drainCompletedAt: now,
    drainMode: 'full',
    drainPauseReason: null,
    drainPausedUntil: null,
    checklistDismissed: false,
    triagePromptDismissedAt: null,
  },
  'wizard-complete': {
    wizardCompletedAt: now,
    steamConnectedAt: yesterday,
    drainStartedAt: yesterday,
    drainCompletedAt: now,
    drainMode: 'full',
    drainPauseReason: null,
    drainPausedUntil: null,
    checklistDismissed: false,
    triagePromptDismissedAt: null,
  },
};

const key = `onboarding_state:${userRow.id}`;
const target = SEED[seedState];

const tx = db.transaction(() => {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  if (target) {
    db.prepare(
      `INSERT INTO settings (key, value, description, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(key, JSON.stringify(target), 'Onboarding state machine (seeded)', now);
  }

  if (argMap.wipeGames) {
    // Drop snapshots first (FK cascade would handle it, but be explicit).
    const userGameIds = db
      .prepare('SELECT game_id FROM user_games WHERE user_id = ?')
      .all(userRow.id)
      .map((r) => r.game_id);
    if (userGameIds.length > 0) {
      const placeholders = userGameIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM price_snapshots WHERE game_id IN (${placeholders})`).run(
        ...userGameIds,
      );
    }
    db.prepare('DELETE FROM user_games WHERE user_id = ?').run(userRow.id);
  }
});

tx();
db.close();

console.log('');
console.log(`Reset complete: ${seedState}${argMap.wipeGames ? ' + wiped games' : ''}.`);
console.log('Restart your dev server so the in-process scheduler picks up the cleared state.');
