import { NextResponse } from 'next/server';
import { getBackupStatus, runDatabaseBackup } from '@/lib/sync/backup';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/backup
 * Returns backup status information.
 */
export async function GET(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const status = getBackupStatus();

    return NextResponse.json({
      data: {
        lastBackup: status.lastBackup,
        backupCount: status.backupCount,
        totalSize: status.totalSize,
        oldestBackup: status.oldestBackup,
      },
    });
  } catch (error) {
    console.error('Failed to get backup status:', error);
    return NextResponse.json(
      { error: 'Failed to get backup status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/backup
 * Triggers a manual backup.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const result = await runDatabaseBackup({ tag: 'manual' });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Backup failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        success: true,
        fileSize: result.fileSize,
        backupCount: result.backupCount,
      },
    });
  } catch (error) {
    console.error('Failed to run backup:', error);
    return NextResponse.json(
      { error: 'Failed to run backup' },
      { status: 500 }
    );
  }
}
