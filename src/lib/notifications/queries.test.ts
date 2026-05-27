import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedNotification } from '@/lib/db/test-helpers';
import type { TestDb } from '@/lib/db/test-helpers';

let testDb: TestDb;

vi.mock('@/lib/db', async () => {
  const actualSchema = await vi.importActual<typeof import('@/lib/db/schema')>('@/lib/db/schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

import {
  listNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  dismissNotification,
  dismissAll,
  pruneNotifications,
} from './queries';
import { createNotification } from './create';

beforeEach(() => {
  testDb = createTestDb();
});

describe('createNotification', () => {
  it('inserts a row and returns the new id', () => {
    const id = createNotification('user-1', 'drain-complete', {
      title: 'Drain finished',
      body: 'Library is fully enriched',
    });
    expect(id).not.toBeNull();
    expect(listNotifications('user-1')).toHaveLength(1);
  });

  it('serializes metadata to JSON', () => {
    createNotification('user-1', 'milestone', {
      title: 'Milestone',
      metadata: { stage: 'hltb', percent: 25 },
    });
    const [row] = listNotifications('user-1');
    expect(row.metadata).toEqual({ stage: 'hltb', percent: 25 });
  });

  it('persists null body/link/metadata when omitted', () => {
    createNotification('user-1', 'sync-failure', { title: 'Failure' });
    const [row] = listNotifications('user-1');
    expect(row.body).toBeNull();
    expect(row.link).toBeNull();
    expect(row.metadata).toBeNull();
  });
});

describe('listNotifications', () => {
  it('returns newest-first', () => {
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    seedNotification(testDb, 'user-1', { title: 'older', createdAt: older });
    seedNotification(testDb, 'user-1', { title: 'newer', createdAt: newer });

    const result = listNotifications('user-1');
    expect(result[0].title).toBe('newer');
    expect(result[1].title).toBe('older');
  });

  it('excludes dismissed notifications', () => {
    seedNotification(testDb, 'user-1', { title: 'visible' });
    seedNotification(testDb, 'user-1', { title: 'hidden', dismissedAt: new Date() });
    const result = listNotifications('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('visible');
  });

  it('scopes per-user', () => {
    seedNotification(testDb, 'user-1', { title: 'mine' });
    seedNotification(testDb, 'user-2', { title: 'theirs' });
    const result = listNotifications('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('mine');
  });

  it('respects the limit', () => {
    for (let i = 0; i < 5; i += 1) {
      seedNotification(testDb, 'user-1', { title: `n${i}` });
    }
    expect(listNotifications('user-1', 3)).toHaveLength(3);
  });
});

describe('getUnreadCount', () => {
  it('counts only unread, non-dismissed notifications for the user', () => {
    seedNotification(testDb, 'user-1', { title: 'unread' });
    seedNotification(testDb, 'user-1', { title: 'read', readAt: new Date() });
    seedNotification(testDb, 'user-1', { title: 'dismissed', dismissedAt: new Date() });
    seedNotification(testDb, 'user-2', { title: 'other' });

    expect(getUnreadCount('user-1')).toBe(1);
  });

  it('returns 0 when no rows match', () => {
    expect(getUnreadCount('user-1')).toBe(0);
  });
});

describe('markAllRead', () => {
  it('stamps every unread row and skips dismissed/read rows', () => {
    seedNotification(testDb, 'user-1', { title: 'a' });
    seedNotification(testDb, 'user-1', { title: 'b' });
    seedNotification(testDb, 'user-1', { title: 'already-read', readAt: new Date() });
    seedNotification(testDb, 'user-1', { title: 'dismissed', dismissedAt: new Date() });

    const updated = markAllRead('user-1');
    expect(updated).toBe(2);
    expect(getUnreadCount('user-1')).toBe(0);
  });
});

describe('markRead', () => {
  it('marks a single notification read when scoped to its owner', () => {
    const id = seedNotification(testDb, 'user-1', { title: 'a' });
    expect(markRead(id, 'user-1')).toBe(true);
    expect(getUnreadCount('user-1')).toBe(0);
  });

  it('refuses cross-user mark-read', () => {
    const id = seedNotification(testDb, 'user-1', { title: 'a' });
    expect(markRead(id, 'user-2')).toBe(false);
    expect(getUnreadCount('user-1')).toBe(1);
  });
});

describe('dismissNotification', () => {
  it('hides a single notification when scoped to its owner', () => {
    const id = seedNotification(testDb, 'user-1', { title: 'a' });
    expect(dismissNotification(id, 'user-1')).toBe(true);
    expect(listNotifications('user-1')).toHaveLength(0);
  });

  it('refuses cross-user dismiss', () => {
    const id = seedNotification(testDb, 'user-1', { title: 'a' });
    expect(dismissNotification(id, 'user-2')).toBe(false);
    expect(listNotifications('user-1')).toHaveLength(1);
  });
});

describe('dismissAll', () => {
  it('hides every still-visible notification for the user', () => {
    seedNotification(testDb, 'user-1', { title: 'a' });
    seedNotification(testDb, 'user-1', { title: 'b' });
    seedNotification(testDb, 'user-2', { title: 'theirs' });

    const dismissed = dismissAll('user-1');
    expect(dismissed).toBe(2);
    expect(listNotifications('user-1')).toHaveLength(0);
    expect(listNotifications('user-2')).toHaveLength(1);
  });
});

describe('pruneNotifications', () => {
  it('deletes rows dismissed more than 7 days ago', () => {
    const oldDismissed = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const recentDismissed = new Date(Date.now() - 24 * 60 * 60 * 1000);
    seedNotification(testDb, 'user-1', { title: 'old', dismissedAt: oldDismissed });
    seedNotification(testDb, 'user-1', { title: 'recent', dismissedAt: recentDismissed });

    const removed = pruneNotifications();
    expect(removed).toBe(1);
  });

  it('deletes unread notifications older than 60 days', () => {
    const ancientCreated = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    const recentCreated = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    seedNotification(testDb, 'user-1', { title: 'ancient', createdAt: ancientCreated });
    seedNotification(testDb, 'user-1', { title: 'recent', createdAt: recentCreated });

    const removed = pruneNotifications();
    expect(removed).toBe(1);
    expect(listNotifications('user-1').map((n) => n.title)).toEqual(['recent']);
  });

  it('also deletes read-but-not-dismissed notifications older than 60 days', () => {
    const ancientCreated = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    seedNotification(testDb, 'user-1', {
      title: 'old-read',
      createdAt: ancientCreated,
      readAt: ancientCreated,
    });
    const removed = pruneNotifications();
    expect(removed).toBe(1);
  });

  it('leaves read+recent notifications alone', () => {
    seedNotification(testDb, 'user-1', {
      title: 'fresh-read',
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      readAt: new Date(),
    });
    expect(pruneNotifications()).toBe(0);
    expect(listNotifications('user-1')).toHaveLength(1);
  });

  it('leaves recently-dismissed notifications alone', () => {
    seedNotification(testDb, 'user-1', {
      title: 'just-dismissed',
      createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      dismissedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    expect(pruneNotifications()).toBe(0);
  });
});
