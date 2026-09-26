import { apiError, spotifyFetch } from "@/lib/spotify";

type SpotifyPlayback = {
  is_playing?: boolean;
  progress_ms?: number;
  device?: { id?: string; name?: string; type?: string };
  item?: {
    id?: string;
    uri?: string;
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: { name?: string; images?: Array<{ url?: string }> };
  };
};

export async function GET() {
  try {
    const playback = await spotifyFetch("/me/player?additional_types=track") as SpotifyPlayback | null;
    if (!playback?.item) return Response.json({ active: false });
    return Response.json({
      active: true,
      isPlaying: Boolean(playback.is_playing),
      progressMs: Number(playback.progress_ms || 0),
      item: {
        spotifyId: playback.item.id || "",
        uri: playback.item.uri || "",
        name: playback.item.name || "Onbekend nummer",
        artist: playback.item.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Onbekende artiest",
        album: playback.item.album?.name || "",
        imageUrl: playback.item.album?.images?.[0]?.url || null,
        durationMs: Number(playback.item.duration_ms || 0),
      },
      device: playback.device ? { id: playback.device.id || "", name: playback.device.name || "Spotify", type: playback.device.type || "" } : null,
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
