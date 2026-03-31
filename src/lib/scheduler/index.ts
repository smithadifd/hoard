/**
 * Scheduler - Cron-based background tasks
 *
 * Handles scheduled operations like:
 * - Price checking for watched games
 * - Library sync from Steam
 * - HLTB data backfill
 *
 * Uses node-cron for in-process scheduling.
 * Lightweight enough for NAS deployment.
 */

import cron, { type ScheduledTask as CronTask } from 'node-cron';
import type { SyncResult } from '../sync/types';

type TaskFn = () => Promise<SyncResult | void>;

interface ScheduledTask {
  name: string;
  schedule: string;
  task: CronTask;
  lastRun?: Date;
  isRunning: boolean;
}

const TASK_TO_SOURCE: Record<string, string> = {
  'price-check':       'itad_prices',
  'library-sync':      'steam_library',
  'wishlist-sync':     'steam_wishlist',
  'hltb-sync':         'hltb',
  'review-enrichment': 'reviews',
  'database-backup':   'backup',
  'health-summary':    'health_summary',
};

function taskToSource(name: string): string {
  return TASK_TO_SOURCE[name] ?? name;
}

const tasks = new Map<string, ScheduledTask>();

/**
 * Register a scheduled task.
 * Prevents concurrent runs of the same task.
 */
export function registerTask(name: string, schedule: string, fn: TaskFn): void {
  if (process.env.DEMO_MODE === 'true') {
    console.log(`[Scheduler] Demo mode — skipping task registration: ${name}`);
    return;
  }

  if (tasks.has(name)) {
    console.warn(`Task "${name}" already registered, skipping`);
    return;
  }

  const task = cron.createTask(schedule, async () => {
    const taskInfo = tasks.get(name);
    if (!taskInfo || taskInfo.isRunning) {
      console.log(`Task "${name}" already running, skipping this execution`);
      return;
    }

    taskInfo.isRunning = true;
    console.log(`[Scheduler] Starting task: ${name}`);

    try {
      const result = await fn();
      taskInfo.lastRun = new Date();
      console.log(`[Scheduler] Completed task: ${name}`);

      // Evaluate sync health if the task returned stats
      if (result?.stats) {
        try {
          const { evaluateSyncHealth } = await import('../sync/health');
          await evaluateSyncHealth(taskToSource(name), result.stats);
        } catch {
          // Don't let health eval crash the scheduler
        }
      }
    } catch (error) {
      console.error(`[Scheduler] Task "${name}" failed:`, error);
      try {
        const { getDiscordClient } = await import('../discord/client');
        const { getRecentSyncStats } = await import('../db/queries');
        const msg = error instanceof Error ? error.message : 'Unknown error';

        // Build context from recent runs
        const recentRuns = getRecentSyncStats(taskToSource(name), 3);
        const contextLines = recentRuns
          .filter(r => r.itemsAttempted && r.itemsAttempted > 0)
          .map(r => `${r.itemsProcessed}/${r.itemsAttempted} (${r.status})`);

        await getDiscordClient().sendOperationalAlert({
          title: `Sync Failed: ${name}`,
          description: msg,
          fields: [
            { name: 'Schedule', value: taskInfo.schedule, inline: true },
            ...(contextLines.length > 0
              ? [{ name: 'Recent Runs', value: contextLines.join(', '), inline: false }]
              : []),
          ],
        });
      } catch {
        // Don't let notification failure crash the scheduler
      }
    } finally {
      taskInfo.isRunning = false;
    }
  });

  tasks.set(name, {
    name,
    schedule,
    task,
    isRunning: false,
  });
}

/**
 * Start all registered tasks.
 */
export function startScheduler(): void {
  console.log('[Scheduler] Starting all tasks...');
  for (const [name, taskInfo] of tasks) {
    taskInfo.task.start();
    console.log(`[Scheduler] Started: ${name} (${taskInfo.schedule})`);
  }
}

/**
 * Stop all registered tasks.
 */
export function stopScheduler(): void {
  console.log('[Scheduler] Stopping all tasks...');
  for (const [name, taskInfo] of tasks) {
    taskInfo.task.stop();
    console.log(`[Scheduler] Stopped: ${name}`);
  }
}

/**
 * Get status of all tasks.
 */
export function getTaskStatus(): Array<{
  name: string;
  schedule: string;
  isRunning: boolean;
  lastRun?: Date;
}> {
  return Array.from(tasks.values()).map(({ name, schedule, isRunning, lastRun }) => ({
    name,
    schedule,
    isRunning,
    lastRun,
  }));
}

/**
 * Run a specific task immediately (outside its schedule).
 */
export async function runTaskNow(name: string): Promise<boolean> {
  const taskInfo = tasks.get(name);
  if (!taskInfo) {
    console.error(`Task "${name}" not found`);
    return false;
  }

  if (taskInfo.isRunning) {
    console.warn(`Task "${name}" is already running`);
    return false;
  }

  // Trigger the task manually
  await taskInfo.task.execute();
  return true;
}
