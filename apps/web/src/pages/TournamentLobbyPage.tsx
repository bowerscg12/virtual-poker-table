import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { PublicTournamentState } from '@vct/shared-types';
import {
  getTournamentById,
  registerForTournament,
  unregisterFromTournament,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getWsUrl } from '../api/client';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function useCountdown(targetIso: string): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    function update() {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) { setLabel('Starting now'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setLabel(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return label;
}

export default function TournamentLobbyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tournament, setTournament] = useState<PublicTournamentState | null>(null);
  const [registrations, setRegistrations] = useState<Array<{ userId: string; displayName: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const countdown = useCountdown(tournament?.scheduledStart ?? new Date(Date.now() + 86400000).toISOString());

  const isRegistered = registrations.some((r) => r.userId === user?.id);
  const isHost = tournament?.hostUserId === user?.id;

  const fetchTournament = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getTournamentById(id);
      setTournament(data.tournament);
      setRegistrations(data.tournament.leaderboard.map((e) => ({
        userId: e.userId,
        displayName: e.displayName,
        status: e.isEliminated ? 'eliminated' : 'registered',
      })));
    } catch {
      setError('Tournament not found.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTournament();
  }, [fetchTournament]);

  // WebSocket for real-time tournament state
  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem('vct_token');
    if (!token) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as { type: string; [key: string]: unknown };
        if (msg.type === 'authenticated') {
          ws.send(JSON.stringify({ type: 'join_tournament', tournamentId: id }));
        } else if (msg.type === 'tournament_state') {
          const t = msg.tournament as PublicTournamentState;
          setTournament(t);
          setRegistrations(t.leaderboard.map((e) => ({
            userId: e.userId,
            displayName: e.displayName,
            status: e.isEliminated ? 'eliminated' : 'registered',
          })));
        } else if (msg.type === 'tournament_started') {
          const { tableLobbyId, seatIndex } = msg as unknown as { tableLobbyId: string; seatIndex: number };
          if (tableLobbyId && seatIndex >= 0) {
            navigate(`/table/${tableLobbyId}`);
          }
        } else if (msg.type === 'tournament_cancelled') {
          navigate('/tournaments');
        } else if (msg.type === 'error') {
          setError((msg as unknown as { message: string }).message);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave_tournament', tournamentId: id }));
      }
      ws.close();
    };
  }, [id, navigate]);

  async function handleRegister() {
    if (!id) return;
    setActionLoading(true);
    setError(null);
    try {
      await registerForTournament(id);
      await fetchTournament();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUnregister() {
    if (!id) return;
    setActionLoading(true);
    setError(null);
    try {
      await unregisterFromTournament(id);
      await fetchTournament();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStart() {
    if (!id) return;
    setActionLoading(true);
    setError(null);
    try {
      // Send via WS for real-time response
      wsRef.current?.send(JSON.stringify({ type: 'host_start_tournament', tournamentId: id }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!id || !confirm('Cancel this tournament? Players will be refunded.')) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected. Please refresh and try again.');
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'host_cancel_tournament', tournamentId: id }));
    // Navigation happens via tournament_cancelled WS broadcast
  }

  if (loading) return <div className="page home"><div className="panel"><p>Loading...</p></div></div>;
  if (!tournament) return <div className="page home"><div className="panel"><p style={{ color: 'var(--error,#f56)' }}>{error ?? 'Tournament not found'}</p></div></div>;

  const totalSlots = tournament.totalPlayers;
  const prizePool = tournament.prizePool > 0 ? tournament.prizePool : Math.floor(tournament.buyIn * totalSlots * 1.5);

  return (
    <div className="page home">
      <header className="hero" style={{ paddingBottom: '1rem', position: 'relative' }}>
        <h1>{tournament.variant === 'holdem' ? "Hold'em" : 'Omaha'} Tournament</h1>
        <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Code: <strong style={{ color: 'var(--gold)', letterSpacing: '0.1em' }}>{tournament.inviteCode}</strong></div>
        <button
          type="button"
          className="btn"
          style={{ position: 'absolute', top: '1rem', left: '1rem', fontSize: '0.85rem' }}
          onClick={() => navigate('/tournaments')}
        >
          Back
        </button>
      </header>

      <div className="panel">
        <h2>Tournament Info</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem', fontSize: '0.9rem' }}>
          <div><span style={{ opacity: 0.6 }}>Buy-in:</span> {tournament.buyIn.toLocaleString()} chips</div>
          <div><span style={{ opacity: 0.6 }}>Starting Stack:</span> {tournament.startingStack.toLocaleString()}</div>
          <div><span style={{ opacity: 0.6 }}>Players:</span> {totalSlots}</div>
          <div><span style={{ opacity: 0.6 }}>Prize Pool:</span> {prizePool.toLocaleString()}</div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={{ opacity: 0.6 }}>Starts in:</span> <strong style={{ color: 'var(--gold)' }}>{countdown}</strong>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={{ opacity: 0.6 }}>Scheduled:</span> {formatDate(tournament.scheduledStart)}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Blind Schedule</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ opacity: 0.6 }}>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Level</th>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Small</th>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Big</th>
                <th style={{ textAlign: 'left' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {tournament.blindSchedule.map((l) => (
                <tr key={l.level}>
                  <td style={{ paddingRight: '1rem', paddingTop: '0.2rem' }}>{l.level}</td>
                  <td style={{ paddingRight: '1rem' }}>{l.small.toLocaleString()}</td>
                  <td style={{ paddingRight: '1rem' }}>{l.big.toLocaleString()}</td>
                  <td>{l.durationMinutes}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Registered Players ({totalSlots})</h2>
        {registrations.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No players registered yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {registrations.map((r, i) => (
              <div key={r.userId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', padding: '0.2rem 0' }}>
                <span>{i + 1}. {r.displayName}</span>
                {r.userId === tournament.hostUserId && <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>host</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="panel"><p style={{ color: 'var(--error, #f56)', margin: 0 }}>{error}</p></div>}

      {tournament.status === 'waiting' && (
        <div className="panel">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {isHost ? (
              <>
                <button
                  className="btn primary"
                  onClick={handleStart}
                  disabled={actionLoading || totalSlots < 6}
                  title={totalSlots < 6 ? 'Need at least 6 players' : undefined}
                >
                  {actionLoading ? 'Starting...' : `Start Now${totalSlots < 6 ? ' (need 6+)' : ''}`}
                </button>
                <button className="btn" onClick={handleCancel} disabled={actionLoading}>
                  Cancel Tournament
                </button>
              </>
            ) : isRegistered ? (
              <button className="btn" onClick={handleUnregister} disabled={actionLoading}>
                {actionLoading ? 'Leaving...' : 'Leave Tournament'}
              </button>
            ) : (
              <button className="btn primary" onClick={handleRegister} disabled={actionLoading}>
                {actionLoading ? 'Registering...' : 'Register'}
              </button>
            )}
          </div>
        </div>
      )}

      {tournament.status === 'running' && (
        <div className="panel">
          <p style={{ color: 'var(--gold)', fontWeight: 600 }}>Tournament in progress!</p>
          {isRegistered && <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>Check your table — you should have been redirected automatically.</p>}
        </div>
      )}
    </div>
  );
}
