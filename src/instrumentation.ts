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
    const { runDatabaseBackup } = await import('@/lib/sync/backup');
    const { getDiscordClient } = await import('@/lib/discord/client');

    const config = getEffectiveConfig();

    registerTask('price-check', config.cronPriceCheck, async () => syncPrices());
    registerTask('library-sync', config.cronLibrarySync, async () => syncLibrary());
    registerTask('wishlist-sync', config.cronWishlistSync, async () => syncWishlist());
    registerTask('hltb-sync', config.cronHltbSync, async () => syncHltb());
    registerTask('review-enrichment', config.cronReviewSync, async () => syncReviews());

    registerTask('database-backup', config.cronBackup, async () => {
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
    });

    registerTask('health-summary', '0 9 * * 1', async () => {
      const { sendWeeklyHealthSummary } = await import('@/lib/sync/health');
      await sendWeeklyHealthSummary();
    });

    startScheduler();

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
