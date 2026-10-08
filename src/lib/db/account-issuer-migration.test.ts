import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const START = join(ROOT, 'scripts', 'start.mjs');
const WORKER = join(ROOT, 'test', 'account-migration-worker.mjs');
const TAG = '0019_fast_gauntlet';
const EMAIL = 'owner@example.com';
const PASSWORD = 'correct-horse-battery';
const FIXTURE_DIR = join(ROOT, 'test', 'fixtures', 'account-issuer');
const BOOT_FIXTURES = [
  { name: 'absent', file: 'absent.sql', shape: null },
  { name: 'pre-1.7', file: 'pre-1.7.sql', shape: 'pre-1.7' },
  { name: 'fresh-1.7', file: 'fresh-1.7.sql', shape: 'not-null' },
  { name: 'reconciled', file: 'reconciled.sql', shape: 'not-null' },
] as const;

const USER_DDL = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
`;

const LEGACY_AUTH_DDL = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expiresAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
  );
`;

const COLUMN_DEFINITIONS: Record<string, string> = {
  id: 'id TEXT PRIMARY KEY',
  user_id: 'user_id TEXT NOT NULL',
  issuer: 'issuer TEXT',
  account_id: 'account_id TEXT NOT NULL',
  provider_id: 'provider_id TEXT NOT NULL',
  access_token: 'access_token TEXT',
  refresh_token: 'refresh_token TEXT',
  access_token_expires_at: 'access_token_expires_at INTEGER',
  refresh_token_expires_at: 'refresh_token_expires_at INTEGER',
  scope: 'scope TEXT',
  id_token: 'id_token TEXT',
  password: 'password TEXT',
  created_at:
    "created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))",
  updated_at:
    "updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))",
};
const ACCOUNT_COLUMN_NAMES = Object.keys(COLUMN_DEFINITIONS);

type AccountShape = 'pre-1.7' | 'current' | 'not-null';
interface AccountDdlOptions {
  shape: AccountShape;
  idNotNull?: boolean;
  omit?: string;
  extra?: string;
  table?: string;
}
type ProcessResult = SpawnSyncReturns<string>;
type WorkerResult = Record<string, unknown>;
interface ChildOutcome {
  code: number | null;
  output: string;
}
interface TrackedChild {
  child: ChildProcess;
  ready: Promise<void>;
  done: Promise<ChildOutcome>;
}

let testDir: string;
let dbPath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hoard-account-migration-'));
  dbPath = join(testDir, 'hoard.db');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function openDb(file = dbPath): BetterSqlite3.Database {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  return db;
}

function accountDdl({
  shape,
  idNotNull = false,
  omit,
  extra,
  table = 'account',
}: AccountDdlOptions): string {
  const names = ACCOUNT_COLUMN_NAMES.filter((name) => name !== omit && (shape !== 'pre-1.7' || name !== 'issuer'));
  const definitions = names.map((name) => {
    if (name === 'id' && idNotNull) return 'id TEXT PRIMARY KEY NOT NULL';
    if (name === 'issuer' && shape === 'not-null') return 'issuer TEXT NOT NULL';
    return COLUMN_DEFINITIONS[name];
  });
  if (extra) definitions.push(extra);
  definitions.push('FOREIGN KEY (user_id) REFERENCES user(id) ON UPDATE NO ACTION ON DELETE CASCADE');
  return `CREATE TABLE ${table} (${definitions.join(', ')});`;
}

function createAccountFixture(
  db: BetterSqlite3.Database,
  options: AccountDdlOptions & { canonicalIndex?: boolean },
): void {
  db.exec(USER_DDL);
  db.exec(accountDdl(options));
  if (options.shape !== 'pre-1.7' && options.canonicalIndex !== false) {
    db.exec('CREATE UNIQUE INDEX account_issuer_account_id_idx ON account (issuer, account_id)');
  }
}

function seedUser(db: BetterSqlite3.Database, id = 'user-1', email = 'one@example.com'): void {
  db.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, 'Owner', ?, 1, 1000, 1000)`,
  ).run(id, email);
}

function seedAccount(
  db: BetterSqlite3.Database,
  shape: AccountShape,
  values: {
    id?: string;
    userId?: string;
    issuer?: string;
    accountId?: string;
    providerId?: string;
    password?: string;
  } = {},
): void {
  const columns = [
    'id',
    'user_id',
    ...(shape === 'pre-1.7' ? [] : ['issuer']),
    'account_id',
    'provider_id',
    'access_token',
    'refresh_token',
    'access_token_expires_at',
    'refresh_token_expires_at',
    'scope',
    'id_token',
    'password',
    'created_at',
    'updated_at',
  ];
  const row = {
    id: values.id ?? 'account-1',
    user_id: values.userId ?? 'user-1',
    issuer: values.issuer ?? 'custom:issuer',
    account_id: values.accountId ?? 'external-1',
    provider_id: values.providerId ?? 'credential',
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    access_token_expires_at: 2000,
    refresh_token_expires_at: 3000,
    scope: 'profile email',
    id_token: 'id-token',
    password: values.password ?? 'password-hash',
    created_at: 1000,
    updated_at: 1001,
  };
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO account (${columns.join(', ')}) VALUES (${placeholders})`).run(
    ...columns.map((column) => row[column as keyof typeof row]),
  );
}

function markEarlierMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  const journal = JSON.parse(
    readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const insert = db.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  );
  for (const entry of journal.entries) {
    if (entry.tag === TAG) break;
    insert.run(entry.tag, 1);
  }
}

function tagCount(db: BetterSqlite3.Database): number {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE hash = ?').get(TAG) as {
      count: number;
    }
  ).count;
}

function runMigration(file = dbPath): ProcessResult {
  return spawnSync(process.execPath, [START, '--migrate-only'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: file },
    encoding: 'utf8',
  });
}

function runWorker(
  mode: string,
  env: Record<string, string> = {},
  file = dbPath,
): { process: ProcessResult; result: WorkerResult | null } {
  const processResult = spawnSync(
    process.execPath,
    ['--import', 'tsx', WORKER, mode],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: file,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        ...env,
      },
      encoding: 'utf8',
    },
  );
  const output = `${processResult.stdout ?? ''}\n${processResult.stderr ?? ''}`;
  const match = output.match(/WORKER_RESULT=(.+)/);
  return { process: processResult, result: match ? (JSON.parse(match[1]) as WorkerResult) : null };
}

function expectSuccess(result: ProcessResult): void {
  expect(`${result.stderr ?? ''}${result.stdout ?? ''}`).toContain('[startup]');
  expect(result.status, result.stderr?.toString()).toBe(0);
}

function expectFailure(result: ProcessResult, message: RegExp): void {
  expect(result.status).not.toBe(0);
  expect(`${result.stderr ?? ''}${result.stdout ?? ''}`).toMatch(message);
}

function accountRows(db: BetterSqlite3.Database): unknown[] {
  return db.prepare('SELECT * FROM account ORDER BY id').all();
}

function accountMetadata(db: BetterSqlite3.Database): unknown[] {
  return db.prepare('PRAGMA table_info(account)').all();
}

function accountIndexes(db: BetterSqlite3.Database): unknown[] {
  return db
    .prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'account' AND sql IS NOT NULL ORDER BY name",
    )
    .all();
}

function accountState(db: BetterSqlite3.Database): unknown {
  return {
    table: db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'account'").get(),
    rows: accountRows(db),
    metadata: accountMetadata(db),
    indexes: accountIndexes(db),
  };
}
function loadFixture(db: BetterSqlite3.Database, file: string): void {
  db.exec(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
}

function seedFixtureAuthRows(db: BetterSqlite3.Database, shape: AccountShape): void {
  seedUser(db, 'fixture-user-1', 'fixture-one@example.com');
  seedUser(db, 'fixture-user-2', 'fixture-two@example.com');
  seedAccount(db, shape, {
    id: 'fixture-account-1',
    userId: 'fixture-user-1',
    issuer: 'custom:issuer',
    accountId: 'fixture-external-1',
    providerId: 'oauth provider/ü',
  });
  seedAccount(db, shape, {
    id: 'fixture-account-2',
    userId: 'fixture-user-2',
    issuer: '',
    accountId: 'fixture-external-2',
    providerId: 'credential',
  });
  db.exec(`
    INSERT INTO session (
      id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at
    ) VALUES (
      'fixture-session', 'fixture-user-1', 'fixture-token', 9000,
      '127.0.0.1', 'fixture-agent', 1000, 1001
    );
    INSERT INTO verification (
      id, identifier, value, expires_at, created_at, updated_at
    ) VALUES (
      'fixture-verification', 'fixture@example.com', 'fixture-value', 9000, 1000, 1001
    );
    CREATE INDEX account_provider_idx ON account (provider_id);
  `);
}

function preservedAuthRows(db: BetterSqlite3.Database): unknown {
  return {
    users: db.prepare('SELECT * FROM user ORDER BY id').all(),
    sessions: db.prepare('SELECT * FROM session ORDER BY id').all(),
    accounts: db
      .prepare(
        `SELECT
          id, user_id, account_id, provider_id, access_token, refresh_token,
          access_token_expires_at, refresh_token_expires_at, scope, id_token,
          password, created_at, updated_at
         FROM account
         ORDER BY id`,
      )
      .all(),
    verifications: db.prepare('SELECT * FROM verification ORDER BY id').all(),
  };
}

function expectCurrentContract(db: BetterSqlite3.Database): void {
  const issuer = (accountMetadata(db) as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[])
    .find((column) => column.name === 'issuer');
  expect(issuer).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
  expect(db.prepare('PRAGMA foreign_key_list(account)').all()).toEqual([
    expect.objectContaining({ table: 'user', from: 'user_id', to: 'id', on_delete: 'CASCADE' }),
  ]);
  const index = db
    .prepare('PRAGMA index_list(account)')
    .all()
    .find((row) => (row as { name: string }).name === 'account_issuer_account_id_idx') as
    | { unique: number }
    | undefined;
  expect(index?.unique).toBe(1);
  expect(
    db.prepare('PRAGMA index_info(account_issuer_account_id_idx)').all().map((row) => (row as { name: string }).name),
  ).toEqual(['issuer', 'account_id']);
  expect(db.prepare('PRAGMA foreign_key_check(account)').all()).toEqual([]);
}

function rebuildAsNotNull(db: BetterSqlite3.Database): void {
  db.exec('DROP INDEX account_issuer_account_id_idx');
  db.exec(accountDdl({ shape: 'not-null', table: 'account_not_null' }));
  db.exec(`
    INSERT INTO account_not_null (
      id, user_id, issuer, account_id, provider_id, access_token, refresh_token,
      access_token_expires_at, refresh_token_expires_at, scope, id_token, password,
      created_at, updated_at
    )
    SELECT
      id, user_id, COALESCE(issuer, 'local:credential'), account_id, provider_id,
      access_token, refresh_token, access_token_expires_at, refresh_token_expires_at,
      scope, id_token, password, created_at, updated_at
    FROM account;
    DROP TABLE account;
    ALTER TABLE account_not_null RENAME TO account;
    CREATE UNIQUE INDEX account_issuer_account_id_idx ON account (issuer, account_id);
  `);
}

function startMigrationChild(
  mode: string,
  name: string,
  readyFile: string,
  readyMarker: string,
  env: Record<string, string>,
): TrackedChild {
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER, mode], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: dbPath,
      READY_FILE: readyFile,
      WORKER_NAME: name,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const readyResolvers = Promise.withResolvers<void>();
  const doneResolvers = Promise.withResolvers<ChildOutcome>();
  let output = '';
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes(readyMarker)) readyResolvers.resolve();
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.on('error', (error) => {
    output += error.message;
  });
  child.on('close', (code) => doneResolvers.resolve({ code, output }));
  return { child, ready: readyResolvers.promise, done: doneResolvers.promise };
}

