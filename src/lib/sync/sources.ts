/**
 * Sync Source Registry
 *
 * Single source of truth for the set of known sync sources, their display
 * metadata, scheduler task names, and which external service drives them.
 *
 * Used by the System Settings tab aggregation endpoints and UI to render
 * per-source health cards, sparklines, and API-call usage widgets.
 */

export type SyncService = 'steam' | 'itad' | 'hltb' | 'discord' | 'internal';

export interface SyncSourceDef {
  /** Sync log source key (matches `sync_log.source`). */
  key: string;
  /** Display label for the UI. */
  label: string;
  /** Short description of what this source does. */
  description: string;
  /** External service the source primarily talks to. */
  service: SyncService;
  /** Scheduler task name (from instrumentation.ts) — null if no scheduled task. */
  taskName: string | null;
  /** True if a manual run can be triggered via POST /api/sync. */
  supportsManualRun: boolean;
  /** Manual run type for POST /api/sync (only when supportsManualRun is true). */
  manualRunType?: string;
}

export const SYNC_SOURCES: SyncSourceDef[] = [
  {
    key: 'steam_library',
    label: 'Steam Library',
    description: 'Owned games + playtime from Steam Web API',
    service: 'steam',
    taskName: 'library-sync',
    supportsManualRun: true,
    manualRunType: 'library',
  },
  {
    key: 'steam_wishlist',
    label: 'Steam Wishlist',
    description: 'Wishlist entries from Steam Web API',
    service: 'steam',
    taskName: 'wishlist-sync',
    supportsManualRun: true,
    manualRunType: 'wishlist',
  },
  {
    key: 'itad_prices',
    label: 'ITAD Prices',
    description: 'Current best prices + historical lows across stores',
    service: 'itad',
    taskName: 'price-check',
    supportsManualRun: true,
    manualRunType: 'prices',
  },
  {
    key: 'itad_history',
    label: 'ITAD Price History',
    description: 'Per-game price history backfill (manual triggers from detail pages)',
    service: 'itad',
    taskName: null,
    supportsManualRun: false,
  },
  {
    key: 'price-history-backfill',
    label: 'Price History Enrichment',
    description: 'Nightly batch of new ITAD price history',
    service: 'itad',
    taskName: 'price-history-backfill',
    supportsManualRun: true,
    manualRunType: 'price-history-backfill',
  },
  {
    key: 'price-history-prime',
    label: 'Price History Prime',
    description: 'Drain mode for fresh onboarding — primes the full price-history queue',
    service: 'itad',
    taskName: null,
    supportsManualRun: true,
    manualRunType: 'price-history-prime',
  },
  {
    key: 'hltb',
    label: 'HowLongToBeat',
    description: 'Game duration estimates from HLTB',
    service: 'hltb',
    taskName: 'hltb-sync',
    supportsManualRun: true,
    manualRunType: 'hltb',
  },
  {
    key: 'reviews',
    label: 'Steam Reviews',
    description: 'Steam review summaries + scores',
    service: 'steam',
    taskName: 'review-enrichment',
    supportsManualRun: true,
    manualRunType: 'reviews',
  },
  {
    key: 'metadata_refresh',
    label: 'Steam Metadata',
    description: 'Nightly Steam store metadata refresh (EA flag, release dates, etc.)',
    service: 'steam',
    taskName: 'metadata-refresh',
    supportsManualRun: false,
  },
  {
    key: 'release_check',
    label: 'Release Status',
    description: 'Detects newly-released wishlist games and fires Discord notifications',
    service: 'steam',
    taskName: null,
    supportsManualRun: false,
  },
  {
    key: 'alert_check',
    label: 'Price Alerts',
    description: 'Evaluates price thresholds and posts Discord alerts',
    service: 'discord',
    taskName: null,
    supportsManualRun: false,
  },
  {
    key: 'backup',
    label: 'Database Backup',
    description: 'Daily SQLite backup with retention',
    service: 'internal',
    taskName: 'database-backup',
    supportsManualRun: false,
  },
  {
    key: 'health_summary',
    label: 'Weekly Health Summary',
    description: 'Weekly digest of sync health to Discord',
    service: 'discord',
    taskName: 'health-summary',
    supportsManualRun: false,
  },
];

export function getSourceDef(key: string): SyncSourceDef | undefined {
  return SYNC_SOURCES.find((s) => s.key === key);
}

/** Map task name (from scheduler) → source key. */
export function sourceKeyForTask(taskName: string): string | undefined {
  return SYNC_SOURCES.find((s) => s.taskName === taskName)?.key;
}
