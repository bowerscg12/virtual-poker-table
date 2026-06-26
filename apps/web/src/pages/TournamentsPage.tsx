import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TournamentSummary } from '@vct/shared-types';
import {
  listTournaments,
  getTournamentByCode,
  getWallet,
  claimDailyChips,
  claimLowChipBonus,
  getGlobalLeaderboard,
  getMyTournamentStats,
  type LeaderboardUser,
  type TournamentUserStats,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

const LOW_CHIP_THRESHOLD = 1000;

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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function WalletPanel() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [lastClaim, setLastClaim] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [lowChipClaiming, setLowChipClaiming] = useState(false);
  const [lowChipError, setLowChipError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || user.isGuest) { setLoading(false); return; }
    getWallet()
      .then((data) => {
        setBalance(data.chipBalance);
        setLastClaim(data.lastDailyClaim);
      })
      .catch(() => setBalance(0))
      .finally(() => setLoading(false));
  }, [user]);

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

  async function handleLowChipClaim() {
    setLowChipClaiming(true);
    setLowChipError(null);
    try {
      const data = await claimLowChipBonus();
      setBalance(data.chipBalance);
    } catch (err) {
      setLowChipError((err as Error).message);
    } finally {
      setLowChipClaiming(false);
    }
  }

  if (user?.isGuest) return null;

  const alreadyClaimed = hasClaimedToday(lastClaim);
  const showLowChip = balance !== null && balance < LOW_CHIP_THRESHOLD;

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

          {alreadyClaimed && !showLowChip && (
            <p style={{ fontSize: '0.78rem', opacity: 0.55, textAlign: 'center', margin: '0.4rem 0 0' }}>
              Come back tomorrow for more!
            </p>
          )}

          {showLowChip && (
            <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: 'rgba(255,180,0,0.08)', border: '1px solid rgba(255,180,0,0.25)', borderRadius: 8 }}>
              <p style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: 'rgba(255,200,80,0.9)' }}>
                Running low? Claim a one-time 2,000-chip recovery bonus (available once per 7 days).
              </p>
              <button
                className="btn"
                onClick={handleLowChipClaim}
                disabled={lowChipClaiming}
                style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }}
              >
                {lowChipClaiming ? 'Claiming...' : 'Claim 2,000 Recovery Chips'}
              </button>
              {lowChipError && <p className="form-error" style={{ margin: '0.3rem 0 0', fontSize: '0.78rem' }}>{lowChipError}</p>}
            </div>
          )}

          {claimError && <p className="form-error" style={{ margin: '0.3rem 0 0' }}>{claimError}</p>}
        </>
      )}
    </div>
  );
}

function TournamentStatsCard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<TournamentUserStats | null>(null);

  useEffect(() => {
    if (!user || user.isGuest) return;
    getMyTournamentStats().then(setStats).catch(() => null);
  }, [user]);

  if (!user || user.isGuest || !stats || stats.tournamentsPlayed === 0) return null;

  return (
    <div className="panel">
      <p className="home-section-label"><span aria-hidden="true">♦</span> Your Tournament Record</p>
      <div className="tournament-stats-grid">
        <div className="tournament-stat">
          <div className="tournament-stat__value">{stats.tournamentsPlayed}</div>
          <div className="tournament-stat__label">Played</div>
        </div>
        <div className="tournament-stat">
          <div className="tournament-stat__value">{stats.tournamentCashes}</div>
          <div className="tournament-stat__label">Cashes</div>
        </div>
        <div className="tournament-stat">
          <div className="tournament-stat__value">{stats.tournamentWins}</div>
          <div className="tournament-stat__label">Wins</div>
        </div>
        <div className="tournament-stat">
          <div className="tournament-stat__value">{stats.itmPercent}%</div>
          <div className="tournament-stat__label">ITM</div>
        </div>
      </div>
      {stats.bestTournamentFinish !== null && (
        <p style={{ fontSize: '0.82rem', opacity: 0.7, margin: '0.5rem 0 0', textAlign: 'center' }}>
          Best finish: <strong style={{ color: 'var(--gold)' }}>{ordinal(stats.bestTournamentFinish)}</strong>
          {' · '}Total earnings: <strong style={{ color: 'var(--gold)' }}>{stats.totalTournamentEarnings.toLocaleString()} chips</strong>
        </p>
      )}
    </div>
  );
}

