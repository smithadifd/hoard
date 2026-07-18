import Link from 'next/link';
import { ArrowLeft, Scale } from 'lucide-react';
import { getDealOutcomeInputs } from '@/lib/db/queries';
import { computeDealOutcomesReport, type DealOutcomesReport } from '@/lib/scoring/dealOutcomes';
import { getSession } from '@/lib/auth-helpers';
import { DealOutcomesSummary } from '@/components/library/DealOutcomesSummary';
import { DealOutcomesBreakdown } from '@/components/library/DealOutcomesBreakdown';
import { DealOutcomesTable } from '@/components/library/DealOutcomesTable';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Deal Outcomes — closes the loop between the deal you bought and what you
 * actually got from it: expected $/hr (from the purchase-time price + hours
 * estimate) vs realized $/hr (from actual playtime), broken down by store,
 * genre, discount depth, and deal-score band. The library's forward-looking
 * "is this a good deal?" answered honestly, in reverse.
 */
export default async function DealOutcomesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let report: DealOutcomesReport = {
    games: [],
    overall: { key: 'overall', hits: 0, misses: 0, unknown: 0, pending: 0, graded: 0, hitRate: null },
    byStore: [],
    byGenre: [],
    byDiscountBand: [],
    byDealScoreBand: [],
  };
  try {
    const inputs = getDealOutcomeInputs(session.user.id);
    report = computeDealOutcomesReport(inputs);
  } catch {
    // DB not ready yet — render the empty-state report below.
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Library
        </Link>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Deal Outcomes</h1>
        <p className="text-muted-foreground mt-1">
          Did the deal pay off? Expected value at purchase vs what you actually got, across{' '}
          {report.games.length} priced game{report.games.length === 1 ? '' : 's'}.
        </p>
      </div>

      {report.games.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center">
          <Scale className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-medium mb-1">No priced games yet</h3>
          <p className="text-xs text-muted-foreground">
            Record what you paid for an owned game (from its detail page) to start grading deals.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-primary">
                <Scale className="h-4 w-4" />
              </span>
              <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
                Overall
              </h2>
            </div>
            <DealOutcomesSummary overall={report.overall} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-card p-5">
              <DealOutcomesBreakdown title="By Store" entries={report.byStore} />
            </div>
            <div className="rounded-xl bg-card p-5">
              <DealOutcomesBreakdown title="By Genre" entries={report.byGenre} />
            </div>
            <div className="rounded-xl bg-card p-5">
              <DealOutcomesBreakdown title="By Discount Depth" entries={report.byDiscountBand} />
            </div>
            <div className="rounded-xl bg-card p-5">
              <DealOutcomesBreakdown title="By Deal-Score Band" entries={report.byDealScoreBand} />
            </div>
          </div>

          <div className="rounded-xl bg-card p-5">
            <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Every Deal
            </h2>
            <DealOutcomesTable games={report.games} />
          </div>
        </>
      )}
    </div>
  );
}
