import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression tests for #179 — the scheduler task registry must be shared across
 * module instances.
 *
 * In Next.js standalone output `instrumentation.ts` (which registers the tasks
 * on boot) and the route handlers (which read them via `getTaskStatus()`) can
 * resolve to SEPARATE module instances of `@/lib/scheduler`. We simulate that
 * split with `vi.resetModules()`, which forces the next `import()` to
 * re-evaluate the module from scratch — a fresh instance, exactly like the
 * second copy Next.js loads in the route handler.
 *
 * Before the fix, each instance owned its own module-level `new Map()`, so the
 * re-imported instance saw zero tasks (the first assertion below fails). After
 * hoisting the registry onto `globalThis[Symbol.for('hoard.scheduler.tasks')]`,
 * every instance shares one Map.
 */

const SCHEDULER_TASKS_KEY = Symbol.for('hoard.scheduler.tasks');

function clearSharedRegistry() {
  const store = globalThis as unknown as Record<
    symbol,
    Map<string, { task?: { stop?: () => void; destroy?: () => void } }> | undefined
  >;
  const existing = store[SCHEDULER_TASKS_KEY];
  if (existing) {
    for (const info of existing.values()) {
      try {
        info.task?.stop?.();
        info.task?.destroy?.();
      } catch {
        // best-effort teardown
      }
    }
    existing.clear();
  }
  delete store[SCHEDULER_TASKS_KEY];
}

describe('scheduler task registry (#179)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEMO_MODE;
    clearSharedRegistry();
  });

  afterEach(() => {
    clearSharedRegistry();
    vi.resetModules();
  });

  it('reflects tasks registered by a different module instance (survives a re-import)', async () => {
    // Instance A — stands in for instrumentation.ts registering a task on boot.
    const schedulerA = await import('./index');
    schedulerA.registerTask('price-check', '0 */12 * * *', async () => {});
    expect(schedulerA.getTaskStatus().map(t => t.name)).toContain('price-check');

    // Force a brand-new module graph: the next import is a SEPARATE instance,
    // like the copy Next.js loads inside a route handler.
    vi.resetModules();
    const schedulerB = await import('./index');

    // Pre-fix: instance B has its own empty Map -> length 0 -> this FAILS.
    const namesB = schedulerB.getTaskStatus().map(t => t.name);
    expect(namesB).toContain('price-check');
    expect(schedulerB.getTaskStatus().length).toBeGreaterThan(0);
  });

  it('reports an empty registry when no task was ever registered (genuine "scheduler down")', async () => {
    const scheduler = await import('./index');
    expect(scheduler.getTaskStatus()).toHaveLength(0);
  });
});
