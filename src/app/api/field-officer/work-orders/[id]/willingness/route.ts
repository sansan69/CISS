import { getWorkOrderWillingness } from '@/lib/server/duties/willingness';
import { dutyJson, dutyErrorResponse, readJson } from '@/lib/server/duties/requests';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: {
  params: Promise<{
    id: string;
  }>;
}) {
  try {
    return dutyJson(await getWorkOrderWillingness(request, (await params).id));
  }
  catch (e) {
    return dutyErrorResponse(e);
  }
}