function GlobalLeaderboard({ currentUserId }: { currentUserId?: string }) {
  const [entries, setEntries] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getGlobalLeaderboard()
      .then((data) => setEntries(data.leaderboard))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="panel">
      <p className="home-section-label"><span aria-hidden="true">♥</span> Chip Richlist — Top 25</p>
      {loading ? (
        <p style={{ opacity: 0.7 }}>Loading...</p>
      ) : entries.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No ranked players yet.</p>
      ) : (
        <div className="tournament-leaderboard-list">
          {entries.map((e) => {
            const isMe = e.userId === currentUserId;
            return (
              <div
                key={e.userId}
                className="tournament-leaderboard-row"
                style={isMe ? { background: 'rgba(212,175,55,0.08)', borderColor: 'rgba(212,175,55,0.3)' } : undefined}
              >
                <span className="tournament-leaderboard-rank">{e.rank === 1 ? '👑' : `#${e.rank}`}</span>
                <span className="tournament-leaderboard-name" style={isMe ? { color: 'var(--gold)' } : undefined}>
                  {e.displayName}{isMe ? ' (you)' : ''}
                </span>
                <span className="tournament-leaderboard-chips">{e.chipBalance.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusPill(t: TournamentSummary): { label: string; style: React.CSSProperties } {
  const isFull = t.registeredCount >= t.maxPlayers;
  if (isFull) return { label: 'Full', style: { background: 'rgba(255,80,80,0.18)', color: 'rgba(255,120,120,0.9)' } };
  const minsUntil = (new Date(t.scheduledStart).getTime() - Date.now()) / 60_000;
  if (minsUntil <= 15) return { label: 'Starting Soon', style: { background: 'rgba(255,180,0,0.18)', color: 'rgba(255,200,80,0.9)' } };
  return { label: 'Open', style: { background: 'rgba(80,200,120,0.15)', color: 'rgba(100,220,140,0.9)' } };
}

export default function TournamentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [tab, setTab] = useState<'open' | 'leaderboard'>('open');

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
      <TournamentStatsCard />

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

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1rem' }}>
        <button
          className={`btn${tab === 'open' ? ' primary' : ''}`}
          style={{ flex: 1, fontSize: '0.85rem' }}
          onClick={() => setTab('open')}
        >
          Open Tournaments
        </button>
        <button
          className={`btn${tab === 'leaderboard' ? ' primary' : ''}`}
          style={{ flex: 1, fontSize: '0.85rem' }}
          onClick={() => setTab('leaderboard')}
        >
          Leaderboard
        </button>
      </div>

      {tab === 'open' && (
        <div className="panel">
          {loading ? (
            <p style={{ opacity: 0.7 }}>Loading...</p>
          ) : tournaments.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No open tournaments right now. Create one!</p>
          ) : (
            <div className="tournament-list">
              {tournaments.map((t) => {
                const pill = statusPill(t);
                const minsUntil = (new Date(t.scheduledStart).getTime() - Date.now()) / 60_000;
                const startingSoon = minsUntil <= 15;
                const prizePool = Math.floor(t.buyIn * t.maxPlayers * 1.5);
                const fillPct = Math.round((t.registeredCount / t.maxPlayers) * 100);
                return (
                  <div
                    key={t.id}
                    className="tournament-list-item"
                    style={startingSoon ? { borderLeftColor: 'var(--gold)', borderLeftWidth: 3 } : undefined}
                    onClick={() => navigate(`/tournaments/${t.id}`)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span className="tournament-list-item__title">
                          {t.variant === 'holdem' ? "Hold'em" : 'Omaha'} — {t.buyIn.toLocaleString()} chips
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: 20, fontWeight: 600, ...pill.style }}>{pill.label}</span>
                      </div>
                      <div className="tournament-list-item__meta">
                        🏆 {prizePool.toLocaleString()} prize pool · Starts {formatDate(t.scheduledStart)}
                      </div>
                      <div style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>👤 {t.registeredCount}/{t.maxPlayers}</span>
                        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', maxWidth: 80 }}>
                          <div style={{ height: '100%', width: `${fillPct}%`, background: 'var(--gold)', borderRadius: 2 }} />
                        </div>
                      </div>
                    </div>
                    <button className="btn small primary" style={{ flexShrink: 0 }}>View</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'leaderboard' && <GlobalLeaderboard currentUserId={user?.id} />}

      <div className="name-selection-actions">
        <button className="btn" onClick={() => navigate('/')}>Back</button>
      </div>
    </div>
  );
}
