export type LocationFreshness = 'LIVE' | 'STALE' | 'OFFLINE';

/**
 * Classifies how recently a vehicle reported its position. Thresholds are configurable via
 * LOCATION_LIVE_WINDOW_SECONDS / LOCATION_STALE_WINDOW_SECONDS (see configuration.ts) so ops
 * can tune them without a deploy.
 */
export function classifyFreshness(
  recordedAt: Date | null,
  now: Date,
  liveWindowSeconds: number,
  staleWindowSeconds: number,
): LocationFreshness {
  if (!recordedAt) {
    return 'OFFLINE';
  }
  const ageSeconds = (now.getTime() - recordedAt.getTime()) / 1000;
  if (ageSeconds <= liveWindowSeconds) {
    return 'LIVE';
  }
  if (ageSeconds <= staleWindowSeconds) {
    return 'STALE';
  }
  return 'OFFLINE';
}
