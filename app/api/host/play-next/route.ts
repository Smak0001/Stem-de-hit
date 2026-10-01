import { getTopCandidate, getTrack, markQueued, setSettings } from "@/db/repository";
import { continuation, getQueuePlan, PLAN_KEY, planPosition, requireFreshPlayback, startSequence, withPlayerLock } from "@/lib/party-queue";
import { apiError, assertAdmin, SpotifyError } from "@/lib/spotify";

export async function POST(request: Request) {
  try {
    const { adminCode, itemId, deviceId, immediate = true, recover = false, automatic = false, prepare = false, afterTrack, commandId } = await request.json() as { adminCode?: string; itemId?: number; deviceId?: string; immediate?: boolean; recover?: boolean; automatic?: boolean; prepare?: boolean; afterTrack?: string; commandId?: string };
    assertAdmin(adminCode);
    if (!immediate || recover) throw new SpotifyError("Ververs deze hostpagina: de oude Auto-DJ-versie wordt niet meer gebruikt.", 409);
    return await withPlayerLock(async () => {
      const snapshot = await requireFreshPlayback();
      const playback = snapshot.playback!;
      const currentUri = playback.item!.uri!;
      if (deviceId && playback.device!.id !== deviceId) throw new SpotifyError("Het geselecteerde apparaat speelt niet. Selecteer het actieve Spotify-apparaat.", 409);
      const plan = await getQueuePlan();
      if (prepare) { await continuation(snapshot, plan); return Response.json({ prepared: true }); }
      if (plan && !plan.confirmed && currentUri === plan.uris[0] && playback.device!.id === plan.deviceId) {
        plan.confirmed = true;
        await setSettings({ [PLAN_KEY]: JSON.stringify(plan) });
        if (plan.itemId) await markQueued(plan.itemId);
      }
      if (automatic && plan && plan.fromUri === afterTrack && Date.now() - plan.issuedAt < 15_000) return Response.json({ played: false, unchanged: true });
      // Duplicate network deliveries and multiple host tabs cannot repeat a command.
      if (commandId && plan?.commandId === commandId) {
        if (plan.confirmed || currentUri === plan.uris[0]) return Response.json({ played: false, unchanged: true });
        throw new SpotifyError("Spotify heeft de vorige opdracht nog niet bevestigd. Controleer de laptop voordat je opnieuw start.", 409);
      }
      if (plan && !plan.confirmed && currentUri !== plan.uris[0]) throw new SpotifyError("De vorige afspeelopdracht is onzeker. Start de oorspronkelijke playlist opnieuw op Spotify en begin een nieuwe sessie.", 409);
      if (plan && snapshot.sampledAt <= plan.issuedAt) throw new SpotifyError("We wachten op bevestiging van de vorige afspeelopdracht.", 409, 1);
      // Do not advance on silence, stale data, an ordinary pause, or an early poll.
      const remaining = Number(playback.item!.duration_ms || 0) - Number(playback.progress_ms || 0);
      const justChanged = Boolean(afterTrack && currentUri !== afterTrack && Number(playback.progress_ms || 0) < 5000);
      if (automatic && (!afterTrack || (!justChanged && (currentUri !== afterTrack || remaining > 200)))) return Response.json({ played: false, waiting: true });
      const track = itemId ? await getTrack(Number(itemId)) : await getTopCandidate();
      if (itemId && (!track || track.status !== "candidate")) return Response.json({ played: false, unchanged: true });
      if (track?.uri === currentUri) {
        await markQueued(track.id);
        return Response.json({ played: false, unchanged: true, itemId: track.id, name: track.name });
      }
      const position = planPosition(plan, snapshot);
      const hasTail = Boolean(plan && position === plan.batchEnd - 1 && plan.uris.length > plan.batchEnd);
      if (!track && (!hasTail || playback.is_playing || remaining > 200)) return Response.json({ played: false, unchanged: true });
      const rest = await continuation(snapshot, plan, automatic && justChanged);
      // Large source reads must not turn an old observation into a blind command.
      const verified = await requireFreshPlayback();
      if (verified.playback?.item?.uri !== currentUri || verified.playback?.device?.id !== playback.device!.id) return Response.json({ played: false, waiting: true });
      const uris = track ? [track.uri, ...rest.uris.filter(uri => uri !== track!.uri)] : rest.uris;
      if (!uris.length) return Response.json({ played: false, unchanged: true });
      await startSequence(uris, playback.device!.id!, rest.sourceContext, commandId || crypto.randomUUID(), afterTrack || currentUri, track?.id);
      if (track) await markQueued(track.id);
      return Response.json({ played: true, itemId: track?.id, name: track?.name || "Het vervolg van de afspeellijst", spotifyId: uris[0].split(":").pop(), strategy: "managed-sequence" });
    });
  } catch (error) { return apiError(error); }
}
