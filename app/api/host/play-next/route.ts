import { getTopCandidate, getTrack, markQueued } from "@/db/repository";
import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode, itemId, deviceId, immediate = true } = await request.json() as { adminCode?: string; itemId?: number; deviceId?: string; immediate?: boolean };
    assertAdmin(adminCode);
    const track = itemId ? await getTrack(Number(itemId)) : await getTopCandidate();
    if (!track || track.status !== "candidate") throw new Error("Er staat geen nummer klaar om af te spelen.");
    const params = new URLSearchParams({ uri: track.uri });
    if (deviceId) params.set("device_id", String(deviceId));
    await spotifyFetch(`/me/player/queue?${params}`, { method: "POST" });
    if (immediate) {
      const nextParams = new URLSearchParams();
      if (deviceId) nextParams.set("device_id", String(deviceId));
      await spotifyFetch(`/me/player/next${nextParams.size ? `?${nextParams}` : ""}`, { method: "POST" });
    }
    await markQueued(track.id);
    return Response.json({ played: immediate, queued: true, itemId: track.id, name: track.name, spotifyId: track.uri.split(":").pop() || "" });
  } catch (error) {
    return apiError(error);
  }
}
