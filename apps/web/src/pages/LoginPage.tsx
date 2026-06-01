import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type Mode = 'signin' | 'register' | 'guest';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { user, loginAccount, registerAccount, loginGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from ?? '/';

  // Already authenticated — skip the login page
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        await loginAccount(email.trim(), password);
      } else if (mode === 'register') {
        await registerAccount(displayName.trim(), email.trim(), password);
      } else {
        await loginGuest(displayName.trim());
      }
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading &&
    (mode === 'signin'
      ? email.trim().length > 0 && password.length > 0
      : mode === 'register'
      ? displayName.trim().length > 0 && email.trim().length > 0 && password.length > 0
      : displayName.trim().length > 0);

  return (
    <div className="page home">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p>Host home games online — shuffle, deal, and chips handled in-app. Settle up with friends IRL.</p>
      </header>

      <div className="panel login-panel">
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab${mode === 'signin' ? ' active' : ''}`}
            onClick={() => switchMode('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`login-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Create Account
          </button>
          <button
            type="button"
            className={`login-tab${mode === 'guest' ? ' active' : ''}`}
            onClick={() => switchMode('guest')}
          >
            Guest
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {(mode === 'register' || mode === 'guest') && (
            <label>
              Display name
              <input
                type="text"
                placeholder="Your name at the table"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value.slice(0, 10)); setError(null); }}
                maxLength={10}
                autoComplete="nickname"
                autoFocus
                disabled={loading}
              />
              <span className="field-hint">Max 10 characters — visible to other players.</span>
            </label>
          )}

          {(mode === 'signin' || mode === 'register') && (
            <label>
              Email
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                autoComplete={mode === 'register' ? 'email' : 'username'}
                autoFocus={mode === 'signin'}
                disabled={loading}
              />
            </label>
          )}

          {(mode === 'signin' || mode === 'register') && (
            <label>
              Password
              <input
                type="password"
                placeholder={mode === 'register' ? 'Min 6 characters' : 'Password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                disabled={loading}
              />
            </label>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {loading
              ? 'Please wait…'
              : mode === 'signin'
              ? 'Sign In'
              : mode === 'register'
              ? 'Create Account'
              : 'Continue as Guest'}
          </button>
        </form>
      </div>

      <footer className="disclaimer">
        Entertainment only. Play-money chips — no real-money wagering in this app.
      </footer>
    </div>
  );
}
