/**
 * In-Container Database Backup Script
 *
 * Uses better-sqlite3's .backup() API for safe, atomic backups.
 * Designed to run inside the Docker container where sqlite3 CLI
 * may not be available. Can be called from the scheduler or CLI.
 *
 * Usage:
 *   npx tsx scripts/backup-db.ts
 *   npx tsx scripts/backup-db.ts --tag pre-deploy
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export interface BackupResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
  backupCount?: number;
  cleanedUp?: number;
}

export async function runBackup(options?: { tag?: string }): Promise<BackupResult> {
  const dbPath = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');
  const backupDir = join(dirname(dbPath), 'backups');
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

  // Build filename with optional tag
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const tag = options?.tag ? `_${options.tag}` : '';
  const backupFile = join(backupDir, `hoard_${timestamp}${tag}.db`);

  try {
    // Verify source database exists
    if (!existsSync(dbPath)) {
      return { success: false, error: `Database not found at: ${dbPath}` };
    }

    // Create backup directory
    mkdirSync(backupDir, { recursive: true });

    // Open source database and run backup
    const sourceDb = new Database(dbPath, { readonly: true });
    console.log(`[backup] Starting backup of ${dbPath}`);

    await sourceDb.backup(backupFile);
    sourceDb.close();

    // Verify backup was created
    if (!existsSync(backupFile)) {
      return { success: false, error: 'Backup file was not created' };
    }

    const fileSize = statSync(backupFile).size;
    console.log(`[backup] Created: ${backupFile} (${formatBytes(fileSize)})`);

    // Integrity check on the backup
    const backupDb = new Database(backupFile, { readonly: true });
    const integrity = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    backupDb.close();

    if (integrity[0]?.integrity_check !== 'ok') {
      unlinkSync(backupFile);
      return { success: false, error: `Integrity check failed: ${integrity[0]?.integrity_check}` };
    }
    console.log('[backup] Integrity check passed');

    // Clean up old backups
    const cleanedUp = cleanupOldBackups(backupDir, retentionDays);
    if (cleanedUp > 0) {
      console.log(`[backup] Cleaned up ${cleanedUp} backup(s) older than ${retentionDays} days`);
    }

    // Count remaining backups
    const backupCount = readdirSync(backupDir).filter((f) => f.startsWith('hoard_') && f.endsWith('.db')).length;
    console.log(`[backup] Done. ${backupCount} backup(s) in ${backupDir}`);

    return { success: true, filePath: backupFile, fileSize, backupCount, cleanedUp };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backup] Failed:`, message);
    return { success: false, error: message };
  }
}

function cleanupOldBackups(backupDir: string, retentionDays: number): number {
  if (retentionDays <= 0) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  const files = readdirSync(backupDir).filter((f) => f.startsWith('hoard_') && f.endsWith('.db'));

  for (const file of files) {
    const filePath = join(backupDir, file);
    const stat = statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      unlinkSync(filePath);
      cleaned++;
    }
  }

  return cleaned;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get status information about existing backups.
 */
export function getBackupStatus(): {
  lastBackup: string | null;
  backupCount: number;
  totalSize: number;
  oldestBackup: string | null;
} {
  const dbPath = process.env.DATABASE_URL || join(ROOT, 'data', 'hoard.db');
  const backupDir = join(dirname(dbPath), 'backups');

  if (!existsSync(backupDir)) {
    return { lastBackup: null, backupCount: 0, totalSize: 0, oldestBackup: null };
  }

  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith('hoard_') && f.endsWith('.db'))
    .map((f) => {
      const stat = statSync(join(backupDir, f));
      return { name: f, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    return { lastBackup: null, backupCount: 0, totalSize: 0, oldestBackup: null };
  }

  return {
    lastBackup: new Date(files[0].mtime).toISOString(),
    backupCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    oldestBackup: new Date(files[files.length - 1].mtime).toISOString(),
  };
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('backup-db.ts') || process.argv[1].endsWith('backup-db.mjs'))) {
  const tagIndex = process.argv.indexOf('--tag');
  const tag = tagIndex !== -1 ? process.argv[tagIndex + 1] : undefined;

  runBackup({ tag }).then((result) => {
    if (!result.success) {
      console.error(`[backup] FAILED: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  });
}
