import { useEffect, useState } from 'react';
import { api, ApiError, AuthenticatedUser, Child, Journey, NotificationItem } from './api';
import LiveTripView from './LiveTripView';

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

export default function ParentHome({ token, user, onLogout }: Props) {
  const [children, setChildren] = useState<Child[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function refresh() {
    try {
      const [childrenResult, journeysResult, notificationsResult] = await Promise.all([
        api.myChildren(token),
        api.listMyJourneys(token),
        api.listNotifications(token),
      ]);
      setChildren(childrenResult);
      const today = new Date().toISOString().slice(0, 10);
      setJourneys(journeysResult.data.filter((j) => j.scheduledDate?.slice(0, 10) === today));
      setNotifications(notificationsResult.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (selectedJourney) {
    return (
      <LiveTripView token={token} journeyId={selectedJourney} onBack={() => setSelectedJourney(null)} />
    );
  }

  return (
    <div className="parent-app">
      <header>
        <div>
          <strong>
            {user.firstName} {user.lastName}
          </strong>
          <span className="role-badge">PARENT</span>
        </div>
        <button onClick={onLogout}>Log out</button>
      </header>

      <ErrorText error={error} />

      <section className="panel">
        <h2>My children</h2>
        {children.length === 0 ? (
          <p className="hint">No children enrolled yet. Ask your school to enrol them.</p>
        ) : (
          <ul className="event-list">
            {children.map((c) => (
              <li key={c.id}>
                {c.firstName} {c.lastName}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Today's trips</h2>
        {journeys.length === 0 ? (
          <p className="hint">No trips scheduled for today.</p>
        ) : (
          <ul className="event-list">
            {journeys.map((j) => (
              <li key={j.id}>
                <div>
                  <strong>{j.route?.name}</strong> — {j.direction === 'TO_SCHOOL' ? 'To school' : 'From school'} —{' '}
                  <span className={`status-badge status-${j.status.toLowerCase()}`}>{j.status}</span>
                </div>
                <button onClick={() => setSelectedJourney(j.id)}>View live trip</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Notifications</h2>
        {notifications.length === 0 ? (
          <p className="hint">No notifications yet.</p>
        ) : (
          <ul className="event-list">
            {notifications.map((n) => (
              <li key={n.id}>
                <div>
                  <strong>{n.title}</strong>
                  <div className="hint">{n.body}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
