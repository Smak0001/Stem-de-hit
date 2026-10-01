import { setSettings } from "@/db/repository";
import { apiError, assertAdmin } from "@/lib/spotify";

type SetupBody = { adminCode?: string; clientId?: string; access_token?: string; refresh_token?: string; expires_in?: number };
export async function POST(request: Request) {
  try {
    const body = await request.json() as SetupBody;
    assertAdmin(body.adminCode);
    if (!body.clientId || !body.access_token || !body.refresh_token) throw new Error("Spotify gaf geen geldige koppeling terug.");
    await setSettings({ spotify_client_id: body.clientId, spotify_access_token: body.access_token, spotify_refresh_token: body.refresh_token, spotify_expires_at: String(Date.now() + Number(body.expires_in || 3600) * 1000) });
    return Response.json({ configured: true });
  } catch (error) {
    return apiError(error, 401);
  }
}
