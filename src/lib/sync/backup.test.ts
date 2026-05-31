import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanupOldBackups } from './backup';

describe('cleanupOldBackups', () => {
  let dir: string;

  // Write a backup file and back-date its mtime by `ageDays`.
  function writeBackup(name: string, ageDays: number) {
    const path = join(dir, name);
    writeFileSync(path, 'x');
    const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    utimesSync(path, when, when);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hoard-backup-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes backups older than the retention window and keeps newer ones', () => {
    writeBackup('hoard_2026-01-01_00-00-00.db', 30); // older than 7 days → delete
    writeBackup('hoard_2026-01-10_00-00-00.db', 10); // older than 7 days → delete
    writeBackup('hoard_2026-05-30_00-00-00.db', 1); // within window → keep

    const cleaned = cleanupOldBackups(dir, 7);

    expect(cleaned).toBe(2);
    const remaining = readdirSync(dir);
    expect(remaining).toEqual(['hoard_2026-05-30_00-00-00.db']);
  });

  it('only touches hoard_*.db files, leaving non-backups intact', () => {
    writeBackup('hoard_old.db', 30);
    writeFileSync(join(dir, 'notes.txt'), 'keep me'); // not a backup
    writeFileSync(join(dir, 'hoard_recent.db.wal'), 'x'); // wrong suffix

    const cleaned = cleanupOldBackups(dir, 7);

    expect(cleaned).toBe(1);
    const remaining = readdirSync(dir).sort();
    expect(remaining).toEqual(['hoard_recent.db.wal', 'notes.txt']);
  });

  it('is a no-op when retentionDays <= 0 (retention disabled)', () => {
    writeBackup('hoard_ancient.db', 365);
    expect(cleanupOldBackups(dir, 0)).toBe(0);
    expect(readdirSync(dir)).toEqual(['hoard_ancient.db']);
  });
});
