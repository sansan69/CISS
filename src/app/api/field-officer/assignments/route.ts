import { createGuardAssignment, listGuardAssignments } from '@/lib/server/duties/assignments';
import { dutyJson, dutyErrorResponse, readJson } from '@/lib/server/duties/requests';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    return dutyJson({
      assignments: await listGuardAssignments(request, p.get('from'), p.get('to'))
    });
  }
  catch (e) {
    return dutyErrorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    return dutyJson(await createGuardAssignment(request, await readJson(request)));
  }
  catch (e) {
    return dutyErrorResponse(e);
  }
}
