'use client';

import { useState, useEffect } from 'react';
import { Activity, Loader2, CheckCircle, XCircle, Clock, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

interface TaskStatus {
  name: string;
  schedule: string;
  isRunning: boolean;
  lastRun?: string;
}

interface SyncLogEntry {
  id: number;
  source: string;
  status: string;
  itemsProcessed: number;
  itemsAttempted: number | null;
  itemsFailed: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  steam_library: 'Steam Library',
  steam_wishlist: 'Steam Wishlist',
  itad_prices: 'ITAD Prices',
  hltb: 'HLTB Durations',
  reviews: 'Steam Reviews',
  alert_check: 'Price Alerts',
  database_backup: 'Database Backup',
  release_check: 'Release Check',
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '-';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 text-deal-great" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'partial':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function SyncHistory() {
  const [tasks, setTasks] = useState<TaskStatus[]>([]);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedError, setExpandedError] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sync')
      .then(res => res.json())
      .then(data => {
        if (!cancelled) {
          setTasks(data.data.tasks ?? []);
          setLogs(data.data.logs ?? []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Sync History</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Scheduled task status and recent sync operations.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sync history...
        </div>
      ) : (
        <>
          {/* Scheduler Tasks */}
          {tasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Scheduled Tasks</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tasks.map(task => (
                  <div
                    key={task.name}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{task.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{task.schedule}</span>
                    </div>
                    {task.isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin" />
                    ) : task.lastRun ? (
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(task.lastRun)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Sync Logs */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Recent Syncs</h3>
            {logs.length === 0 ? (
              <p className="text-sm text-yellow-500">No sync operations recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Source</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium hidden sm:table-cell">Items</th>
                      <th className="pb-2 pr-4 font-medium hidden sm:table-cell">Duration</th>
                      <th className="pb-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4">
                          {log.status === 'error' && log.errorMessage ? (
                            <button
                              onClick={() => setExpandedError(expandedError === log.id ? null : log.id)}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              {expandedError === log.id ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                              {SOURCE_LABELS[log.source] ?? log.source}
                            </button>
                          ) : (
                            SOURCE_LABELS[log.source] ?? log.source
                          )}
                          {expandedError === log.id && log.errorMessage && (
                            <p className="mt-1 text-xs text-destructive break-all">
                              {log.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1.5">
                            <StatusIcon status={log.status} />
                            <span className={
                              log.status === 'success' ? 'text-deal-great' :
                              log.status === 'error' ? 'text-destructive' :
                              'text-yellow-500'
                            }>
                              {log.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 hidden sm:table-cell text-muted-foreground">
                          {log.itemsAttempted && log.itemsAttempted > 0
                            ? `${log.itemsProcessed}/${log.itemsAttempted}`
                            : log.itemsProcessed}
                          {log.itemsFailed && log.itemsFailed > 0 && (
                            <span className="text-yellow-500 ml-1">({log.itemsFailed} failed)</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 hidden sm:table-cell text-muted-foreground">
                          {formatDuration(log.startedAt, log.completedAt)}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {formatRelativeTime(log.startedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
