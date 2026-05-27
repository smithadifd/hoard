/**
 * Shared types for the System tab API responses.
 *
 * Mirrors the response shapes from:
 *  - GET /api/sync/sources
 *  - GET /api/sync/sources/[source]
 */

import type { SyncService } from './sources';

export type Health = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface SourceRecentStat {
  startedAt: string;
  status: string;
  itemsProcessed: number | null;
  itemsAttempted: number | null;
  itemsFailed: number | null;
  apiCalls: number | null;
}

export interface SourceLastRun {
  id: number;
  status: string;
  itemsProcessed: number | null;
  itemsAttempted: number | null;
  itemsFailed: number | null;
  apiCalls: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SourceTaskInfo {
  name: string;
  schedule: string;
  isRunning: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

export interface SourceEntry {
  source: string;
  label: string;
  description: string;
  service: SyncService;
  supportsManualRun: boolean;
  manualRunType: string | null;
  task: SourceTaskInfo | null;
  health: Health;
  threshold: number | null;
  minAttempts: number;
  /** Newest-first list, up to 14 entries. */
  recentStats: SourceRecentStat[];
  apiCalls24h: number;
  lastRun: SourceLastRun | null;
}

export interface ApiCallsByService {
  steam: number;
  itad: number;
  hltb: number;
}

export interface SourcesResponse {
  sources: SourceEntry[];
  apiCallsByService7d: ApiCallsByService;
}

export interface SyncRunRow {
  id: number;
  source: string;
  status: string;
  itemsProcessed: number | null;
  itemsAttempted: number | null;
  itemsFailed: number | null;
  errorMessage: string | null;
  apiCalls: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface DailyRollupRow {
  day: string;
  total: number;
  succeeded: number;
  partial: number;
  errored: number;
  itemsProcessed: number;
  itemsAttempted: number;
  itemsFailed: number;
  apiCalls: number;
}

export interface SourceDetailResponse {
  source: string;
  label: string;
  description: string;
  service: SyncService;
  supportsManualRun: boolean;
  manualRunType: string | null;
  threshold: number | null;
  minAttempts: number;
  runs: SyncRunRow[];
  dailyRollup: DailyRollupRow[];
}
