import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-helpers';
import { BackupConfig } from '@/components/settings/BackupConfig';

export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <BackupConfig />;
}
