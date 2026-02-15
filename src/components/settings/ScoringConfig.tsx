'use client';

import { useState } from 'react';
import { Save, Loader2, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import type { ScoringWeights, ScoringThresholds } from '@/lib/scoring/types';
import { useApiMutation } from '@/hooks/useApiMutation';

const DEFAULT_WEIGHTS: ScoringWeights = {
  priceWeight: 0.30,
  reviewWeight: 0.25,
  valueWeight: 0.25,
  interestWeight: 0.20,
};

const DEFAULT_THRESHOLDS: ScoringThresholds = {
  maxDollarsPerHour: {
    overwhelminglyPositive: 4.00,
    veryPositive: 3.00,
    positive: 2.00,
    mixed: 1.00,
    negative: 0.50,
  },
};

interface ScoringConfigProps {
  initialWeights: ScoringWeights;
  initialThresholds: ScoringThresholds;
  initialBacklogThreshold?: number;
  initialPlayAgainCompletionPct?: number;
  initialPlayAgainDormantMonths?: number;
}

export function ScoringConfig({ initialWeights, initialThresholds, initialBacklogThreshold = 10, initialPlayAgainCompletionPct = 50, initialPlayAgainDormantMonths = 24 }: ScoringConfigProps) {
  const [weights, setWeights] = useState<ScoringWeights>(initialWeights);
  const [thresholds, setThresholds] = useState<ScoringThresholds>(initialThresholds);
  const [backlogThreshold, setBacklogThreshold] = useState(initialBacklogThreshold);
  const [playAgainCompletionPct, setPlayAgainCompletionPct] = useState(initialPlayAgainCompletionPct);
  const [playAgainDormantMonths, setPlayAgainDormantMonths] = useState(initialPlayAgainDormantMonths);
  const { mutate: saveConfig, isPending: saving, status: saveStatus, reset: resetSaveStatus } = useApiMutation(
    '/api/settings',
    { method: 'PUT' }
  );

  const totalWeight = weights.priceWeight + weights.reviewWeight + weights.valueWeight + weights.interestWeight;
  const isValid = Math.abs(totalWeight - 1.0) < 0.01;

  const handleWeightChange = (key: keyof ScoringWeights, rawValue: number) => {
    const value = rawValue / 100;
    setWeights((prev) => ({ ...prev, [key]: value }));
    resetSaveStatus();
  };

  const handleThresholdChange = (tier: keyof ScoringThresholds['maxDollarsPerHour'], value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    setThresholds((prev) => ({
      maxDollarsPerHour: { ...prev.maxDollarsPerHour, [tier]: num },
    }));
    resetSaveStatus();
  };

  const handleBacklogThresholdChange = (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 50) return;
    setBacklogThreshold(num);
    resetSaveStatus();
  };

  const handlePlayAgainCompletionChange = (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 10 || num > 100) return;
    setPlayAgainCompletionPct(num);
    resetSaveStatus();
  };

  const handlePlayAgainDormantChange = (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 120) return;
    setPlayAgainDormantMonths(num);
    resetSaveStatus();
  };

  const handleReset = () => {
    setWeights(DEFAULT_WEIGHTS);
    setThresholds(DEFAULT_THRESHOLDS);
    setBacklogThreshold(10);
    setPlayAgainCompletionPct(50);
    setPlayAgainDormantMonths(24);
    resetSaveStatus();
  };

  const handleSave = () => {
    if (!isValid) return;
    saveConfig({
      settings: {
        scoring_weights: JSON.stringify(weights),
        scoring_thresholds: JSON.stringify(thresholds),
        backlog_threshold_percent: String(backlogThreshold),
        play_again_completion_pct: String(playAgainCompletionPct),
        play_again_dormant_months: String(playAgainDormantMonths),
      },
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Deal Scoring</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how deal scores are calculated. Weights must total 100%.
        </p>
      </div>

      {/* Weights */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Score Weights</h3>
        <WeightSlider
          label="Price vs. Historical Low"
          value={weights.priceWeight}
          onChange={(v) => handleWeightChange('priceWeight', v)}
        />
        <WeightSlider
          label="Review Score"
          value={weights.reviewWeight}
          onChange={(v) => handleWeightChange('reviewWeight', v)}
        />
        <WeightSlider
          label="Value ($/hour)"
          value={weights.valueWeight}
          onChange={(v) => handleWeightChange('valueWeight', v)}
        />
        <WeightSlider
          label="Personal Interest"
          value={weights.interestWeight}
          onChange={(v) => handleWeightChange('interestWeight', v)}
        />
        <p className={`text-sm ${isValid ? 'text-muted-foreground' : 'text-destructive font-medium'}`}>
          Total: {Math.round(totalWeight * 100)}%{!isValid && ' (must be 100%)'}
        </p>
      </div>

      {/* Thresholds */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Max $/Hour by Review Tier</h3>
        <p className="text-xs text-muted-foreground">
          Maximum dollars per hour of gameplay considered &quot;good value&quot; for each review rating.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <ThresholdInput
            label="Overwhelmingly Positive"
            value={thresholds.maxDollarsPerHour.overwhelminglyPositive}
            onChange={(v) => handleThresholdChange('overwhelminglyPositive', v)}
          />
          <ThresholdInput
            label="Very Positive"
            value={thresholds.maxDollarsPerHour.veryPositive}
            onChange={(v) => handleThresholdChange('veryPositive', v)}
          />
          <ThresholdInput
            label="Positive"
            value={thresholds.maxDollarsPerHour.positive}
            onChange={(v) => handleThresholdChange('positive', v)}
          />
          <ThresholdInput
            label="Mixed"
            value={thresholds.maxDollarsPerHour.mixed}
            onChange={(v) => handleThresholdChange('mixed', v)}
          />
          <ThresholdInput
            label="Negative"
            value={thresholds.maxDollarsPerHour.negative}
            onChange={(v) => handleThresholdChange('negative', v)}
          />
        </div>
      </div>

      {/* Backlog Threshold */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Backlog Threshold</h3>
        <p className="text-xs text-muted-foreground">
          Games where you&apos;ve played less than this percentage of the main story (HLTB) are
          considered part of your backlog. Games without HLTB data use a 15-minute absolute threshold.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={backlogThreshold}
            onChange={(e) => handleBacklogThresholdChange(e.target.value)}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-steam-blue bg-secondary"
          />
          <span className="text-sm font-medium w-12 text-right">{backlogThreshold}%</span>
        </div>
      </div>

      {/* Play Again Thresholds */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Play Again</h3>
        <p className="text-xs text-muted-foreground">
          Surface games you played significantly but haven&apos;t touched in a long time.
          Shown as a preset on the Backlog page.
        </p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-muted-foreground">Min completion</label>
              <span className="text-sm font-medium w-12 text-right">{playAgainCompletionPct}%</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Minimum percentage of main story (HLTB) played. Games without HLTB data need 10+ hours.
            </p>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={playAgainCompletionPct}
              onChange={(e) => handlePlayAgainCompletionChange(e.target.value)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-steam-blue bg-secondary"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-muted-foreground">Dormant period</label>
              <span className="text-sm font-medium w-16 text-right">{playAgainDormantMonths} mo</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              How long since last played before a game is considered dormant.
            </p>
            <input
              type="range"
              min={1}
              max={120}
              step={1}
              value={playAgainDormantMonths}
              onChange={(e) => handlePlayAgainDormantChange(e.target.value)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-steam-blue bg-secondary"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !isValid}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Scoring Config
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

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (rawValue: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">{label}</label>
        <span className="text-sm font-medium w-10 text-right">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-steam-blue bg-secondary"
      />
    </div>
  );
}

function ThresholdInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <input
          type="number"
          step="0.50"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-6 pr-3 py-2 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/hr</span>
      </div>
    </div>
  );
}
