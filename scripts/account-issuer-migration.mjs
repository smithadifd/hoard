const MIGRATION_TAG = '0019_fast_gauntlet';
const CANONICAL_INDEX = 'account_issuer_account_id_idx';
const ACCOUNT_COLUMNS = [
  'id',
  'user_id',
  'issuer',
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
const PRE_17_COLUMNS = ACCOUNT_COLUMNS.filter((name) => name !== 'issuer');
const TIMESTAMP_DEFAULT = "cast(unixepoch('subsecond') * 1000 as integer)";

function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function tableInfo(db) {
  return db.prepare('PRAGMA table_info(account)').all();
}

function accountViolations(db) {
  return db.prepare('PRAGMA foreign_key_check(account)').all();
}

function assertNoAccountViolations(db, phase) {
  const violations = accountViolations(db);
  if (violations.length === 0) return;

  const details = violations
    .map((row) => `rowid=${String(row.rowid)}, parent=${String(row.parent)}, fk=${String(row.fkid)}`)
    .join('; ');
  throw new Error(
    `account foreign-key violation ${phase}: ${details}. ` +
      'Restore the referenced user row, or correct/delete the orphan account row, then retry.',
  );
}

function assertNoInboundAccountForeignKeys(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();

  for (const { name } of tables) {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all();
    const inbound = foreignKeys.find((foreignKey) => foreignKey.table.toLowerCase() === 'account');
    if (inbound) {
      throw new Error(
        `Cannot migrate account while table ${quoteIdentifier(name)} references ` +
          `${quoteIdentifier(inbound.table)}. Remove the inbound foreign key and retry.`,
      );
    }
  }
}

function assertColumnSet(columns) {
  const names = new Set(columns.map((column) => column.name));
  const legal =
    names.size === ACCOUNT_COLUMNS.length && ACCOUNT_COLUMNS.every((name) => names.has(name))
      ? 'current'
      : names.size === PRE_17_COLUMNS.length && PRE_17_COLUMNS.every((name) => names.has(name))
        ? 'pre-1.7'
        : null;

  if (!legal) {
    throw new Error(
      `Unsupported account columns; refusing to migrate. Observed metadata: ${JSON.stringify(columns)}`,
    );
  }

  const id = columns.find((column) => column.name === 'id');
  if (
    !id ||
    id.type.toUpperCase() !== 'TEXT' ||
    (id.notnull !== 0 && id.notnull !== 1) ||
    id.dflt_value !== null ||
    id.pk !== 1
  ) {
    throw new Error(`Unsupported account.id metadata; refusing to migrate: ${JSON.stringify(id)}`);
  }

  if (legal === 'pre-1.7') return 'pre-1.7';

  const issuer = columns.find((column) => column.name === 'issuer');
  if (
    !issuer ||
    issuer.type.toUpperCase() !== 'TEXT' ||
    (issuer.notnull !== 0 && issuer.notnull !== 1) ||
    issuer.dflt_value !== null ||
    issuer.pk !== 0
  ) {
    throw new Error(`Unsupported account.issuer metadata; refusing to migrate: ${JSON.stringify(issuer)}`);
  }

  return issuer.notnull === 1 ? 'not-null' : 'current';
}

function assertAccountForeignKey(db) {
  const foreignKeys = db.prepare('PRAGMA foreign_key_list(account)').all();
  const valid =
    foreignKeys.length === 1 &&
    foreignKeys[0].table.toLowerCase() === 'user' &&
    foreignKeys[0].from === 'user_id' &&
    foreignKeys[0].to === 'id' &&
    foreignKeys[0].on_update.toUpperCase() === 'NO ACTION' &&
    foreignKeys[0].on_delete.toUpperCase() === 'CASCADE';
  if (!valid) {
    throw new Error(
      `account must have exactly user_id -> user(id) ON DELETE CASCADE; observed: ` +
        JSON.stringify(foreignKeys),
    );
  }
}

function canonicalIndexMetadata(db) {
  const index = db
    .prepare('PRAGMA index_list(account)')
    .all()
    .find((row) => row.name === CANONICAL_INDEX);
  if (!index) return null;

  const columns = db
    .prepare(`PRAGMA index_info(${quoteIdentifier(CANONICAL_INDEX)})`)
    .all()
    .map((row) => row.name);
  return { index, columns };
}

function assertCanonicalIndex(db) {
  const metadata = canonicalIndexMetadata(db);
  const valid =
    metadata &&
    metadata.index.unique === 1 &&
    metadata.index.partial === 0 &&
    metadata.columns.length === 2 &&
    metadata.columns[0] === 'issuer' &&
    metadata.columns[1] === 'account_id';
  if (!valid) {
    throw new Error(
      `${CANONICAL_INDEX} must be UNIQUE (issuer, account_id); observed: ` + JSON.stringify(metadata),
    );
  }
}

function ensureCanonicalIndex(db) {
  const existing = canonicalIndexMetadata(db);
  if (existing) {
    assertCanonicalIndex(db);
    return;
  }
  db.exec(
    `CREATE UNIQUE INDEX ${CANONICAL_INDEX} ON account (issuer, account_id)`,
  );
  assertCanonicalIndex(db);
}

function assertCommonPostconditions(db) {
  const columns = tableInfo(db);
  if (assertColumnSet(columns) !== 'current') {
    throw new Error(`account.issuer is not nullable after migration: ${JSON.stringify(columns)}`);
  }
  assertAccountForeignKey(db);
  assertCanonicalIndex(db);
}

function assertRebuiltColumns(db) {
  const expected = {
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
    created_at: ['INTEGER', 1, TIMESTAMP_DEFAULT, 0],
    updated_at: ['INTEGER', 1, TIMESTAMP_DEFAULT, 0],
  };
  const columns = tableInfo(db);
  const observed = Object.fromEntries(
    columns.map((column) => [
      column.name,
      [column.type.toUpperCase(), column.notnull, column.dflt_value, column.pk],
    ]),
  );
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `Rebuilt account metadata does not match the canonical schema. Observed: ${JSON.stringify(columns)}`,
    );
  }
}

