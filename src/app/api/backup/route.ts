import { getBackupStatus, runDatabaseBackup } from '@/lib/sync/backup';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/utils/api';

/**
 * GET /api/backup
 * Returns backup status information.
 */
export async function GET(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const status = getBackupStatus();

    return apiSuccess({
      lastBackup: status.lastBackup,
      backupCount: status.backupCount,
      totalSize: status.totalSize,
      oldestBackup: status.oldestBackup,
    });
  } catch (error) {
    console.error('[GET /api/backup]', error);
    return apiError('Failed to get backup status');
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
    return apiUnauthorized();
  }

  try {
    const result = await runDatabaseBackup({ tag: 'manual' });

    if (!result.success) {
      return apiError(result.error || 'Backup failed');
    }

    return apiSuccess({
      success: true,
      fileSize: result.fileSize,
      backupCount: result.backupCount,
    });
  } catch (error) {
    console.error('[POST /api/backup]', error);
    return apiError('Failed to run backup');
  }
}
