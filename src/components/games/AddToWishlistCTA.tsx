'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';

interface AddToWishlistCTAProps {
  gameId: number;
}

/**
 * Button that adds a lookup-mode game to the user's wishlist.
 * On success, refreshes the page — the game re-renders in full library mode.
 */
export function AddToWishlistCTA({ gameId }: AddToWishlistCTAProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddToWishlist() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isWishlisted: true }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? 'Failed to add to wishlist');
        return;
      }

      // Refresh page — it will now render in full library mode
      router.refresh();
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleAddToWishlist}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Heart className={`h-4 w-4 ${loading ? 'animate-pulse' : ''}`} />
        {loading ? 'Adding...' : 'Add to Wishlist'}
      </button>
      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}
    </div>
  );
}
