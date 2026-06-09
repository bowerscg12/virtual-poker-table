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
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span>💰</span> Chip Wallet
      </h2>

      {loading ? (
        <p style={{ opacity: 0.6, margin: 0 }}>Loading...</p>
      ) : (
        <>
          <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
            <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--gold)', lineHeight: 1.1 }}>
              {(balance ?? 0).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.78rem', opacity: 0.6, marginTop: '0.2rem' }}>chips available</div>
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
          {claimError && (
            <p className="form-error" style={{ margin: 0 }}>{claimError}</p>
          )}
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
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.8rem', margin: '0 0 1.25rem' }}>
        Tournaments
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '1rem', alignItems: 'start' }}>

        {/* Left column — wallet */}
        <WalletPanel />

        {/* Right column — create / join / browse + back */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="panel">
            <h2>Create Tournament</h2>
            <p style={{ opacity: 0.8, margin: '0.4rem 0 0.9rem' }}>
              Host a private tournament with custom blind schedules and prize pools.
            </p>
            <button className="btn primary" onClick={() => navigate('/tournaments/create')}>
              Create Tournament
            </button>
          </div>

          <div className="panel">
            <h2>Join with Code</h2>
            <form
              onSubmit={handleJoinByCode}
              style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginTop: '0.5rem', flexWrap: 'wrap' }}
            >
              <input
                type="text"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase().slice(0, 8));
                  setJoinError(null);
                }}
                placeholder="Enter invite code"
                maxLength={8}
                style={{ flex: 1, minWidth: 0 }}
                disabled={joining}
              />
              <button className="btn primary" type="submit" disabled={joining || !joinCode.trim()}>
                {joining ? 'Looking up...' : 'Join'}
              </button>
            </form>
            {joinError && (
              <p className="form-error" style={{ marginTop: '0.4rem' }}>{joinError}</p>
            )}
          </div>

          <div className="panel">
            <h2>Browse Open Tournaments</h2>
            {loading ? (
              <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>Loading...</p>
            ) : tournaments.length === 0 ? (
              <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>No open tournaments right now. Create one!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
                {tournaments.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: 10,
                      padding: '0.75rem 0.9rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      cursor: 'pointer',
                      border: '1px solid rgba(212,175,55,0.15)',
                    }}
                    onClick={() => navigate(`/tournaments/${t.id}`)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--gold)' }}>
                        {t.variant === 'holdem' ? "Hold'em" : 'Omaha'} — {t.buyIn.toLocaleString()} chips buy-in
                      </div>
                      <div style={{ fontSize: '0.82rem', opacity: 0.7, marginTop: '0.1rem' }}>
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
      </div>
    </div>
  );
}
