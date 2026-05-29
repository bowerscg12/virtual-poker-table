import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getLobbyByInvite } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function JoinLobbyPage() {
  const { code } = useParams();
  const [inviteCode, setInviteCode] = useState(code ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { user, loginGuest, token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (code && code.length >= 4) {
      getLobbyByInvite(code)
        .then((r) => navigate(`/table/${r.lobby.id}`, { replace: true }))
        .catch(() => {});
    }
  }, [code, navigate]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!user && name.trim()) await loginGuest(name.trim());
    } catch {
      setError('Display names must be 10 characters or fewer.');
      return;
    }
    const { lobby } = await getLobbyByInvite(inviteCode.trim().toUpperCase());
    navigate(`/table/${lobby.id}`);
  }

  return (
    <div className="page">
      <form className="panel" onSubmit={handleJoin}>
        <h2>Join table</h2>
        {!token && !user && (
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 10))}
            maxLength={10}
          />
        )}
        <input
          placeholder="Invite code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn primary">
          Join
        </button>
      </form>
    </div>
  );
}
