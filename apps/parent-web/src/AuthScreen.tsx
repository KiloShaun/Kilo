import { useState } from 'react';
import { api, ApiError, AuthTokens } from './api';

type Tab = 'login' | 'register';

interface Props {
  onAuthenticated: (tokens: AuthTokens) => void;
}

export default function AuthScreen({ onAuthenticated }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  async function run(action: () => Promise<AuthTokens>) {
    setBusy(true);
    setError(null);
    try {
      const tokens = await action();
      onAuthenticated(tokens);
    } catch (err) {
      setError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : 'Something went wrong. Is the API running?',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <h1>HomeSafe</h1>
      <p className="subtitle">Connects to the real API — nothing here is mocked.</p>

      <div className="tabs">
        <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
          Log in
        </button>
        <button className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}>
          Create account
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab === 'login' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.login({ email, password }));
          }}
        >
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      )}

      {tab === 'register' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.register({ email, password, firstName, lastName }));
          }}
        >
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password (min 10 characters)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
            />
          </label>
          <label>
            First name
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>
          <label>
            Last name
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}
    </div>
  );
}