describe('account issuer migration matrix', () => {
  it('[case 1] journals an absent account table, then bootstrap creates and authenticates the nullable shape', () => {
    const db = openDb();
    markEarlierMigrations(db);
    db.close();

    expectSuccess(runMigration());
    const migrated = openDb();
    expect(migrated.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'account'").get()).toBeUndefined();
    expect(tagCount(migrated)).toBe(1);
    migrated.close();

    const auth = runWorker('auth', { AUTH_SIGN_UP: 'true', AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(auth.process.status, auth.process.stderr?.toString()).toBe(0);
    expect(auth.result).toMatchObject({ email: EMAIL, issuer: null });
    const bootstrapped = openDb();
    expectCurrentContract(bootstrapped);
    bootstrapped.close();
  });

  it('[case 2] accepts both legal current id nullability spellings without rebuilding or rewriting', () => {
    for (const idNotNull of [false, true]) {
      const file = join(testDir, `current-${idNotNull}.db`);
      const db = openDb(file);
      createAccountFixture(db, { shape: 'current', idNotNull });
      seedUser(db);
      seedAccount(db, 'current', { issuer: 'kept:value' });
      markEarlierMigrations(db);
      const before = accountState(db);
      db.close();

      const helper = runWorker('helper', {}, file);
      expect(helper.process.status, helper.process.stderr?.toString()).toBe(0);
      expect(helper.result).toMatchObject({ foreignKeys: 1, connectionOpen: true });
      expectSuccess(runMigration(file));

      const after = openDb(file);
      expect(accountState(after)).toEqual(before);
      expect(tagCount(after)).toBe(1);
      expectCurrentContract(after);
      after.close();
    }
  });

  it('[case 3] upgrades populated pre-1.7 rows, preserves objects, and signs in a backfilled credential', () => {
    const initial = runWorker('auth', { AUTH_SIGN_UP: 'true', AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(initial.process.status, initial.process.stderr?.toString()).toBe(0);

    const db = openDb();
    db.exec('DROP INDEX account_issuer_account_id_idx; ALTER TABLE account DROP COLUMN issuer;');
    db.exec('CREATE INDEX account_provider_idx ON account (provider_id)');
    db.exec('CREATE VIEW account_provider_counts AS SELECT provider_id, count(*) AS count FROM account GROUP BY provider_id');
    db.prepare(
      `INSERT INTO account (
        id, user_id, account_id, provider_id, access_token, refresh_token,
        access_token_expires_at, refresh_token_expires_at, scope, id_token, password,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'oauth-account',
      (db.prepare('SELECT id FROM user').get() as { id: string }).id,
      'oauth-external',
      'oauth provider/ü',
      'oa',
      'or',
      4000,
      5000,
      'openid',
      'oid',
      null,
      1100,
      1101,
    );
    markEarlierMigrations(db);
    const oldColumns = accountMetadata(db);
    const oldRows = accountRows(db);
    const oldIndex = db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'account_provider_idx'").get();
    const oldView = db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'account_provider_counts'").get();
    db.close();

    expectSuccess(runMigration());
    const migrated = openDb();
    const newRows = accountRows(migrated) as Record<string, unknown>[];
    expect(newRows.map(({ issuer: _issuer, ...row }) => row)).toEqual(oldRows);
    expect(newRows.find((row) => row.provider_id === 'credential')?.issuer).toBe('local:credential');
    expect(newRows.find((row) => row.provider_id === 'oauth provider/ü')?.issuer).toBe(
      'local:oauth:oauth%20provider%2F%C3%BC',
    );
    expect((oldColumns as unknown[]).length + 1).toBe(accountMetadata(migrated).length);
    expect(migrated.prepare("SELECT sql FROM sqlite_schema WHERE name = 'account_provider_idx'").get()).toEqual(oldIndex);
    expect(migrated.prepare("SELECT sql FROM sqlite_schema WHERE name = 'account_provider_counts'").get()).toEqual(oldView);
    expectCurrentContract(migrated);
    migrated.close();

    const signIn = runWorker('auth', { AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(signIn.process.status, signIn.process.stderr?.toString()).toBe(0);
    expect(signIn.result).toMatchObject({ email: EMAIL, issuer: 'local:credential' });
  });

  it('[case 4] upgrades an empty pre-1.7 table and Better Auth creates and signs in a NULL-issuer account', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'pre-1.7' });
    markEarlierMigrations(db);
    db.close();

    expectSuccess(runMigration());
    const auth = runWorker('auth', { AUTH_SIGN_UP: 'true', AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(auth.process.status, auth.process.stderr?.toString()).toBe(0);
    expect(auth.result).toMatchObject({ email: EMAIL, issuer: null });
  });

  it('[case 5] rebuilds a populated 1.7.0-1.7.2 table with exact rows, metadata, foreign key, and indexes', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'not-null' });
    seedUser(db, 'user-1', 'one@example.com');
    seedUser(db, 'user-2', 'two@example.com');
    seedAccount(db, 'not-null', { id: 'a1', userId: 'user-1', issuer: 'non-local:value' });
    seedAccount(db, 'not-null', {
      id: 'a2',
      userId: 'user-2',
      issuer: '',
      accountId: 'external-2',
      providerId: 'oauth',
      password: '',
    });
    db.exec('CREATE INDEX account_provider_idx ON account (provider_id)');
    markEarlierMigrations(db);
    const rows = accountRows(db);
    db.close();

    expectSuccess(runMigration());
    const migrated = openDb();
    expect(accountRows(migrated)).toEqual(rows);
    const metadata = accountMetadata(migrated) as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
    expect(Object.fromEntries(metadata.map((column) => [column.name, [column.type, column.notnull, column.dflt_value, column.pk]]))).toEqual({
      id: ['TEXT', 1, null, 1],
      user_id: ['TEXT', 1, null, 0],
      issuer: ['TEXT', 0, null, 0],
      account_id: ['TEXT', 1, null, 0],
      provider_id: ['TEXT', 1, null, 0],
      access_token: ['TEXT', 0, null, 0],
      refresh_token: ['TEXT', 0, null, 0],
      access_token_expires_at: ['INTEGER', 0, null, 0],
      refresh_token_expires_at: ['INTEGER', 0, null, 0],
      scope: ['TEXT', 0, null, 0],
      id_token: ['TEXT', 0, null, 0],
      password: ['TEXT', 0, null, 0],
      created_at: ['INTEGER', 1, "cast(unixepoch('subsecond') * 1000 as integer)", 0],
      updated_at: ['INTEGER', 1, "cast(unixepoch('subsecond') * 1000 as integer)", 0],
    });
    expect(accountIndexes(migrated)).toHaveLength(2);
    expectCurrentContract(migrated);
    migrated.close();
  });

  it('[case 6] rebuilds an empty 1.7.0-1.7.2 table and Better Auth creates and signs in a NULL-issuer account', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'not-null' });
    markEarlierMigrations(db);
    db.close();

    expectSuccess(runMigration());
    const auth = runWorker('auth', { AUTH_SIGN_UP: 'true', AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(auth.process.status, auth.process.stderr?.toString()).toBe(0);
    expect(auth.result).toMatchObject({ email: EMAIL, issuer: null });
  });

  it('[case 7] application fallback rebuilds without journaling and startup later journals without rewriting', () => {
    const initial = runWorker('auth', { AUTH_SIGN_UP: 'true', AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(initial.process.status, initial.process.stderr?.toString()).toBe(0);
    const db = openDb();
    db.exec("UPDATE account SET issuer = 'preserved:issuer'");
    rebuildAsNotNull(db);
    markEarlierMigrations(db);
    const originalRows = accountRows(db);
    db.close();

    const helper = runWorker('helper');
    expect(helper.process.status, helper.process.stderr?.toString()).toBe(0);
    const afterHelper = openDb();
    expect(tagCount(afterHelper)).toBe(0);
    expect(accountRows(afterHelper)).toEqual(originalRows);
    afterHelper.exec("UPDATE account SET issuer = NULL WHERE provider_id = 'credential'");
    const beforeRunner = accountRows(afterHelper);
    afterHelper.close();

    expectSuccess(runMigration());
    const afterRunner = openDb();
    expect(accountRows(afterRunner)).toEqual(beforeRunner);
    expect(tagCount(afterRunner)).toBe(1);
    afterRunner.close();
    const signIn = runWorker('auth', { AUTH_EMAIL: EMAIL, AUTH_PASSWORD: PASSWORD });
    expect(signIn.process.status, signIn.process.stderr?.toString()).toBe(0);
    expect(signIn.result).toMatchObject({ email: EMAIL, issuer: null });
  });

  it('[case 8] defers legacy camelCase schemas until empty recreation or gated backed-up reset owns them', () => {
    const emptyFile = join(testDir, 'legacy-empty.db');
    const empty = openDb(emptyFile);
    empty.exec(LEGACY_AUTH_DDL);
    markEarlierMigrations(empty);
    const emptyBefore = empty.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
    empty.close();
    expectSuccess(runMigration(emptyFile));
    const deferredEmpty = openDb(emptyFile);
    expect(tagCount(deferredEmpty)).toBe(0);
    expect(deferredEmpty.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name").all()).toEqual(emptyBefore);
    deferredEmpty.close();
    const emptyBootstrap = runWorker('bootstrap', {}, emptyFile);
    expect(emptyBootstrap.process.status, emptyBootstrap.process.stderr?.toString()).toBe(0);
    expectSuccess(runMigration(emptyFile));
    const convertedEmpty = openDb(emptyFile);
    expect(tagCount(convertedEmpty)).toBe(1);
    expectCurrentContract(convertedEmpty);
    convertedEmpty.close();

    const populatedFile = join(testDir, 'legacy-populated.db');
    const populated = openDb(populatedFile);
    populated.exec(LEGACY_AUTH_DDL);
    populated.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('legacy-user', 'Owner', 'legacy@example.com', 1, 1, 1)`,
    ).run();
    populated.prepare(
      `INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt)
       VALUES ('legacy-account', 'legacy-user', 'legacy-user', 'credential', 'hash', 1, 1)`,
    ).run();
    markEarlierMigrations(populated);
    populated.close();
    expectSuccess(runMigration(populatedFile));
    const deferredPopulated = openDb(populatedFile);
    expect(tagCount(deferredPopulated)).toBe(0);
    deferredPopulated.close();
    const refusal = runWorker('bootstrap', {}, populatedFile);
    expect(refusal.process.status).not.toBe(0);
    expect(`${refusal.process.stderr ?? ''}${refusal.process.stdout ?? ''}`).toMatch(/Refusing to auto-drop/);
    const reset = runWorker('bootstrap', { HOARD_ALLOW_AUTH_TABLE_RESET: 'true' }, populatedFile);
    expect(reset.process.status, reset.process.stderr?.toString()).toBe(0);
    expect(readdirSync(testDir).filter((name) => name.includes('legacy-populated.db.auth-reset-backup-'))).toHaveLength(1);
    expectSuccess(runMigration(populatedFile));
    const convertedPopulated = openDb(populatedFile);
    expect(tagCount(convertedPopulated)).toBe(1);
    convertedPopulated.close();
  });

  it('[case 9] is idempotent for absent, pre-1.7, current, and NOT NULL shapes', () => {
    for (const shape of ['absent', 'pre-1.7', 'current', 'not-null'] as const) {
      const file = join(testDir, `idempotent-${shape}.db`);
      const db = openDb(file);
      if (shape !== 'absent') {
        createAccountFixture(db, { shape });
        seedUser(db);
        seedAccount(db, shape, { issuer: shape === 'not-null' ? 'kept' : undefined });
      }
      markEarlierMigrations(db);
      db.close();
      expectSuccess(runMigration(file));
      const first = openDb(file);
      const state = shape === 'absent' ? null : accountState(first);
      expect(tagCount(first)).toBe(1);
      first.close();
      expectSuccess(runMigration(file));
      const second = openDb(file);
      expect(tagCount(second)).toBe(1);
      if (shape !== 'absent') expect(accountState(second)).toEqual(state);
      second.close();
    }
  });

  it('[case 10] holds an immediate transaction lock while a concurrent starter waits, then journals exactly once', async () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'not-null' });
    seedUser(db);
    seedAccount(db, 'not-null', { issuer: 'concurrent:value' });
    markEarlierMigrations(db);
    const rows = accountRows(db);
    db.close();

    const firstReady = join(testDir, 'first.ready');
    const firstRelease = join(testDir, 'first.release');
    const secondReady = join(testDir, 'second.ready');
    const secondEntered = join(testDir, 'second.entered');
    const first = startMigrationChild(
      'migrate-held-transaction',
      'first',
      firstReady,
      'TRANSACTION_HELD',
      { RELEASE_FILE: firstRelease },
    );
    await first.ready;
    const second = startMigrationChild(
      'migrate-observe-transaction',
      'second',
      secondReady,
      'OUTER_READ_DONE',
      { ENTERED_FILE: secondEntered },
    );
    await second.ready;
    // SQLite lock contention is process-level; fake timers cannot advance the blocked native call.
    const contentionWindow = Promise.withResolvers<void>();
    setTimeout(contentionWindow.resolve, 250);
    await contentionWindow.promise;
    const secondEnteredWhileFirstHeld = existsSync(secondEntered);
    writeFileSync(firstRelease, 'go');

    const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
    expect(
      secondEnteredWhileFirstHeld,
      'the second starter entered its transaction while the first held the write lock',
    ).toBe(false);
    expect(firstResult.code, firstResult.output).toBe(0);
    expect(secondResult.code, secondResult.output).toBe(0);
    expect(firstResult.output).toContain('"inTransaction":false');
    expect(secondResult.output).toContain('"inTransaction":false');
    expect(secondResult.output).toContain('"foreignKeys":1');
    expect(secondResult.output).toContain('TRANSACTION_ENTERED');

    const after = openDb();
    expect(tagCount(after)).toBe(1);
    const probeCount = after.prepare('SELECT COUNT(*) AS count FROM concurrent_probe').get() as { count: number };
    expect(probeCount.count).toBe(2);
    expect(accountRows(after)).toEqual(rows);
    expectCurrentContract(after);
    after.close();
  }, 20_000);

  it('[case 11] rejects inbound account foreign keys under every identifier casing before DDL', () => {
    for (const [fixture, target] of ['account', 'Account', '"ACCOUNT"'].entries()) {
      const file = join(testDir, `inbound-${fixture}.db`);
      const db = openDb(file);
      createAccountFixture(db, { shape: 'not-null' });
      seedUser(db);
      seedAccount(db, 'not-null', { issuer: 'kept' });
      db.exec(`CREATE TABLE child (id TEXT PRIMARY KEY, account_id TEXT REFERENCES ${target}(id))`);
      db.exec("INSERT INTO child (id, account_id) VALUES ('child-1', 'account-1')");
      markEarlierMigrations(db);
      const before = accountState(db);
      db.close();

      const failed = runMigration(file);
      expectFailure(failed, /references.*account/i);
      const unchanged = openDb(file);
      expect(tagCount(unchanged)).toBe(0);
      expect(accountState(unchanged)).toEqual(before);
      expect(unchanged.prepare('SELECT * FROM child').all()).toEqual([{ id: 'child-1', account_id: 'account-1' }]);
      unchanged.exec('DROP TABLE child');
      unchanged.close();
      expectSuccess(runMigration(file));
    }
  });

  it('[case 12] rejects account orphans with row guidance but ignores unrelated foreign-key violations', () => {
    const orphanFile = join(testDir, 'account-orphan.db');
    const orphan = openDb(orphanFile);
    createAccountFixture(orphan, { shape: 'not-null' });
    orphan.pragma('foreign_keys = OFF');
    seedAccount(orphan, 'not-null', { issuer: 'orphan' });
    orphan.pragma('foreign_keys = ON');
    markEarlierMigrations(orphan);
    const before = accountState(orphan);
    orphan.close();
    const failed = runMigration(orphanFile);
    expectFailure(failed, /rowid=1.*Restore the referenced user row/);
    const unchanged = openDb(orphanFile);
    expect(tagCount(unchanged)).toBe(0);
    expect(accountState(unchanged)).toEqual(before);
    unchanged.close();

    const unrelatedFile = join(testDir, 'unrelated-orphan.db');
    const unrelated = openDb(unrelatedFile);
    createAccountFixture(unrelated, { shape: 'not-null' });
    seedUser(unrelated);
    seedAccount(unrelated, 'not-null', { issuer: 'clean' });
    unrelated.exec('CREATE TABLE unrelated_parent (id TEXT PRIMARY KEY); CREATE TABLE unrelated_child (parent_id TEXT REFERENCES unrelated_parent(id));');
    unrelated.pragma('foreign_keys = OFF');
    unrelated.exec("INSERT INTO unrelated_child (parent_id) VALUES ('missing')");
    unrelated.pragma('foreign_keys = ON');
    markEarlierMigrations(unrelated);
    unrelated.close();
    expectSuccess(runMigration(unrelatedFile));
    const migrated = openDb(unrelatedFile);
    expect(tagCount(migrated)).toBe(1);
    expect(migrated.prepare('PRAGMA foreign_key_check(unrelated_child)').all()).toHaveLength(1);
    expectCurrentContract(migrated);
    migrated.close();
  });

  it('[case 13] fails closed on an unknown extra column and succeeds after fixture repair', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'current', extra: 'unexpected TEXT' });
    seedUser(db);
    seedAccount(db, 'current');
    markEarlierMigrations(db);
    const before = accountState(db);
    db.close();
    const failed = runMigration();
    expectFailure(failed, /Unsupported account columns/);
    const unchanged = openDb();
    expect(tagCount(unchanged)).toBe(0);
    expect(accountState(unchanged)).toEqual(before);
    unchanged.exec('ALTER TABLE account DROP COLUMN unexpected');
    unchanged.close();
    expectSuccess(runMigration());
  });

  it('[case 14] fails closed on an unknown missing column and succeeds after fixture repair', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'current', omit: 'scope' });
    seedUser(db);
    markEarlierMigrations(db);
    const before = accountState(db);
    db.close();
    const failed = runMigration();
    expectFailure(failed, /Unsupported account columns/);
    const unchanged = openDb();
    expect(tagCount(unchanged)).toBe(0);
    expect(accountState(unchanged)).toEqual(before);
    unchanged.exec('ALTER TABLE account ADD COLUMN scope TEXT');
    unchanged.close();
    expectSuccess(runMigration());
  });

  it('[case 15] refuses rebuild triggers and views unchanged, then succeeds after each is removed', () => {
    for (const object of ['trigger', 'view'] as const) {
      const file = join(testDir, `${object}.db`);
      const objectName = object === 'trigger' ? 'account_touch' : 'unrelated_view';
      const db = openDb(file);
      createAccountFixture(db, { shape: 'not-null' });
      seedUser(db);
      seedAccount(db, 'not-null', { issuer: 'kept' });
      if (object === 'trigger') {
        db.exec('CREATE TRIGGER account_touch AFTER UPDATE ON account BEGIN SELECT 1; END');
      } else {
        db.exec('CREATE VIEW unrelated_view AS SELECT 1 AS value');
      }
      markEarlierMigrations(db);
      const before = {
        account: accountState(db),
        object: db.prepare('SELECT type, name, sql FROM sqlite_schema WHERE name = ?').get(objectName),
      };
      db.close();
      const failed = runMigration(file);
      expectFailure(failed, object === 'trigger' ? /trigger/ : /view/);
      const unchanged = openDb(file);
      expect(tagCount(unchanged)).toBe(0);
      expect({
        account: accountState(unchanged),
        object: unchanged.prepare('SELECT type, name, sql FROM sqlite_schema WHERE name = ?').get(objectName),
      }).toEqual(before);
      unchanged.exec(`DROP ${object.toUpperCase()} ${objectName}`);
      unchanged.close();
      expectSuccess(runMigration(file));
    }
  });

  it('[case 16] rolls back copy, rename, index replay, and journal together after an injected late failure', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'not-null' });
    seedUser(db);
    seedAccount(db, 'not-null', { issuer: 'rollback:value' });
    db.exec('CREATE INDEX account_provider_idx ON account (provider_id)');
    markEarlierMigrations(db);
    const before = accountState(db);
    db.close();

    const injected = runWorker('migrate-atomic-failure');
    expect(injected.process.status, injected.process.stderr?.toString()).toBe(0);
    expect(injected.result).toMatchObject({ error: 'injected failure before account postconditions' });
    const rolledBack = openDb();
    expect(accountState(rolledBack)).toEqual(before);
    expect(tagCount(rolledBack)).toBe(0);
    rolledBack.close();
    expectSuccess(runMigration());
  });

  it('[case 17] preserves application ownership, closes failed runner connections, and rejects nested transactions before reads', () => {
    const appFile = join(testDir, 'application.db');
    const app = runWorker('application-failure', {}, appFile);
    expect(app.process.status, app.process.stderr?.toString()).toBe(0);
    expect(app.result).toMatchObject({ connectionOpen: true, foreignKeys: 1 });
    expect(app.result?.error).toMatch(/Unsupported account columns/);

    const runnerFile = join(testDir, 'runner.db');
    const runnerDb = openDb(runnerFile);
    createAccountFixture(runnerDb, { shape: 'current', extra: 'unexpected TEXT' });
    markEarlierMigrations(runnerDb);
    runnerDb.close();
    const runner = runWorker('migrate-failure-close', {}, runnerFile);
    expect(runner.process.status, runner.process.stderr?.toString()).toBe(0);
    expect(runner.result).toMatchObject({ connectionOpen: false });
    expect(runner.result?.error).toMatch(/Unsupported account columns/);

    const guardFile = join(testDir, 'guard.db');
    const guardDb = openDb(guardFile);
    createAccountFixture(guardDb, { shape: 'pre-1.7' });
    guardDb.close();
    const guard = runWorker('transaction-guard', {}, guardFile);
    expect(guard.process.status, guard.process.stderr?.toString()).toBe(0);
    expect(guard.result).toMatchObject({ unchanged: true, inTransaction: false });
    expect(guard.result?.error).toMatch(/without an open transaction/);
  });

  it('[case 18] preserves explicit indexes for mixed-case and quoted-uppercase account tables', () => {
    for (const [fixture, table] of [
      ['mixed-case', 'Account'],
      ['quoted-uppercase', '"ACCOUNT"'],
    ] as const) {
      const file = join(testDir, `${fixture}.db`);
      const db = openDb(file);
      createAccountFixture(db, { shape: 'not-null', table });
      seedUser(db);
      seedAccount(db, 'not-null', { issuer: `${fixture}:issuer` });
      db.exec('CREATE INDEX account_provider_idx ON account (provider_id)');
      markEarlierMigrations(db);
      const rows = accountRows(db);
      db.close();

      expectSuccess(runMigration(file));
      const migrated = openDb(file);
      const migratedRows = accountRows(migrated) as { issuer: string }[];
      expect(migratedRows).toEqual(rows);
      expect(migratedRows.map((row) => row.issuer)).toEqual([`${fixture}:issuer`]);
      const migratedIndexes = accountIndexes(migrated) as { name: string }[];
      expect(migratedIndexes.map((index) => index.name)).toEqual([
        'account_issuer_account_id_idx',
        'account_provider_idx',
      ]);
      expect(tagCount(migrated)).toBe(1);
      expectCurrentContract(migrated);
      migrated.close();
    }
  });

  it('[case 19] rolls back the rebuilt table and journal when explicit-index verification fails', () => {
    const db = openDb();
    createAccountFixture(db, { shape: 'not-null' });
    seedUser(db);
    seedAccount(db, 'not-null', { issuer: 'index-verification:value' });
    db.exec('CREATE INDEX account_provider_idx ON account (provider_id)');
    markEarlierMigrations(db);
    const before = accountState(db);
    db.close();

    const injected = runWorker('migrate-index-verification-failure');
    expect(injected.process.status, injected.process.stderr?.toString()).toBe(0);
    expect(injected.result?.error).toMatch(
      /Explicit account index "account_provider_idx" was not restored with its original columns/,
    );
    const rolledBack = openDb();
    expect(accountState(rolledBack)).toEqual(before);
    expect(tagCount(rolledBack)).toBe(0);
    rolledBack.close();

    expectSuccess(runMigration());
    const migrated = openDb();
    expect(tagCount(migrated)).toBe(1);
    migrated.close();
  });
  it('[case 20] records the reconciled fixture issuer metadata exactly', () => {
    const db = openDb();
    loadFixture(db, 'reconciled.sql');
    const issuer = (
      db.prepare('PRAGMA table_info(account)').all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }[]
    ).find((column) => column.name === 'issuer');

    expect(
      issuer && {
        cid: issuer.cid,
        type: issuer.type,
        notnull: issuer.notnull,
        dflt_value: issuer.dflt_value,
      },
    ).toEqual({ cid: 13, type: 'TEXT', notnull: 1, dflt_value: "''" });
    db.close();
  });

  it.each(BOOT_FIXTURES)(
    '[case 21] boots the $name schema fixture twice and authenticates after migration',
    ({ name, file: fixtureFile, shape }) => {
      const file = join(testDir, `${name}.db`);
      const db = openDb(file);
      loadFixture(db, fixtureFile);

      let rowsBefore: unknown = null;
      let foreignKeyBefore: unknown[] = [];
      let indexesBefore: { name: string; sql: string }[] = [];
      if (shape !== null) {
        seedFixtureAuthRows(db, shape);
        rowsBefore = preservedAuthRows(db);
        foreignKeyBefore = db.prepare('PRAGMA foreign_key_list(account)').all();
        indexesBefore = accountIndexes(db) as { name: string; sql: string }[];
      }
      markEarlierMigrations(db);
      db.pragma('journal_mode = WAL');
      db.close();

      expectSuccess(runMigration(file));
      if (shape === null) {
        const journaled = openDb(file);
        expect(tagCount(journaled)).toBe(1);
        expect(
          journaled
            .prepare(
              "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'account'",
            )
            .get(),
        ).toBeUndefined();
        journaled.close();

        const bootstrap = runWorker('bootstrap', {}, file);
        expect(bootstrap.process.status, bootstrap.process.stderr?.toString()).toBe(0);
      }

      const migrated = openDb(file);
      expect(tagCount(migrated)).toBe(1);
      expectCurrentContract(migrated);
      if (shape !== null) {
        expect(preservedAuthRows(migrated)).toEqual(rowsBefore);
        expect(migrated.prepare('PRAGMA foreign_key_list(account)').all()).toEqual(
          foreignKeyBefore,
        );
        for (const index of indexesBefore) {
          expect(
            migrated
              .prepare(
                "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name = ?",
              )
              .get(index.name),
          ).toEqual(index);
        }
        const issuers = migrated
          .prepare('SELECT issuer FROM account ORDER BY id')
          .all();
        expect(issuers).toEqual(
          shape === 'pre-1.7'
            ? [
                { issuer: 'local:oauth:oauth%20provider%2F%C3%BC' },
                { issuer: 'local:credential' },
              ]
            : [{ issuer: 'custom:issuer' }, { issuer: '' }],
        );
      }
      const firstState = accountState(migrated);
      migrated.close();

      const secondRun = runMigration(file);
      expectSuccess(secondRun);
      expect(secondRun.stdout).toContain('[startup] Database is up to date');
      const rerun = openDb(file);
      expect(tagCount(rerun)).toBe(1);
      expect(accountState(rerun)).toEqual(firstState);
      rerun.close();

      const authReady = openDb(file);
      authReady.exec(`
        DELETE FROM verification;
        DELETE FROM session;
        DELETE FROM account;
        DELETE FROM user;
      `);
      authReady.close();

      const email = `${name}@example.com`;
      const auth = runWorker(
        'auth',
        { AUTH_SIGN_UP: 'true', AUTH_EMAIL: email, AUTH_PASSWORD: PASSWORD },
        file,
      );
      expect(auth.process.status, auth.process.stderr?.toString()).toBe(0);
      expect(auth.result).toMatchObject({ email, issuer: null });
    },
  );

  it('[case 22] refuses an issuer default other than the empty string without changing the database', () => {
    const file = join(testDir, 'unsupported-default.db');
    const db = openDb(file);
    const unsupportedFixture = readFileSync(
      join(FIXTURE_DIR, 'reconciled.sql'),
      'utf8',
    ).replace("DEFAULT ''", "DEFAULT 'x'");
    db.exec(unsupportedFixture);
    seedFixtureAuthRows(db, 'not-null');
    markEarlierMigrations(db);
    db.pragma('journal_mode = WAL');
    const stateBefore = accountState(db);
    db.close();
    const bytesBefore = readFileSync(file);

    const failed = runMigration(file);
    expectFailure(failed, /Unsupported account\.issuer metadata/);
    expect(
      readFileSync(file).equals(bytesBefore),
      'migration refusal changed the database file',
    ).toBe(true);

    const unchanged = openDb(file);
    expect(tagCount(unchanged)).toBe(0);
    expect(accountState(unchanged)).toEqual(stateBefore);
    unchanged.close();
  });
});
