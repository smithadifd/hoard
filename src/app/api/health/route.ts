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

    const healthy = checks.database && checks.scheduler;
    // Always return 200 if the database is reachable — scheduler state
    // may report false due to module isolation in server components.
    // Docker healthcheck and deploy script rely on this endpoint.
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
