import { existsSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const mode = process.argv[2];
const dbPath = process.env.DATABASE_URL;
if (!dbPath) throw new Error('DATABASE_URL is required');

function emit(value) {
  process.stdout.write(`WORKER_RESULT=${JSON.stringify(value)}\n`);
}

function waitForFile(file) {
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(file)) Atomics.wait(sleep, 0, 0, 10);
}

if (mode === 'migrate-with-barrier') {
  const { runMigrations } = await import('../scripts/start.mjs');
  await runMigrations({
    dbPath,
    afterAppliedTagsRead: () => {
      writeFileSync(process.env.READY_FILE, 'ready');
      process.stdout.write('BARRIER_READY\n');
      waitForFile(process.env.RELEASE_FILE);
    },
    beforeConnectionClose: (db) => {
      db.exec('CREATE TABLE IF NOT EXISTS concurrent_probe (value TEXT NOT NULL)');
      db.prepare('INSERT INTO concurrent_probe (value) VALUES (?)').run(process.env.WORKER_NAME);
      emit({ inTransaction: db.inTransaction, foreignKeys: db.pragma('foreign_keys', { simple: true }) });
    },
  });
} else if (mode === 'migrate-atomic-failure') {
  const { runMigrations } = await import('../scripts/start.mjs');
  try {
    let checks = 0;
    await runMigrations({
      dbPath,
      afterAppliedTagsRead: ({ db }) => {
        const prepare = db.prepare.bind(db);
        db.prepare = (sql) => {
          if (sql === 'PRAGMA foreign_key_check(account)' && ++checks === 2) {
            throw new Error('injected failure before account postconditions');
          }
          return prepare(sql);
        };
      },
    });
    throw new Error('migration unexpectedly succeeded');
  } catch (error) {
    emit({ error: error.message });
  }
} else if (mode === 'migrate-failure-close') {
  const { runMigrations } = await import('../scripts/start.mjs');
  let opened;
  try {
    await runMigrations({
      dbPath,
      afterAppliedTagsRead: ({ db }) => {
        opened = db;
      },
    });
    throw new Error('migration unexpectedly succeeded');
  } catch (error) {
    emit({ error: error.message, connectionOpen: opened?.open ?? null });
  }
} else if (mode === 'application-failure') {
  const { getDb } = await import('../src/lib/db/index.ts');
  const { reconcileAccountIssuerSchema } = await import('../scripts/account-issuer-migration.mjs');
  const client = getDb().$client;
  client.exec('ALTER TABLE account ADD COLUMN unexpected TEXT');
  let error;
  try {
    reconcileAccountIssuerSchema(client);
  } catch (caught) {
    error = caught.message;
  }
  emit({
    error,
    connectionOpen: client.open,
    foreignKeys: client.pragma('foreign_keys', { simple: true }),
  });
  client.close();
} else if (mode === 'transaction-guard') {
  const { reconcileAccountIssuerSchema } = await import('../scripts/account-issuer-migration.mjs');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const before = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'account'").get();
  let error;
  db.transaction(() => {
    try {
      reconcileAccountIssuerSchema(db);
    } catch (caught) {
      error = caught.message;
    }
  })();
  const after = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'account'").get();
  emit({ error, unchanged: before.sql === after.sql, inTransaction: db.inTransaction });
  db.close();
} else if (mode === 'helper') {
  const { reconcileAccountIssuerSchema } = await import('../scripts/account-issuer-migration.mjs');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const result = reconcileAccountIssuerSchema(db);
  emit({ result, foreignKeys: db.pragma('foreign_keys', { simple: true }), connectionOpen: db.open });
  db.close();
} else if (mode === 'bootstrap' || mode === 'auth') {
  const { getDb } = await import('../src/lib/db/index.ts');
  const client = getDb().$client;
  if (mode === 'auth') {
    const { auth } = await import('../src/lib/auth.ts');
    const email = process.env.AUTH_EMAIL ?? 'owner@example.com';
    const password = process.env.AUTH_PASSWORD ?? 'correct-horse-battery';
    if (process.env.AUTH_SIGN_UP === 'true') {
      await auth.api.signUpEmail({ body: { email, password, name: 'Owner' } });
    }
    const response = await auth.api.signInEmail({ body: { email, password } });
    const account = client
      .prepare('SELECT issuer FROM account WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1')
      .get('credential');
    emit({ email: response.user.email, issuer: account?.issuer ?? null });
  } else {
    emit({ bootstrapped: true });
  }
  client.close();
} else {
  throw new Error(`Unknown worker mode: ${mode}`);
}
