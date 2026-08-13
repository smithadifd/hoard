import { getHLTBClient } from '@/lib/hltb/client';
import { apiSuccess, apiError, apiValidationError, withAuth } from '@/lib/utils/api';
import { hltbSearchSchema, formatZodError } from '@/lib/validations';

/**
 * POST /api/hltb/search
 * Search HLTB for a game title and return top 5 results.
 */
export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      if (body === null) {
        return apiValidationError('Invalid JSON');
      }
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
  });
}
