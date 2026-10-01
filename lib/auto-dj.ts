export type PlaybackObservation = { active: boolean; stale?: boolean; sampledAt?: number; isPlaying?: boolean; progressMs?: number; item?: { uri: string; durationMs: number }; hasManagedTail?: boolean };
export type EndObservation = { uri: string; remaining: number; sampledAt: number; isPlaying: boolean };

// Missing data is never an end-of-track signal. A transition must follow a fresh
// observation near the end, not a tab reopening, manual pause, or network outage.
export function autoDjDecision(playback: PlaybackObservation, previous: EndObservation | null, now: number, hasCandidate: boolean) {
  if (!playback.active || playback.stale || !playback.item || !playback.sampledAt || now - playback.sampledAt > 2500) return { observation: null, afterTrack: null };
  const remaining = playback.item.durationMs - Number(playback.progressMs || 0);
  const observation: EndObservation = { uri: playback.item.uri, remaining, sampledAt: playback.sampledAt, isPlaying: Boolean(playback.isPlaying) };
  if (!hasCandidate && !playback.hasManagedTail) return { observation, afterTrack: null };
  const naturalTransition = previous && previous.uri !== observation.uri && previous.isPlaying && previous.remaining <= 3000 && now - previous.sampledAt <= 5000;
  const atEnd = remaining <= 200 && remaining >= 0 && (playback.isPlaying || Boolean(previous?.isPlaying && previous.uri === observation.uri));
  return { observation, afterTrack: naturalTransition ? previous.uri : atEnd ? observation.uri : null };
}

export function fillPartyQueue<T extends { spotifyId: string }>(candidates: T[], queue: T[], limit = 5) {
  const ids = new Set<string>();
  return [...candidates, ...queue].filter(t => t.spotifyId && !ids.has(t.spotifyId) && Boolean(ids.add(t.spotifyId))).slice(0, limit);
}
