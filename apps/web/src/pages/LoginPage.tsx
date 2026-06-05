import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type Mode = 'signin' | 'register' | 'guest';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
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
    setUsername('');
    setPassword('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        await loginAccount(username.trim(), password);
      } else if (mode === 'register') {
        await registerAccount(displayName.trim(), username.trim(), password);
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
      ? username.trim().length > 0 && password.length > 0
      : mode === 'register'
      ? displayName.trim().length > 0 && username.trim().length >= 3 && password.length >= 6
      : displayName.trim().length > 0);

  return (
    <div className="page home">
      <header className="hero">
        <h1>Home Game</h1>
        <p>Your home game, online.</p>
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
              Username
              <input
                type="text"
                placeholder={mode === 'register' ? 'letters, numbers, underscores' : 'your_username'}
                value={username}
                onChange={(e) => { setUsername(e.target.value.slice(0, 20)); setError(null); }}
                autoComplete="username"
                autoFocus={mode === 'signin'}
                maxLength={20}
                disabled={loading}
              />
              {mode === 'register' && (
                <span className="field-hint">3–20 characters. Letters, numbers, and underscores only.</span>
              )}
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

          {mode === 'register' && (
            <p className="policy-notice">
              By creating an account you agree to our{' '}
              <Link to="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
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
        {' · '}
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}
