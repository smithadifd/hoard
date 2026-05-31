import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/onboarding/state', () => ({
  getOnboardingState: vi.fn(),
  updateOnboardingState: vi.fn(),
  computeChecklist: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { getOnboardingState, updateOnboardingState, computeChecklist } from '@/lib/onboarding/state';
import { GET, PATCH } from './route';

const mockRequireUser = vi.mocked(requireUserIdFromRequest);
const mockGetState = vi.mocked(getOnboardingState);
const mockUpdateState = vi.mocked(updateOnboardingState);
const mockChecklist = vi.mocked(computeChecklist);

function createRequest(body?: unknown | string, method = 'GET'): NextRequest {
  return new NextRequest(new URL('/api/onboarding/state', 'http://localhost:3000'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET /api/onboarding/state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns the state and derived checklist', async () => {
    mockGetState.mockReturnValue({ wizardCompletedAt: null } as never);
    mockChecklist.mockReturnValue({ items: [], complete: false } as never);

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty('state');
    expect(body.data).toHaveProperty('checklist');
  });

  it('returns 500 when the state read throws', async () => {
    mockGetState.mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/onboarding/state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await PATCH(createRequest({ checklistDismissed: true }, 'PATCH'));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await PATCH(createRequest('{ bad', 'PATCH'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown key (strict schema)', async () => {
    const res = await PATCH(createRequest({ bogusField: 1 }, 'PATCH'));
    expect(res.status).toBe(400);
    expect(mockUpdateState).not.toHaveBeenCalled();
  });

  it('merges the patch and returns the next state', async () => {
    mockUpdateState.mockReturnValue({ checklistDismissed: true } as never);
    mockChecklist.mockReturnValue({ items: [], complete: true } as never);

    const res = await PATCH(createRequest({ checklistDismissed: true }, 'PATCH'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpdateState).toHaveBeenCalledWith('test-user-id', { checklistDismissed: true });
    expect(body.data.state).toMatchObject({ checklistDismissed: true });
  });
});
