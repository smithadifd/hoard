// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceHealthCard } from './SourceHealthCard';
import type { SourceEntry } from '@/lib/sync/api-types';

function entry(source: string, label: string): SourceEntry {
  return {
    source,
    label,
    description: '',
    service: 'steam',
    supportsManualRun: false,
    manualRunType: null,
    task: null,
    health: 'healthy',
    threshold: null,
    minAttempts: 0,
    recentStats: [],
    apiCalls24h: 0,
    lastRun: null,
  } as SourceEntry;
}

const noop = () => undefined;

function renderCard(source: SourceEntry) {
  return render(<SourceHealthCard source={source} onOpen={noop} onRunComplete={noop} />);
}

/** The source icon is the svg rendered next to the label. */
function iconOf(label: string): Element | null {
  return screen.getByText(label).parentElement?.querySelector('svg') ?? null;
}

describe('SourceHealthCard icon', () => {
  it('renders the registered icon for the source with the card icon classes', () => {
    renderCard(entry('hltb', 'HowLongToBeat'));
    const icon = iconOf('HowLongToBeat');
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains('lucide-clock')).toBe(true);
    expect(icon?.getAttribute('class')).toContain('h-4 w-4 text-muted-foreground shrink-0');
  });

  it('falls back to the database icon for an unknown source', () => {
    renderCard(entry('something_new', 'Something new'));
    expect(iconOf('Something new')?.classList.contains('lucide-database')).toBe(true);
  });

  it('switches icon when the source changes', () => {
    const view = renderCard(entry('hltb', 'HowLongToBeat'));
    view.rerender(<SourceHealthCard source={entry('reviews', 'Reviews')} onOpen={noop} onRunComplete={noop} />);
    expect(iconOf('Reviews')?.classList.contains('lucide-star')).toBe(true);
  });
});
