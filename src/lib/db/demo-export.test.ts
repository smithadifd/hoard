import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { getTableName, isTable } from 'drizzle-orm';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as schema from './schema';
import { PUBLIC_TABLES, SANITIZED_TABLES } from '../../../scripts/export-demo-db.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const PRIVATE = 'synthetic-private-';
const PRIVATE_NUMBER = 987654321;
const scratch: string[] = [];

// Independent fixture classification: do not seed from the exporter's list, since
// omitting a table there must not also omit its private regression fixture.
const PERSONAL_TABLES = [
  'user', 'session', 'account', 'verification', 'settings', 'sync_log',
  'price_alerts', 'user_games', 'playtime_snapshots', 'notifications',
  'recommendation_events',
];

async function fixture(): Promise<{ dir: string; source: string; output: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'hoard-demo-export-'));
  scratch.push(dir);
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(ROOT, 'scripts/export-demo-db.mjs'), join(dir, 'scripts/export-demo-db.mjs'));
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  const source = join(dir, 'private.db');
  const db = new Database(source);
  try {
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSQLiteDrizzleJson(schema);
    for (const sql of await generateSQLiteMigration(empty, current)) db.exec(sql);
    db.pragma('foreign_keys = OFF');
    db.exec(`INSERT INTO games (id, steam_app_id, title) VALUES (1, 10, 'Public game');
      INSERT INTO tags (id, name, type) VALUES (1, 'Public tag', 'genre');
      INSERT INTO game_tags (game_id, tag_id) VALUES (1, 1);
      INSERT INTO price_snapshots (game_id, store, price_current, price_regular, snapshot_date, deal_score)
        VALUES (1, 'steam', 5, 10, '2026-01-01', ${PRIVATE_NUMBER});`);
    for (const table of PERSONAL_TABLES) {
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[];
      const values = columns.map(({ name, type }) => {
        if (name === 'game_id') return 1;
        if (name === 'user_id') return `${PRIVATE}user-id`;
        if (name === 'id') return type === 'TEXT' ? `${PRIVATE}${table}-id` : 1;
        return type === 'TEXT' ? `${PRIVATE}${table}-${name}` : PRIVATE_NUMBER;
      });
      db.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c.name}"`).join(',')})
        VALUES (${columns.map(() => '?').join(',')})`).run(...values);
    }
    db.prepare(`UPDATE games SET hltb_manual = 1, hltb_id = ?, hltb_main = ?, hltb_main_extra = ?,
      hltb_completionist = ?, hltb_last_updated = ?, last_viewed_at = ?, source = ?, created_at = ?, updated_at = ?`)
      .run(PRIVATE_NUMBER, PRIVATE_NUMBER, PRIVATE_NUMBER, PRIVATE_NUMBER,
        `${PRIVATE}manual-date`, PRIVATE_NUMBER, `${PRIVATE}source`, `${PRIVATE}created`, `${PRIVATE}updated`);
  } finally {
    db.close();
  }
  return { dir, source, output: join(dir, 'data/demo/demo-seed.db') };
}

function runExporter(dir: string, source: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [join(dir, 'scripts/export-demo-db.mjs'), source], {
    cwd: dir, encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('demo export privacy', () => {
  it('classifies every current schema table exactly once', () => {
    const tables = Object.values(schema).filter(isTable).map(getTableName).sort();
    const classified = [...SANITIZED_TABLES, ...PUBLIC_TABLES];
    expect(classified.filter((name) => name !== '__drizzle_migrations').sort(), 'schema tables must be classified exactly once')
      .toEqual(tables);
  });

  it('removes every private row and credential, replaces personal game data, and leaves the source unchanged', async () => {
    const { dir, source, output } = await fixture();
    const before = readFileSync(source);
    const result = runExporter(dir, source);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(readFileSync(source).equals(before), 'source database changed').toBe(true);
    const db = new Database(output, { readonly: true });
    try {
      for (const table of PERSONAL_TABLES.filter((name) => name !== 'user_games')) {
        expect(db.prepare(`SELECT * FROM "${table}"`).all(), `private rows survived in ${table}`).toEqual([]);
      }
      const demoGames = db.prepare('SELECT * FROM user_games').all() as Record<string, unknown>[];
      expect(demoGames).toEqual([expect.objectContaining({ user_id: 'demo', game_id: 1, is_owned: 1 })]);
      const tables = Object.values(schema).filter(isTable).map(getTableName);
      for (const table of tables) {
        for (const row of db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]) {
          for (const [column, value] of Object.entries(row)) {
            expect(String(value), `private value survived in ${table}.${column}`).not.toContain(PRIVATE);
            expect(value, `private number survived in ${table}.${column}`).not.toBe(PRIVATE_NUMBER);
          }
        }
      }
      expect(readFileSync(output).includes(Buffer.from(PRIVATE)), 'private bytes survived VACUUM').toBe(false);
      expect(db.prepare('SELECT title, hltb_manual, hltb_main, last_viewed_at FROM games').get())
        .toEqual({ title: 'Public game', hltb_manual: 0, hltb_main: null, last_viewed_at: null });
      expect(db.prepare('SELECT name FROM tags').get()).toEqual({ name: 'Public tag' });
      expect(db.prepare('SELECT game_id, tag_id FROM game_tags').get()).toEqual({ game_id: 1, tag_id: 1 });
      expect(db.prepare('SELECT price_current FROM price_snapshots').get()).toEqual({ price_current: 5 });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('refuses an unclassified table instead of shipping its private contents', async () => {
    const { dir, source } = await fixture();
    const db = new Database(source);
    db.exec(`CREATE TABLE future_personal_data (secret TEXT);
      INSERT INTO future_personal_data VALUES ('${PRIVATE}future-token')`);
    db.close();
    const result = runExporter(dir, source);
    expect(result.status, 'unclassified table was exported').not.toBe(0);
    expect(String(result.stderr)).toContain('Unclassified demo export table: future_personal_data');
  });
});
