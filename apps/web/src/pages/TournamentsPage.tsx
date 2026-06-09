import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TournamentSummary } from '@vct/shared-types';
import { listTournaments, getTournamentByCode, getWallet, claimDailyChips } from '../api/client';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function hasClaimedToday(lastClaim: string | null): boolean {
  if (!lastClaim) return false;
  return lastClaim.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function WalletPanel() {
  const [balance, setBalance] = useState<number | null>(null);
  const [lastClaim, setLastClaim] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWallet()
      .then((data) => {
        setBalance(data.chipBalance);
        setLastClaim(data.lastDailyClaim);
      })
      .catch(() => setBalance(0))
      .finally(() => setLoading(false));
  }, []);

  async function handleClaim() {
    setClaiming(true);
    setClaimError(null);
    try {
      const data = await claimDailyChips();
      setBalance(data.chipBalance);
      setLastClaim(new Date().toISOString());
    } catch (err) {
      setClaimError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  const alreadyClaimed = hasClaimedToday(lastClaim);

  return (
    <div className="panel">
      <p className="home-section-label"><span aria-hidden="true">♣</span> Chip Wallet</p>

      {loading ? (
        <p style={{ opacity: 0.6, margin: 0 }}>Loading...</p>
      ) : (
        <>
          <div className="wallet-balance">
            <div className="wallet-balance-amount">{(balance ?? 0).toLocaleString()}</div>
            <div className="wallet-balance-label">chips available</div>
          </div>

          <button
            className="btn primary"
            onClick={handleClaim}
            disabled={claiming || alreadyClaimed}
          >
            {alreadyClaimed ? '✓ Claimed Today' : claiming ? 'Claiming...' : 'Claim Daily 1,000'}
          </button>

          {alreadyClaimed && (
            <p style={{ fontSize: '0.78rem', opacity: 0.55, textAlign: 'center', margin: 0 }}>
              Come back tomorrow for more!
            </p>
          )}
          {claimError && <p className="form-error" style={{ margin: 0 }}>{claimError}</p>}
        </>
      )}
    </div>
  );
}

export default function TournamentsPage() {
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    listTournaments()
      .then((data) => setTournaments(data.tournaments))
      .catch(() => setTournaments([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleJoinByCode(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const data = await getTournamentByCode(joinCode.trim().toUpperCase());
      navigate(`/tournaments/${data.tournament.id}`);
    } catch {
      setJoinError('Tournament not found. Check the code and try again.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Tournaments</h1>
        <p>Compete in structured events for the prize pool.</p>
      </header>

      <WalletPanel />

      <div className="panel">
        <p className="home-section-label"><span aria-hidden="true">♠</span> Host</p>
        <p style={{ opacity: 0.8, margin: '0 0 0.75rem' }}>
          Host a private tournament with custom blind schedules and prize pools.
        </p>
        <button className="btn primary" onClick={() => navigate('/tournaments/create')}>
          Create Tournament
        </button>
      </div>

      <div className="panel">
        <p className="home-section-label"><span aria-hidden="true">♦</span> Join with Code</p>
        <form onSubmit={handleJoinByCode} className="join-code-row">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value.toUpperCase().slice(0, 8));
              setJoinError(null);
            }}
            placeholder="Invite code"
            maxLength={8}
            disabled={joining}
          />
          <button className="btn primary" type="submit" disabled={joining || !joinCode.trim()}>
            {joining ? 'Looking up...' : 'Join'}
          </button>
        </form>
        {joinError && <p className="form-error" style={{ marginTop: '0.4rem' }}>{joinError}</p>}
      </div>

      <div className="panel">
        <p className="home-section-label"><span aria-hidden="true">♥</span> Open Tournaments</p>
        {loading ? (
          <p style={{ opacity: 0.7 }}>Loading...</p>
        ) : tournaments.length === 0 ? (
          <p style={{ opacity: 0.7 }}>No open tournaments right now. Create one!</p>
        ) : (
          <div className="tournament-list">
            {tournaments.map((t) => (
              <div
                key={t.id}
                className="tournament-list-item"
                onClick={() => navigate(`/tournaments/${t.id}`)}
              >
                <div>
                  <div className="tournament-list-item__title">
                    {t.variant === 'holdem' ? "Hold'em" : 'Omaha'} — {t.buyIn.toLocaleString()} chips buy-in
                  </div>
                  <div className="tournament-list-item__meta">
                    Starts {formatDate(t.scheduledStart)} · {t.registeredCount}/{t.maxPlayers} registered
                  </div>
                </div>
                <button className="btn small primary">View</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="name-selection-actions">
        <button className="btn" onClick={() => navigate('/')}>Back</button>
      </div>
    </div>
  );
}
