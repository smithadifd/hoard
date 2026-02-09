import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { user, userGames, priceAlerts } from '@/lib/db/schema';
import { sql, eq } from 'drizzle-orm';
import { z } from 'zod';

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
      return NextResponse.json(
        { error: 'Setup already completed. Please sign in.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return NextResponse.json({ error: firstError }, { status: 400 });
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
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 }
      );
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

    return NextResponse.json({
      data: { message: 'Account created successfully' },
    });
  } catch (error) {
    console.error('[Setup] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
