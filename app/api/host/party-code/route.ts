import { getCurrentPartyCode } from "@/lib/party-access";
import { apiError, assertAdmin } from "@/lib/spotify";

export async function GET(request: Request) {
  try {
    assertAdmin(new URL(request.url).searchParams.get("adminCode"));
    return Response.json(await getCurrentPartyCode(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 401);
  }
}
