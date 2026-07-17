import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { APIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { user } from './db/schema';

/**
 * Hoard is single-user (one household, one install). The first account is
 * created through the `/setup` flow; every account after that must be refused,
 * so an exposed instance can't have strangers self-registering. Better Auth's
 * static `disableSignUp` can't express "after the first user" (it would block
 * setup too), so we enforce it dynamically here: the create hook runs for every
 * signup — server-side (`/setup`) or via `/api/auth/sign-up` — and rejects it
 * once any user row exists. Idempotent and cheap (one indexed COUNT).
 *
 * Accepted residual (TOCTOU): the COUNT here and Better Auth's later INSERT are
 * not one transaction — the `before` hook doesn't expose the adapter's tx — so
 * two truly-simultaneous FIRST-EVER signups (distinct emails) could both read
 * count=0 and both insert. This is reachable ONLY in the one-time bootstrap
 * window before any user exists and is permanently closed once the first row
 * lands; making it atomic would need a DB-level "at most one user" constraint
 * (a migration that would also fight the userId-parameterised multi-user model).
 * Not worth that trade for a fresh-install-only race, so it's documented and
 * left. The `/api/setup` route applies the same count check as a second gate.
 */
export function assertSignUpAllowed(): void {
  const row = getDb().select({ count: sql<number>`count(*)` }).from(user).get();
  if ((row?.count ?? 0) > 0) {
    throw new APIError('FORBIDDEN', {
      message: 'Sign-ups are disabled: this Hoard instance already has an account.',
    });
  }
}

function getTrustedOrigins(): string[] {
  const origins = ['http://localhost:3000'];
  const extra = process.env.TRUSTED_ORIGINS; // comma-separated
  if (extra) {
    origins.push(...extra.split(',').map(o => o.trim()).filter(Boolean));
  }
  return origins;
}

function createAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    secret: process.env.BETTER_AUTH_SECRET,

    database: drizzleAdapter(getDb(), {
      provider: 'sqlite',
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
    },

    databaseHooks: {
      user: {
        create: {
          // Enforce single-user signup lockdown: allow the first account,
          // refuse every one after it. See assertSignUpAllowed above.
          before: async (userData) => {
            assertSignUpAllowed();
            return { data: userData };
          },
        },
      },
    },

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min — avoids DB lookup on most requests
      },
      expiresIn: process.env.DEMO_MODE === 'true'
        ? 60 * 60 * 24       // 24 hours (demo)
        : 60 * 60 * 24 * 30, // 30 days (production)
      updateAge: 60 * 60 * 24, // refresh once per day
    },

    trustedOrigins: getTrustedOrigins(),

    plugins: [
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let _auth: Auth | null = null;

function ensureAuth(): Auth {
  if (!_auth) _auth = createAuth();
  return _auth;
}

/**
 * Lazy singleton — avoids calling getDb() at module load time,
 * which would fail during `next build` in CI (no data/ directory).
 *
 * betterAuth() returns a callable object (function with properties),
 * so the proxy target must also be a function to support the `apply` trap.
 */
export const auth: Auth = new Proxy(function () {} as unknown as Auth, {
  get(_target, prop, receiver) {
    return Reflect.get(ensureAuth(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(ensureAuth(), prop);
  },
  apply(_target, thisArg, args) {
    return Reflect.apply(ensureAuth() as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
});
