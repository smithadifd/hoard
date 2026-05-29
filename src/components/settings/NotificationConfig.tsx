'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Save, Loader2, CheckCircle, AlertCircle, RotateCcw, Bell, MessageSquare } from 'lucide-react';
import { useApiMutation } from '@/hooks/useApiMutation';
import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  type NotificationPreferences,
  type NotificationCategory,
} from '@/lib/notifications/preferences';

interface NotificationConfigProps {
  initialPreferences: NotificationPreferences;
  discordConfigured: boolean;
  serverTimeZone: string;
}

const CATEGORY_META: Record<NotificationCategory, { label: string; description: string }> = {
  'deal-individual': {
    label: 'Deal alerts',
    description: 'Free games, target-price hits, and brand-new all-time lows.',
  },
  'deal-digest': {
    label: 'Deal digest',
    description: 'Batched roundup of games still sitting at their all-time low.',
  },
  release: {
    label: 'Releases',
    description: 'Wishlisted games launching or graduating from Early Access.',
  },
  milestone: {
    label: 'Milestones',
    description: 'Onboarding and setup milestones.',
  },
  system: {
    label: 'System',
    description: 'Sync-health warnings, backup failures, and other ops alerts.',
  },
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
}

export function NotificationConfig({ initialPreferences, discordConfigured, serverTimeZone }: NotificationConfigProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(initialPreferences);
  const {
    mutate: save,
    isPending: saving,
    status: saveStatus,
    reset: resetSaveStatus,
  } = useApiMutation('/api/settings', { method: 'PUT' });

  const update = (next: NotificationPreferences) => {
    setPrefs(next);
    resetSaveStatus();
  };

  const toggleChannel = (cat: NotificationCategory, channel: 'inApp' | 'discord') => {
    update({
      ...prefs,
      categories: {
        ...prefs.categories,
        [cat]: { ...prefs.categories[cat], [channel]: !prefs.categories[cat][channel] },
      },
    });
  };

  const handleThrottleChange = (value: string) => {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num < 1 || num > 168) return;
    update({ ...prefs, frequency: { ...prefs.frequency, throttleHours: num } });
  };

  const handleReset = () => update(structuredClone(DEFAULT_PREFERENCES));

  const handleSave = () => {
    save({ settings: { notification_preferences: JSON.stringify(prefs) } });
  };

  return (
    <section className="rounded-xl bg-card p-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how each kind of notification reaches you. The in-app bell is always available;
          Discord is optional and configured in{' '}
          <Link href="/settings" className="text-primary hover:underline">
            General settings
          </Link>
          .
        </p>
      </div>

      {/* Routing matrix */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Where notifications go</h3>
          <div className="flex items-center gap-6 pr-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Bell className="h-3.5 w-3.5" /> In-app
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" /> Discord
            </span>
          </div>
        </div>

        {!discordConfigured && (
          <p className="text-xs text-amber-500">
            Discord isn&apos;t configured — Discord toggles are saved but won&apos;t deliver until you add a webhook in{' '}
            <Link href="/settings" className="underline">
              General settings
            </Link>
            .
          </p>
        )}

        <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]">
          {NOTIFICATION_CATEGORIES.map((cat) => (
            <div key={cat} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{CATEGORY_META[cat].label}</p>
                <p className="text-xs text-muted-foreground">{CATEGORY_META[cat].description}</p>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <Toggle
                  checked={prefs.categories[cat].inApp}
                  onChange={() => toggleChannel(cat, 'inApp')}
                  ariaLabel={`${CATEGORY_META[cat].label} in-app`}
                />
                <Toggle
                  checked={prefs.categories[cat].discord}
                  onChange={() => toggleChannel(cat, 'discord')}
                  ariaLabel={`${CATEGORY_META[cat].label} Discord`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Frequency */}
      <div className="space-y-2 border-t border-white/[0.06] pt-6">
        <h3 className="text-sm font-medium">Frequency</h3>
        <label className="text-sm text-muted-foreground" htmlFor="throttle-hours">
          Minimum hours between notifications for the same game
        </label>
        <div className="flex items-center gap-3">
          <input
            id="throttle-hours"
            type="number"
            min={1}
            max={168}
            value={prefs.frequency.throttleHours}
            onChange={(e) => handleThrottleChange(e.target.value)}
            className="w-24 px-3 py-2 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Prevents repeated alerts for the same game. A genuinely new all-time low always breaks
          through. Default: 24 hours.
        </p>
      </div>

      {/* Quiet hours */}
      <div className="space-y-3 border-t border-white/[0.06] pt-6">
        <div className="flex items-center gap-3">
          <Toggle
            checked={prefs.quietHours.enabled}
            onChange={() =>
              update({ ...prefs, quietHours: { ...prefs.quietHours, enabled: !prefs.quietHours.enabled } })
            }
            ariaLabel="Enable quiet hours"
          />
          <h3 className="text-sm font-medium">Quiet hours</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Pauses Discord deal pings during this window ({serverTimeZone} time). The in-app bell still
          records silently, so nothing is lost — milestones and system alerts are never paused.
        </p>
        <div className="flex items-center gap-2">
          <HourSelect
            label="From"
            value={prefs.quietHours.start}
            disabled={!prefs.quietHours.enabled}
            onChange={(h) => update({ ...prefs, quietHours: { ...prefs.quietHours, start: h } })}
          />
          <HourSelect
            label="to"
            value={prefs.quietHours.end}
            disabled={!prefs.quietHours.enabled}
            onChange={(h) => update({ ...prefs, quietHours: { ...prefs.quietHours, end: h } })}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-white/[0.06] pt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Preferences
        </button>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          Reset Defaults
        </button>
        {saveStatus === 'success' && (
          <span className="flex items-center gap-1 text-sm text-deal-great">
            <CheckCircle className="h-4 w-4" /> Saved
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> Failed to save
          </span>
        )}
      </div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function HourSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (hour: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="px-3 py-2 rounded-md bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {formatHour(h)}
          </option>
        ))}
      </select>
    </label>
  );
}
