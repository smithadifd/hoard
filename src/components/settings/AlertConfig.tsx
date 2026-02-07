'use client';

import { useState } from 'react';
import { Bell, Send, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface AlertConfigProps {
  initialThrottleHours: number;
  hasWebhookUrl: boolean;
  activeAlertCount: number;
}

export function AlertConfig({
  initialThrottleHours,
  hasWebhookUrl,
  activeAlertCount,
}: AlertConfigProps) {
  const [throttleHours, setThrottleHours] = useState(initialThrottleHours.toString());
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleSaveThrottle = async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { alert_throttle_hours: throttleHours },
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaveStatus('success');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      const res = await fetch('/api/alerts/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setTestStatus('error');
        setTestMessage(data.error || 'Test failed');
      } else {
        setTestStatus('success');
        setTestMessage('Test notification sent!');
      }
    } catch {
      setTestStatus('error');
      setTestMessage('Failed to send test notification');
    } finally {
      setTesting(false);
    }
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
              setSaveStatus('idle');
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

      {/* Test Webhook */}
      <div className="space-y-2 pt-2 border-t border-border">
        <label className="text-sm font-medium">Test Discord Webhook</label>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestWebhook}
            disabled={testing || !hasWebhookUrl}
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
        {!hasWebhookUrl && (
          <p className="text-xs text-yellow-500">
            Configure your Discord Webhook URL above to enable notifications.
          </p>
        )}
      </div>
    </section>
  );
}
