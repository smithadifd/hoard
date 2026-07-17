import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';
import { NextRequest } from 'next/server';

// The proxy calls getSessionCookie on non-public routes. Default: authenticated,
// so we can exercise the rate-limit + CSP paths. Individual tests override it.
vi.mock('better-auth/cookies', () => ({
  getSessionCookie: vi.fn(() => 'session-token'),
}));

import { proxy } from './proxy';
import { getSessionCookie } from 'better-auth/cookies';

const mockSessionCookie = vi.mocked(getSessionCookie);

function makeRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`), { method, headers });
}

beforeEach(() => {
  mockSessionCookie.mockReturnValue('session-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// DEMO_BLOCKED reflection test — the anti-regression centerpiece.
//
// Discover every API route file at test time, statically detect which mutation
// methods (POST/PUT/PATCH/DELETE) it exports, and assert the proxy 403s each one
// in demo mode. A newly-added mutation route that isn't added to DEMO_BLOCKED
// makes this fail automatically (it returns 401/redirect, not 403), so a write
// endpoint can never silently leak into the public demo.
// ---------------------------------------------------------------------------

const API_DIR = join(process.cwd(), 'src', 'app', 'api');
const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

function exportedMutationMethods(source: string): string[] {
  const found: string[] = [];
  for (const m of MUTATION_METHODS) {
    const patterns = [
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`), // export function POST(
      new RegExp(`export\\s+const\\s+${m}\\b`),                   // export const POST =
      new RegExp(`export\\s+const\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`), // export const { GET, POST } =
    ];
    if (patterns.some(p => p.test(source))) found.push(m);
  }
  return found;
}

interface RouteCase {
  file: string;
  method: string;
  path: string;
  note: string;
}

function discoverMutationRoutes(): RouteCase[] {
  const cases: RouteCase[] = [];
  const entries = readdirSync(API_DIR, { recursive: true, encoding: 'utf8' });
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry.endsWith('route.ts')) continue;
    const file = join(API_DIR, entry);
    const methods = exportedMutationMethods(readFileSync(file, 'utf8'));
    if (methods.length === 0) continue;

    const dir = entry.replace(/[/\\]?route\.ts$/, '');
    let routePath = '/api' + (dir ? '/' + dir.split(sep).join('/') : '');
    const isCatchAll = /\[\.\.\.[^\]]+\]/.test(routePath);
    // Substitute dynamic segments with concrete samples.
    routePath = routePath
      .replace(/\[\.\.\.[^\]]+\]/g, '__CATCHALL__')
      .replace(/\[[^\]]+\]/g, '1');

    const authCatchAll = isCatchAll && routePath.startsWith('/api/auth');
    for (const method of methods) {
      if (authCatchAll) {
        // The only mutation surface of the Better Auth catch-all that MUST be
        // demo-blocked is signup — sign-in/out stay open (see the dedicated
        // negative-control test below).
        cases.push({ file, method, path: '/api/auth/sign-up/email', note: 'auth signup' });
      } else if (routePath.includes('__CATCHALL__')) {
        cases.push({ file, method, path: routePath.replace(/__CATCHALL__/g, 'x'), note: 'catch-all' });
      } else {
        cases.push({ file, method, path: routePath, note: '' });
      }
    }
  }
  return cases;
}

const mutationRoutes = discoverMutationRoutes();

describe('DEMO_BLOCKED reflection — every mutation route export is blocked in demo mode', () => {
  it('discovers the mutation routes under src/app/api', () => {
    // Sanity floor so a broken discovery (finding nothing) can't vacuously pass.
    expect(mutationRoutes.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of mutationRoutes) {
    const rel = c.file.slice(API_DIR.length + 1);
    it(`${c.method} ${c.path} → 403 in demo mode [${rel}${c.note ? ' · ' + c.note : ''}]`, () => {
      vi.stubEnv('DEMO_MODE', 'true');
      const res = proxy(makeRequest(c.method, c.path));
      expect(res.status).toBe(403);
    });
  }
});

describe('demo mode — auth signup vs sign-in', () => {
  it('blocks POST /api/auth/sign-up/email', () => {
    vi.stubEnv('DEMO_MODE', 'true');
    expect(proxy(makeRequest('POST', '/api/auth/sign-up/email')).status).toBe(403);
  });

  it('does NOT block POST /api/auth/sign-in/email (demo account must log in)', () => {
    vi.stubEnv('DEMO_MODE', 'true');
    expect(proxy(makeRequest('POST', '/api/auth/sign-in/email')).status).not.toBe(403);
  });

  it('leaves GET reads open so the demo UI renders', () => {
    vi.stubEnv('DEMO_MODE', 'true');
    // /api/notifications GET is a read the demo bell needs.
    expect(proxy(makeRequest('GET', '/api/notifications')).status).not.toBe(403);
  });
});

describe('demo mode off — mutations are NOT demo-blocked', () => {
  it('an unauthenticated mutation returns 401 (auth), not 403 (demo)', () => {
    vi.stubEnv('DEMO_MODE', 'false');
    mockSessionCookie.mockReturnValue(null);
    const res = proxy(makeRequest('POST', '/api/games/1'));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — the two outbound-triggering GETs are limited; other GETs are not.
// ---------------------------------------------------------------------------

function floodGet(path: string, count: number, ip: string): number[] {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) {
    statuses.push(proxy(makeRequest('GET', path, { 'x-forwarded-for': ip })).status);
  }
  return statuses;
}

describe('rate limiting — outbound-triggering GETs', () => {
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', 'false');
    mockSessionCookie.mockReturnValue('session-token');
  });

  it('rate-limits GET /api/search (429 once the burst is spent)', () => {
    const statuses = floodGet('/api/search?q=hades', 45, '10.0.0.1');
    expect(statuses[0]).not.toBe(429);          // early requests allowed
    expect(statuses).toContain(429);             // burst eventually spent
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('rate-limits GET /api/games/:id/itad-overview', () => {
    const statuses = floodGet('/api/games/42/itad-overview', 40, '10.0.0.2');
    expect(statuses[0]).not.toBe(429);
    expect(statuses).toContain(429);
  });

  it('does NOT rate-limit ordinary read GETs (e.g. /api/games list)', () => {
    const statuses = floodGet('/api/games', 200, '10.0.0.3');
    expect(statuses).not.toContain(429);
  });

  it('returns a Retry-After header on the 429', () => {
    const responses: Response[] = [];
    for (let i = 0; i < 45; i++) {
      responses.push(proxy(makeRequest('GET', '/api/search?q=x', { 'x-forwarded-for': '10.0.0.4' })));
    }
    const limited = responses.find(r => r.status === 429);
    expect(limited).toBeTruthy();
    expect(limited!.headers.get('Retry-After')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CSP — nonce is real; unsafe-eval only in development.
// ---------------------------------------------------------------------------

function cspFor(nodeEnv: string): string {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('DEMO_MODE', 'false');
  const res = proxy(makeRequest('GET', '/api/health'));
  return res.headers.get('Content-Security-Policy') ?? '';
}

describe('CSP header', () => {
  it('always carries a per-request nonce in script-src', () => {
    const csp = cspFor('production');
    expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
  });

  it("drops 'unsafe-eval' in production", () => {
    expect(cspFor('production')).not.toContain("'unsafe-eval'");
  });

  it("keeps 'unsafe-eval' in development (Turbopack/HMR needs it)", () => {
    expect(cspFor('development')).toContain("'unsafe-eval'");
  });

  it('locks down object-src / frame-src / base-uri', () => {
    const csp = cspFor('production');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
