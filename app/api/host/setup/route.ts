import { saveSpotifyConnection } from "@/lib/spotify-connection";
import { encryptSetting } from "@/lib/secure-settings";
import { apiError, assertAdmin } from "@/lib/spotify";

type SetupBody = { adminCode?: string; clientId?: string; access_token?: string; refresh_token?: string; expires_in?: number; newParty?: boolean };
export async function POST(request: Request) {
  try {
    const body = await request.json() as SetupBody;
    assertAdmin(body.adminCode);
    if (typeof body.clientId !== "string" || !body.clientId.trim() || typeof body.access_token !== "string" || !body.access_token || typeof body.refresh_token !== "string" || !body.refresh_token) throw new Error("Spotify gaf geen geldige koppeling terug.");
    const profileResponse = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${body.access_token}` }, signal: AbortSignal.timeout(8000) });
    if (!profileResponse.ok) throw new Error("Het nieuwe Spotify-account kon niet worden gecontroleerd. De bestaande koppeling blijft behouden.");
    const profile = await profileResponse.json() as { id?: string; display_name?: string };
    if (!profile.id) throw new Error("Spotify gaf geen geldig account terug.");
    const [access, refresh] = await Promise.all([encryptSetting(body.access_token), encryptSetting(body.refresh_token)]);
    const lifetime = Number(body.expires_in);
    await saveSpotifyConnection({ spotify_client_id: body.clientId.trim(), spotify_access_token: access, spotify_refresh_token: refresh, spotify_expires_at: String(Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000) }, body.newParty === true);
    return Response.json({ configured: true, accountName: profile.display_name || profile.id });
  } catch (error) {
    return apiError(error, 401);
  }
}
