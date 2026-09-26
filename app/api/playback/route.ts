import { apiError, spotifyFetch } from "@/lib/spotify";
import { isHostRequest } from "@/lib/host-auth";

type SpotifyTrack = {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string }> };
};

type SpotifyPlayback = {
  is_playing?: boolean;
  progress_ms?: number;
  device?: { id?: string; name?: string; type?: string };
  item?: SpotifyTrack;
};

function mapTrack(track: SpotifyTrack) {
  return { spotifyId: track.id || "", uri: track.uri || "", name: track.name || "Onbekend nummer", artist: track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Onbekende artiest", album: track.album?.name || "", imageUrl: track.album?.images?.[0]?.url || null, durationMs: Number(track.duration_ms || 0) };
}

type PlaybackSnapshot = {
  active: boolean;
  isPlaying?: boolean;
  progressMs?: number;
  item?: ReturnType<typeof mapTrack>;
  queue: ReturnType<typeof mapTrack>[];
  device?: { id: string; name: string; type: string } | null;
};

let cachedSnapshot: { value: PlaybackSnapshot; expiresAt: number } | null = null;
let pendingSnapshot: Promise<PlaybackSnapshot> | null = null;

async function spotifyWithDeadline<T>(path: string, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Spotify reageerde niet op tijd.")); }, timeoutMs);
  });
  try {
    return await Promise.race([spotifyFetch(path, { signal: controller.signal }) as Promise<T>, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadSnapshot() {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.value;
  if (pendingSnapshot) return pendingSnapshot;
  pendingSnapshot = (async () => {
    const [playback, queueData] = await Promise.all([
      spotifyWithDeadline<SpotifyPlayback | null>("/me/player?additional_types=track", 4_000),
      spotifyWithDeadline<{ queue?: SpotifyTrack[] } | null>("/me/player/queue", 1_500).catch(() => null),
    ]);
    const queue = (queueData?.queue || []).filter((track) => track?.uri?.startsWith("spotify:track:")).slice(0, 20).map(mapTrack);
    const value: PlaybackSnapshot = playback?.item ? {
      active: true,
      isPlaying: Boolean(playback.is_playing),
      progressMs: Number(playback.progress_ms || 0),
      item: mapTrack(playback.item),
      queue,
      device: playback.device ? { id: playback.device.id || "", name: playback.device.name || "Spotify", type: playback.device.type || "" } : null,
    } : { active: false, queue };
    cachedSnapshot = { value, expiresAt: Date.now() + 1_200 };
    return value;
  })();
  try { return await pendingSnapshot; }
  finally { pendingSnapshot = null; }
}

export async function GET(request: Request) {
  try {
    const snapshot = await loadSnapshot();
    const isHost = await isHostRequest(request);
    if (!isHost) {
      const publicSnapshot = { ...snapshot };
      delete publicSnapshot.device;
      return Response.json(publicSnapshot, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
    }
    return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
  } catch (error) {
    if (cachedSnapshot) {
      const isHost = await isHostRequest(request);
      const fallback: PlaybackSnapshot & { stale: true } = { ...cachedSnapshot.value, stale: true };
      if (!isHost) delete fallback.device;
      return Response.json(fallback, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Playback-Stale": "1" } });
    }
    return apiError(error, 503);
  }
}
