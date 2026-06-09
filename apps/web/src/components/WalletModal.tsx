import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWallet, claimDailyChips } from '../api/client';

interface Props {
  onClose: () => void;
}

function formatChips(n: number): string {
  return n.toLocaleString();
}

function hasClaimedToday(lastClaim: string | null): boolean {
  if (!lastClaim) return false;
  const claimDay = lastClaim.slice(0, 10);
  const todayUTC = new Date().toISOString().slice(0, 10);
  return claimDay === todayUTC;
}

export function WalletModal({ onClose }: Props) {
  const navigate = useNavigate();
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Chip Wallet</h2>

        {loading ? (
          <p className="modal-body">Loading...</p>
        ) : (
          <>
            <div className="modal-chip-count">{formatChips(balance ?? 0)}</div>
            <p className="modal-warning">chips available</p>

            <button
              className="btn primary"
              style={{ width: '100%', marginBottom: '0.5rem' }}
              onClick={handleClaim}
              disabled={claiming || alreadyClaimed}
            >
              {alreadyClaimed ? 'Daily 1,000 Claimed' : claiming ? 'Claiming...' : 'Claim Daily 1,000 Chips'}
            </button>
            {alreadyClaimed && <p className="modal-warning" style={{ textAlign: 'center' }}>Come back tomorrow for more!</p>}
            {claimError && <p style={{ color: 'var(--error, #f56)', fontSize: '0.85rem', margin: '0.25rem 0' }}>{claimError}</p>}
          </>
        )}

        <div className="modal-actions">
          <button
            className="btn primary"
            onClick={() => { onClose(); navigate('/tournaments'); }}
          >
            Enter Tournaments
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
