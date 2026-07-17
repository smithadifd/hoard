import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

describe('migration 0018_warm_mentor (recommendation_events)', () => {
  it('creates the recommendation_events table + indexes on a bare DB', () => {
    const db = new Database(':memory:');
    // Only prerequisite is the FK target.
    db.exec(`CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, steam_app_id INTEGER);`);

    const sqlPath = path.join(process.cwd(), 'drizzle', '0018_warm_mentor.sql');
    const migration = readFileSync(sqlPath, 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) db.exec(trimmed);
    }

    const cols = (db.prepare(`PRAGMA table_info(recommendation_events)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual([
      'id',
      'user_id',
      'game_id',
      'bucket',
      'reason',
      'score',
      'shown_at',
      'accepted_at',
      'dismissed_at',
      'created_at',
    ]);

    const indexes = (db.prepare(`PRAGMA index_list(recommendation_events)`).all() as { name: string }[]).map(
      (i) => i.name,
    );
    expect(indexes).toContain('re_user_game_idx');
    expect(indexes).toContain('re_user_shown_idx');
  });
});
