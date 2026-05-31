export const meta = {
  name: 'hoard-audit-sweep',
  description: 'Hoard-tuned full-codebase audit — wraps the toolkit audit-sweep with Hoard-specific lens hints and writes audit state to the project memory dir',
  phases: [
    { title: 'Scan', detail: 'toolkit audit-sweep, Hoard-tuned' },
    { title: 'Write Plans', detail: 'one writer per lens' },
    { title: 'Track', detail: 'plans/README.md + memory/audit-state.md' },
  ],
}

// Thin wrapper over the shared toolkit auditor. The generic script is the single
// source of truth for the lens checklists and orchestration; this only injects
// Hoard-specific "where to look" hints and the project's audit-state path.
// Override-able via args (e.g. args.lenses to restrict the run).
const A = args || {}

const HOARD_HINTS = {
  security: `src/app/api/** (every route guards with requireUserId/requireUserIdFromRequest unless intentionally public; bodies parsed with Zod .safeParse). src/proxy.ts — verify EVERY mutation route is in DEMO_BLOCKED (recent gap: onboarding + notification mutations). src/lib/auth*, src/lib/config.ts (secret handling), src/lib/validations.ts. Check GET /api/settings doesn't echo secret values.`,
  'testing-gaps': `Known 0-coverage suspects: src/lib/auth*, src/lib/hltb/**, src/lib/itad/**, the onboarding drain orchestrator, most src/app/api/** handlers, all src/components/** and src/hooks/**. Prioritize scoring/sync/dispatch/queries edge cases over UI.`,
  maintainability: `Large files like src/lib/db/queries.ts (~3.7k lines) — cohesive or dumping ground? Business logic leaking into components or UI logic into API routes.`,
  performance: `src/lib/db/** (N+1, missing indexes — cross-check schema.ts), src/components/** (useMemo, stable keys), API over-fetching.`,
  dependencies: `Read package.json + package-lock.json only. Unused deps, major drift, runtime-vs-dev misplacement.`,
  'error-handling': `src/app/api/** try/catch returning ApiResponse shape; src/lib/sync/** per-item isolation; steam/itad/hltb/discord client timeouts.`,
  accessibility: `src/components/** and src/app/**/page.tsx — accessible names, labels, alt, focus traps, touch targets.`,
  consistency: `ApiResponse<T> shape across routes; 'import type' usage; class concat via TEMPLATE LITERALS (no cn()/classnames — project convention); naming.`,
  'correctness-bugs': `src/lib/scoring/{engine,valueReceived}.ts (null/divide-by-zero/tier boundaries), src/lib/sync/** + drain orchestrator (per-item failure, dedup, ordering), src/lib/notifications/dispatch.ts (quiet hours crossing midnight, category matrix, once-per-snapshot dedup), src/lib/onboarding/** (state transitions), currency/ATL handling (BASE_CURRENCY filter on BOTH current and lowest, new-ATL throttle).`,
  'docs-accuracy': `Verify AGENTS.md (repo map, table names in schema.ts, DEMO_BLOCKED description vs proxy.ts, env vars vs config.ts), docs/src/content/docs/** pages, and changelog.md. Flag undocumented features (notifications dispatcher, onboarding drain, value-received internals, API routes).`,
}

return await workflow(
  { scriptPath: '/Users/andrew/claude-toolkit/workflows/audit-sweep.js' },
  {
    repoRoot: '/Users/andrew/hoard',
    plansDir: '/Users/andrew/hoard/plans',
    auditStatePath: '/Users/andrew/.claude/projects/-Users-andrew-hoard/memory/audit-state.md',
    lensHints: HOARD_HINTS,
    ...A,
  }
)
