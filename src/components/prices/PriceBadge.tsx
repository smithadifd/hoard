/**
 * PriceBadge - Shows current price with optional discount and ATL indicator.
 */
interface PriceBadgeProps {
  currentPrice: number;
  regularPrice?: number;
  discountPercent?: number;
  historicalLow?: number;
  currency?: string;
}

export function PriceBadge({
  currentPrice,
  regularPrice,
  discountPercent,
  historicalLow,
  currency = '$',
}: PriceBadgeProps) {
  const isAtATL = historicalLow !== undefined && currentPrice <= historicalLow;
  const hasDiscount = discountPercent !== undefined && discountPercent > 0;

  return (
    <div className="flex items-center gap-2">
      {hasDiscount && (
        <span className="bg-primary text-primary-foreground text-xs font-label font-bold px-1.5 py-0.5 rounded">
          -{discountPercent}%
        </span>
      )}

      <div className="flex flex-col items-end">
        {hasDiscount && regularPrice !== undefined && (
          <span className="text-xs text-muted-foreground line-through font-label">
            {currency}{regularPrice.toFixed(2)}
          </span>
        )}
        <span className={`text-sm font-label font-bold ${isAtATL ? 'text-teal' : ''}`}>
          {currency}{currentPrice.toFixed(2)}
        </span>
      </div>

      {isAtATL && (
        <span className="text-[10px] font-label font-bold text-teal uppercase tracking-wider">
          ATL
        </span>
      )}
    </div>
  );
}
