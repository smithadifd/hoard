'use client';

import { useState } from 'react';
import { Bell, Send, Loader2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { useApiMutation } from '@/hooks/useApiMutation';

interface AlertConfigProps {
  initialThrottleHours: number;
  activeAlertCount: number;
  initialAutoAtlDealAlerts: boolean;
}

export function AlertConfig({
  initialThrottleHours,
  activeAlertCount,
  initialAutoAtlDealAlerts,
}: AlertConfigProps) {
  const [throttleHours, setThrottleHours] = useState(initialThrottleHours.toString());
  const [autoAtlDealAlerts, setAutoAtlDealAlerts] = useState(initialAutoAtlDealAlerts);

  const {
    mutate: saveThrottle,
    isPending: saving,
    status: saveStatus,
    reset: resetSaveStatus,
  } = useApiMutation('/api/settings', { method: 'PUT' });

  const {
    mutate: saveAutoAtl,
    isPending: savingAutoAtl,
    status: autoAtlStatus,
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

  const handleSaveThrottle = () => {
    saveThrottle({ settings: { alert_throttle_hours: throttleHours } });
  };

  const handleTestWebhook = () => {
    testWebhook();
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-4">
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

      {/* Notification Throttle */}
      <div className="space-y-1">
        <label className="text-sm font-medium">
          Minimum hours between notifications (per game)
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1"
            max="168"
            value={throttleHours}
            onChange={(e) => {
              setThrottleHours(e.target.value);
              resetSaveStatus();
            }}
            className="w-24 px-3 py-2 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-sm text-muted-foreground">hours</span>
          <button
            onClick={handleSaveThrottle}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
          {saveStatus === 'success' && (
            <span className="flex items-center gap-1 text-xs text-deal-great">
              <CheckCircle className="h-3 w-3" /> Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> Failed
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Prevents repeated notifications for the same game. Default: 24 hours.
        </p>
      </div>

      {/* Auto ATL Deal Alerts */}
      <div className="space-y-2 pt-2 border-t border-border">
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
              autoAtlDealAlerts ? 'bg-steam-blue' : 'bg-muted'
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
          Automatically notify via Discord when any wishlisted game hits a new all-time low
          with a &quot;Good&quot; deal score or better (55+). Only released games are included.
          You can opt out individual games from their detail page.
        </p>
      </div>

      {/* Test Webhook */}
      <div className="space-y-2 pt-2 border-t border-border">
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
