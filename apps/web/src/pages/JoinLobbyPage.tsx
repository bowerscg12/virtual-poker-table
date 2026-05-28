import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getLobbyByInvite } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function JoinLobbyPage() {
  const { code } = useParams();
  const [inviteCode, setInviteCode] = useState(code ?? '');
  const [name, setName] = useState('');
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
    if (!user && name.trim()) await loginGuest(name.trim());
    const { lobby } = await getLobbyByInvite(inviteCode.trim().toUpperCase());
    navigate(`/table/${lobby.id}`);
  }

  return (
    <div className="page">
      <form className="card" onSubmit={handleJoin}>
        <h2>Join table</h2>
        {!token && !user && (
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input
          placeholder="Invite code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
        />
        <button type="submit" className="btn primary">
          Join
        </button>
      </form>
    </div>
  );
}
