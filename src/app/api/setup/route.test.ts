import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createTestDb, seedUser, seedGame, seedUserGame } from '@/lib/db/test-helpers';
import type { TestDb } from '@/lib/db/test-helpers';

let testDb: TestDb;

vi.mock('@/lib/db', () => ({
  getDb: () => testDb,
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { signUpEmail: vi.fn() } },
}));

import { auth } from '@/lib/auth';
import { POST } from './route';

const mockSignUp = vi.mocked(auth.api.signUpEmail);

function createRequest(body: unknown | string): NextRequest {
  return new NextRequest(new URL('/api/setup', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { name: 'Andrew', email: 'a@example.com', password: 'supersecret1' };

describe('POST /api/setup', () => {
  beforeEach(() => {
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('creates the first user and migrates default-scoped rows', async () => {
    mockSignUp.mockResolvedValue({ user: { id: 'new-user-id' } } as never);
    // Pre-existing data scoped to the placeholder 'default' user.
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Owned Game' });
    seedUserGame(testDb, gameId, { userId: 'default', isOwned: true });

    const res = await POST(createRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toBe('Account created successfully');
    // The 'default' user_games row was reassigned to the new user.
    const migrated = testDb
      .select()
      .from(schema.userGames)
      .where(eq(schema.userGames.gameId, gameId))
      .get();
    expect(migrated?.userId).toBe('new-user-id');
  });

  it('returns 403 when a user already exists', async () => {
    seedUser(testDb, { id: 'existing', email: 'existing@example.com' });

    const res = await POST(createRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Setup already completed');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(createRequest('{ not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body fails validation (short password)', async () => {
    const res = await POST(createRequest({ ...validBody, password: 'short' }));
    expect(res.status).toBe(400);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('returns 500 when account creation yields no user id', async () => {
    mockSignUp.mockResolvedValue({ user: null } as never);
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(500);
  });
});
