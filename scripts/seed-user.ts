/**
 * One-time script to seed the first user and migrate existing data.
 * Run with: source .env.local && npx tsx scripts/seed-user.ts <email> <password> [name]
 *
 * This does the same thing as the /api/setup endpoint:
 * 1. Creates a user via Better Auth
 * 2. Migrates 'default' userId records to the new user
 */

import { auth } from '../src/lib/auth';
import { getDb } from '../src/lib/db';
import { user, userGames, priceAlerts } from '../src/lib/db/schema';
import { sql, eq } from 'drizzle-orm';

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const NAME = process.argv[4] || 'Admin';

if (!EMAIL || !PASSWORD) {
  console.error('Usage: npx tsx scripts/seed-user.ts <email> <password> [name]');
  process.exit(1);
}

async function main() {
  const db = getDb();

  // Check if users already exist
  const row = db.select({ count: sql<number>`count(*)` }).from(user).get();
  if ((row?.count ?? 0) > 0) {
    console.log('Users already exist. Skipping setup.');
    const users = db.select().from(user).all();
    console.log('Existing users:', users.map(u => `${u.email} (${u.id})`));
    return;
  }

  console.log(`Creating user: ${EMAIL}`);

  // Create user via Better Auth API
  const result = await auth.api.signUpEmail({
    body: { name: NAME, email: EMAIL, password: PASSWORD },
  });

  if (!result?.user?.id) {
    console.error('Failed to create user:', result);
    process.exit(1);
  }

  const newUserId = result.user.id;
  console.log(`User created with ID: ${newUserId}`);

  // Migrate existing 'default' userId records
  const ugResult = db.update(userGames)
    .set({ userId: newUserId })
    .where(eq(userGames.userId, 'default'))
    .run();
  console.log(`Migrated ${ugResult.changes} user_games records`);

  const paResult = db.update(priceAlerts)
    .set({ userId: newUserId })
    .where(eq(priceAlerts.userId, 'default'))
    .run();
  console.log(`Migrated ${paResult.changes} price_alerts records`);

  console.log('Setup complete!');
}

main().catch(console.error);
