import { useState } from 'react';
import type { LobbySummary } from '@vct/shared-types';
import { TIMER_STEPS_SEC, BLACKJACK_TIMER_STEPS_SEC, TIME_BANK_EXTENSION_SEC, TIME_BANK_MAX_USES, formatTimerLabel, getTableBuyIn } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

function AnteInput({ label, current, onSet }: { label: string; current: number; onSet: (amount: number) => void }) {
  const [value, setValue] = useState(current > 0 ? String(current) : '');
  const parsed = Number.parseInt(value, 10);
  const isValid = value === '' || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000 && parsed % 5 === 0);

  function handleSet() {
    if (!isValid) return;
    onSet(value === '' ? 0 : parsed);
  }

  function handleClear() {
    setValue('');
    onSet(0);
  }

  return (
    <label className="host-buy-in">
      {label}
      <div className="host-buy-in-row">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="0 = off"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        />
        <button type="button" className="btn small" onClick={handleSet} disabled={!isValid}>
          Set
        </button>
        {current > 0 && (
          <button type="button" className="btn small" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>
    </label>
  );
}

function AntesControl({
  lobby,
  onSetBigBlindAnte,
  onSetSmallBlindAnte,
}: {
  lobby: LobbySummary;
  onSetBigBlindAnte: (amount: number) => void;
  onSetSmallBlindAnte: (amount: number) => void;
}) {
  const bba = lobby.settings.bigBlindAnte ?? 0;
  const sba = lobby.settings.smallBlindAnte ?? 0;
  const lines: string[] = [];
  if (bba > 0) lines.push(`BB posts ${formatChips(bba)} ante`);
  if (sba > 0) lines.push(`SB posts ${formatChips(sba)} ante`);

  return (
    <fieldset className="settings-group bomb-pot-controls">
      <legend>Antes</legend>
      <AnteInput label="Big Blind Ante" current={bba} onSet={onSetBigBlindAnte} />
      <AnteInput label="Small Blind Ante" current={sba} onSet={onSetSmallBlindAnte} />
      <p className="field-hint">
        {lines.length > 0
          ? `Active: ${lines.join(', ')} each hand. Takes effect next hand.`
          : 'Dead antes posted by position before blinds each hand. Takes effect next hand.'}
      </p>
    </fieldset>
  );
}

interface Props {
  lobby: LobbySummary;
  handActive: boolean;
  /** ISO deadline for the next hand's intermission countdown; undefined when none is running. */
  intermissionDeadline?: string;
  onStart: () => void;
  onPause: (paused: boolean) => void;
  onKick: (seatIndex: number) => void;
  onTransferHost: (seatIndex: number) => void;
  onSetBuyIn: (amount: number) => void;
  onSetActionTimer: (seconds: number) => void;
  onSetTimeBank: (enabled: boolean) => void;
  onSetFlipAnte?: (ante: number) => void;
  onSetBombPot?: (value: { enabled: boolean; amount?: number; doubleBoard?: boolean }) => void;
  onSetRunItOut?: (times: number) => void;
  onSetPineapple?: (enabled: boolean) => void;
  onSetBigBlindAnte?: (amount: number) => void;
  onSetSmallBlindAnte?: (amount: number) => void;
}

export function HostControls({ lobby, handActive, intermissionDeadline, onStart, onPause, onKick, onTransferHost, onSetBuyIn, onSetActionTimer, onSetTimeBank, onSetFlipAnte, onSetBombPot, onSetRunItOut, onSetPineapple, onSetBigBlindAnte, onSetSmallBlindAnte }: Props) {
  const isTcf = lobby.settings.game === 'twelve_card_flip';
  const isBlackjack = lobby.settings.game === 'blackjack';
  const currentBuyIn = getTableBuyIn(lobby.settings);
  const [buyIn, setBuyIn] = useState(String(currentBuyIn));
  const parsedBuyIn = Number.parseInt(buyIn, 10);
  const isValidBuyIn =
    Number.isInteger(parsedBuyIn) && parsedBuyIn >= 10 && parsedBuyIn <= 10000 && parsedBuyIn % 5 === 0;

  const currentAnte = lobby.settings.twelveCardFlipAnte ?? currentBuyIn;
  const [ante, setAnte] = useState(String(currentAnte));
  const parsedAnte = Number.parseInt(ante, 10);
  const isValidAnte =
    Number.isInteger(parsedAnte) && parsedAnte >= 10 && parsedAnte <= 10000 && parsedAnte % 5 === 0;

  const currentTimerSec = lobby.settings.actionTimerSec ?? 0;
  const gameStarted = lobby.status === 'playing' || lobby.status === 'paused';

  // ── Bomb Pot (next-hand modifier) ───────────────────────────
  const pendingBombPot = lobby.settings.nextHandBombPot;
  const bombPotEnabled = !!pendingBombPot;
  const defaultBombPotAmount = Math.max(1, lobby.settings.blinds.big * 10);
  const [bombPotAmount, setBombPotAmount] = useState(String(pendingBombPot?.amount ?? defaultBombPotAmount));
  const parsedBombPotAmount = Number.parseInt(bombPotAmount, 10);
  const isValidBombPotAmount = Number.isInteger(parsedBombPotAmount) && parsedBombPotAmount > 0;
  const bombPotDoubleBoard = pendingBombPot?.doubleBoard ?? false;

  function toggleBombPot(enabled: boolean) {
    if (!onSetBombPot) return;
    if (enabled) {
      onSetBombPot({ enabled: true, amount: isValidBombPotAmount ? parsedBombPotAmount : defaultBombPotAmount, doubleBoard: bombPotDoubleBoard });
    } else {
      onSetBombPot({ enabled: false });
    }
  }
  function applyBombPotAmount() {
    if (!onSetBombPot || !isValidBombPotAmount) return;
    onSetBombPot({ enabled: true, amount: parsedBombPotAmount, doubleBoard: bombPotDoubleBoard });
  }
  function setDoubleBoard(doubleBoard: boolean) {
    if (!onSetBombPot) return;
    onSetBombPot({ enabled: true, amount: isValidBombPotAmount ? parsedBombPotAmount : defaultBombPotAmount, doubleBoard });
  }

  function handleUpdateBuyIn() {
    if (!isValidBuyIn) return;
    onSetBuyIn(parsedBuyIn);
  }

  function handleUpdateAnte() {
    if (!isValidAnte || !onSetFlipAnte) return;
    onSetFlipAnte(parsedAnte);
  }

  return (
    <div className="host-controls panel">
      <h3>Host controls</h3>

      {isTcf && onSetFlipAnte && (
        <>
          <label className="host-buy-in">
            Ante per hand
            <div className="host-buy-in-row">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={ante}
                disabled={handActive}
                onChange={(e) => setAnte(e.target.value.replace(/[^\d]/g, ''))}
              />
              <button
                type="button"
                className="btn small"
                onClick={handleUpdateAnte}
                disabled={!isValidAnte || handActive}
              >
                Update
              </button>
            </div>
          </label>
          <p className="field-hint">
            {handActive
              ? 'Ante cannot be changed while a hand is in progress.'
              : `Current ante: ${formatChips(currentAnte)} chips. Takes effect next hand.`}
          </p>
        </>
      )}

      {!isTcf && (
        <>
          <label className="host-buy-in">
            Table buy-in (chips for new players)
            <div className="host-buy-in-row">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={buyIn}
                onChange={(e) => setBuyIn(e.target.value.replace(/[^\d]/g, ''))}
              />
              <button type="button" className="btn small" onClick={handleUpdateBuyIn} disabled={!isValidBuyIn}>
                Update
              </button>
            </div>
          </label>
          <p className="field-hint">Current seated stacks stay as-is; new joiners get the updated amount.</p>
        </>
      )}

      <label className="host-timer">
        Action timer
        <select
          value={currentTimerSec}
          onChange={(e) => onSetActionTimer(Number(e.target.value))}
        >
          {(isBlackjack ? BLACKJACK_TIMER_STEPS_SEC : TIMER_STEPS_SEC).map((sec) => (
            <option key={sec} value={sec}>
              {formatTimerLabel(sec)}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">Takes effect on the next action. Changing to "No Timer" cancels any running countdown.</p>

      {!isBlackjack && currentTimerSec > 0 && (
        <>
          <label className="checkbox-row time-bank-row">
            <input
              type="checkbox"
              checked={!!lobby.settings.timeBankEnabled}
              onChange={(e) => onSetTimeBank(e.target.checked)}
            />
            Time bank
          </label>
          <p className="field-hint">
            Lets each player add {TIME_BANK_EXTENSION_SEC}s to their clock up to {TIME_BANK_MAX_USES} times per
            sit-down, preventing rage-folds on a bad connection.
          </p>
        </>
      )}

      {!isTcf && !isBlackjack && onSetBombPot && (
        <fieldset className="settings-group bomb-pot-controls">
          <legend>Bomb Pot (next hand)</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={bombPotEnabled}
              onChange={(e) => toggleBombPot(e.target.checked)}
            />
            Bomb Pot
          </label>

          {bombPotEnabled && (
            <>
              <label className="host-buy-in">
                Bomb Pot amount (per player)
                <div className="host-buy-in-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={bombPotAmount}
                    onChange={(e) => setBombPotAmount(e.target.value.replace(/[^\d]/g, ''))}
                  />
                  <button
                    type="button"
                    className="btn small"
                    onClick={applyBombPotAmount}
                    disabled={!isValidBombPotAmount}
                  >
                    Update
                  </button>
                </div>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={bombPotDoubleBoard}
                  onChange={(e) => setDoubleBoard(e.target.checked)}
                />
                Double Board
              </label>
            </>
          )}
          <p className="field-hint">
            {bombPotEnabled
              ? `Next hand: ${bombPotDoubleBoard ? 'Double Board ' : ''}Bomb Pot (${formatChips(pendingBombPot?.amount ?? 0)}). Players opt in before it starts.`
              : 'Run the next hand as a Bomb Pot — forced ante, no betting, board runs out automatically.'}
          </p>
        </fieldset>
      )}

      {lobby.settings.game === 'holdem' && onSetPineapple && (
        <fieldset className="settings-group bomb-pot-controls">
          <legend>Pineapple (persistent)</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!lobby.settings.pineapple}
              onChange={(e) => onSetPineapple(e.target.checked)}
            />
            Pineapple Mode
          </label>
          <p className="field-hint">
            {lobby.settings.pineapple
              ? 'Every hand: 3 hole cards dealt, players discard one before preflop. Players opt in each hand.'
              : 'Deal 3 hole cards per hand — players choose one to discard before preflop betting.'}
          </p>
        </fieldset>
      )}

      {!isTcf && !isBlackjack && (onSetBigBlindAnte || onSetSmallBlindAnte) && (
        <AntesControl
          lobby={lobby}
          onSetBigBlindAnte={onSetBigBlindAnte ?? (() => {})}
          onSetSmallBlindAnte={onSetSmallBlindAnte ?? (() => {})}
        />
      )}

      {!isTcf && onSetRunItOut && (lobby.settings.game === 'holdem' || lobby.settings.game === 'omaha') && (
        <fieldset className="settings-group run-it-out-controls">
          <legend>Run It Out</legend>
          <label className="host-timer">
            Times to run the board
            <select
              value={lobby.settings.runItOut ?? 1}
              onChange={(e) => onSetRunItOut(Number(e.target.value))}
            >
              <option value={1}>Once (standard)</option>
              <option value={2}>Twice</option>
              <option value={3}>Three times</option>
            </select>
          </label>
          <p className="field-hint">
            When all players are all-in, a randomly chosen player decides how many times to run out the board (up to this limit).
          </p>
        </fieldset>
      )}

      <div className="host-btns">
        {!gameStarted && (
          <button type="button" className="btn primary" onClick={onStart}>
            Start hand
          </button>
        )}
        {/* Recovery button: shown when the game is between hands but no auto-progression
            is running (e.g. intermission timer was lost after a server restart). */}
        {gameStarted && !handActive && lobby.status === 'playing' && !intermissionDeadline && (
          <button type="button" className="btn primary" onClick={onStart}>
            Start next hand
          </button>
        )}
        {gameStarted && lobby.status === 'playing' && (
          <button type="button" className="btn" onClick={() => onPause(true)}>
            Pause
          </button>
        )}
        {gameStarted && lobby.status === 'paused' && (
          <button type="button" className="btn primary" onClick={() => onPause(false)}>
            Resume
          </button>
        )}
      </div>
      <details>
        <summary>Transfer host</summary>
        <ul>
          {lobby.seats
            .filter((s) => s.userId && s.userId !== lobby.hostUserId)
            .map((s) => (
              <li key={s.seatIndex}>
                {s.displayName} ({formatChips(s.stack)} chips){' '}
                <button type="button" className="btn small" onClick={() => onTransferHost(s.seatIndex)}>
                  Make host
                </button>
              </li>
            ))}
        </ul>
      </details>
      <details>
        <summary>Kick player</summary>
        <ul>
          {lobby.seats
            .filter((s) => s.userId)
            .map((s) => (
              <li key={s.seatIndex}>
                {s.displayName} ({formatChips(s.stack)} chips){' '}
                <button type="button" className="btn small danger" onClick={() => onKick(s.seatIndex)}>
                  Kick
                </button>
              </li>
            ))}
        </ul>
      </details>
      <p className="rules-summary">
        {isBlackjack
          ? `blackjack · ${lobby.settings.blackjackNumDecks ?? 6} decks · min ${lobby.settings.blackjackMinBet ?? 5} / max ${lobby.settings.blackjackMaxBet ?? 500}`
          : `${lobby.settings.game} · ${lobby.settings.limit} · Blinds ${lobby.settings.blinds.small}/${lobby.settings.blinds.big}`}
      </p>
    </div>
  );
}
