import { resetParty } from "@/db/repository";
import { apiError, assertAdmin } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode } = await request.json() as { adminCode?: string };
    assertAdmin(adminCode);
    await resetParty();
    return Response.json({ reset: true });
  } catch (error) {
    return apiError(error);
  }
}
