import { useEffect, useState } from 'react';
import AuthScreen from './AuthScreen';
import Dashboard from './Dashboard';
import { api, AuthenticatedUser, AuthTokens } from './api';

const STORAGE_KEY = 'homesafe-admin-session';

interface StoredSession {
  accessToken: string;
  user: AuthenticatedUser;
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setCheckingSession(false);
      return;
    }
    try {
      const stored: StoredSession = JSON.parse(raw);
      // Confirm the token still works rather than trusting stale localStorage.
      api
        .me(stored.accessToken)
        .then((user) => setSession({ accessToken: stored.accessToken, user }))
        .catch(() => localStorage.removeItem(STORAGE_KEY))
        .finally(() => setCheckingSession(false));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setCheckingSession(false);
    }
  }, []);

  function handleAuthenticated(tokens: AuthTokens) {
    const next: StoredSession = { accessToken: tokens.accessToken, user: tokens.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }

  if (checkingSession) {
    return <div className="loading-screen">Loading…</div>;
  }

  return session ? (
    <Dashboard token={session.accessToken} user={session.user} onLogout={handleLogout} />
  ) : (
    <AuthScreen onAuthenticated={handleAuthenticated} />
  );
}
