import { getGuardDuties } from '@/lib/server/duties/guard-feed';
import { dutyJson, dutyErrorResponse, readJson } from '@/lib/server/duties/requests';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    return dutyJson({
      duties: await getGuardDuties(request)
    });
  }
  catch (e) {
    return dutyErrorResponse(e);
  }
}
