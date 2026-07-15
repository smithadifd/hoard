import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Integration regression test for #179.
 *
 * Unlike `route.test.ts` (which mocks `@/lib/scheduler` wholesale), this suite
 * exercises the REAL scheduler across a simulated Next.js standalone module
 * split: a task is registered on one module instance, then `vi.resetModules()`
 * forces the route handler to load a fresh, SEPARATE instance of
 * `@/lib/scheduler` — the same duplication that made `/api/health` report
 * `scheduler:false` -> `status:degraded` on every deploy.
 *
 * Only the DB layer is mocked (so the route doesn't need a live SQLite file);
 * the scheduler is left real so the shared-registry fix is what's under test.
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

/** Load a fresh copy of the health route with the DB layer mocked out. */
async function loadRoute() {
  vi.resetModules();
  vi.doMock('@/lib/db', () => ({
    getDb: () => ({ get: () => ({ ok: 1, count: 0 }) }),
  }));
  vi.doMock('@/lib/db/queries', () => ({
    getLastSuccessfulSyncBySource: () => ({}),
  }));
  return import('./route');
}

describe('GET /api/health — real scheduler across the module boundary (#179)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEMO_MODE;
    clearSharedRegistry();
  });

  afterEach(() => {
    clearSharedRegistry();
    vi.resetModules();
  });

  it('reports scheduler:true / healthy when a DIFFERENT module instance registered the tasks', async () => {
    // Instance A: stand-in for instrumentation.ts registering a task on boot.
    vi.resetModules();
    const scheduler = await import('@/lib/scheduler');
    scheduler.registerTask('price-check', '0 */12 * * *', async () => {});
    expect(scheduler.getTaskStatus().length).toBeGreaterThan(0);

    // Instance B: the route loads its own fresh copy of @/lib/scheduler.
    // Pre-fix that copy's task Map is empty -> scheduler:false -> this FAILS.
    const { GET } = await loadRoute();
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.scheduler).toBe(true);
    expect(body.status).toBe('healthy');
  });

  it('reports scheduler:false / degraded (still HTTP 200) when the scheduler is genuinely down', async () => {
    // No task registered anywhere — the shared registry is empty.
    const { GET } = await loadRoute();
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200); // DB reachable -> still 200 for the healthcheck
    expect(body.checks.scheduler).toBe(false);
    expect(body.status).toBe('degraded');
  });
});
