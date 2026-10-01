import { hasPartyAccess, partyAccessDenied } from "@/lib/party-access";
import { getPlaybackSnapshot, mapTrack } from "@/lib/playback";
import { apiError } from "@/lib/spotify";
import { getQueuePlan, planPosition } from "@/lib/party-queue";

export async function GET(request: Request) {
  try {
    if (!await hasPartyAccess(request, new URL(request.url).searchParams.get("adminCode"))) return partyAccessDenied();
    const snapshot = await getPlaybackSnapshot();
    const playback = snapshot.playback;
    const plan = await getQueuePlan();
    const position = planPosition(plan, snapshot);
    return Response.json({
      active: Boolean(playback?.item), isPlaying: Boolean(playback?.is_playing),
      progressMs: Number(playback?.progress_ms || 0),
      item: playback?.item ? mapTrack(playback.item) : undefined,
      queue: snapshot.queue.filter(t => t.uri?.startsWith("spotify:track:")).slice(0, 20).map(mapTrack),
      device: playback?.device || null,
      stale: snapshot.stale, sampledAt: snapshot.sampledAt, error: snapshot.error,
      hasManagedTail: Boolean(plan && position === plan.batchEnd - 1 && plan.uris.length > plan.batchEnd),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 503); }
}
