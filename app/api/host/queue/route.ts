import { claimTrack, getTrack, setTrackStatus } from "@/db/repository";
import { assertHostRequest } from "@/lib/host-auth";
import { apiError, spotifyFetch } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    await assertHostRequest(request);
    const { itemId, deviceId } = await request.json() as { itemId?: number; deviceId?: string };
    const track = await getTrack(Number(itemId));
    if (!track || track.status !== "candidate") throw new Error("Dit nummer staat niet meer in de stemlijst.");
    if (!(await claimTrack(track.id))) throw new Error("Dit nummer wordt al door een andere actie verwerkt.");
    const params = new URLSearchParams({ uri: track.uri });
    if (deviceId) params.set("device_id", String(deviceId));
    try {
      await spotifyFetch(`/me/player/queue?${params}`, { method: "POST" });
      await setTrackStatus(track.id, "queued");
    } catch (error) {
      await setTrackStatus(track.id, "candidate");
      throw error;
    }
    return Response.json({ queued: true });
  } catch (error) {
    return apiError(error);
  }
}
