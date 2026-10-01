export type PlaybackStatus = { stale?: boolean; refreshing?: boolean; sampledAt?: number; error?: string };

export function playbackWarning(status: PlaybackStatus, now = Date.now()) {
  if (!status.stale) return "";
  if (status.error) return status.error;
  // Only a recent, previously successful sample may refresh without an alarm.
  if (status.refreshing && status.sampledAt && now - status.sampledAt <= 5000) return "";
  return "De Spotify-status is vertraagd. Het laatst bekende nummer blijft zichtbaar; Auto-DJ wacht op actuele informatie.";
}
