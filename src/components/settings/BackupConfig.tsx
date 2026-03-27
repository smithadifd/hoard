'use client';

import { useState, useEffect } from 'react';
import { HardDrive, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useApiMutation } from '@/hooks/useApiMutation';

interface BackupStatus {
  lastBackup: string | null;
  backupCount: number;
  totalSize: number;
  oldestBackup: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export function BackupConfig() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [backupMessage, setBackupMessage] = useState('');

  const {
    mutate: runBackup,
    isPending: backingUp,
    status: backupResult,
  } = useApiMutation<undefined, { data: { fileSize: number } }>('/api/backup', {
    method: 'POST',
    onSuccess: (resp) => {
      setBackupMessage(`Backup created (${formatBytes(resp.data.fileSize)})`);
    },
    onError: (msg) => {
      setBackupMessage(msg);
    },
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/backup')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setStatus(data.data);
      })
      .catch(() => {
        // Ignore — status just won't show
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [backupResult]);

  const handleBackupNow = () => {
    setBackupMessage('');
    runBackup();
  };

  return (
    <section className="rounded-xl bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <HardDrive className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Database Backups</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Automatic daily backups at 4am. Backups are kept for 30 days.
      </p>

      {/* Backup Status */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading backup status...
        </div>
      ) : status && status.backupCount > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Last Backup</p>
            <p className="font-medium">{formatRelativeTime(status.lastBackup!)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Backups</p>
            <p className="font-medium">{status.backupCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Size</p>
            <p className="font-medium">{formatBytes(status.totalSize)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Oldest</p>
            <p className="font-medium">{formatRelativeTime(status.oldestBackup!)}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-yellow-500">
          No backups yet. Run a manual backup or wait for the next scheduled run.
        </p>
      )}

      {/* Manual Backup */}
      <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
        <button
          onClick={handleBackupNow}
          disabled={backingUp}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          {backingUp ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <HardDrive className="h-4 w-4" />
          )}
          Backup Now
        </button>
        {backupMessage && (
          <span className={`flex items-center gap-1 text-xs ${
            backupResult === 'success' ? 'text-deal-great' : 'text-destructive'
          }`}>
            {backupResult === 'success' ? (
              <CheckCircle className="h-3 w-3" />
            ) : (
              <AlertCircle className="h-3 w-3" />
            )}
            {backupMessage}
          </span>
        )}
      </div>
    </section>
  );
}
