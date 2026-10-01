import { acquireLease, getSetting, releaseLease, setSettings } from "@/db/repository";
import { SpotifyError, spotifyFetch } from "@/lib/spotify";

export type SpotifyTrack = { id?: string; uri?: string; name?: string; duration_ms?: number; is_local?: boolean; is_playable?: boolean; artists?: Array<{ name?: string }>; album?: { name?: string; images?: Array<{ url?: string }> } };
export type SpotifyPlayback = { is_playing?: boolean; progress_ms?: number; timestamp?: number; shuffle_state?: boolean; context?: { uri?: string } | null; device?: { id?: string; name?: string; type?: string }; item?: SpotifyTrack };
export type PlaybackSnapshot = { playback: SpotifyPlayback | null; queue: SpotifyTrack[]; sampledAt: number; retryAt: number; stale: boolean; refreshing?: boolean; error?: string };
const KEY = "spotify_playback_cache_v2";
let pending: Promise<PlaybackSnapshot> | null = null;

export function mapTrack(track: SpotifyTrack) {
  return { spotifyId: track.id || "", uri: track.uri || "", name: track.name || "Onbekend nummer", artist: track.artists?.map(a => a.name).filter(Boolean).join(", ") || "Onbekende artiest", album: track.album?.name || "", imageUrl: track.album?.images?.[0]?.url || null, durationMs: Number(track.duration_ms || 0) };
}

async function loadSnapshot(): Promise<PlaybackSnapshot> {
  const saved = await getSetting(KEY);
  const cached: PlaybackSnapshot | null = saved ? JSON.parse(saved) : null;
  if (cached && cached.retryAt > Date.now()) return cached;
  const owner = crypto.randomUUID();
  if (!await acquireLease("lock:playback-cache", owner, 25_000)) {
    if (cached) return { ...cached, stale: true, refreshing: !cached.error && Date.now() - cached.sampledAt <= 5000 };
    throw new SpotifyError("Spotify-status wordt opgehaald. Even geduld.", 503, 1);
  }
  try {
    const latest = await getSetting(KEY);
    const snapshot: PlaybackSnapshot | null = latest ? JSON.parse(latest) : cached;
    if (snapshot && snapshot.retryAt > Date.now()) return snapshot;
    try {
      const sampledAt = Date.now();
      const [playback, queue] = await Promise.all([
        spotifyFetch("/me/player?additional_types=track") as Promise<SpotifyPlayback | null>,
        spotifyFetch("/me/player/queue") as Promise<{ queue?: SpotifyTrack[] } | null>,
      ]);
      if (!queue || !Array.isArray(queue.queue)) throw new Error("Spotify gaf geen geldige wachtrij terug.");
      const now = Date.now();
      const value: PlaybackSnapshot = { playback, queue: queue.queue, sampledAt, retryAt: now + 1000, stale: false };
      await setSettings({ [KEY]: JSON.stringify(value) });
      return value;
    } catch (error) {
      const now = Date.now();
      const value: PlaybackSnapshot = { playback: snapshot?.playback || null, queue: snapshot?.queue || [], sampledAt: snapshot?.sampledAt || 0, stale: true, retryAt: now + (error instanceof SpotifyError ? error.retryAfter * 1000 : 5000), error: error instanceof Error ? error.message : "Spotify is tijdelijk niet bereikbaar." };
      await setSettings({ [KEY]: JSON.stringify(value) });
      return value;
    }
  } finally { await releaseLease("lock:playback-cache", owner); }
}

export async function getPlaybackSnapshot() {
  if (!pending) pending = loadSnapshot().finally(() => { pending = null; });
  return pending;
}

export async function invalidatePlayback() {
  const saved = await getSetting(KEY);
  if (saved) await setSettings({ [KEY]: JSON.stringify({ ...JSON.parse(saved), stale: true, retryAt: 0 }) });
}
