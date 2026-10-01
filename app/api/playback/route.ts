import { hasPartyAccess, partyAccessDenied } from "@/lib/party-access";
import { apiError, spotifyFetch } from "@/lib/spotify";

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

export async function GET(request: Request) {
  try {
    const adminCode = new URL(request.url).searchParams.get("adminCode");
    if (!await hasPartyAccess(request, adminCode)) return partyAccessDenied();
    const [playback, queueData] = await Promise.all([
      spotifyFetch("/me/player?additional_types=track") as Promise<SpotifyPlayback | null>,
      spotifyFetch("/me/player/queue").catch(() => null) as Promise<{ queue?: SpotifyTrack[] } | null>,
    ]);
    const queue = (queueData?.queue || []).filter((track) => track?.uri?.startsWith("spotify:track:")).slice(0, 20).map(mapTrack);
    if (!playback?.item) return Response.json({ active: false, queue }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({
      active: true,
      isPlaying: Boolean(playback.is_playing),
      progressMs: Number(playback.progress_ms || 0),
      item: mapTrack(playback.item),
      queue,
      device: playback.device ? { id: playback.device.id || "", name: playback.device.name || "Spotify", type: playback.device.type || "" } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 503);
  }
}
