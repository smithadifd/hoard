/**
 * Wishlist Page - Browse wishlisted games with deal indicators.
 *
 * Phase 1: Display wishlist from Steam.
 * Phase 2: Add ITAD pricing, historical lows, deal scores.
 * Phase 5: Add price alert management.
 */
export default function WishlistPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
        <p className="text-muted-foreground mt-1">
          Your wishlisted games — see deals at a glance
        </p>
      </div>

      {/* TODO Phase 2: Deal quality indicators */}
      {/* TODO Phase 2: Price vs ATL comparison */}
      {/* TODO Phase 3: $/hour value scoring */}

      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <p className="text-lg">Wishlist view coming in Phase 1</p>
        <p className="text-sm mt-1">Sync your Steam wishlist from Settings to get started</p>
      </div>
    </div>
  );
}
