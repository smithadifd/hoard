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

import cron from 'node-cron';
import { getConfig } from '../config';

type TaskFn = () => Promise<void>;

interface ScheduledTask {
  name: string;
  schedule: string;
  task: cron.ScheduledTask;
  lastRun?: Date;
  isRunning: boolean;
}

const tasks = new Map<string, ScheduledTask>();

/**
 * Register a scheduled task.
 * Prevents concurrent runs of the same task.
 */
export function registerTask(name: string, schedule: string, fn: TaskFn): void {
  if (tasks.has(name)) {
    console.warn(`Task "${name}" already registered, skipping`);
    return;
  }

  const task = cron.schedule(schedule, async () => {
    const taskInfo = tasks.get(name);
    if (!taskInfo || taskInfo.isRunning) {
      console.log(`Task "${name}" already running, skipping this execution`);
      return;
    }

    taskInfo.isRunning = true;
    console.log(`[Scheduler] Starting task: ${name}`);

    try {
      await fn();
      taskInfo.lastRun = new Date();
      console.log(`[Scheduler] Completed task: ${name}`);
    } catch (error) {
      console.error(`[Scheduler] Task "${name}" failed:`, error);
    } finally {
      taskInfo.isRunning = false;
    }
  }, {
    scheduled: false, // Don't start until explicitly started
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
  taskInfo.task.now();
  return true;
}
