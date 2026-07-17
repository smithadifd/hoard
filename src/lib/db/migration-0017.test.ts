import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

describe('migration 0017_backlog_lifecycle', () => {
  it('adds the five lifecycle columns + index incrementally on a pre-0017 user_games', () => {
    const db = new Database(':memory:');
    // A minimal pre-0017 user_games (the columns the ALTERs build on).
    db.exec(`CREATE TABLE user_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      game_id INTEGER NOT NULL,
      playtime_minutes INTEGER DEFAULT 0
    );`);
    db.prepare(`INSERT INTO user_games (user_id, game_id, playtime_minutes) VALUES (?, ?, ?)`).run(
      'default',
      1,
      500,
    );

    const sqlPath = path.join(process.cwd(), 'drizzle', '0017_backlog_lifecycle.sql');
    const migration = readFileSync(sqlPath, 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) db.exec(trimmed);
    }

    const cols = (db.prepare(`PRAGMA table_info(user_games)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(
      expect.arrayContaining(['completion_status', 'backlog_state', 'priority', 'started_at', 'abandoned_at']),
    );

    // Existing row backfilled to the NOT NULL default rather than nulled.
    const row = db.prepare(`SELECT completion_status FROM user_games WHERE game_id = 1`).get() as {
      completion_status: string;
    };
    expect(row.completion_status).toBe('unplayed');

    const indexes = (db.prepare(`PRAGMA index_list(user_games)`).all() as { name: string }[]).map(
      (i) => i.name,
    );
    expect(indexes).toContain('ug_completion_idx');
  });
});
