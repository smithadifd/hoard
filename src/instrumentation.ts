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
    const { syncSteamPlaytime } = await import('@/lib/sync/steam-playtime');
    const { syncPriceHistoryBackfill } = await import('@/lib/sync/price-history-backfill');
    const { refreshMetadata } = await import('@/lib/sync/metadata');
    const { runDatabaseBackup } = await import('@/lib/sync/backup');
    const { getDiscordClient } = await import('@/lib/discord/client');
    const { emitNotification } = await import('@/lib/notifications/dispatch');
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
    registerTask('steam-playtime', config.cronSteamPlaytimeSync, skipWhileDraining('steam-playtime', () => syncSteamPlaytime()));
    registerTask('price-history-backfill', config.cronPriceHistoryBackfill, skipWhileDraining('price-history-backfill', () => syncPriceHistoryBackfill()));
    registerTask('metadata-refresh', config.cronMetadataRefresh, skipWhileDraining('metadata-refresh', () => refreshMetadata()));

    registerTask('database-backup', config.cronBackup, skipWhileDraining('database-backup', async () => {
      try {
        const result = await runDatabaseBackup();
        if (!result.success) {
          console.error('[Scheduler] Backup failed:', result.error);
          await emitNotification({
            category: 'system',
            inApp: {
              title: 'Database backup failed',
              body: result.error ?? 'Unknown error',
              link: '/settings/backups',
              metadata: { error: result.error ?? null },
            },
            discord: () => getDiscordClient().sendBackupNotification(result),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Scheduler] Backup failed:', error);
        await emitNotification({
          category: 'system',
          inApp: {
            title: 'Database backup failed',
            body: message,
            link: '/settings/backups',
            metadata: { error: message },
          },
          discord: () => getDiscordClient().sendBackupNotification({ success: false, error: message }),
        });
      }
    }));

    registerTask('snapshot-prune', '0 3 1 * *', skipWhileDraining('snapshot-prune', async () => {
      const { pruneOldPriceSnapshots, pruneOldPlaytimeSnapshots } = await import('@/lib/db/queries');
      const deletedPrices = pruneOldPriceSnapshots(180);
      const deletedPlaytime = pruneOldPlaytimeSnapshots(180);
      console.log(
        `[SnapshotPrune] Deleted ${deletedPrices} old price snapshot(s), ${deletedPlaytime} old playtime snapshot(s)`,
      );
    }));

    // Daily at 4:30am, ten min after backup so we don't pile two writers up.
    registerTask('notification-prune', '30 4 * * *', skipWhileDraining('notification-prune', async () => {
      const { pruneNotifications } = await import('@/lib/notifications/queries');
      try {
        const deleted = pruneNotifications();
        if (deleted > 0) {
          console.log(`[NotificationPrune] Deleted ${deleted} expired notifications`);
        }
      } catch (err) {
        console.error('[NotificationPrune] Failed:', err);
      }
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

    // Initialize the database. A fatal init failure here — e.g. the fail-loud
    // legacy-auth guard refusing to drop populated auth tables — is surfaced
    // loudly at startup with its actionable message, instead of only appearing
    // later as a 500 on the first request. (Every request path calls getDb()
    // and would fail the same way, so the process stays effectively down until
    // the operator resolves it.)
    let db: ReturnType<typeof import('@/lib/db').getDb> | undefined;
    try {
      const { getDb } = await import('@/lib/db');
      db = getDb();
    } catch (err) {
      console.error(
        '[Startup] Database initialization failed — the app cannot serve requests until this is resolved:\n',
        err instanceof Error ? err.message : String(err)
      );
    }

    // Clean up abandoned sync_log rows from previous process (non-fatal).
    if (db) {
      try {
        const { sql } = await import('drizzle-orm');
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
    }

    // One-time backfill: stored snapshot deal scores written before their game's
    // enrichment (HLTB/review) landed are stale, so deal-score sorts bury games
    // whose live badge reads higher. Recompute every game's latest snapshot score
    // once; the update paths keep them fresh from here on. Guarded by a flag so
    // it runs a single time after this version deploys.
    try {
      const { getSetting, setSetting, recomputeAllLatestDealScores } = await import('@/lib/db/queries');
      if (getSetting('deal_score_backfill_v1') !== 'done') {
        const changed = recomputeAllLatestDealScores();
        setSetting('deal_score_backfill_v1', 'done');
        console.log(`[Startup] Deal-score backfill: refreshed ${changed} stale snapshot score(s)`);
      }
    } catch (err) {
      console.error('[Startup] Deal-score backfill failed:', err);
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
