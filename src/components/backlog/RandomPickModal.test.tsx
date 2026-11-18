// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RandomPickModal } from './RandomPickModal';
import type { EnrichedGame } from '@/types';

vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => createElement('img', { alt: props.alt ?? '' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

function game(id: number, title: string): EnrichedGame {
  return { id, title, steamAppId: id, genres: [] } as unknown as EnrichedGame;
}

const candidates = [game(1, 'Cand A'), game(2, 'Cand B'), game(3, 'Cand C'), game(4, 'Cand D')];
const finalPick = game(9, 'Final Pick');

const noop = () => undefined;

function renderModal(props: Partial<React.ComponentProps<typeof RandomPickModal>> = {}) {
  const base = {
    finalPick,
    candidates,
    open: true,
    onClose: noop,
    onReroll: noop,
  };
  const ui = (p: Partial<React.ComponentProps<typeof RandomPickModal>>) =>
    createElement(RandomPickModal, { ...base, ...p });
  const view = render(ui(props));
  return { rerender: (p: Partial<React.ComponentProps<typeof RandomPickModal>>) => view.rerender(ui(p)) };
}

const landed = () => screen.queryByText('Your pick is in!') !== null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RandomPickModal', () => {
  it('renders nothing while closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('spins through candidates, slows, then lands on the final pick', () => {
    renderModal();

    // Spinning: nothing landed, the final pick is shown until the first tick.
    expect(landed()).toBe(false);
    expect(screen.getByRole('heading', { name: 'Final Pick' })).toBeTruthy();

    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole('heading', { name: 'Cand A' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole('heading', { name: 'Cand B' })).toBeTruthy();

    // Just before the slow phase: still not landed.
    act(() => { vi.advanceTimersByTime(699); });
    expect(landed()).toBe(false);

    // Slow phase ends 1200ms after it starts at 800ms.
    act(() => { vi.advanceTimersByTime(1 + 1199); });
    expect(landed()).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(landed()).toBe(true);
    expect(screen.getByRole('heading', { name: 'Final Pick' })).toBeTruthy();
  });

  it('lands immediately when there are fewer than 3 candidates', () => {
    renderModal({ candidates: candidates.slice(0, 2) });
    expect(landed()).toBe(true);
    expect(screen.getByRole('heading', { name: 'Final Pick' })).toBeTruthy();
  });

  it('lands on the new pick when it changes with fewer than 3 candidates', () => {
    const few = candidates.slice(0, 2);
    const { rerender } = renderModal({ candidates: few });
    rerender({ candidates: few, finalPick: game(10, 'Second Pick') });
    expect(landed()).toBe(true);
    expect(screen.getByRole('heading', { name: 'Second Pick' })).toBeTruthy();
  });

  it('lands immediately when the candidates shrink below 3 mid-spin', () => {
    const { rerender } = renderModal();
    act(() => { vi.advanceTimersByTime(100); });
    expect(landed()).toBe(false);

    rerender({ candidates: candidates.slice(0, 2) });
    expect(landed()).toBe(true);
    expect(screen.getByRole('heading', { name: 'Final Pick' })).toBeTruthy();
  });

  it('restarts the spin when the final pick changes, keeping the previous display until the first tick', () => {
    const { rerender } = renderModal();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(landed()).toBe(true);

    rerender({ finalPick: game(10, 'Reroll Pick') });
    expect(landed()).toBe(false);
    // displayGame is not cleared on restart: the landed pick stays until the first tick.
    expect(screen.getByRole('heading', { name: 'Final Pick' })).toBeTruthy();

    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole('heading', { name: 'Cand A' })).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1950); });
    expect(landed()).toBe(true);
    expect(screen.getByRole('heading', { name: 'Reroll Pick' })).toBeTruthy();
  });

  it('spins again after being closed and reopened', () => {
    const { rerender } = renderModal();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(landed()).toBe(true);

    rerender({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender({ open: true });
    expect(landed()).toBe(false);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(landed()).toBe(true);
  });

  it('only allows closing once landed', () => {
    renderModal();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
