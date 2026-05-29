import type { WinnerBannerData } from '../hooks/useTableAnimations';
import { formatChips } from '../utils/formatChips';

interface Props {
  data: WinnerBannerData;
}

export function WinnerBanner({ data }: Props) {
  const { winners, isSplit } = data;
  const totalPot = winners.reduce((s, w) => s + w.amount, 0);

  return (
    <div className="winner-banner" role="status" aria-live="polite">
      {isSplit ? (
        <>
          <p className="winner-banner__title">Split Pot</p>
          <div className="winner-banner__split-row">
            {winners.map((w, i) => (
              <div key={i} className="winner-banner__split-winner">
                <span className="winner-banner__split-winner-name">{w.displayName}</span>
                <span className="winner-banner__split-winner-amount">
                  +{formatChips(w.amount)}
                </span>
              </div>
            ))}
          </div>
          {winners[0] && (
            <p className="winner-banner__hand">{winners[0].handDescription}</p>
          )}
        </>
      ) : (
        <>
          <p className="winner-banner__title">Winner</p>
          <p className="winner-banner__name">{winners[0]?.displayName}</p>
          {winners[0]?.handDescription && (
            <p className="winner-banner__hand">{winners[0].handDescription}</p>
          )}
          <p className="winner-banner__amount">+{formatChips(totalPot)}</p>
        </>
      )}
    </div>
  );
}
