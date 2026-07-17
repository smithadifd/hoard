import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Authentication + rate limiting + CSP nonce proxy.
 *
 * - Generates per-request nonce for Content-Security-Policy
 * - Checks for session cookie on all non-public routes
 * - Rate-limits mutating API requests via token bucket
 * - Blocks mutations in demo mode
 */

function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `/api/auth` is DENY-BY-DEFAULT in demo mode: the Better Auth catch-all
 * (`/api/auth/[...all]`) mounts many mutations on one route handler — `sign-up`,
 * `update-user`, `change-password`, `change-email`, `revoke-sessions`, … — so an
 * allow-list of individual blocked paths would silently leak every mutation it
 * doesn't happen to enumerate (and each Better Auth upgrade can add more). Since
 * the demo credentials are public (`src/lib/demo.ts`), we instead REFUSE every
 * mutating `/api/auth` request except the few the demo legitimately needs below.
 * Non-mutating auth calls (GET get-session, etc.) are unaffected.
 */
const DEMO_AUTH_ALLOWED_PREFIXES = [
  '/api/auth/sign-in',  // the demo account has to be able to log in
  '/api/auth/sign-out', // …and log back out
];

function isDemoAllowedAuthPath(pathname: string): boolean {
  return DEMO_AUTH_ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Endpoints blocked in demo mode (method + path prefix).
 *
 * Invariant (see AGENTS.md): every mutation endpoint AND every endpoint that
 * drives an outbound external call must appear here, so a public demo visitor
 * cannot write to the DB or proxy authenticated third-party requests. GET reads
 * are intentionally left open so the demo UI still renders. `proxy.test.ts`
 * reflects over every mutation route export and fails if one isn't covered here.
 * (`/api/auth` is handled separately, deny-by-default — see above.)
 *
 * Matching is method + path-prefix (startsWith), so a namespace prefix like
 * `/api/onboarding` covers all of its sub-routes.
 */
const DEMO_BLOCKED: { method: string; prefix: string }[] = [
  { method: 'POST', prefix: '/api/sync' },
  { method: 'POST', prefix: '/api/steam' },
  // Note: there is no `/api/prices` route — price-history mutation is
  // `POST /api/games/[id]/prices/history`, already covered by `/api/games`.
  { method: 'POST', prefix: '/api/backup' },
  { method: 'PUT', prefix: '/api/settings' },
  { method: 'PATCH', prefix: '/api/settings' },
  { method: 'POST', prefix: '/api/setup' },
  { method: 'POST', prefix: '/api/alerts/test' },
  { method: 'PATCH', prefix: '/api/games' },
  { method: 'POST', prefix: '/api/games' },
  { method: 'POST', prefix: '/api/alerts' },
  { method: 'PATCH', prefix: '/api/alerts' },
  { method: 'DELETE', prefix: '/api/alerts' },
  // Onboarding: validate-steam persists credentials + hits the Steam API,
  // state/drain write onboarding + orchestrator state. Block the whole namespace.
  { method: 'POST', prefix: '/api/onboarding' },
  { method: 'PATCH', prefix: '/api/onboarding' },
  { method: 'DELETE', prefix: '/api/onboarding' },
  // Notifications: markAllRead / dismissAll / per-id PATCH mutate the dataset.
  // GET /api/notifications stays open so the demo bell still renders.
  { method: 'POST', prefix: '/api/notifications' },
  { method: 'DELETE', prefix: '/api/notifications' },
  { method: 'PATCH', prefix: '/api/notifications' },
  // HLTB search drives an outbound HowLongToBeat request.
  { method: 'POST', prefix: '/api/hltb' },
];

// --- Public paths that bypass auth ---
const PUBLIC_PATHS = ['/login', '/setup', '/api/auth', '/api/setup', '/api/health', '/api/version'];

const STATIC_PREFIXES = [
  '/_next',
  '/favicon.ico',
  '/manifest.json',
  '/apple-touch-icon',
  '/sw.js',
  '/serwist',
  '/icons',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
    || STATIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p));
}

// --- Rate limiting (token bucket) ---

type RateLimitTier = { tokensPerMinute: number; burst: number };

/**
 * GET endpoints that trigger an outbound third-party call (Steam store search,
 * ITAD pricing) and so must be rate-limited despite being reads — otherwise a
 * scripted client can hammer the upstream through us for free. Every other GET
 * stays unlimited so the read UI is never throttled. Limits are generous enough
 * for the debounced search box (250ms) and per-page ITAD card (1h-cached), while
 * still bounding abuse. Keep these paths in sync with the RATE_LIMITS tiers below.
 */
const RATE_LIMITED_GET_PATTERNS: RegExp[] = [
  /^\/api\/search(?:$|[/?])/,
  /^\/api\/games\/[^/]+\/itad-overview(?:$|[/?])/,
];

