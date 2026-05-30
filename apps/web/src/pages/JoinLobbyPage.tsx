import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getLobbyByInvite } from '../api/client';

export default function JoinLobbyPage() {
  const { code } = useParams();
  const [inviteCode, setInviteCode] = useState(code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Auto-resolve a code passed directly in the URL
  useEffect(() => {
    if (code && code.length >= 4) {
      getLobbyByInvite(code)
        .then((r) => navigate(`/lobby/${r.lobby.id}/name`, { replace: true }))
        .catch(() => {});
    }
  }, [code, navigate]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inviteCode.trim().toUpperCase();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      const { lobby } = await getLobbyByInvite(trimmed);
      navigate(`/lobby/${lobby.id}/name`);
    } catch {
      setError('Table not found. Check the invite code and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <form className="panel" onSubmit={handleJoin}>
        <h2>Join table</h2>
        <input
          placeholder="Invite code"
          value={inviteCode}
          onChange={(e) => {
            setInviteCode(e.target.value);
            if (error) setError(null);
          }}
          disabled={loading}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="name-selection-actions">
          <button type="submit" className="btn primary" disabled={loading || !inviteCode.trim()}>
            {loading ? 'Looking up table...' : 'Next'}
          </button>
          <button type="button" className="btn" onClick={() => navigate(-1)} disabled={loading}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
