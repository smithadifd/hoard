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
      'http://192.168.50.88:3001',
    ],

    plugins: [
      nextCookies(),
    ],
  });
}

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
