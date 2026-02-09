import { redirect } from 'next/navigation';
import { TrendingDown } from 'lucide-react';
import { getDb } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { SetupForm } from './SetupForm';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  // If users already exist, redirect to login
  try {
    const db = getDb();
    const row = db.select({ count: sql<number>`count(*)` }).from(user).get();
    if ((row?.count ?? 0) > 0) {
      redirect('/login');
    }
  } catch {
    // DB not initialized yet — show setup form
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-border bg-card p-6 shadow-lg">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <TrendingDown className="h-8 w-8 text-steam-blue" />
            <span className="text-2xl font-bold">Hoard</span>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold">Welcome to Hoard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create your account to get started
            </p>
          </div>

          <SetupForm />
        </div>
      </div>
    </div>
  );
}
