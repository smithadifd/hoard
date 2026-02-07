import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { getConfig } from '../config';

let db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const config = getConfig();
  const sqlite = new Database(config.databaseUrl);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = 1000000000'); // 1GB
  sqlite.pragma('foreign_keys = true');
  sqlite.pragma('temp_store = memory');

  return drizzle(sqlite, { schema });
}

export function getDb() {
  if (!db) {
    db = createDb();
  }
  return db;
}

export type Database = ReturnType<typeof getDb>;
export { schema };
