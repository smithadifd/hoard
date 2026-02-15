'use client';

import { useState, useCallback, useRef } from 'react';
import { Save, Loader2, CheckCircle, AlertCircle, Library, Heart, DollarSign, Clock, Star, X } from 'lucide-react';
import { readSSEStream } from '@/lib/utils/sse';

interface SettingsFormProps {
  initialSettings: Record<string, string>;
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState({
    steam_api_key: initialSettings['steam_api_key'] || '',
    steam_user_id: initialSettings['steam_user_id'] || '',
    itad_api_key: initialSettings['itad_api_key'] || '',
    discord_webhook_url: initialSettings['discord_webhook_url'] || '',
    discord_ops_webhook_url: initialSettings['discord_ops_webhook_url'] || '',
  });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [syncStatus, setSyncStatus] = useState<Record<string, 'idle' | 'syncing' | 'success' | 'error'>>({
    library: 'idle',
    wishlist: 'idle',
    prices: 'idle',
    hltb: 'idle',
    reviews: 'idle',
  });
  const [syncMessage, setSyncMessage] = useState<Record<string, string>>({});
  const [syncDetail, setSyncDetail] = useState<Record<string, string>>({});
  const abortControllers = useRef<Record<string, AbortController>>({});

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaveStatus('success');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = useCallback((type: string) => {
    const controller = abortControllers.current[type];
    if (controller) {
      controller.abort();
      delete abortControllers.current[type];
    }
  }, []);

