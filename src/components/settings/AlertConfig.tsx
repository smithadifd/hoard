'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Send, Loader2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { useApiMutation } from '@/hooks/useApiMutation';

interface AlertConfigProps {
  activeAlertCount: number;
  initialAutoAtlDealAlerts: boolean;
  initialMinSnapshots: number;
}

export function AlertConfig({
  activeAlertCount,
  initialAutoAtlDealAlerts,
  initialMinSnapshots,
}: AlertConfigProps) {
  const [autoAtlDealAlerts, setAutoAtlDealAlerts] = useState(initialAutoAtlDealAlerts);
  const [minSnapshots, setMinSnapshots] = useState(initialMinSnapshots.toString());

  const {
    mutate: saveAutoAtl,
    isPending: savingAutoAtl,
    status: autoAtlStatus,
  } = useApiMutation('/api/settings', { method: 'PUT' });

  const {
    mutate: saveMinSnapshots,
    isPending: savingMinSnapshots,
    status: minSnapshotsStatus,
    reset: resetMinSnapshotsStatus,
  } = useApiMutation('/api/settings', { method: 'PUT' });

  const {
    mutate: testWebhook,
    isPending: testing,
    status: testStatus,
    error: testError,
  } = useApiMutation('/api/alerts/test', {
    method: 'POST',
  });

  const testMessage = testStatus === 'success'
    ? 'Test notification sent!'
    : testError || '';

  const handleSaveMinSnapshots = () => {
    saveMinSnapshots({ settings: { min_snapshots_for_atl_alert: minSnapshots } });
  };

  const handleTestWebhook = () => {
    testWebhook();
  };

  return (
    <section className="rounded-xl bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Price Alert Configuration</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        {activeAlertCount > 0
          ? `You have ${activeAlertCount} active price alert${activeAlertCount !== 1 ? 's' : ''}. `
          : 'No active alerts. '}
        Alerts are checked automatically after each price sync.
      </p>

      {/* Delivery frequency, channel routing, and quiet hours now live in Notifications */}
      <div className="rounded-md border border-white/[0.06] bg-background/40 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          Notification frequency (throttle), channel routing, and quiet hours are configured in{' '}
          <Link href="/settings/notifications" className="text-primary hover:underline">
            Notification settings
          </Link>
          .
        </p>
      </div>

      {/* Minimum snapshots before ATL alert */}
      <div className="space-y-1 pt-2 border-t border-white/[0.06]">
        <label className="text-sm font-medium">
          Minimum price snapshots before an ATL alert can fire
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1"
            max="50"
            value={minSnapshots}
            onChange={(e) => {
              setMinSnapshots(e.target.value);
              resetMinSnapshotsStatus();
            }}
            className="w-24 px-3 py-2 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-sm text-muted-foreground">snapshots</span>
          <button
            onClick={handleSaveMinSnapshots}
            disabled={savingMinSnapshots}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {savingMinSnapshots && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
          {minSnapshotsStatus === 'success' && (
            <span className="flex items-center gap-1 text-xs text-deal-great">
              <CheckCircle className="h-3 w-3" /> Saved
            </span>
          )}
          {minSnapshotsStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> Failed
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Suppresses spurious &quot;new ATL&quot; alerts for freshly-tracked games whose first observed price happens to match the historical low. Default: 3.
        </p>
      </div>

      {/* Auto ATL Deal Alerts */}
      <div className="space-y-2 pt-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium">Auto ATL Deal Alerts</label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const newValue = !autoAtlDealAlerts;
              setAutoAtlDealAlerts(newValue);
              saveAutoAtl({ settings: { auto_atl_deal_alerts: String(newValue) } });
            }}
            disabled={savingAutoAtl}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoAtlDealAlerts ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoAtlDealAlerts ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm text-muted-foreground">
            {autoAtlDealAlerts ? 'Enabled' : 'Disabled'}
          </span>
          {autoAtlStatus === 'success' && (
            <span className="flex items-center gap-1 text-xs text-deal-great">
              <CheckCircle className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Automatically notify you when any wishlisted game hits a new all-time low
          with a &quot;Good&quot; deal score or better (55+). Only released games are included.
          You can opt out individual games from their detail page.
        </p>
      </div>

      {/* Test Webhook */}
      <div className="space-y-2 pt-2 border-t border-white/[0.06]">
        <label className="text-sm font-medium">Test Discord Webhook</label>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestWebhook}
            disabled={testing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send Test
          </button>
          {testMessage && (
            <span
              className={`text-xs ${
                testStatus === 'success' ? 'text-deal-great' : 'text-destructive'
              }`}
            >
              {testMessage}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
