import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { validateAccountIssuerColumns } from './account-issuer-migration.mjs';

const databasePath = process.argv[2];
if (!databasePath) {
  console.error('Usage: node scripts/check-account-shape.mjs <database-path>');
  process.exitCode = 1;
} else {
  const db = new Database(resolve(databasePath), { readonly: true, fileMustExist: true });
  try {
    const columns = db.prepare('PRAGMA table_info(account)').all();
    console.log('PRAGMA table_info(account):');
    console.log(JSON.stringify(columns, null, 2));

    if (columns.length === 0) {
      console.log('Validator: ACCEPT (absent)');
    } else {
      try {
        const shape = validateAccountIssuerColumns(columns);
        console.log(`Validator: ACCEPT (${shape})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`Validator: REFUSE (${message})`);
        process.exitCode = 1;
      }
    }
  } finally {
    db.close();
  }
}
