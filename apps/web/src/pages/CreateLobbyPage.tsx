import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RulesPreset, VariantConfig } from '@vct/shared-types';
import { TIMER_STEPS_SEC, formatTimerLabel } from '@vct/shared-types';
import { createLobby, getPresets } from '../api/client';
import { useAuth } from '../context/AuthContext';

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function parsePositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function loadPresetIntoForm(
  preset: RulesPreset | undefined,
  setBuyIn: (value: string) => void,
  setSmallBlind: (value: string) => void,
  setBigBlind: (value: string) => void,
  setStraddleEnabled: (value: boolean) => void,
  setStraddleAmount: (value: string) => void,
  setSevenDeuceRule: (value: boolean) => void,
  setActionTimerSec: (value: number) => void
): void {
  if (!preset) return;

  const config = preset.config;
  setBuyIn(String(config.buyIn ?? config.minBuyIn));
  setSmallBlind(String(Math.max(1, Math.floor(config.blinds.small))));
  setBigBlind(String(Math.max(1, Math.floor(config.blinds.big))));
  setStraddleEnabled(config.game === 'holdem' && !!config.straddle);
  setStraddleAmount(String(Math.max(config.blinds.big, config.straddleAmount ?? config.blinds.big * 2)));
  setSevenDeuceRule(config.game === 'holdem' && !!config.sevenDeuceRule);
  setActionTimerSec(config.actionTimerSec ?? 30);
}

