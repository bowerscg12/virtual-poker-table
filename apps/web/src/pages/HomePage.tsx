import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function HomePage() {
  const { user, loginGuest } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleGuest(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a display name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await loginGuest(trimmed);
    } catch {
      setError('Could not sign in. Is the game server running? Start it with: npm run dev -w @vct/game-server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p>Host home games online — shuffle, deal, and chips handled in-app. Settle up with friends IRL.</p>
      </header>

      {!user ? (
        <form className="panel" onSubmit={handleGuest}>
          <h2>Join as guest</h2>
          <input
            type="text"
            placeholder="Your display name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            maxLength={64}
            autoComplete="nickname"
            disabled={loading}
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      ) : (
        <>
          <p className="welcome">Welcome, {user.displayName}</p>
          <div className="actions">
            <Link className="btn primary" to="/create">
              Create table
            </Link>
            <button className="btn secondary" type="button" onClick={() => navigate('/join/')}>
              Join with code
            </button>
          </div>
        </>
      )}

      <footer className="disclaimer">
        Entertainment only. Play-money chips — no real-money wagering in this app.
      </footer>
    </div>
  );
}
