import { getTrack, markQueued } from "@/db/repository";
import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode, itemId, deviceId } = await request.json() as { adminCode?: string; itemId?: number; deviceId?: string };
    assertAdmin(adminCode);
    const track = await getTrack(Number(itemId));
    if (!track || track.status !== "candidate") throw new Error("Dit nummer staat niet meer in de stemlijst.");
    const params = new URLSearchParams({ uri: track.uri });
    if (deviceId) params.set("device_id", String(deviceId));
    await spotifyFetch(`/me/player/queue?${params}`, { method: "POST" });
    await markQueued(track.id);
    return Response.json({ queued: true });
  } catch (error) {
    return apiError(error);
  }
}
