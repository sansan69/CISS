import { setDutyWillingness } from '@/lib/server/duties/willingness';
import { dutyJson, dutyErrorResponse, readJson } from '@/lib/server/duties/requests';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: {
  params: Promise<{
    id: string;
  }>;
}) {
  try {
    const { id } = await params;
    return dutyJson(await setDutyWillingness(request, id, await readJson(request)));
  }
  catch (e) {
    return dutyErrorResponse(e);
  }
}
