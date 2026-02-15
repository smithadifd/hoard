import { z } from 'zod';
import { getHLTBClient } from '@/lib/hltb/client';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import { formatZodError } from '@/lib/validations';

const hltbSearchSchema = z.object({
  query: z.string().min(1).max(200),
});

/**
 * POST /api/hltb/search
 * Search HLTB for a game title and return top 5 results.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await request.json();
    const parsed = hltbSearchSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    const client = getHLTBClient();
    console.log(`[HLTB Search] Querying for "${parsed.data.query}"...`);
    const results = await client.searchAll(parsed.data.query, 5);
    console.log(`[HLTB Search] Got ${results.length} results for "${parsed.data.query}"`);

    return apiSuccess({ results });
  } catch (error) {
    console.error('[POST /api/hltb/search]', error);
    return apiError('HLTB search failed');
  }
}
