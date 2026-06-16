import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { enterLobby, getLobbyByInvite } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * One-click spectator entry. Resolves an invite code, enters the table as a
 * read-only watcher (no seat taken), then lands on the table in spectate mode.
 * Works for both registered users and brand-new guests.
 */
export default function WatchLobbyPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, loading, setAuthDirect } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // Wait for auth to settle so a logged-in user watches as themselves
    // rather than being entered as an anonymous guest.
    if (!code || loading || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const { lobby } = await getLobbyByInvite(code.toUpperCase());
        const name = user?.displayName ?? 'Spectator';
        const res = await enterLobby(lobby.id, name, undefined, { spectate: true });
        setAuthDirect(res.user, res.token, res.sessionId);
        navigate(`/table/${lobby.id}?spectate=1`, { replace: true });
      } catch {
        setError('Table not found. Check the link and try again.');
      }
    })();
  }, [code, user, loading, setAuthDirect, navigate]);

  return (
    <div className="page home">
      <header className="hero">
        <h1>{error ? 'Cannot watch table' : 'Joining as spectator…'}</h1>
        <p>{error ?? 'Connecting you to the table in read-only mode.'}</p>
      </header>
      {error && (
        <div className="panel">
          <div className="name-selection-actions">
            <button type="button" className="btn primary" onClick={() => navigate('/')}>
              Back to home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
