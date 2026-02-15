'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell, BellOff, Trash2, Loader2 } from 'lucide-react';

interface AlertRow {
  id: number;
  gameId: number;
  title: string;
  headerImageUrl: string | null;
  steamAppId: number;
  targetPrice: number | null;
  notifyOnAllTimeLow: boolean;
  notifyOnThreshold: boolean;
  isActive: boolean;
  lastNotifiedAt: string | null;
  currentPrice: number | null;
  regularPrice: number | null;
  discountPercent: number | null;
  historicalLowPrice: number | null;
}

interface WatchlistTableProps {
  alerts: AlertRow[];
}

export function WatchlistTable({ alerts: initialAlerts }: WatchlistTableProps) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const toggleActive = async (alertId: number, currentActive: boolean) => {
    setLoadingId(alertId);
    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, isActive: !currentActive } : a))
        );
      }
    } catch (err) {
      console.error('Failed to toggle alert:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const deleteAlert = async (alertId: number) => {
    setLoadingId(alertId);
    try {
      const res = await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' });
      if (res.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      }
    } catch (err) {
      console.error('Failed to delete alert:', err);
    } finally {
      setLoadingId(null);
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-sm font-medium mb-1">No price alerts</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Add games to your watchlist from the wishlist page to get price alerts.
        </p>
        <Link
          href="/wishlist"
          className="inline-flex items-center px-3 py-1.5 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors"
        >
          Browse Wishlist
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Mobile card layout */}
      <div className="lg:hidden space-y-3">
        {alerts.map((alert) => {
          const isLoading = loadingId === alert.id;
          const atTarget = alert.currentPrice !== null && alert.targetPrice !== null
            && alert.currentPrice <= alert.targetPrice;

          return (
            <div key={alert.id} className={`rounded-lg border border-border bg-card p-4 ${!alert.isActive ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3">
                {/* Game image + info */}
                <Link href={`/games/${alert.gameId}`} className="flex-1 min-w-0 flex items-center gap-3">
                  {alert.headerImageUrl && (
                    <Image
                      src={alert.headerImageUrl}
                      alt={alert.title}
                      width={64}
                      height={30}
                      className="rounded object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm truncate">{alert.title}</h3>
                    {alert.isActive ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-steam-green/10 text-steam-green mt-1">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-muted-foreground mt-1">
                        Paused
                      </span>
                    )}
                  </div>
                </Link>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <button
                        onClick={() => toggleActive(alert.id, alert.isActive)}
                        title={alert.isActive ? 'Pause alert' : 'Resume alert'}
                        className="p-2.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                      >
                        {alert.isActive ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => deleteAlert(alert.id)}
                        title="Delete alert"
                        className="p-2.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive min-w-[44px] min-h-[44px] flex items-center justify-center"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Price row */}
              <div className="flex items-center gap-4 mt-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Current</span>
                  {alert.currentPrice !== null ? (
                    <div>
                      <span className={`font-medium ${atTarget ? 'text-deal-great' : ''}`}>
                        ${alert.currentPrice.toFixed(2)}
                      </span>
                      {alert.discountPercent !== null && alert.discountPercent > 0 && (
                        <span className="ml-1 text-xs text-deal-great">-{alert.discountPercent}%</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">--</div>
                  )}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Target</span>
                  <div className="text-muted-foreground">
                    {alert.targetPrice !== null ? `$${alert.targetPrice.toFixed(2)}` : 'ATL only'}
                  </div>
                </div>
                {alert.lastNotifiedAt && (
                  <div className="ml-auto text-xs text-muted-foreground">
                    Alerted {new Date(alert.lastNotifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table layout */}
      <div className="hidden lg:block rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-card border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Game</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Current</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Target</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">Last Alert</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {alerts.map((alert) => {
              const isLoading = loadingId === alert.id;
              const atTarget = alert.currentPrice !== null && alert.targetPrice !== null
                && alert.currentPrice <= alert.targetPrice;

              return (
                <tr key={alert.id} className={`bg-card/50 ${!alert.isActive ? 'opacity-50' : ''}`}>
                  {/* Game */}
                  <td className="px-4 py-3">
                    <Link href={`/games/${alert.gameId}`} className="flex items-center gap-3 hover:text-steam-blue transition-colors">
                      {alert.headerImageUrl && (
                        <Image
                          src={alert.headerImageUrl}
                          alt={alert.title}
                          width={48}
                          height={22}
                          className="rounded object-cover"
                        />
                      )}
                      <span className="font-medium truncate max-w-[200px]">{alert.title}</span>
                    </Link>
                  </td>

                  {/* Current Price */}
                  <td className="px-4 py-3 text-right">
                    {alert.currentPrice !== null ? (
                      <div>
                        <span className={`font-medium ${atTarget ? 'text-deal-great' : ''}`}>
                          ${alert.currentPrice.toFixed(2)}
                        </span>
                        {alert.discountPercent !== null && alert.discountPercent > 0 && (
                          <span className="ml-1 text-xs text-deal-great">
                            -{alert.discountPercent}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>

                  {/* Target Price */}
                  <td className="px-4 py-3 text-right">
                    {alert.targetPrice !== null ? (
                      <span className="text-muted-foreground">${alert.targetPrice.toFixed(2)}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">ATL only</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    {alert.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-steam-green/10 text-steam-green">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground">
                        Paused
                      </span>
                    )}
                  </td>

                  {/* Last Notified */}
                  <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                    {alert.lastNotifiedAt ? (
                      new Date(alert.lastNotifiedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    ) : (
                      'Never'
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <button
                            onClick={() => toggleActive(alert.id, alert.isActive)}
                            title={alert.isActive ? 'Pause alert' : 'Resume alert'}
                            className="p-2.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                          >
                            {alert.isActive ? (
                              <BellOff className="h-4 w-4" />
                            ) : (
                              <Bell className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => deleteAlert(alert.id)}
                            title="Delete alert"
                            className="p-2.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
