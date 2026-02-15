import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-helpers';
import { BackupConfig } from '@/components/settings/BackupConfig';
import { SyncHistory } from '@/components/settings/SyncHistory';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="space-y-8">
      <BackupConfig />
      <SyncHistory />
    </div>
  );
}
