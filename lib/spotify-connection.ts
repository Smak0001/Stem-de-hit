import { env } from "cloudflare:workers";

function database() {
  if (!env.DB) throw new Error("De Spotify-instellingen zijn tijdelijk niet beschikbaar.");
  return env.DB;
}

// Commit credentials and an optional new party together: a failed batch preserves both.
export async function saveSpotifyConnection(values: Record<string, string>, newParty: boolean) {
  const db = database();
  const settings = { ...values, spotify_connection_id: crypto.randomUUID(), party_playback_plan_v1: "", party_source_playlist_v1: "", spotify_playback_cache_v2: "", spotify_retry_at: "0", ...(newParty ? { party_access_seed: crypto.randomUUID() } : {}) };
  await db.batch([
    ...Object.entries(settings).map(([key, value]) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, value, Date.now())),
    ...(newParty ? [db.prepare("DELETE FROM votes"), db.prepare("DELETE FROM suggestions"), db.prepare("DELETE FROM reactions")] : []),
  ]);
}

// A refresh started for the old account must never overwrite the new connection.
export async function saveRefreshedSpotifyTokens(values: Record<string, string>, connectionId: string) {
  const db = database();
  const result = await db.batch(Object.entries(values).map(([key, value]) => db.prepare("INSERT INTO settings (key, value, updated_at) SELECT ?, ?, ? WHERE COALESCE((SELECT value FROM settings WHERE key = 'spotify_connection_id'), '') = ? ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, value, Date.now(), connectionId)));
  if (result.some(row => row.meta.changes !== 1)) throw new Error("Het Spotify-account is gewijzigd. Ververs de pagina.");
}
