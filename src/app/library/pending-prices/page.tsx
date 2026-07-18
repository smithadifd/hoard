import { redirect } from 'next/navigation';
import { getPendingPricePaidSuggestions } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { PendingPriceConfirmList } from '@/components/games/PendingPriceConfirmList';

export const dynamic = 'force-dynamic';

/**
 * The bulk-confirm backlog for price-paid suggestions — the multi-game
 * counterpart to the per-game "Did you pay ~$X?" prompt on the game detail
 * page and library cards. Lists every owned game with an unconfirmed
 * suggestion (see getPendingPricePaidSuggestions) and lets the user accept
 * all, accept a selection, or adjust individually before writing.
 */
export default async function PendingPricesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const pending = getPendingPricePaidSuggestions(session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Confirm Prices Paid</h1>
        <p className="text-muted-foreground mt-1">
          {pending.length > 0
            ? `${pending.length} owned game${pending.length === 1 ? '' : 's'} with an estimated price awaiting your confirmation.`
            : 'No pending price estimates right now.'}
        </p>
      </div>

      <PendingPriceConfirmList initialPending={pending} />
    </div>
  );
}
