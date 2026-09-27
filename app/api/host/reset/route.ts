import { resetParty } from "@/db/repository";
import { rotatePartyAccess } from "@/lib/party-access";
import { apiError, assertAdmin } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode } = await request.json() as { adminCode?: string };
    assertAdmin(adminCode);
    await resetParty();
    await rotatePartyAccess();
    return Response.json({ reset: true });
  } catch (error) {
    return apiError(error);
  }
}
