import { redirect } from 'next/navigation';
import {
  arePricePaidSuggestionsEnabled,
  getPendingPricePaidSuggestionsIfEnabled,
} from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { PendingPriceConfirmList } from '@/components/games/PendingPriceConfirmList';

export const dynamic = 'force-dynamic';

/**
 * The bulk-confirm backlog for price-paid suggestions — the multi-game
 * counterpart to the per-game "Did you pay ~$X?" prompt on the game detail
 * page and library cards. Lists every owned game with an unconfirmed
 * suggestion (see getPendingPricePaidSuggestions) and lets the user accept
 * all, accept a selection, or adjust individually before writing.
 *
 * Gated on the price_paid_suggestions_enabled setting: when the feature is off,
 * this whole surface disappears — we redirect back to /library rather than show
 * a bare page for a feature the user turned off. (The library banner that links
 * here is gated the same way, so it won't point here either.) Existing
 * suggestion rows are left in the DB untouched; they're just not surfaced.
 */
export default async function PendingPricesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  if (!arePricePaidSuggestionsEnabled()) redirect('/library');

  const pending = getPendingPricePaidSuggestionsIfEnabled(session.user.id);

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
