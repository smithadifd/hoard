// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Step4Library } from './Step4Library';
import type { StepProps } from '../OnboardingWizard';

const fetchMock = vi.fn();
const setShared = vi.fn();

const props: StepProps = {
  step: 4,
  totalSteps: 7,
  shared: {} as StepProps['shared'],
  setShared,
  onNext: () => undefined,
  onBack: () => undefined,
};

function sse(event: string, data: unknown): Response {
  return new Response('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

interface SyncCall {
  type: string;
  signal: AbortSignal;
}

/** Route /api/sync calls to the supplied handler; everything else resolves ok. */
function routeSync(handler: (call: SyncCall) => Promise<unknown>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/sync') {
      const body = JSON.parse(String(init?.body)) as { type: string };
      return handler({ type: body.type, signal: init?.signal as AbortSignal });
    }
    return { ok: true, json: async () => ({}) };
  });
}

const syncCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/sync');
const never = () => new Promise<never>(() => undefined);

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  setShared.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Step4Library', () => {
  it('starts the library sync on mount and shows the running state', async () => {
    routeSync(() => never());
    render(<Step4Library {...props} />);
    await flush();

    expect(syncCalls()).toHaveLength(1);
    expect(JSON.parse(String(syncCalls()[0][1].body))).toEqual({ type: 'library' });
    expect(screen.getByText('Pulling owned games…')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Cancel/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the running state on the very first render', () => {
    routeSync(() => never());
    render(<Step4Library {...props} />);
    expect(screen.getByText('Pulling owned games…')).toBeTruthy();
  });

  it('runs library then wishlist and offers Continue when done', async () => {
    routeSync(async ({ type }) =>
      type === 'library' ? sse('done', { gamesProcessed: 3 }) : sse('done', { gamesProcessed: 2 }),
    );
    render(<Step4Library {...props} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy());

    expect(syncCalls().map(([, init]) => JSON.parse(String(init.body)).type)).toEqual(['library', 'wishlist']);
    expect(setShared).toHaveBeenCalledWith({ libraryCount: 3 });
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'P' && (el.textContent ?? '').startsWith('Imported 3 owned games and 2 wishlist items'),
      ),
    ).toBeTruthy();
  });

  it('aborts the in-flight sync when unmounted', async () => {
    let signal: AbortSignal | undefined;
    routeSync((call) => {
      signal = call.signal;
      return never();
    });
    const view = render(<Step4Library {...props} />);
    await flush();
    expect(signal?.aborted).toBe(false);

    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('aborts the sync and shows Cancelled when Cancel is clicked', async () => {
    routeSync(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    render(<Step4Library {...props} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    });
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('resets progress and restarts the sync when Retry is clicked after an error', async () => {
    let call = 0;
    let secondSignal: AbortSignal | undefined;
    routeSync(({ signal }) => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Steam is down' }) });
      }
      secondSignal = signal;
      return never();
    });
    render(<Step4Library {...props} />);
    await vi.waitFor(() => expect(screen.getByText('Steam is down')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    expect(screen.queryByText('Steam is down')).toBeNull();
    expect(screen.getByText('Pulling owned games…')).toBeTruthy();
    expect(syncCalls()).toHaveLength(2);
    expect(secondSignal?.aborted).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('aborts the previous sync when a new one starts', async () => {
    const signals: AbortSignal[] = [];
    let call = 0;
    routeSync(({ signal }) => {
      call += 1;
      signals.push(signal);
      return call === 1
        ? Promise.resolve({ ok: false, json: async () => ({ error: 'nope' }) })
        : never();
    });
    render(<Step4Library {...props} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
