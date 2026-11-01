'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

interface RefreshResult {
  reviews: 'updated' | 'unavailable' | 'error';
  playtime: 'updated' | 'too_few_reviews' | 'error';
  hltb: 'matched' | 'no_match' | 'manual' | 'error';
}

const REVIEWS_LABEL: Record<RefreshResult['reviews'], string> = {
  updated: 'reviews updated',
  unavailable: 'no reviews from Steam',
  error: 'reviews failed',
};
const PLAYTIME_LABEL: Record<RefreshResult['playtime'], string> = {
  updated: 'playtime updated',
  too_few_reviews: 'too few reviews for playtime',
  error: 'playtime failed',
};
const HLTB_LABEL: Record<RefreshResult['hltb'], string> = {
  matched: 'HLTB matched',
  no_match: 'no HLTB match',
  manual: 'HLTB set by hand',
  error: 'HLTB failed',
};

function summarizeRefresh(r: RefreshResult): string {
  return [REVIEWS_LABEL[r.reviews], PLAYTIME_LABEL[r.playtime], HLTB_LABEL[r.hltb]].join(' · ');
}

/**
 * "Refresh from Steam": pulls fresh reviews, reviewer playtime and HLTB for one
 * game on demand, bypassing the background schedules.
 */
export function RefreshGameButton({ gameId }: { gameId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/games/${gameId}/refresh`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { data?: RefreshResult; error?: string };
      if (res.ok && body.data) {
        setMessage(summarizeRefresh(body.data));
        router.refresh();
      } else {
        setMessage(body.error ?? 'Refresh failed');
      }
    } catch {
      setMessage('Refresh failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-1 space-y-1">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'Refreshing…' : 'Refresh from Steam'}
      </button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
