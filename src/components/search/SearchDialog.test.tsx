// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchDialog } from './SearchDialog';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => createElement('img', { alt: props.alt ?? '' }),
}));

const fetchMock = vi.fn();

const searchBody = {
  data: {
    library: [
      { id: 1, title: 'Library Hit', headerImage: null, isOwned: true, isWishlisted: false, isWatchlisted: false },
    ],
    steam: [{ appId: 42, name: 'Steam Hit', tinyImage: null, price: null }],
  },
};

function routeFetch(lookup: { ok: boolean; body: unknown } = { ok: false, body: { error: 'Lookup exploded' } }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/search')) return { ok: true, json: async () => searchBody };
    return { ok: lookup.ok, json: async () => lookup.body };
  });
}

function ui(open: boolean) {
  return createElement(SearchDialog, { open, onOpenChange: () => undefined });
}

const input = () => screen.getByPlaceholderText('Search your library and Steam...') as HTMLInputElement;

async function typeQuery(value: string) {
  fireEvent.change(input(), { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SearchDialog state reset', () => {
  it('shows results for a typed query while open', async () => {
    routeFetch();
    render(ui(true));
    await typeQuery('ha');
    expect(screen.getByText('Library Hit')).toBeTruthy();
    expect(screen.getByText('Steam Hit')).toBeTruthy();
  });

  it('clears the query and results when closed and reopened', async () => {
    routeFetch();
    const view = render(ui(true));
    await typeQuery('ha');
    expect(screen.getByText('Library Hit')).toBeTruthy();

    view.rerender(ui(false));
    view.rerender(ui(true));

    expect(input().value).toBe('');
    expect(screen.queryByText('Library Hit')).toBeNull();
    expect(screen.getByText('Type at least 2 characters to search')).toBeTruthy();
  });

  it('clears a search error when closed and reopened', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const view = render(ui(true));
    await typeQuery('ha');
    expect(screen.getByText('Search failed. Please try again.')).toBeTruthy();

    view.rerender(ui(false));
    view.rerender(ui(true));
    expect(screen.queryByText('Search failed. Please try again.')).toBeNull();
  });

  it('clears a lookup error when closed and reopened', async () => {
    routeFetch();
    const view = render(ui(true));
    await typeQuery('ha');
    await act(async () => {
      fireEvent.click(screen.getByText('Steam Hit'));
    });
    expect(screen.getByText('Lookup exploded')).toBeTruthy();

    view.rerender(ui(false));
    view.rerender(ui(true));
    await typeQuery('ha');

    expect(screen.getByText('Steam Hit')).toBeTruthy();
    expect(screen.queryByText('Lookup exploded')).toBeNull();
  });

  it('cancels a pending debounced search when closed', async () => {
    routeFetch();
    const view = render(ui(true));
    fireEvent.change(input(), { target: { value: 'ha' } });

    view.rerender(ui(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the query while it stays open across re-renders', async () => {
    routeFetch();
    const view = render(ui(true));
    await typeQuery('ha');
    view.rerender(ui(true));
    expect(input().value).toBe('ha');
    expect(screen.getByText('Library Hit')).toBeTruthy();
  });
});
