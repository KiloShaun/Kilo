import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  AuthenticatedUser,
  Driver,
  EmergencyIncident,
  Journey,
  NotificationItem,
  Route,
  School,
  Vehicle,
} from './api';

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? `${error.code}: ${error.message}` : String(error);
  return <div className="error-banner">{message}</div>;
}

export function FleetPanel({ token }: { token: string }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [capacity, setCapacity] = useState('16');
  const [vehicleType, setVehicleType] = useState('MINIBUS');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const result = await api.listVehicles(token);
      setVehicles(result.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createVehicle(token, {
        registrationNumber,
        capacity: Number(capacity),
        vehicleType,
      });
      setRegistrationNumber('');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Fleet</h2>
      <ErrorText error={error} />
      {vehicles.length === 0 ? (
        <p className="hint">No vehicles yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Registration</th>
              <th>Type</th>
              <th>Capacity</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td className="mono">{v.registrationNumber}</td>
                <td>{v.vehicleType}</td>
                <td>{v.capacity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={handleCreate} className="inline-form">
        <input
          placeholder="Registration number"
          value={registrationNumber}
          onChange={(e) => setRegistrationNumber(e.target.value)}
          required
        />
        <input
          type="number"
          min={1}
          placeholder="Capacity"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          required
        />
        <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
          <option value="MINIBUS">Minibus</option>
          <option value="SEDAN">Sedan</option>
          <option value="BUS">Bus</option>
          <option value="VAN">Van</option>
        </select>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Add vehicle'}
        </button>
      </form>
    </section>
  );
}

export function RoutesPanel({ token, schools }: { token: string; schools: School[] }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [stopName, setStopName] = useState('');
  const [latitude, setLatitude] = useState('-26.2041');
  const [longitude, setLongitude] = useState('28.0473');
  const [busy, setBusy] = useState(false);

  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [assignDriverId, setAssignDriverId] = useState('');
  const [assignVehicleId, setAssignVehicleId] = useState('');
  const [assignChildId, setAssignChildId] = useState('');

  async function refresh() {
    try {
      const [routesResult, driversResult, vehiclesResult] = await Promise.all([
        api.listRoutes(token),
        api.listDrivers(token),
        api.listVehicles(token),
      ]);
      setRoutes(routesResult.data);
      setDrivers(driversResult.data);
      setVehicles(vehiclesResult.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createRoute(token, {
        name,
        schoolId,
        stops: stopName
          ? [{ sequence: 1, name: stopName, latitude: Number(latitude), longitude: Number(longitude) }]
          : undefined,
      });
      setName('');
      setStopName('');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.assignRoute(token, selectedRouteId, { driverId: assignDriverId, vehicleId: assignVehicleId });
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function handleAssignChild(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.assignChildToRoute(token, selectedRouteId, { childId: assignChildId });
      setAssignChildId('');
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Routes</h2>
        <button type="button" className="refresh-button" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
      <ErrorText error={error} />
      {routes.length === 0 ? (
        <p className="hint">No routes yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Stops</th>
              <th>Current assignment</th>
              <th>Children</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.name}</td>
                <td>{r.stops.length}</td>
                <td>
                  {r.assignments?.[0]
                    ? `${r.assignments[0].driver.user.firstName} / ${r.assignments[0].vehicle.registrationNumber}`
                    : 'Unassigned'}
                </td>
                <td>{r.childAssignments?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Create a route</h3>
      <form onSubmit={handleCreate} className="stacked-form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          School
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required>
            <option value="">Select a school…</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          First stop name (optional)
          <input value={stopName} onChange={(e) => setStopName(e.target.value)} />
        </label>
        {stopName && (
          <>
            <label>
              Latitude
              <input value={latitude} onChange={(e) => setLatitude(e.target.value)} />
            </label>
            <label>
              Longitude
              <input value={longitude} onChange={(e) => setLongitude(e.target.value)} />
            </label>
          </>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create route'}
        </button>
      </form>

      <h3>Assign driver/vehicle, or enrol a child</h3>
      <div className="stacked-form">
        <label>
          Route
          <select value={selectedRouteId} onChange={(e) => setSelectedRouteId(e.target.value)}>
            <option value="">Select a route…</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form onSubmit={handleAssign} className="inline-form">
        <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)} required>
          <option value="">Driver…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.user.firstName} {d.user.lastName}
            </option>
          ))}
        </select>
        <select value={assignVehicleId} onChange={(e) => setAssignVehicleId(e.target.value)} required>
          <option value="">Vehicle…</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registrationNumber}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!selectedRouteId}>
          Assign to route
        </button>
      </form>
      <form onSubmit={handleAssignChild} className="inline-form">
        <input
          placeholder="Child ID"
          value={assignChildId}
          onChange={(e) => setAssignChildId(e.target.value)}
          required
        />
        <button type="submit" disabled={!selectedRouteId}>
          Enrol child on route
        </button>
      </form>
    </section>
  );
}

export function JourneysPanel({ token, user }: { token: string; user: AuthenticatedUser }) {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [routeId, setRouteId] = useState('');
  const [direction, setDirection] = useState<'TO_SCHOOL' | 'FROM_SCHOOL'>('TO_SCHOOL');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Journey | null>(null);

  const canCreate = user.role === 'SUPER_ADMIN' || user.role === 'TRANSPORT_OPERATOR' || user.role === 'SCHOOL_ADMIN';

  async function refresh() {
    try {
      const [journeysResult, routesResult] = await Promise.all([api.listJourneys(token), api.listRoutes(token)]);
      setJourneys(journeysResult.data);
      setRoutes(routesResult.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.createJourney(token, { routeId, direction, scheduledDate: today });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    try {
      setSelected(await api.getJourney(token, id));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Journeys (live ops)</h2>
        <button type="button" className="refresh-button" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
      <ErrorText error={error} />
      {journeys.length === 0 ? (
        <p className="hint">No journeys yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {journeys.map((j) => (
              <tr key={j.id}>
                <td>{j.route?.name}</td>
                <td>{j.scheduledDate?.slice(0, 10)}</td>
                <td>
                  <span className={`status-badge status-${j.status.toLowerCase()}`}>{j.status}</span>
                </td>
                <td>
                  <button onClick={() => openDetail(j.id)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canCreate && (
        <form onSubmit={handleCreate} className="inline-form">
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)} required>
            <option value="">Route…</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'TO_SCHOOL' | 'FROM_SCHOOL')}>
            <option value="TO_SCHOOL">To school</option>
            <option value="FROM_SCHOOL">From school</option>
          </select>
          <button type="submit" disabled={busy}>
            {busy ? 'Scheduling…' : "Schedule today's journey"}
          </button>
        </form>
      )}

      {selected && (
        <div className="invite-result">
          <strong>
            {selected.route?.name} — {selected.status}
          </strong>
          <ul className="event-list">
            {selected.childJourneys?.map((cj) => (
              <li key={cj.id}>
                {cj.child.firstName} {cj.child.lastName}: {cj.status}
              </li>
            ))}
          </ul>
          <ul className="event-list">
            {selected.events?.map((ev) => (
              <li key={ev.id} className="mono">
                {ev.eventType} @ {new Date(ev.occurredAt).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function NotificationsPanel({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  async function refresh() {
    try {
      const result = await api.listNotifications(token);
      setNotifications(result.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="panel">
      <h2>Notifications</h2>
      <ErrorText error={error} />
      {notifications.length === 0 ? (
        <p className="hint">No notifications yet.</p>
      ) : (
        <ul className="event-list">
          {notifications.map((n) => (
            <li key={n.id}>
              <strong>{n.title}</strong> — {n.body}{' '}
              <span className="hint">({new Date(n.createdAt).toLocaleString()})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EmergencyPanel({ token }: { token: string }) {
  const [incidents, setIncidents] = useState<EmergencyIncident[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [journeyId, setJourneyId] = useState('');
  const [note, setNote] = useState('');

  async function refresh() {
    try {
      const [incidentsResult, journeysResult] = await Promise.all([
        api.listIncidents(token),
        api.listJourneys(token),
      ]);
      setIncidents(incidentsResult.data);
      setJourneys(journeysResult.data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTrigger(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.triggerSos(token, { journeyId, note: note || undefined });
      setNote('');
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function handleAcknowledge(id: string) {
    try {
      await api.acknowledgeIncident(token, id);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  async function handleResolve(id: string) {
    try {
      await api.resolveIncident(token, id);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Emergency / SOS</h2>
        <button type="button" className="refresh-button" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
      <ErrorText error={error} />
      {incidents.length === 0 ? (
        <p className="hint">No incidents — all clear.</p>
      ) : (
        <ul className="event-list">
          {incidents.map((incident) => (
            <li key={incident.id} className={`incident incident-${incident.status.toLowerCase()}`}>
              <strong>{incident.status}</strong> — {incident.journey?.route?.name ?? 'Unknown route'} —{' '}
              {incident.affectedChildIds.length} child(ren) onboard
              {incident.note ? ` — "${incident.note}"` : ''}
              {incident.status !== 'RESOLVED' && (
                <span className="incident-actions">
                  {incident.status === 'TRIGGERED' && (
                    <button onClick={() => handleAcknowledge(incident.id)}>Acknowledge</button>
                  )}
                  <button onClick={() => handleResolve(incident.id)}>Resolve</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Trigger a test SOS (ops only)</h3>
      <form onSubmit={handleTrigger} className="inline-form">
        <select value={journeyId} onChange={(e) => setJourneyId(e.target.value)} required>
          <option value="">Journey…</option>
          {journeys.map((j) => (
            <option key={j.id} value={j.id}>
              {j.route?.name} ({j.status})
            </option>
          ))}
        </select>
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" disabled={!journeyId}>
          Trigger SOS
        </button>
      </form>
    </section>
  );
}
