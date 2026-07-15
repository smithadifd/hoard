import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getTaskStatus } from '@/lib/scheduler';
import { getLastSuccessfulSyncBySource } from '@/lib/db/queries';

/**
 * GET /api/health
 * Public health check endpoint — no auth required.
 * Used by Docker healthcheck, deploy script, and stale data banner.
 */
export async function GET() {
  const checks = {
    database: false,
    scheduler: false,
    stuckSyncs: 0,
    lastSyncs: {} as Record<string, string>,
  };

  try {
    // Test DB connectivity
    const db = getDb();
    const result = db.get<{ ok: number }>(sql`SELECT 1 as ok`);
    checks.database = result?.ok === 1;

    // Check scheduler status
    const taskStatus = getTaskStatus();
    checks.scheduler = taskStatus.length > 0;

    // Get last successful sync per source
    checks.lastSyncs = getLastSuccessfulSyncBySource();

    // Check for stuck sync_log rows (running for >2 hours)
    const stuckResult = db.get<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM sync_log WHERE status = 'running' AND started_at < datetime('now', '-2 hours')`
    );
    checks.stuckSyncs = stuckResult?.count ?? 0;

    const healthy = checks.database && checks.scheduler && checks.stuckSyncs === 0;
    // Always return 200 while the database is reachable: the Docker healthcheck
    // and deploy script gate on this endpoint, and a scheduler or stuck-sync
    // issue shouldn't pull the container out of rotation. The scheduler registry
    // is now shared across module instances via a global symbol (see
    // src/lib/scheduler), so `checks.scheduler` reflects the real scheduler
    // state rather than a Next.js module-isolation artifact (#179).
    return NextResponse.json(
      { status: healthy ? 'healthy' : 'degraded', checks },
      { status: checks.database ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', checks },
      { status: 503 }
    );
  }
}
