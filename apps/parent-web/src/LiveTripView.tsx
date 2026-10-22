import { useEffect, useState } from 'react';
import { api, ApiError, Journey, LatestLocation } from './api';

interface Props {
  token: string;
  journeyId: string;
  onBack: () => void;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? `${error.code}: ${error.message}` : String(error);
  return <div className="error-banner">{message}</div>;
}

const FRESHNESS_LABEL: Record<LatestLocation['freshness'], string> = {
  LIVE: 'Live',
  STALE: 'Last seen a while ago',
  OFFLINE: 'No recent signal',
};

/**
 * Shows the vehicle's live position as a freshness-coded indicator driven by real GPS data
 * from the API, rather than a tile map — see docs/architecture.md's MapProvider note for
 * swapping in a real map later; this works without any external map/network dependency.
 */
export default function LiveTripView({ token, journeyId, onBack }: Props) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [location, setLocation] = useState<LatestLocation | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function refresh() {
    try {
      const [journeyResult, locationResult] = await Promise.all([
        api.getJourney(token, journeyId),
        api.getLatestLocation(token, journeyId),
      ]);
      setJourney(journeyResult);
      setLocation(locationResult);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId]);

  return (
    <div className="parent-app">
      <button onClick={onBack} className="back-link">
        ← Back
      </button>

      <ErrorText error={error} />

      {journey && (
        <section className="panel">
          <h2>{journey.route?.name}</h2>
          <p className="hint">
            Status: <span className={`status-badge status-${journey.status.toLowerCase()}`}>{journey.status}</span>
          </p>

          {location && (
            <div className={`live-indicator live-${location.freshness.toLowerCase()}`}>
              <span className="live-dot" />
              <div>
                <strong>{FRESHNESS_LABEL[location.freshness]}</strong>
                {location.location ? (
                  <div className="hint">
                    {location.location.latitude.toFixed(4)}, {location.location.longitude.toFixed(4)} — updated{' '}
                    {new Date(location.location.recordedAt).toLocaleTimeString()}
                  </div>
                ) : (
                  <div className="hint">No position reported yet.</div>
                )}
              </div>
            </div>
          )}

          <h3>Children on this trip</h3>
          <ul className="event-list">
            {journey.childJourneys?.map((cj) => (
              <li key={cj.id}>
                {cj.child.firstName} {cj.child.lastName} —{' '}
                <span className={`status-badge status-${cj.status.toLowerCase()}`}>{cj.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
