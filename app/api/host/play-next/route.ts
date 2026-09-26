import { claimTrack, getTopCandidate, getTrack, setTrackStatus } from "@/db/repository";
import { assertHostRequest } from "@/lib/host-auth";
import { apiError, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    await assertHostRequest(request);
    const { itemId, deviceId, immediate = true } = await request.json() as { itemId?: number; deviceId?: string; immediate?: boolean };
    const track = itemId ? await getTrack(Number(itemId)) : await getTopCandidate();
    if (!track || track.status !== "candidate") throw new Error("Er staat geen nummer klaar om af te spelen.");
    if (!(await claimTrack(track.id))) throw new Error("Dit nummer wordt al door een andere actie verwerkt.");
    const params = new URLSearchParams({ uri: track.uri });
    if (deviceId) params.set("device_id", String(deviceId));
    let addedToSpotify = false;
    try {
      await spotifyFetch(`/me/player/queue?${params}`, { method: "POST" });
      addedToSpotify = true;
      await setTrackStatus(track.id, "queued");
      if (immediate) {
        const nextParams = new URLSearchParams();
        if (deviceId) nextParams.set("device_id", String(deviceId));
        await spotifyFetch(`/me/player/next${nextParams.size ? `?${nextParams}` : ""}`, { method: "POST" });
      }
    } catch (error) {
      if (!addedToSpotify) await setTrackStatus(track.id, "candidate");
      throw error;
    }
    return Response.json({ played: immediate, queued: true, itemId: track.id, name: track.name, spotifyId: track.uri.split(":").pop() || "" });
  } catch (error) {
    return apiError(error);
  }
}
