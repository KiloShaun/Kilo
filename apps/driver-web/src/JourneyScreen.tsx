import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError, AuthenticatedUser, Journey } from './api';

interface Props {
  token: string;
  user: AuthenticatedUser;
  onLogout: () => void;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? `${error.code}: ${error.message}` : String(error);
  return <div className="error-banner">{message}</div>;
}

const CHILD_ACTIONS: Record<string, { label: string; action: 'pickup' | 'dropoff' } | null> = {
  NOT_YET_BOARDED: { label: 'Pick up', action: 'pickup' },
  PICKED_UP: { label: 'Pick up', action: 'pickup' },
  ON_VEHICLE: { label: 'Drop off', action: 'dropoff' },
  ARRIVED_AT_SCHOOL: { label: 'Drop off', action: 'dropoff' },
  DROPPED_OFF: null,
  MISSED_PICKUP: null,
};

export default function JourneyScreen({ token, user, onLogout }: Props) {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selected, setSelected] = useState<Journey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [delayReason, setDelayReason] = useState('');
  const [sosSent, setSosSent] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const gpsIntervalRef = useRef<number | null>(null);

  async function refreshList() {
    try {
      const result = await api.listMyJourneys(token);
      const today = new Date().toISOString().slice(0, 10);
      setJourneys(result.data.filter((j) => j.scheduledDate?.slice(0, 10) === today));
    } catch (err) {
      setError(err);
    }
  }

  async function openJourney(id: string) {
    try {
      setSelected(await api.getJourney(token, id));
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sends the driver's live position to the API every 10s while the route is in progress.
  useEffect(() => {
    if (gpsIntervalRef.current) {
      window.clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
    if (!selected || selected.status !== 'DRIVER_STARTED' || !navigator.geolocation) {
      return;
    }

    const sendOnce = () => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          setGpsStatus('sending');
          try {
            await api.reportLocation(token, {
              journeyId: selected.id,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              speedKph:
                typeof position.coords.speed === 'number' ? position.coords.speed * 3.6 : undefined,
              accuracyMeters: position.coords.accuracy ?? undefined,
            });
            setGpsStatus('idle');
          } catch {
            setGpsStatus('error');
          }
        },
        () => setGpsStatus('error'),
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    };

    sendOnce();
    gpsIntervalRef.current = window.setInterval(sendOnce, 10_000);
    return () => {
      if (gpsIntervalRef.current) window.clearInterval(gpsIntervalRef.current);
    };
  }, [selected?.id, selected?.status, token]);

  async function handleStart() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.startJourney(token, selected.id);
      await openJourney(selected.id);
      await refreshList();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.endJourney(token, selected.id);
      await openJourney(selected.id);
      await refreshList();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelay(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    try {
      await api.reportDelay(token, selected.id, delayReason);
      setDelayReason('');
    } catch (err) {
      setError(err);
    }
  }

  async function handleChildAction(childId: string, action: 'pickup' | 'dropoff') {
    if (!selected) return;
    setError(null);
    try {
      await api.verifyChild(token, selected.id, childId, action, 'MANUAL');
      await openJourney(selected.id);
    } catch (err) {
      setError(err);
    }
  }

  async function handleSos() {
    if (!selected) return;
    if (!confirm('Trigger an SOS? This notifies the operator and every parent of a child currently on board.')) {
      return;
    }
    setError(null);
    try {
      await api.triggerSos(token, { journeyId: selected.id, note: 'Driver-initiated emergency' });
      setSosSent(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="driver-app">
      <header>
        <div>
          <strong>
            {user.firstName} {user.lastName}
          </strong>
          <span className="role-badge">DRIVER</span>
        </div>
        <button onClick={onLogout}>Log out</button>
      </header>

      <ErrorText error={error} />

      {!selected && (
        <section className="panel">
          <h2>Today's routes</h2>
          {journeys.length === 0 ? (
            <p className="hint">No journeys scheduled for you today.</p>
          ) : (
            <ul className="event-list">
              {journeys.map((j) => (
                <li key={j.id}>
                  <strong>{j.route?.name}</strong> — {j.direction === 'TO_SCHOOL' ? 'To school' : 'From school'} —{' '}
                  <span className={`status-badge status-${j.status.toLowerCase()}`}>{j.status}</span>
                  <button onClick={() => openJourney(j.id)} style={{ marginLeft: 10 }}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selected && (
        <section className="panel">
          <button onClick={() => setSelected(null)} className="back-link">
            ← Back to today's routes
          </button>
          <h2>{selected.route?.name}</h2>
          <p className="hint">
            Vehicle {selected.vehicle?.registrationNumber} — status{' '}
            <span className={`status-badge status-${selected.status.toLowerCase()}`}>{selected.status}</span>
            {selected.status === 'DRIVER_STARTED' && (
              <span className="hint"> — GPS: {gpsStatus === 'sending' ? 'sending…' : gpsStatus === 'error' ? 'error' : 'live'}</span>
            )}
          </p>

          <div className="action-row">
            {selected.status === 'SCHEDULED' && (
              <button onClick={handleStart} disabled={busy}>
                Start route
              </button>
            )}
            {selected.status === 'DRIVER_STARTED' && (
              <button onClick={handleEnd} disabled={busy}>
                End route
              </button>
            )}
            <button className="sos-button" onClick={handleSos} disabled={sosSent}>
              {sosSent ? 'SOS sent' : 'SOS'}
            </button>
          </div>

          {selected.status === 'DRIVER_STARTED' && (
            <form onSubmit={handleDelay} className="inline-form">
              <input
                placeholder="Report a delay (reason)"
                value={delayReason}
                onChange={(e) => setDelayReason(e.target.value)}
              />
              <button type="submit" disabled={!delayReason}>
                Report delay
              </button>
            </form>
          )}

          <h3>Passengers</h3>
          <ul className="event-list">
            {selected.childJourneys?.map((cj) => {
              const actionDef = CHILD_ACTIONS[cj.status];
              return (
                <li key={cj.id}>
                  {cj.child.firstName} {cj.child.lastName} —{' '}
                  <span className={`status-badge status-${cj.status.toLowerCase()}`}>{cj.status}</span>
                  {actionDef && (
                    <button onClick={() => handleChildAction(cj.childId, actionDef.action)} style={{ marginLeft: 10 }}>
                      {actionDef.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
