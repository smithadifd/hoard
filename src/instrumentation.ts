/**
 * Next.js Instrumentation Hook
 *
 * Runs once on server startup. Registers and starts
 * scheduled background tasks (price checks, library sync).
 */

export async function register() {
  // Only run on the server (not during build or on edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerTask, startScheduler, getTaskStatus } = await import('@/lib/scheduler');
    const { getEffectiveConfig } = await import('@/lib/config');
    const { syncPrices } = await import('@/lib/sync/prices');
    const { syncLibrary } = await import('@/lib/sync/library');
    const { syncWishlist } = await import('@/lib/sync/wishlist');
    const { syncHltb } = await import('@/lib/sync/hltb');
    const { syncReviews } = await import('@/lib/sync/reviews');
    const { syncPriceHistoryBackfill } = await import('@/lib/sync/price-history-backfill');
    const { refreshMetadata } = await import('@/lib/sync/metadata');
    const { runDatabaseBackup } = await import('@/lib/sync/backup');
    const { getDiscordClient } = await import('@/lib/discord/client');
    const { isDraining } = await import('@/lib/sync/drain');

    // Wraps a cron callback so it short-circuits while the onboarding drain
    // is running — keeps the drain from racing with scheduled enrichment
    // for the same upstream APIs.
    const skipWhileDraining = (name: string, task: () => Promise<unknown>) => async () => {
      if (isDraining()) {
        console.log(`[Scheduler] ${name} skipped — onboarding drain in progress`);
        return;
      }
      await task();
    };

    const config = getEffectiveConfig();

    registerTask('price-check', config.cronPriceCheck, skipWhileDraining('price-check', () => syncPrices()));
    registerTask('library-sync', config.cronLibrarySync, skipWhileDraining('library-sync', () => syncLibrary()));
    registerTask('wishlist-sync', config.cronWishlistSync, skipWhileDraining('wishlist-sync', () => syncWishlist()));
    registerTask('hltb-sync', config.cronHltbSync, skipWhileDraining('hltb-sync', () => syncHltb()));
    registerTask('review-enrichment', config.cronReviewSync, skipWhileDraining('review-enrichment', () => syncReviews()));
    registerTask('price-history-backfill', config.cronPriceHistoryBackfill, skipWhileDraining('price-history-backfill', () => syncPriceHistoryBackfill()));
    registerTask('metadata-refresh', config.cronMetadataRefresh, skipWhileDraining('metadata-refresh', () => refreshMetadata()));

    registerTask('database-backup', config.cronBackup, skipWhileDraining('database-backup', async () => {
      try {
        const result = await runDatabaseBackup();
        if (!result.success) {
          console.error('[Scheduler] Backup failed:', result.error);
          await getDiscordClient().sendBackupNotification(result);
        }
      } catch (error) {
        console.error('[Scheduler] Backup failed:', error);
        await getDiscordClient().sendBackupNotification({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    registerTask('snapshot-prune', '0 3 1 * *', skipWhileDraining('snapshot-prune', async () => {
      const { pruneOldPriceSnapshots } = await import('@/lib/db/queries');
      const deleted = pruneOldPriceSnapshots(180);
      console.log(`[SnapshotPrune] Deleted ${deleted} old snapshots`);
    }));

    registerTask('health-summary', '0 9 * * 1', skipWhileDraining('health-summary', async () => {
      const { sendWeeklyHealthSummary } = await import('@/lib/sync/health');
      try {
        await sendWeeklyHealthSummary();
      } catch (err) {
        console.error('[Scheduler] Weekly health summary failed:', err);
      }
    }));

    startScheduler();

    // Clean up abandoned sync_log rows from previous process
    try {
      const { getDb } = await import('@/lib/db');
      const { sql } = await import('drizzle-orm');
      const db = getDb();
      const cleaned = db.run(sql`
        UPDATE sync_log
        SET status = 'error', error_message = 'Process restarted — sync did not complete', completed_at = datetime('now')
        WHERE status = 'running' AND started_at < datetime('now', '-5 minutes')
      `);
      if (cleaned.changes > 0) {
        console.log(`[Startup] Cleaned ${cleaned.changes} abandoned sync_log row(s)`);
      }
    } catch {
      // Non-fatal
    }

    // Send startup notification to Discord
    try {
      const taskStatus = getTaskStatus();
      await getDiscordClient().sendOperationalAlert({
        title: 'Hoard Started',
        description: `Scheduler active with ${taskStatus.length} task${taskStatus.length !== 1 ? 's' : ''}`,
        color: 0x22c55e, // Green
        fields: taskStatus.map(t => ({
          name: t.name,
          value: t.schedule,
          inline: true,
        })),
      });
    } catch {
      console.warn('[Startup] Failed to send Discord notification');
    }
  }
}
