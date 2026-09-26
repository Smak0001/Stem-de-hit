import { getTopCandidate, getTrack, markQueued } from "@/db/repository";
import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode, itemId, deviceId } = await request.json() as { adminCode?: string; itemId?: number; deviceId?: string };
    assertAdmin(adminCode);
    const track = itemId ? await getTrack(Number(itemId)) : await getTopCandidate();
    if (!track || track.status !== "candidate") throw new Error("Er staat geen nummer klaar om af te spelen.");
    const params = new URLSearchParams();
    if (deviceId) params.set("device_id", String(deviceId));
    const suffix = params.size ? `?${params}` : "";
    await spotifyFetch(`/me/player/play${suffix}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [track.uri], position_ms: 0 }),
    });
    await markQueued(track.id);
    return Response.json({ played: true, itemId: track.id, name: track.name, spotifyId: track.uri.split(":").pop() || "" });
  } catch (error) {
    return apiError(error);
  }
}
