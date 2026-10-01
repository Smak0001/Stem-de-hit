import { acquireLease, getSetting, releaseLease, setSettings } from "@/db/repository";
import { getPlaybackSnapshot, invalidatePlayback, type PlaybackSnapshot, type SpotifyTrack } from "@/lib/playback";
import { SpotifyError, spotifyFetch } from "@/lib/spotify";

export const PLAN_KEY = "party_playback_plan_v1";
export type QueuePlan = { uris: string[]; deviceId: string; sourceContext: string | null; commandId: string; fromUri: string; itemId?: number; issuedAt: number; confirmed: boolean; cursor: number; batchEnd: number };
const isTrack = (uri: string | undefined): uri is string => Boolean(uri?.startsWith("spotify:track:"));

export async function withPlayerLock<T>(work: () => Promise<T>): Promise<T> {
  const owner = crypto.randomUUID();
  if (!await acquireLease("lock:party-player", owner, 120_000)) throw new SpotifyError("Een afspeelopdracht wordt al verwerkt. Probeer zo opnieuw.", 409, 2);
  try { return await work(); } finally { await releaseLease("lock:party-player", owner); }
}

export async function getQueuePlan(): Promise<QueuePlan | null> {
  const stored = await getSetting(PLAN_KEY);
  return stored ? JSON.parse(stored) : null;
}

export function planPosition(plan: QueuePlan | null, snapshot: PlaybackSnapshot) {
  if (!plan || plan.deviceId !== snapshot.playback?.device?.id) return -1;
  // A user-selected playlist is an external takeover, not our URI sequence.
  if (snapshot.playback?.context?.uri) return -1;
  return plan.uris.indexOf(snapshot.playback?.item?.uri || "", plan.cursor);
}

async function contextTracks(contextUri: string): Promise<SpotifyTrack[]> {
  const cached = await getSetting("party_source_playlist_v1");
  if (cached) {
    const value = JSON.parse(cached) as { context: string; at: number; tracks: SpotifyTrack[] };
    if (value.context === contextUri && Date.now() - value.at < 60_000) return value.tracks;
  }
  const [, kind, id] = contextUri.split(":");
  if (!id || !["playlist", "album"].includes(kind)) throw new Error("Start een gewone Spotify-afspeellijst of album. Deze afspeelbron kan niet veilig worden overgenomen.");
  const tracks: SpotifyTrack[] = [];
  let offset = 0;
  // A bounded deadline keeps the distributed command lease valid.
  const deadline = Date.now() + 80_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("De volledige afspeellijst laden duurde te lang. Spotify blijft ongewijzigd.");
    const path = kind === "playlist" ? `/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}` : `/albums/${encodeURIComponent(id)}/tracks?limit=50&offset=${offset}`;
    let page: { items?: Array<SpotifyTrack | { item?: SpotifyTrack; track?: SpotifyTrack }>; next?: string | null; total?: number };
    try { page = await spotifyFetch(path) as typeof page; }
    catch (error) {
      if (error instanceof SpotifyError && [401, 403, 404].includes(error.status)) throw new Error("De volledige afspeellijst is niet leesbaar. Koppel Spotify opnieuw voor playlisttoegang, of kies een toegankelijke playlist. Er is niets aan de muziek veranderd.");
      throw error;
    }
    if (!Array.isArray(page?.items)) throw new Error("Spotify gaf geen volledige afspeellijst terug. Er is niets aan de muziek veranderd.");
    for (const entry of page.items) {
      if (!entry || typeof entry !== "object") continue;
      const track = ("item" in entry ? entry.item : "track" in entry ? entry.track : entry) as SpotifyTrack | undefined;
      if (track && isTrack(track.uri) && !track.is_local && track.is_playable !== false) tracks.push({ uri: track.uri });
    }
    offset += page.items.length;
    if (!page.next) break;
    if (!page.items.length || offset > 20_000) throw new Error("De afspeellijst is te groot of onvolledig. Spotify blijft ongewijzigd.");
  }
  await setSettings({ party_source_playlist_v1: JSON.stringify({ context: contextUri, at: Date.now(), tracks }) });
  return tracks;
}

export function mergeContinuation(currentUri: string, visibleUris: string[], playlistUris: string[], includeCurrent: boolean) {
  const currentIndex = playlistUris.indexOf(currentUri);
  // The real queue includes manually queued tracks; keep those in front.
  const lastVisibleIndex = visibleUris.reduce((last, uri) => { const index = playlistUris.indexOf(uri); return index >= 0 ? index : last; }, -1);
  if (playlistUris.length && currentIndex < 0 && lastVisibleIndex < 0) throw new Error("De positie in de oorspronkelijke playlist is niet vast te stellen. Start een nummer uit die playlist voordat je Auto-DJ gebruikt.");
  const remainder = playlistUris.slice((currentIndex >= 0 ? currentIndex : lastVisibleIndex) + 1);
  return [...new Set([...(includeCurrent ? [currentUri] : []), ...visibleUris, ...remainder].filter(uri => isTrack(uri) && (includeCurrent || uri !== currentUri)))];
}

export async function continuation(snapshot: PlaybackSnapshot, plan: QueuePlan | null, includeCurrent = false) {
  const position = planPosition(plan, snapshot);
  if (plan && position >= 0) return { uris: plan.uris.slice(position + (includeCurrent ? 0 : 1)), sourceContext: plan.sourceContext };
  const context = snapshot.playback?.context?.uri || null;
  if (context && snapshot.playback?.shuffle_state) throw new Error("Zet Spotify Shuffle uit voordat Auto-DJ de playlist overneemt; zo kunnen we het volledige vervolg in de juiste volgorde bewaren.");
  const source = context ? await contextTracks(context) : [];
  return { uris: mergeContinuation(snapshot.playback?.item?.uri || "", snapshot.queue.map(t => t.uri || ""), source.map(t => t.uri || ""), includeCurrent), sourceContext: context };
}

export async function requireFreshPlayback() {
  const snapshot = await getPlaybackSnapshot();
  if (snapshot.stale || Date.now() - snapshot.sampledAt > 2500) throw new SpotifyError(snapshot.error || "Geen actuele Spotify-status. De muziek wordt niet aangepast.");
  if (!snapshot.playback?.item || !snapshot.playback.device?.id) throw new SpotifyError("Geen actief Spotify-apparaat. Start Spotify op de laptop; er wordt niets automatisch overgeslagen.", 409);
  return snapshot;
}

export async function startSequence(uris: string[], deviceId: string, sourceContext: string | null, commandId: string, fromUri: string, itemId?: number) {
  const previous = await getSetting(PLAN_KEY);
  const plan: QueuePlan = { uris, deviceId, sourceContext, commandId, fromUri, itemId, issuedAt: Date.now(), confirmed: false, cursor: 0, batchEnd: Math.min(100, uris.length) };
  // Persist the WHOLE continuation before touching Spotify, not just its next page.
  await setSettings({ [PLAN_KEY]: JSON.stringify(plan) });
  try {
    await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uris: uris.slice(0, 100), position_ms: 0 }) });
    plan.confirmed = true;
    await setSettings({ [PLAN_KEY]: JSON.stringify(plan) });
  } catch (error) {
    // A definite rejection is safe to retry after its backoff. A lost response is
    // ambiguous: retain the intent for observation-based reconciliation instead.
    if (error instanceof SpotifyError && error.status >= 400 && error.status < 500) await setSettings({ [PLAN_KEY]: previous || "" });
    throw error;
  } finally { await invalidatePlayback(); }
  return plan;
}
