// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TriageHltbEditor } from './TriageHltbEditor';

const fetchMock = vi.fn();

const MANUAL_INPUT = /Main story hours/;

function searchResponse(results: unknown[]) {
  return { ok: true, json: async () => ({ data: { results } }) };
}

function renderEditor(compact: boolean) {
  return render(
    <TriageHltbEditor gameId={1} gameTitle="Some Game" onSaved={() => undefined} compact={compact} />,
  );
}

async function clickSearch() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Search HLTB/ }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ['compact', true],
  ['mobile', false],
])('TriageHltbEditor (%s layout)', (_label, compact) => {
  it('starts with the search button and no manual entry', () => {
    renderEditor(compact);
    expect(screen.getByRole('button', { name: /Search HLTB/ })).toBeTruthy();
    expect(screen.queryByPlaceholderText(MANUAL_INPUT)).toBeNull();
  });

  it('opens manual entry when the search finds nothing', async () => {
    fetchMock.mockResolvedValueOnce(searchResponse([]));
    renderEditor(compact);
    await clickSearch();

    expect(screen.getByText('No results found on HLTB')).toBeTruthy();
    expect(screen.getByPlaceholderText(MANUAL_INPUT)).toBeTruthy();
  });

  it('opens manual entry when the search request fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) });
    renderEditor(compact);
    await clickSearch();

    expect(screen.getByText('Search failed: boom')).toBeTruthy();
    expect(screen.getByPlaceholderText(MANUAL_INPUT)).toBeTruthy();
  });

  it('does not open manual entry when the search has results', async () => {
    fetchMock.mockResolvedValueOnce(
      searchResponse([
        { id: 1, name: 'Some Game', gameplayMain: 5, gameplayMainExtra: 6, gameplayCompletionist: 7, similarity: 0.9 },
      ]),
    );
    renderEditor(compact);
    await clickSearch();

    expect(screen.getByText('Some Game')).toBeTruthy();
    expect(screen.queryByPlaceholderText(MANUAL_INPUT)).toBeNull();
  });

  it('stays hidden after the user hides manual entry, and re-opens on the next failed search', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    renderEditor(compact);
    await clickSearch();
    expect(screen.getByPlaceholderText(MANUAL_INPUT)).toBeTruthy();

    // Hide manual entry: it must not immediately re-open.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByPlaceholderText(MANUAL_INPUT)).toBeNull();
    expect(screen.getByRole('button', { name: /Search HLTB/ })).toBeTruthy();

    // A new failed search is a fresh change in state and opens it again.
    await clickSearch();
    expect(screen.getByPlaceholderText(MANUAL_INPUT)).toBeTruthy();
  });
});

describe('TriageHltbEditor manual entry button', () => {
  it('opens manual entry from the mobile button without searching', () => {
    renderEditor(false);
    fireEvent.click(screen.getByRole('button', { name: 'Enter hours manually' }));
    expect(screen.getByPlaceholderText(MANUAL_INPUT)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
