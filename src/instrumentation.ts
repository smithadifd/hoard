/**
 * Next.js Instrumentation Hook
 *
 * Runs once on server startup. Registers and starts
 * scheduled background tasks (price checks, library sync).
 */

export async function register() {
  // Only run on the server (not during build or on edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerTask, startScheduler } = await import('@/lib/scheduler');
    const { getEffectiveConfig } = await import('@/lib/config');
    const { syncPrices } = await import('@/lib/sync/prices');
    const { syncLibrary } = await import('@/lib/sync/library');
    const { syncHltb } = await import('@/lib/sync/hltb');

    const config = getEffectiveConfig();

    registerTask('price-check', config.cronPriceCheck, async () => {
      try {
        await syncPrices();
      } catch (error) {
        console.error('[Scheduler] Price check failed:', error);
      }
    });

    registerTask('library-sync', config.cronLibrarySync, async () => {
      try {
        await syncLibrary();
      } catch (error) {
        console.error('[Scheduler] Library sync failed:', error);
      }
    });

    registerTask('hltb-sync', config.cronHltbSync, async () => {
      try {
        await syncHltb();
      } catch (error) {
        console.error('[Scheduler] HLTB sync failed:', error);
      }
    });

    startScheduler();
  }
}
