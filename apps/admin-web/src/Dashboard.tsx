import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, AuthenticatedUser, Child, InvitedAccountResult, School } from './api';
import { EmergencyPanel, FleetPanel, JourneysPanel, NotificationsPanel, RoutesPanel } from './OperationsPanels';

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

function SchoolsPanel({ token, canCreate, onSchoolCreated }: { token: string; canCreate: boolean; onSchoolCreated: (s: School) => void }) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listSchools(token);
      setSchools(result.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
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
      const school = await api.createSchool(token, { name, address });
      setName('');
      setAddress('');
      onSchoolCreated(school);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Schools</h2>
      <ErrorText error={error} />
      {loading ? (
        <p>Loading…</p>
      ) : schools.length === 0 ? (
        <p className="hint">No schools yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.address}</td>
                <td className="mono">{s.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canCreate && (
        <form onSubmit={handleCreate} className="inline-form">
          <input placeholder="School name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create school'}
          </button>
        </form>
      )}
    </section>
  );
}

function ProvisionPanel({ token, role, schools }: { token: string; role: string; schools: School[] }) {
  const [kind, setKind] = useState<'driver' | 'transport-operator' | 'school-admin'>('driver');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<InvitedAccountResult | null>(null);

  const canCreateOperator = role === 'SUPER_ADMIN';
  const canCreateDriverOrSchoolAdmin = role === 'SUPER_ADMIN' || role === 'TRANSPORT_OPERATOR';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let created: InvitedAccountResult;
      if (kind === 'driver') {
        created = await api.createDriver(token, { email, firstName, lastName, licenseNumber });
      } else if (kind === 'transport-operator') {
        created = await api.createTransportOperator(token, { email, firstName, lastName });
      } else {
        created = await api.createSchoolAdmin(token, { email, firstName, lastName, schoolId });
      }
      setResult(created);
      setEmail('');
      setFirstName('');
      setLastName('');
      setLicenseNumber('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Provision staff</h2>
      <p className="hint">
        Creates an account with no usable password yet — the invite token below must be relayed to the person, who
        redeems it under "Accept invite" on the login screen.
      </p>
      <ErrorText error={error} />

      <div className="tabs small">
        <button className={kind === 'driver' ? 'active' : ''} onClick={() => setKind('driver')}>
          Driver
        </button>
        <button
          className={kind === 'transport-operator' ? 'active' : ''}
          onClick={() => setKind('transport-operator')}
          disabled={!canCreateOperator}
          title={canCreateOperator ? undefined : 'Only SUPER_ADMIN can provision transport operators'}
        >
          Transport operator
        </button>
        <button className={kind === 'school-admin' ? 'active' : ''} onClick={() => setKind('school-admin')}>
          School admin
        </button>
      </div>

      <form onSubmit={handleSubmit} className="stacked-form">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          First name
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label>
          Last name
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </label>
        {kind === 'driver' && (
          <label>
            License number
            <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} required />
          </label>
        )}
        {kind === 'school-admin' && (
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
        )}
        <button
          type="submit"
          disabled={
            busy ||
            (kind === 'transport-operator' && !canCreateOperator) ||
            (kind !== 'transport-operator' && !canCreateDriverOrSchoolAdmin)
          }
        >
          {busy ? 'Creating…' : `Create ${kind.replace('-', ' ')}`}
        </button>
      </form>

      {result && (
        <div className="invite-result">
          <strong>Account created.</strong> Relay this one-time invite token to {result.firstName} {result.lastName}
          :
          <code className="mono invite-token">{result.inviteToken}</code>
        </div>
      )}
    </section>
  );
}

function ChildrenPanel({ token, schools }: { token: string; schools: School[] }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [parentId, setParentId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Child | null>(null);

  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<Child | null>(null);
  const [lookupError, setLookupError] = useState<unknown>(null);

  const [parentEmail, setParentEmail] = useState('');
  const [parentLookupError, setParentLookupError] = useState<unknown>(null);
  const [parentLookupBusy, setParentLookupBusy] = useState(false);

  async function handleFindParent(e: FormEvent) {
    e.preventDefault();
    setParentLookupError(null);
    setParentLookupBusy(true);
    try {
      const result = await api.findParentByEmail(token, parentEmail);
      if (result.data.length === 0) {
        setParentLookupError(new Error('No parent account found with that email.'));
      } else {
        setParentId(result.data[0].id);
      }
    } catch (err) {
      setParentLookupError(err);
    } finally {
      setParentLookupBusy(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const child = await api.createChild(token, { firstName, lastName, parentId, schoolId });
      setCreated(child);
      setFirstName('');
      setLastName('');
      setParentId('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setLookupResult(null);
    try {
      setLookupResult(await api.getChild(token, lookupId));
    } catch (err) {
      setLookupError(err);
    }
  }

  return (
    <section className="panel">
      <h2>Children</h2>
      <ErrorText error={error} />
      <form onSubmit={handleCreate} className="stacked-form">
        <label>
          First name
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label>
          Last name
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </label>
        <label>
          Parent ID
          <input
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            placeholder="Find by email below, or paste a Parent UUID"
            required
          />
        </label>
        <ErrorText error={parentLookupError} />
        <div className="inline-form" style={{ marginBottom: 12 }}>
          <input
            type="email"
            placeholder="Parent's account email"
            value={parentEmail}
            onChange={(e) => setParentEmail(e.target.value)}
          />
          <button type="button" onClick={handleFindParent} disabled={parentLookupBusy || !parentEmail}>
            {parentLookupBusy ? 'Finding…' : 'Find parent'}
          </button>
        </div>
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
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create child'}
        </button>
      </form>
      {created && (
        <div className="invite-result">
          Created <strong>{created.firstName} {created.lastName}</strong> — <code className="mono">{created.id}</code>
        </div>
      )}

      <h3>Look up a child by ID</h3>
      <ErrorText error={lookupError} />
      <form onSubmit={handleLookup} className="inline-form">
        <input placeholder="Child ID" value={lookupId} onChange={(e) => setLookupId(e.target.value)} required />
        <button type="submit">Look up</button>
      </form>
      {lookupResult && (
        <div className="invite-result">
          {lookupResult.firstName} {lookupResult.lastName} — school <code className="mono">{lookupResult.schoolId}</code>
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ token, user, onLogout }: Props) {
  const [schools, setSchools] = useState<School[]>([]);

  const canManage = user.role === 'SUPER_ADMIN' || user.role === 'TRANSPORT_OPERATOR';
  const canManageRoutes = canManage || user.role === 'SCHOOL_ADMIN';

  useEffect(() => {
    api
      .listSchools(token)
      .then((result) => setSchools(result.data))
      .catch(() => undefined);
  }, [token]);

  return (
    <div className="dashboard">
      <header>
        <div>
          <strong>
            {user.firstName} {user.lastName}
          </strong>
          <span className="role-badge">{user.role}</span>
        </div>
        <button onClick={onLogout}>Log out</button>
      </header>

      <SchoolsPanel token={token} canCreate={canManage} onSchoolCreated={(s) => setSchools((prev) => [...prev, s])} />

      {canManage && <ProvisionPanel token={token} role={user.role} schools={schools} />}

      {(canManage || user.role === 'SCHOOL_ADMIN') && <ChildrenPanel token={token} schools={schools} />}

      {canManage && <FleetPanel token={token} />}

      {canManageRoutes && <RoutesPanel token={token} schools={schools} />}

      {canManageRoutes && <JourneysPanel token={token} user={user} />}

      {canManage && <EmergencyPanel token={token} />}

      <NotificationsPanel token={token} />
    </div>
  );
}
