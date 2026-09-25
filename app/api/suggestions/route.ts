import { addSuggestion } from "@/db/repository";
import { apiError } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { track, voterId } = await request.json() as { track?: { spotifyId?: string; uri?: string; name?: string; artist?: string; album?: string; imageUrl?: string | null; durationMs?: number }; voterId?: string };
    if (!track?.spotifyId || !track?.uri || !track?.name || !voterId || track.uri !== `spotify:track:${track.spotifyId}`) throw new Error("Ongeldig verzoek.");
    const id = await addSuggestion({ spotifyId: String(track.spotifyId), uri: String(track.uri), name: String(track.name).slice(0, 200), artist: String(track.artist || "Onbekende artiest").slice(0, 200), album: String(track.album || "").slice(0, 200), imageUrl: track.imageUrl ? String(track.imageUrl) : null, durationMs: Number(track.durationMs || 0) }, String(voterId).slice(0, 100));
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
