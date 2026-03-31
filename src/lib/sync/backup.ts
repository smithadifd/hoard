/**
 * Database Backup Sync Module
 *
 * Wraps the backup logic for use by the scheduler.
 * Uses better-sqlite3's .backup() API for atomic, WAL-safe backups.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { getConfig } from '../config';
import { createSyncLog, completeSyncLog } from '../db/queries';

export interface BackupResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
  backupCount?: number;
  cleanedUp?: number;
}

export async function runDatabaseBackup(options?: { tag?: string }): Promise<BackupResult> {
  const config = getConfig();
  const dbPath = config.databaseUrl;
  const backupDir = join(dirname(dbPath), 'backups');
  const retentionDays = config.backupRetentionDays;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const tag = options?.tag ? `_${options.tag}` : '';
  const backupFile = join(backupDir, `hoard_${timestamp}${tag}.db`);

  const syncLogId = createSyncLog('backup');

  try {
    if (!existsSync(dbPath)) {
      const error = `Database not found at: ${dbPath}`;
      completeSyncLog(syncLogId, 'error', 0, error);
      return { success: false, error };
    }

    mkdirSync(backupDir, { recursive: true });

    const sourceDb = new Database(dbPath, { readonly: true });
    console.log(`[backup] Starting backup of ${dbPath}`);

    await sourceDb.backup(backupFile);
    sourceDb.close();

    if (!existsSync(backupFile)) {
      return { success: false, error: 'Backup file was not created' };
    }

    const fileSize = statSync(backupFile).size;
    console.log(`[backup] Created: ${backupFile} (${formatBytes(fileSize)})`);

    // Integrity check
    const backupDb = new Database(backupFile, { readonly: true });
    const integrity = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    backupDb.close();

    if (integrity[0]?.integrity_check !== 'ok') {
      unlinkSync(backupFile);
      const error = `Integrity check failed: ${integrity[0]?.integrity_check}`;
      completeSyncLog(syncLogId, 'error', 0, error);
      return { success: false, error };
    }
    console.log('[backup] Integrity check passed');

    // Clean up old backups
    const cleanedUp = cleanupOldBackups(backupDir, retentionDays);
    if (cleanedUp > 0) {
      console.log(`[backup] Cleaned up ${cleanedUp} backup(s) older than ${retentionDays} days`);
    }

    const backupCount = readdirSync(backupDir).filter((f) => f.startsWith('hoard_') && f.endsWith('.db')).length;
    console.log(`[backup] Done. ${backupCount} backup(s) in ${backupDir}`);

    completeSyncLog(syncLogId, 'success', 1, undefined, 1, 0);
    return { success: true, filePath: backupFile, fileSize, backupCount, cleanedUp };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backup] Failed:`, message);
    completeSyncLog(syncLogId, 'error', 0, message);
    return { success: false, error: message };
  }
}

/**
 * Get info about existing backups (for the Settings UI).
 */
export function getBackupStatus(): {
  lastBackup: string | null;
  backupCount: number;
  totalSize: number;
  oldestBackup: string | null;
} {
  const config = getConfig();
  const backupDir = join(dirname(config.databaseUrl), 'backups');

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
