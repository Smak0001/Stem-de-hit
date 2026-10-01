import { extendDeadline, getSetting, setSettings } from "@/db/repository";
import { decryptSetting, encryptSetting } from "@/lib/secure-settings";

export function assertAdmin(code: string | null | undefined) { const expected = process.env.ADMIN_CODE; if (!expected || !code || code !== expected) throw new Error("De beheercode klopt niet."); }
let tokenRefresh: Promise<string> | null = null;
export class SpotifyError extends Error {
  constructor(message: string, public status = 503, public retryAfter = 5, public reason = "") { super(message); }
}

async function refreshSpotifyToken(refreshToken: string, clientId: string) {
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Spotify moet opnieuw worden gekoppeld.");
  const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([encryptSetting(data.access_token), encryptSetting(data.refresh_token || refreshToken)]);
  await setSettings({ spotify_access_token: encryptedAccessToken, spotify_refresh_token: encryptedRefreshToken, spotify_expires_at: String(Date.now() + (data.expires_in || 3600) * 1000) });
  return data.access_token;
}

export async function spotifyToken(forceRefresh = false) {
  const [storedAccessToken, storedRefreshToken, clientId, expiresAt] = await Promise.all([getSetting("spotify_access_token"), getSetting("spotify_refresh_token"), getSetting("spotify_client_id"), getSetting("spotify_expires_at")]);
  const [accessToken, refreshToken] = await Promise.all([decryptSetting(storedAccessToken), decryptSetting(storedRefreshToken)]);
  if (!refreshToken || !clientId) throw new Error("Spotify is nog niet gekoppeld.");
  if (!forceRefresh && accessToken && Number(expiresAt || 0) > Date.now() + 60_000) return accessToken;
  if (!tokenRefresh) tokenRefresh = refreshSpotifyToken(refreshToken, clientId);
  try { return await tokenRefresh; }
  finally { tokenRefresh = null; }
}

async function spotifyRequest(path: string, init: RequestInit | undefined, token: string) {
  return fetch(`https://api.spotify.com/v1${path}`, { ...init, signal: init?.signal || AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
}

export async function spotifyFetch(path: string, init?: RequestInit) {
  const blockedUntil = Number(await getSetting("spotify_retry_at") || 0);
  if (blockedUntil > Date.now()) throw new SpotifyError("Spotify vraagt even te wachten. De muziek wordt niet aangepast.", 429, Math.ceil((blockedUntil - Date.now()) / 1000));
  let response = await spotifyRequest(path, init, await spotifyToken());
  if (response.status === 401) response = await spotifyRequest(path, init, await spotifyToken(true));
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (response.status === 429) {
    const reason = (data as { error?: { reason?: string } }).error?.reason || "";
    const header = response.headers.get("Retry-After");
    const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : NaN;
    const retryAfter = Number.isFinite(seconds) ? Math.max(1, seconds) : reason === "QUOTA_EXCEEDED" ? 300 : 30;
    await extendDeadline("spotify_retry_at", Date.now() + retryAfter * 1000);
    throw new SpotifyError("Spotify is tijdelijk begrensd. We wachten automatisch; de muziek blijft ongemoeid.", 429, retryAfter, reason);
  }
  if (!response.ok) throw new SpotifyError((data as { error?: { message?: string } }).error?.message || "Spotify gaf een fout terug.", response.status);
  return data;
}
export function apiError(error: unknown, status = 400) { return Response.json({ error: error instanceof Error ? error.message : "Er ging iets mis." }, { status: error instanceof SpotifyError ? error.status : status, headers: { "Cache-Control": "no-store", ...(error instanceof SpotifyError ? { "Retry-After": String(error.retryAfter) } : {}) } }); }
