import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-helpers';
import { SystemDashboard } from '@/components/settings/SystemDashboard';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="space-y-8">
      <SystemDashboard />
    </div>
  );
}