export default function CreateLobbyPage() {
  const { token, user, loginGuest } = useAuth();
  const [presets, setPresets] = useState<RulesPreset[]>([]);
  const [presetId, setPresetId] = useState('nlhe-standard');
  const [buyIn, setBuyIn] = useState('500');
  const [smallBlind, setSmallBlind] = useState('5');
  const [bigBlind, setBigBlind] = useState('10');
  const [straddleEnabled, setStraddleEnabled] = useState(false);
  const [straddleAmount, setStraddleAmount] = useState('20');
  const [sevenDeuceRule, setSevenDeuceRule] = useState(false);
  const [actionTimerSec, setActionTimerSec] = useState(30);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const selectedPreset = presets.find((preset) => preset.id === presetId) ?? presets[0];
  const isHoldem = selectedPreset?.config.game === 'holdem';
  const hasPreset = !!selectedPreset;

  const parsedBuyIn = parsePositiveInt(buyIn);
  const parsedSmallBlind = parsePositiveInt(smallBlind);
  const parsedBigBlind = parsePositiveInt(bigBlind);
  const parsedStraddleAmount = parsePositiveInt(straddleAmount);

  const isValidBuyIn =
    parsedBuyIn !== null && parsedBuyIn >= 10 && parsedBuyIn <= 10000 && parsedBuyIn % 5 === 0;
  const isValidBlinds = parsedSmallBlind !== null && parsedBigBlind !== null;
  const isValidStraddle =
    !isHoldem ||
    !straddleEnabled ||
    (parsedStraddleAmount !== null && parsedBigBlind !== null && parsedStraddleAmount >= parsedBigBlind);
  const isFormValid = hasPreset && isValidBuyIn && isValidBlinds && isValidStraddle;

  useEffect(() => {
    getPresets().then((response) => {
      setPresets(response.presets);
      const first = response.presets.find((preset) => preset.id === 'nlhe-standard') ?? response.presets[0];
      loadPresetIntoForm(
        first,
        setBuyIn,
        setSmallBlind,
        setBigBlind,
        setStraddleEnabled,
        setStraddleAmount,
        setSevenDeuceRule,
        setActionTimerSec
      );
    });
  }, []);

  useEffect(() => {
    loadPresetIntoForm(
      selectedPreset,
      setBuyIn,
      setSmallBlind,
      setBigBlind,
      setStraddleEnabled,
      setStraddleAmount,
      setSevenDeuceRule,
      setActionTimerSec
    );
  }, [presetId, selectedPreset]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPreset || !isFormValid || parsedBuyIn === null || parsedSmallBlind === null || parsedBigBlind === null) {
      setError('Please enter valid buy-in and blind values before creating the table.');
      return;
    }

    setError(null);
    try {
      if (!user && name.trim()) await loginGuest(name.trim());
    } catch {
      setError('Display names must be 10 characters or fewer.');
      return;
    }

    const base: VariantConfig = selectedPreset.config;
    const settings: VariantConfig = {
      ...base,
      buyIn: parsedBuyIn,
      minBuyIn: parsedBuyIn,
      maxBuyIn: Math.max(parsedBuyIn, base.maxBuyIn),
      blinds: {
        ...base.blinds,
        small: parsedSmallBlind,
        big: parsedBigBlind,
      },
      straddle: base.game === 'holdem' ? straddleEnabled : false,
      straddleAmount:
        base.game === 'holdem' && straddleEnabled
          ? Math.max(parsedBigBlind, parsedStraddleAmount ?? parsedBigBlind)
          : undefined,
      sevenDeuceRule: base.game === 'holdem' ? sevenDeuceRule : false,
      actionTimerSec: actionTimerSec > 0 ? actionTimerSec : undefined,
    };
    const { lobby } = await createLobby({ presetId, settings });
    navigate(`/table/${lobby.id}`);
  }

  if (!token && !name) {
    return (
      <div className="page">
        <form className="panel" onSubmit={(e) => { e.preventDefault(); handleCreate(e); }}>
          <h2>Your name</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 10))}
            placeholder="Display name"
            maxLength={10}
          />
          <button type="submit">Next</button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <form className="panel" onSubmit={handleCreate}>
        <h2>Create table</h2>
        <label>
          Rules preset
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} - {preset.description}
              </option>
            ))}
          </select>
        </label>

        <label>
          Buy-in per player (chips)
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={buyIn}
            onChange={(e) => {
              setBuyIn(digitsOnly(e.target.value));
              if (error) setError(null);
            }}
          />
        </label>

        <fieldset className="settings-group">
          <legend>Blinds</legend>
          <label>
            Small blind
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={smallBlind}
              onChange={(e) => {
                setSmallBlind(digitsOnly(e.target.value));
                if (error) setError(null);
              }}
            />
          </label>
          <label>
            Big blind
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={bigBlind}
              onChange={(e) => {
                const nextValue = digitsOnly(e.target.value);
                setBigBlind(nextValue);
                if (straddleEnabled) {
                  const parsedBig = parsePositiveInt(nextValue);
                  const parsedStraddle = parsePositiveInt(straddleAmount);
                  if (parsedBig !== null && (parsedStraddle === null || parsedStraddle < parsedBig)) {
                    setStraddleAmount(String(Math.max(parsedBig, parsedBig * 2)));
                  }
                }
                if (error) setError(null);
              }}
            />
          </label>
        </fieldset>

        {isHoldem && (
          <fieldset className="settings-group">
            <legend>Hold'em options</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={straddleEnabled}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setStraddleEnabled(checked);
                  if (checked) {
                    const parsedBig = parsePositiveInt(bigBlind);
                    const parsedCurrent = parsePositiveInt(straddleAmount);
                    const nextValue = Math.max(parsedBig ?? 0, parsedCurrent ?? 0, (parsedBig ?? 0) * 2);
                    if (nextValue > 0) setStraddleAmount(String(nextValue));
                  }
                  if (error) setError(null);
                }}
              />
              Enable straddle
            </label>

            {straddleEnabled && (
              <label>
                Straddle amount
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={straddleAmount}
                  onChange={(e) => {
                    setStraddleAmount(digitsOnly(e.target.value));
                    if (error) setError(null);
                  }}
                />
              </label>
            )}

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={sevenDeuceRule}
                onChange={(e) => {
                  setSevenDeuceRule(e.target.checked);
                  if (error) setError(null);
                }}
              />
              Enable Seven Deuce Rule
            </label>
          </fieldset>
        )}

        <fieldset className="settings-group">
          <legend>Action timer</legend>
          <label>
            Time per action
            <select
              value={actionTimerSec}
              onChange={(e) => setActionTimerSec(Number(e.target.value))}
            >
              {TIMER_STEPS_SEC.map((sec) => (
                <option key={sec} value={sec}>
                  {formatTimerLabel(sec)}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">
            When set, each player automatically checks (or folds) when their time expires.
          </p>
        </fieldset>

        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="field-hint">
          Each player receives the buy-in stack on join. Blinds must be positive, and straddle amounts must be at
          least the big blind.
        </p>
        <button type="submit" className="btn primary" disabled={!isFormValid}>
          Create &amp; open table
        </button>
      </form>
    </div>
  );
}