  const handleStreamSync = useCallback(async (type: string, url: string, fetchOptions?: RequestInit) => {
    setSyncStatus((prev) => ({ ...prev, [type]: 'syncing' }));
    setSyncMessage((prev) => ({ ...prev, [type]: 'Starting...' }));
    setSyncDetail((prev) => ({ ...prev, [type]: '' }));

    const controller = new AbortController();
    abortControllers.current[type] = controller;

    try {
      const res = await fetch(url, {
        method: 'POST',
        ...fetchOptions,
        signal: controller.signal,
      });

      // If the response is not a stream (e.g. JSON error), handle it
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        setSyncStatus((prev) => ({ ...prev, [type]: 'success' }));
        setSyncMessage((prev) => ({
          ...prev,
          [type]: `Synced ${data.data?.gamesProcessed ?? 0} games`,
        }));
        setSyncDetail((prev) => ({ ...prev, [type]: '' }));
        return;
      }

      await readSSEStream(res, {
        onProgress: ({ processed, total, gameName, status }) => {
          setSyncMessage((prev) => ({
            ...prev,
            [type]: `${processed}/${total} games`,
          }));
          if (gameName) {
            const statusIcon = status === 'matched' ? '\u2713' : status === 'skipped' ? '\u2013' : '';
            setSyncDetail((prev) => ({
              ...prev,
              [type]: statusIcon ? `${statusIcon} ${gameName}` : gameName,
            }));
          }
        },
        onDone: (gamesProcessed, cancelled, message) => {
          setSyncStatus((prev) => ({ ...prev, [type]: 'success' }));
          setSyncMessage((prev) => ({
            ...prev,
            [type]: message
              ? message
              : cancelled
                ? `Cancelled \u2014 ${gamesProcessed} games synced`
                : `Synced ${gamesProcessed} games`,
          }));
          setSyncDetail((prev) => ({ ...prev, [type]: '' }));
        },
        onError: (message) => {
          setSyncStatus((prev) => ({ ...prev, [type]: 'error' }));
          setSyncMessage((prev) => ({ ...prev, [type]: message }));
          setSyncDetail((prev) => ({ ...prev, [type]: '' }));
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSyncStatus((prev) => ({ ...prev, [type]: 'success' }));
        setSyncMessage((prev) => ({ ...prev, [type]: 'Cancelled' }));
        setSyncDetail((prev) => ({ ...prev, [type]: '' }));
        return;
      }
      setSyncStatus((prev) => ({ ...prev, [type]: 'error' }));
      setSyncMessage((prev) => ({
        ...prev,
        [type]: err instanceof Error ? err.message : 'Sync failed',
      }));
      setSyncDetail((prev) => ({ ...prev, [type]: '' }));
    } finally {
      delete abortControllers.current[type];
    }
  }, []);

  const hasSteamKeys = settings.steam_api_key && settings.steam_user_id;
  const hasItadKey = !!settings.itad_api_key;

  return (
    <div className="space-y-8">
      {/* API Keys Section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">API Configuration</h2>
        <p className="text-sm text-muted-foreground">
          API keys are stored locally in your database and never shared.
        </p>

        <div className="space-y-3">
          <FormField
            label="Steam API Key"
            placeholder="Your Steam Web API key"
            helpText="Get one at steamcommunity.com/dev/apikey"
            value={settings.steam_api_key}
            onChange={(v) => updateSetting('steam_api_key', v)}
            type="password"
          />
          <FormField
            label="Steam User ID (Steam64 format)"
            placeholder="17-digit ID (e.g., 76561198012345678)"
            helpText="Must be your 17-digit Steam64 ID — not your vanity name. Find it at steamid.io"
            value={settings.steam_user_id}
            onChange={(v) => updateSetting('steam_user_id', v)}
          />
          <FormField
            label="IsThereAnyDeal API Key"
            placeholder="Your ITAD API key"
            helpText="Get started at docs.isthereanydeal.com"
            value={settings.itad_api_key}
            onChange={(v) => updateSetting('itad_api_key', v)}
            type="password"
          />
          <FormField
            label="Discord Webhook URL (Deals)"
            placeholder="https://discord.com/api/webhooks/..."
            helpText="Optional — for price alert notifications"
            value={settings.discord_webhook_url}
            onChange={(v) => updateSetting('discord_webhook_url', v)}
          />
          <FormField
            label="Discord Webhook URL (Ops)"
            placeholder="https://discord.com/api/webhooks/..."
            helpText="Optional — for sync failures, startup alerts. Falls back to deals webhook if empty."
            value={settings.discord_ops_webhook_url}
            onChange={(v) => updateSetting('discord_ops_webhook_url', v)}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
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

      {/* Sync Section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Data Sync</h2>
        {!hasSteamKeys && (
          <p className="text-sm text-yellow-500">
            Save your Steam API Key and User ID above before syncing.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SyncButton
            label="Sync Library"
            icon={<Library className="h-4 w-4" />}
            status={syncStatus.library}
            message={syncMessage.library}
            detail={syncDetail.library}
            onClick={() => handleStreamSync('library', '/api/steam/library')}
            onCancel={() => handleCancel('library')}
            disabled={!hasSteamKeys}
            primary
          />
          <SyncButton
            label="Sync Wishlist"
            icon={<Heart className="h-4 w-4" />}
            status={syncStatus.wishlist}
            message={syncMessage.wishlist}
            detail={syncDetail.wishlist}
            onClick={() => handleStreamSync('wishlist', '/api/steam/wishlist')}
            onCancel={() => handleCancel('wishlist')}
            disabled={!hasSteamKeys}
          />
          <SyncButton
            label="Sync Prices"
            icon={<DollarSign className="h-4 w-4" />}
            status={syncStatus.prices}
            message={syncMessage.prices}
            detail={syncDetail.prices}
            onClick={() => handleStreamSync('prices', '/api/sync', {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'prices' }),
            })}
            onCancel={() => handleCancel('prices')}
            disabled={!hasItadKey}
          />
          <SyncButton
            label="Sync HLTB"
            icon={<Clock className="h-4 w-4" />}
            status={syncStatus.hltb}
            message={syncMessage.hltb}
            detail={syncDetail.hltb}
            onClick={() => handleStreamSync('hltb', '/api/sync', {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'hltb' }),
            })}
            onCancel={() => handleCancel('hltb')}
            disabled={!hasSteamKeys}
          />
          <SyncButton
            label="Sync Reviews"
            icon={<Star className="h-4 w-4" />}
            status={syncStatus.reviews}
            message={syncMessage.reviews}
            detail={syncDetail.reviews}
            onClick={() => handleStreamSync('reviews', '/api/sync', {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'reviews' }),
            })}
            onCancel={() => handleCancel('reviews')}
            disabled={!hasSteamKeys}
          />
        </div>
        {!hasItadKey && hasSteamKeys && (
          <p className="text-sm text-yellow-500">
            Save your ITAD API Key above to sync prices.
          </p>
        )}
      </section>
    </div>
  );
}

function FormField({
  label,
  placeholder,
  helpText,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  placeholder: string;
  helpText?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}

function SyncButton({
  label,
  icon,
  status,
  message,
  detail,
  onClick,
  onCancel,
  disabled,
  primary,
}: {
  label: string;
  icon: React.ReactNode;
  status: 'idle' | 'syncing' | 'success' | 'error';
  message?: string;
  detail?: string;
  onClick: () => void;
  onCancel: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const isSyncing = status === 'syncing';
  const baseClasses = primary
    ? 'bg-steam-blue text-white hover:bg-steam-blue/90'
    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80';

  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onClick}
          disabled={disabled || isSyncing}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${baseClasses}`}
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            icon
          )}
          {label}
        </button>
        {isSyncing && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Cancel sync"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        )}
      </div>
      {message && (
        <div className="space-y-0.5">
          <span
            className={`text-xs font-medium ${
              status === 'success' ? 'text-deal-great' : status === 'error' ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {message}
          </span>
          {detail && isSyncing && (
            <p className="text-xs text-muted-foreground truncate" title={detail}>
              {detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
