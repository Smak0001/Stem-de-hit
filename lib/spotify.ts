import { getSetting, setSettings } from "@/db/repository";

export function assertAdmin(code: string | null | undefined) { const expected = process.env.ADMIN_CODE; if (!expected || !code || code !== expected) throw new Error("De beheercode klopt niet."); }
export async function spotifyToken() {
  const [accessToken, refreshToken, clientId, expiresAt] = await Promise.all([getSetting("spotify_access_token"), getSetting("spotify_refresh_token"), getSetting("spotify_client_id"), getSetting("spotify_expires_at")]);
  if (!refreshToken || !clientId) throw new Error("Spotify is nog niet gekoppeld.");
  if (accessToken && Number(expiresAt || 0) > Date.now() + 60_000) return accessToken;
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Spotify moet opnieuw worden gekoppeld.");
  await setSettings({ spotify_access_token: data.access_token, spotify_refresh_token: data.refresh_token || refreshToken, spotify_expires_at: String(Date.now() + (data.expires_in || 3600) * 1000) }); return data.access_token;
}
export async function spotifyFetch(path: string, init?: RequestInit) { const token = await spotifyToken(); const response = await fetch(`https://api.spotify.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) } }); if (response.status === 204) return null; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message || "Spotify gaf een fout terug."); return data; }
export function apiError(error: unknown, status = 400) { return Response.json({ error: error instanceof Error ? error.message : "Er ging iets mis." }, { status }); }
