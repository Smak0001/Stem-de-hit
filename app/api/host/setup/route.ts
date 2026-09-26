import { setSettings } from "@/db/repository";
import { assertHostRequest } from "@/lib/host-auth";
import { encryptSetting } from "@/lib/secure-settings";
import { apiError } from "@/lib/spotify";

type SetupBody = { clientId?: string; access_token?: string; refresh_token?: string; expires_in?: number };
export async function POST(request: Request) {
  try {
    await assertHostRequest(request);
    const body = await request.json() as SetupBody;
    if (!body.clientId || !body.access_token || !body.refresh_token) throw new Error("Spotify gaf geen geldige koppeling terug.");
    const [accessToken, refreshToken] = await Promise.all([encryptSetting(body.access_token), encryptSetting(body.refresh_token)]);
    await setSettings({ spotify_client_id: body.clientId, spotify_access_token: accessToken, spotify_refresh_token: refreshToken, spotify_expires_at: String(Date.now() + Number(body.expires_in || 3600) * 1000) });
    return Response.json({ configured: true });
  } catch (error) {
    return apiError(error, 401);
  }
}
