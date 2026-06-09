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
  }

  if (loading) return <div className="page home"><div className="panel"><p>Loading...</p></div></div>;
  if (!tournament) return <div className="page home"><div className="panel"><p className="form-error">{error ?? 'Tournament not found'}</p></div></div>;

  const totalSlots = tournament.totalPlayers;
  const prizePool = tournament.prizePool > 0 ? tournament.prizePool : Math.floor(tournament.buyIn * totalSlots * 1.5);

  return (
    <div className="page home">
      <header className="hero">
        <h1>{tournament.variant === 'holdem' ? "Hold'em" : 'Omaha'} Tournament</h1>
        <p>
          Code: <strong style={{ color: 'var(--gold)', letterSpacing: '0.1em' }}>{tournament.inviteCode}</strong>
        </p>
      </header>

      <div className="panel">
        <p className="home-section-label"><span aria-hidden="true">♠</span> Tournament Info</p>
        <div className="tournament-info-grid">
          <div><span className="tournament-info-label">Buy-in: </span>{tournament.buyIn.toLocaleString()} chips</div>
          <div><span className="tournament-info-label">Starting Stack: </span>{tournament.startingStack.toLocaleString()}</div>
          <div><span className="tournament-info-label">Players: </span>{totalSlots}</div>
          <div><span className="tournament-info-label">Prize Pool: </span>{prizePool.toLocaleString()}</div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="tournament-info-label">Starts in: </span>
            <span className="tournament-countdown">{countdown}</span>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="tournament-info-label">Scheduled: </span>{formatDate(tournament.scheduledStart)}
          </div>
        </div>
      </div>

      <div className="panel">
        <p className="home-section-label"><span aria-hidden="true">♦</span> Blind Schedule</p>
        <div className="blind-schedule-preview">
          <table className="blind-schedule-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>Small</th>
                <th>Big</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {tournament.blindSchedule.map((l) => (
                <tr key={l.level}>
                  <td>{l.level}</td>
                  <td>{l.small.toLocaleString()}</td>
                  <td>{l.big.toLocaleString()}</td>
                  <td>{l.durationMinutes}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <p className="home-section-label"><span aria-hidden="true">♣</span> Registered Players ({totalSlots})</p>
        {registrations.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No players registered yet.</p>
        ) : (
          <div className="tournament-player-list">
            {registrations.map((r, i) => (
              <div key={r.userId} className="tournament-player-row">
                <span>{i + 1}. {r.displayName}</span>
                {r.userId === tournament.hostUserId && (
                  <span className="tournament-host-badge">host</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="panel"><p className="form-error">{error}</p></div>}

      {tournament.status === 'waiting' && (
        <div className="panel">
          <div className="name-selection-actions" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
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
          <p style={{ color: 'var(--gold)', fontWeight: 600, margin: '0 0 0.4rem' }}>Tournament in progress!</p>
          {isRegistered && (
            <p style={{ opacity: 0.7, fontSize: '0.9rem', margin: 0 }}>
              Check your table — you should have been redirected automatically.
            </p>
          )}
        </div>
      )}

      <div className="name-selection-actions">
        <button className="btn" onClick={() => navigate('/tournaments')}>Back</button>
      </div>
    </div>
  );
}