function rebuildAccount(db) {
  const trigger = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'account' COLLATE NOCASE")
    .get();
  if (trigger) {
    throw new Error(`Cannot rebuild account while trigger ${quoteIdentifier(trigger.name)} exists.`);
  }

  const view = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'view' AND name NOT LIKE 'sqlite_%' LIMIT 1")
    .get();
  if (view) {
    throw new Error(`Cannot rebuild account while user-defined view ${quoteIdentifier(view.name)} exists.`);
  }

  const indexes = db
    .prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'account' AND sql IS NOT NULL ORDER BY name",
    )
    .all();

  const canonical = indexes.find((index) => index.name === CANONICAL_INDEX);
  if (canonical) assertCanonicalIndex(db);

  db.exec(`
    CREATE TABLE __new_account_0019 (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      issuer TEXT,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      id_token TEXT,
      password TEXT,
      created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON UPDATE NO ACTION ON DELETE CASCADE
    );
    INSERT INTO __new_account_0019 (
      id, user_id, issuer, account_id, provider_id, access_token, refresh_token,
      access_token_expires_at, refresh_token_expires_at, scope, id_token, password,
      created_at, updated_at
    )
    SELECT
      id, user_id, issuer, account_id, provider_id, access_token, refresh_token,
      access_token_expires_at, refresh_token_expires_at, scope, id_token, password,
      created_at, updated_at
    FROM account;
    DROP TABLE account;
    ALTER TABLE __new_account_0019 RENAME TO account;
  `);

  for (const index of indexes) db.exec(index.sql);
  if (!canonical) ensureCanonicalIndex(db);
}

export const ACCOUNT_ISSUER_MIGRATION_TAG = MIGRATION_TAG;

/**
 * Reconciles every supported Better Auth account schema in one immediate
 * transaction. The optional journal callbacks participate in that transaction.
 */
export function reconcileAccountIssuerSchema(db, options = {}) {
  if (db.inTransaction) {
    throw new Error(
      'reconcileAccountIssuerSchema must be called without an open transaction; it owns BEGIN IMMEDIATE.',
    );
  }
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('reconcileAccountIssuerSchema requires PRAGMA foreign_keys = 1.');
  }

  const journal = options.journal;
  if (journal && (!journal.isApplied || !journal.markApplied)) {
    throw new Error('Account migration journal requires both isApplied and markApplied callbacks.');
  }

  const migrate = db.transaction(() => {
    if (journal?.isApplied(MIGRATION_TAG)) {
      return { status: 'already-applied', shape: null };
    }

    const legacyColumn = db
      .prepare(`SELECT name FROM pragma_table_info('user') WHERE name = 'emailVerified'`)
      .get();
    if (legacyColumn) {
      return { status: 'deferred', shape: 'legacy-camel-case' };
    }

    const accountTable = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'account' COLLATE NOCASE")
      .get();
    if (!accountTable) {
      journal?.markApplied(MIGRATION_TAG);
      return { status: 'applied', shape: 'absent' };
    }

    assertNoInboundAccountForeignKeys(db);
    assertNoAccountViolations(db, 'before migration');

    const sourceShape = assertColumnSet(tableInfo(db));
    if (sourceShape === 'pre-1.7') {
      db.exec('ALTER TABLE account ADD COLUMN issuer TEXT');
      const rows = db.prepare('SELECT id, provider_id FROM account').all();
      const update = db.prepare('UPDATE account SET issuer = ? WHERE id = ?');
      for (const row of rows) {
        const issuer =
          row.provider_id === 'credential'
            ? 'local:credential'
            : `local:oauth:${encodeURIComponent(row.provider_id)}`;
        update.run(issuer, row.id);
      }
      ensureCanonicalIndex(db);
    } else if (sourceShape === 'current') {
      ensureCanonicalIndex(db);
    } else {
      rebuildAccount(db);
    }

    assertCommonPostconditions(db);
    if (sourceShape === 'not-null') assertRebuiltColumns(db);
    assertNoAccountViolations(db, 'after migration');
    journal?.markApplied(MIGRATION_TAG);
    return { status: 'applied', shape: sourceShape };
  });

  return migrate.immediate();
}
