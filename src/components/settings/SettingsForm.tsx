'use client';

import { useState } from 'react';
import { Save, Loader2, CheckCircle, AlertCircle, Library, Heart } from 'lucide-react';

interface SettingsFormProps {
  initialSettings: Record<string, string>;
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState({
    steam_api_key: initialSettings['steam_api_key'] || '',
    steam_user_id: initialSettings['steam_user_id'] || '',
    itad_api_key: initialSettings['itad_api_key'] || '',
    discord_webhook_url: initialSettings['discord_webhook_url'] || '',
  });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [syncStatus, setSyncStatus] = useState<Record<string, 'idle' | 'syncing' | 'success' | 'error'>>({
    library: 'idle',
    wishlist: 'idle',
  });
  const [syncMessage, setSyncMessage] = useState<Record<string, string>>({});

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

  const handleSync = async (type: 'library' | 'wishlist') => {
    setSyncStatus((prev) => ({ ...prev, [type]: 'syncing' }));
    setSyncMessage((prev) => ({ ...prev, [type]: '' }));
    try {
      const res = await fetch(`/api/steam/${type}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSyncStatus((prev) => ({ ...prev, [type]: 'success' }));
      setSyncMessage((prev) => ({
        ...prev,
        [type]: `Synced ${data.data?.gamesProcessed ?? 0} games`,
      }));
    } catch (err) {
      setSyncStatus((prev) => ({ ...prev, [type]: 'error' }));
      setSyncMessage((prev) => ({
        ...prev,
        [type]: err instanceof Error ? err.message : 'Sync failed',
      }));
    }
  };

  const hasSteamKeys = settings.steam_api_key && settings.steam_user_id;

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
            label="Steam User ID"
            placeholder="Your Steam64 ID (e.g., 76561198...)"
            helpText="Find yours at steamid.io"
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
            label="Discord Webhook URL"
            placeholder="https://discord.com/api/webhooks/..."
            helpText="Optional — for price alert notifications"
            value={settings.discord_webhook_url}
            onChange={(v) => updateSetting('discord_webhook_url', v)}
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
        <div className="flex flex-wrap gap-3">
          <SyncButton
            label="Sync Library"
            icon={<Library className="h-4 w-4" />}
            status={syncStatus.library}
            message={syncMessage.library}
            onClick={() => handleSync('library')}
            disabled={!hasSteamKeys}
            primary
          />
          <SyncButton
            label="Sync Wishlist"
            icon={<Heart className="h-4 w-4" />}
            status={syncStatus.wishlist}
            message={syncMessage.wishlist}
            onClick={() => handleSync('wishlist')}
            disabled={!hasSteamKeys}
          />
        </div>
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
  onClick,
  disabled,
  primary,
}: {
  label: string;
  icon: React.ReactNode;
  status: 'idle' | 'syncing' | 'success' | 'error';
  message?: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const baseClasses = primary
    ? 'bg-steam-blue text-white hover:bg-steam-blue/90'
    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80';

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={disabled || status === 'syncing'}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${baseClasses}`}
      >
        {status === 'syncing' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          icon
        )}
        {label}
      </button>
      {message && (
        <span
          className={`text-xs ${
            status === 'success' ? 'text-deal-great' : status === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
