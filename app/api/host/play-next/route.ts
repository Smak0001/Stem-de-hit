import { getTopCandidate, getTrack, markQueued } from "@/db/repository";
import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode, itemId, deviceId, immediate = true, recover = false } = await request.json() as { adminCode?: string; itemId?: number; deviceId?: string; immediate?: boolean; recover?: boolean };
    assertAdmin(adminCode);
    const track = itemId ? await getTrack(Number(itemId)) : await getTopCandidate();
    if (!track || (track.status !== "candidate" && !(recover && track.status === "queued"))) throw new Error("Er staat geen nummer klaar om af te spelen.");
    if (recover) {
      const playParams = new URLSearchParams();
      if (deviceId) playParams.set("device_id", String(deviceId));
      await spotifyFetch(`/me/player/play${playParams.size ? `?${playParams}` : ""}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uris: [track.uri] }) });
    } else {
      const params = new URLSearchParams({ uri: track.uri });
      if (deviceId) params.set("device_id", String(deviceId));
      await spotifyFetch(`/me/player/queue?${params}`, { method: "POST" });
    }
    if (immediate && !recover) {
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
