import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from './db';

type Auth = ReturnType<typeof betterAuth>;
let _auth: Auth | null = null;

function createAuth(): Auth {
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

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min — avoids DB lookup on most requests
      },
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh once per day
    },

    trustedOrigins: [
      'https://hoard.home',
      'http://localhost:3000',
    ],

    plugins: [
      nextCookies(),
    ],
  });
}

/**
 * Lazy singleton — avoids calling getDb() at module load time,
 * which would fail during `next build` in CI (no data/ directory).
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop, receiver) {
    if (!_auth) _auth = createAuth();
    return Reflect.get(_auth, prop, receiver);
  },
});
