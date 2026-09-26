import { resetParty } from "@/db/repository";
import { assertHostRequest } from "@/lib/host-auth";
import { apiError } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    await assertHostRequest(request);
    await resetParty();
    return Response.json({ reset: true });
  } catch (error) {
    return apiError(error);
  }
}
