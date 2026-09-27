import { getTopCandidate, getTrack, markQueued } from "@/db/repository";
import { apiError, assertAdmin, spotifyFetch } from "@/lib/spotify";

type SpotifyQueueItem = { uri?: string };

type QueueSnapshot = {
  futureUris: string[];
};

function playerPath(deviceId?: string) {
  const params = new URLSearchParams();
  if (deviceId) params.set("device_id", String(deviceId));
  return `/me/player/play${params.size ? `?${params}` : ""}`;
}

async function readQueueSnapshot(): Promise<QueueSnapshot> {
  const queue = await spotifyFetch("/me/player/queue").catch(() => null) as { queue?: SpotifyQueueItem[] } | null;
  return {
    futureUris: (queue?.queue || []).map((item) => item.uri || "").filter((uri) => uri.startsWith("spotify:track:")),
  };
}

async function playWithoutLaterDuplicate(trackUri: string, deviceId: string | undefined, snapshot: QueueSnapshot) {
  const remainingUris = snapshot.futureUris.filter((uri) => uri !== trackUri);
  await spotifyFetch(playerPath(deviceId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [trackUri, ...remainingUris].slice(0, 100), position_ms: 0 }),
  });
  return "sequence";
}

export async function POST(request: Request) {
  try {
    const { adminCode, itemId, deviceId, immediate = true, recover = false } = await request.json() as { adminCode?: string; itemId?: number; deviceId?: string; immediate?: boolean; recover?: boolean };
    assertAdmin(adminCode);
    const track = itemId ? await getTrack(Number(itemId)) : await getTopCandidate();
    if (!track || (track.status !== "candidate" && !(recover && track.status === "queued"))) throw new Error("Er staat geen nummer klaar om af te spelen.");
    const snapshot = await readQueueSnapshot();
    const queuedOccurrences = snapshot.futureUris.filter((uri) => uri === track.uri).length;
    const isAlreadyNext = snapshot.futureUris[0] === track.uri;
    let normalizeOnStart = false;
    let strategy = "queue";

    if (recover || (immediate && queuedOccurrences > 0)) {
      strategy = await playWithoutLaterDuplicate(track.uri, deviceId, snapshot);
    } else if (!isAlreadyNext) {
      const params = new URLSearchParams({ uri: track.uri });
      if (deviceId) params.set("device_id", String(deviceId));
      await spotifyFetch(`/me/player/queue?${params}`, { method: "POST" });
    }
    if (immediate && !recover && queuedOccurrences === 0) {
      const nextParams = new URLSearchParams();
      if (deviceId) nextParams.set("device_id", String(deviceId));
      await spotifyFetch(`/me/player/next${nextParams.size ? `?${nextParams}` : ""}`, { method: "POST" });
    }
    if (!immediate && !recover) {
      normalizeOnStart = queuedOccurrences > (isAlreadyNext ? 1 : 0);
    }
    await markQueued(track.id);
    return Response.json({ played: immediate, queued: true, itemId: track.id, name: track.name, spotifyId: track.uri.split(":").pop() || "", normalizeOnStart, strategy });
  } catch (error) {
    return apiError(error);
  }
}
