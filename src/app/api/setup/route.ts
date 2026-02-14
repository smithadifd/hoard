import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { user, userGames, priceAlerts } from '@/lib/db/schema';
import { sql, eq } from 'drizzle-orm';
import { z } from 'zod';
import { apiSuccess, apiError, apiValidationError } from '@/lib/utils/api';

const setupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export async function POST(request: NextRequest) {
  try {
    const db = getDb();

    // Check if any users already exist
    const row = db.select({ count: sql<number>`count(*)` }).from(user).get();
    if ((row?.count ?? 0) > 0) {
      return apiError('Setup already completed. Please sign in.', 403);
    }

    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return apiValidationError(firstError);
    }

    // Create user via Better Auth API
    const result = await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: request.headers,
    });

    if (!result?.user?.id) {
      return apiError('Failed to create account');
    }

    // Migrate existing 'default' userId records to the new user
    const newUserId = result.user.id;

    db.update(userGames)
      .set({ userId: newUserId })
      .where(eq(userGames.userId, 'default'))
      .run();

    db.update(priceAlerts)
      .set({ userId: newUserId })
      .where(eq(priceAlerts.userId, 'default'))
      .run();

    return apiSuccess({ message: 'Account created successfully' });
  } catch (error) {
    console.error('[POST /api/setup]', error);
    return apiError('Failed to create account');
  }
}
