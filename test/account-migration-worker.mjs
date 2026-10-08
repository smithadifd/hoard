import { existsSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const mode = process.argv[2];
const dbPath = process.env.DATABASE_URL;
if (!dbPath) throw new Error('DATABASE_URL is required');

const INNER_JOURNAL_QUERY =
  'SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1';

function beforeInnerJournalRead(db, callback) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql !== INNER_JOURNAL_QUERY) return statement;
    return {
      get: (...parameters) => {
        callback();
        return statement.get(...parameters);
      },
    };
  };
}

function recordCompletion(db) {
  db.exec('CREATE TABLE IF NOT EXISTS concurrent_probe (value TEXT NOT NULL)');
  db.prepare('INSERT INTO concurrent_probe (value) VALUES (?)').run(process.env.WORKER_NAME);
  emit({ inTransaction: db.inTransaction, foreignKeys: db.pragma('foreign_keys', { simple: true }) });
}

function emit(value) {
  process.stdout.write(`WORKER_RESULT=${JSON.stringify(value)}\n`);
}

function waitForFile(file) {
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(file)) Atomics.wait(sleep, 0, 0, 10);
}

if (mode === 'migrate-held-transaction') {
  const { runMigrations } = await import('../scripts/start.mjs');
  await runMigrations({
    dbPath,
    afterAppliedTagsRead: ({ db }) => {
      beforeInnerJournalRead(db, () => {
        writeFileSync(process.env.READY_FILE, 'ready');
        process.stdout.write('TRANSACTION_HELD\n');
        waitForFile(process.env.RELEASE_FILE);
      });
    },
    beforeConnectionClose: recordCompletion,
  });
} else if (mode === 'migrate-observe-transaction') {
  const { runMigrations } = await import('../scripts/start.mjs');
  await runMigrations({
    dbPath,
    afterAppliedTagsRead: ({ db }) => {
      beforeInnerJournalRead(db, () => {
        writeFileSync(process.env.ENTERED_FILE, 'entered');
        process.stdout.write('TRANSACTION_ENTERED\n');
      });
      writeFileSync(process.env.READY_FILE, 'ready');
      process.stdout.write('OUTER_READ_DONE\n');
    },
    beforeConnectionClose: recordCompletion,
  });
} else if (mode === 'migrate-index-verification-failure') {
  const { runMigrations } = await import('../scripts/start.mjs');
  try {
    await runMigrations({
      dbPath,
      afterAppliedTagsRead: ({ db }) => {
        const exec = db.exec.bind(db);
        db.exec = (sql) => {
          const result = exec(sql);
          if (sql === 'CREATE INDEX account_provider_idx ON account (provider_id)') {
            exec('DROP INDEX account_provider_idx');
          }
          return result;
        };
      },
    });
    throw new Error('migration unexpectedly succeeded');
  } catch (error) {
    emit({ error: error.message });
  }
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