function isRateLimitedGet(pathname: string): boolean {
  return RATE_LIMITED_GET_PATTERNS.some(p => p.test(pathname));
}

const RATE_LIMITS: { pattern: RegExp; tier: RateLimitTier }[] = [
  { pattern: /^\/api\/alerts\/test/, tier: { tokensPerMinute: 3, burst: 3 } },
  { pattern: /^\/api\/sync/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/steam/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/prices/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/backup/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/hltb/, tier: { tokensPerMinute: 5, burst: 5 } },
  // Outbound-triggering GETs (see RATE_LIMITED_GET_PATTERNS) — bounded but roomy.
  { pattern: /^\/api\/search/, tier: { tokensPerMinute: 120, burst: 40 } },
  { pattern: /^\/api\/games\/[^/]+\/itad-overview/, tier: { tokensPerMinute: 60, burst: 30 } },
  { pattern: /^\/api\//, tier: { tokensPerMinute: 100, burst: 100 } },
];

type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const BUCKET_STALE_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > BUCKET_STALE_MS) {
      buckets.delete(key);
    }
  }
}

function getTier(pathname: string): RateLimitTier {
  for (const { pattern, tier } of RATE_LIMITS) {
    if (pattern.test(pathname)) return tier;
  }
  return { tokensPerMinute: 100, burst: 100 };
}

function checkRateLimit(key: string, tier: RateLimitTier): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: tier.burst, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / 60_000) * tier.tokensPerMinute;
  bucket.tokens = Math.min(tier.burst, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfter: 0 };
  }

  const retryAfter = Math.ceil((1 - bucket.tokens) / tier.tokensPerMinute * 60);
  return { allowed: false, retryAfter };
}

function applyRateLimit(request: NextRequest): NextResponse | null {
  cleanup();

  const pathname = request.nextUrl.pathname;

  // Rate-limit all mutating methods, plus the handful of GETs that trigger an
  // outbound third-party call. Every other GET is a cheap DB read — leave it
  // unlimited so browsing the read UI is never throttled.
  if (request.method === 'GET' && !isRateLimitedGet(pathname)) return null;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const routeKey = pathname.split('/').slice(0, 4).join('/');
  const key = `${ip}:${routeKey}`;
  const tier = getTier(pathname);

  const { allowed, retryAfter } = checkRateLimit(key, tier);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  return null;
}

// --- CSP nonce ---

function buildCsp(nonce: string): string {
  // The nonce is REAL, not dead: `nextWithCsp` puts this CSP on the request headers
  // passed to `NextResponse.next({ request })`, and Next.js reads the `nonce-…`
  // from it and stamps that nonce onto its own inline framework/hydration
  // <script> tags automatically. That's how those inline scripts pass this policy
  // with no `'unsafe-inline'`. The app ships no first-party inline scripts, so
  // nothing else needs the nonce.
  //
  // `'unsafe-eval'` is only needed by the dev toolchain (Turbopack/React Refresh
  // eval their HMR payloads). Production bundles never eval, so we drop it there —
  // that's the actual hardening. Dev keeps it so `npm run dev` still works.
  const scriptSrc = process.env.NODE_ENV === 'production'
    ? `script-src 'self' 'nonce-${nonce}'`
    : `script-src 'self' 'unsafe-eval' 'nonce-${nonce}'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://steamcdn-a.akamaihd.net",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
}

function nextWithCsp(request: NextRequest, nonce: string): NextResponse {
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

// --- Main proxy function ---

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Block mutations in demo mode
  if (isDemoMode()) {
    const method = request.method;

    const demoBlocked = NextResponse.json(
      { error: 'This action is disabled in demo mode.' },
      { status: 403 }
    );

    // `/api/auth`: deny-by-default. Refuse every mutating auth request except the
    // explicit allow-list, so future Better Auth mutations can't leak (see
    // DEMO_AUTH_ALLOWED_PREFIXES above).
    if (pathname.startsWith('/api/auth') && MUTATING_METHODS.has(method)) {
      if (!isDemoAllowedAuthPath(pathname)) return demoBlocked;
    }

    for (const rule of DEMO_BLOCKED) {
      if (method === rule.method && pathname.startsWith(rule.prefix)) {
        return demoBlocked;
      }
    }
  }

  // Skip auth + rate limiting for static assets
  if (STATIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Public paths: skip auth but still apply rate limiting to API routes
  if (isPublicPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      const rateLimitResponse = applyRateLimit(request);
      if (rateLimitResponse) return rateLimitResponse;
    }
    return nextWithCsp(request, nonce);
  }

  // Auth check: verify session cookie exists
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    // API routes: return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    // Page routes: redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Rate limiting for authenticated API requests
  if (pathname.startsWith('/api/')) {
    const rateLimitResponse = applyRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  return nextWithCsp(request, nonce);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|svg|webp|woff2?|ttf|eot)$).*)',
  ],
};
