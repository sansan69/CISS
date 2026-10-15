import { updateGuardAssignment } from '@/lib/server/duties/assignments';
import { dutyJson, dutyErrorResponse, readJson } from '@/lib/server/duties/requests';
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: {
  params: Promise<{
    id: string;
  }>;
}) {
  try {
    return dutyJson(await updateGuardAssignment(request, (await params).id, await readJson(request)));
  }
  catch (e) {
    return dutyErrorResponse(e);
  }
}
