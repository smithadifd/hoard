import { NextRequest, NextResponse } from 'next/server';

/**
 * Rate limiting proxy using in-memory token bucket algorithm.
 * Single-user app on trusted LAN — no need for Redis/distributed state.
 */

type RateLimitTier = { tokensPerMinute: number; burst: number };

const RATE_LIMITS: { pattern: RegExp; tier: RateLimitTier }[] = [
  { pattern: /^\/api\/alerts\/test/, tier: { tokensPerMinute: 3, burst: 3 } },
  { pattern: /^\/api\/sync/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/steam/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/prices/, tier: { tokensPerMinute: 5, burst: 5 } },
  { pattern: /^\/api\/backup/, tier: { tokensPerMinute: 5, burst: 5 } },
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

  // Refill tokens based on elapsed time
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

export function proxy(request: NextRequest) {
  cleanup();

  // Only rate-limit mutating methods — GET requests are read-only DB queries
  if (request.method === 'GET') {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  // Group by first 4 path segments (e.g., /api/alerts/test stays distinct from /api/alerts/123)
  const routeKey = pathname.split('/').slice(0, 4).join('/');
  const key = `${ip}:${routeKey}`;
  const tier = getTier(pathname);

  const { allowed, retryAfter } = checkRateLimit(key, tier);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
