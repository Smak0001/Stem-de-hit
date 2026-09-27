import { createPartyAccessCookie, hasPartyAccess, verifyPartyCode } from "@/lib/party-access";
import { apiError } from "@/lib/spotify";

export async function GET(request: Request) {
  try {
    return Response.json({ authorized: await hasPartyAccess(request) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function POST(request: Request) {
  try {
    const { code } = await request.json() as { code?: string };
    if (!code || !await verifyPartyCode(code)) return Response.json({ error: "Deze code klopt niet of is net verlopen." }, { status: 401 });
    return Response.json({ authorized: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": await createPartyAccessCookie() } });
  } catch (error) {
    return apiError(error);
  }
}
