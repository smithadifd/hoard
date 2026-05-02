import { readFileSync } from 'fs';
import { join } from 'path';

let cachedBuildId: string | null = null;

function readBuildId(): string {
  if (cachedBuildId !== null) return cachedBuildId;
  try {
    cachedBuildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf-8').trim();
  } catch {
    cachedBuildId = process.env.NEXT_BUILD_ID ?? 'dev';
  }
  return cachedBuildId;
}

/**
 * GET /api/version
 * Returns the current build identifier so clients can detect new deploys
 * and prompt a reload. Intentionally unauthenticated — no sensitive data.
 */
export async function GET() {
  return Response.json(
    { buildId: readBuildId() },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
  );
}
