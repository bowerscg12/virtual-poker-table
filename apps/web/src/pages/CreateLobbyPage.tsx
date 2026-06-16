import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LobbyTemplate, RulesPreset, VariantConfig } from '@vct/shared-types';
import { TIMER_STEPS_SEC, formatTimerLabel, FLIP_MIN_CARDS, FLIP_MAX_CARDS, FLIP_DEFAULT_CARDS, clampFlipCardCount } from '@vct/shared-types';
import { deleteMyTemplate, getMyTemplates, getPresets, saveTemplate } from '../api/client';
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
  setActionTimerSec(config.actionTimerSec ?? 0);
}

export default function CreateLobbyPage() {
  const [presets, setPresets] = useState<RulesPreset[]>([]);
  const [presetId, setPresetId] = useState('nlhe-standard');
  const [buyIn, setBuyIn] = useState('500');
  const [smallBlind, setSmallBlind] = useState('5');
  const [bigBlind, setBigBlind] = useState('10');
  const [straddleEnabled, setStraddleEnabled] = useState(false);
  const [straddleAmount, setStraddleAmount] = useState('20');
  const [sevenDeuceRule, setSevenDeuceRule] = useState(false);
  const [actionTimerSec, setActionTimerSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [bjMinBet, setBjMinBet] = useState('5');
  const [bjMaxBet, setBjMaxBet] = useState('500');
  const [bjNumDecks, setBjNumDecks] = useState<1 | 4 | 6 | 8>(6);
  const [bjSoftSeventeen, setBjSoftSeventeen] = useState<'hit' | 'stand'>('stand');
  const [flipCardCount, setFlipCardCount] = useState(FLIP_DEFAULT_CARDS);

  const { user } = useAuth();
  const isRegistered = !!user && !user.isGuest;
  const [templates, setTemplates] = useState<LobbyTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedPreset = presets.find((preset) => preset.id === presetId) ?? presets[0];
  const isHoldem = selectedPreset?.config.game === 'holdem';
  const isTwelveCardFlip = selectedPreset?.config.game === 'twelve_card_flip';
  const isBlackjack = selectedPreset?.config.game === 'blackjack';
  const hasPreset = !!selectedPreset;

  const parsedBuyIn = parsePositiveInt(buyIn);
  const parsedSmallBlind = parsePositiveInt(smallBlind);
  const parsedBigBlind = parsePositiveInt(bigBlind);
  const parsedStraddleAmount = parsePositiveInt(straddleAmount);

  const isValidBuyIn =
    parsedBuyIn !== null && parsedBuyIn >= 10 && parsedBuyIn <= 10000 && parsedBuyIn % 5 === 0;
  const isValidBlinds = isTwelveCardFlip || isBlackjack || (parsedSmallBlind !== null && parsedBigBlind !== null);
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
    setFlipCardCount(clampFlipCardCount(selectedPreset?.config.twelveCardFlipCardCount));
  }, [presetId, selectedPreset]);

  useEffect(() => {
    if (!isRegistered) return;
    getMyTemplates().then((res) => setTemplates(res.templates));
  }, [isRegistered]);

  function loadTemplateIntoForm(template: LobbyTemplate): void {
    const s = template.settings;
    const matchedPreset = presets.find((p) => p.config.game === s.game);
    if (matchedPreset) setPresetId(matchedPreset.id);
    setBuyIn(String(s.buyIn ?? s.minBuyIn ?? 500));
    setSmallBlind(String(s.blinds?.small ?? 5));
    setBigBlind(String(s.blinds?.big ?? 10));
    setStraddleEnabled(s.game === 'holdem' && !!s.straddle);
    setStraddleAmount(String(s.straddleAmount ?? (s.blinds?.big ?? 10) * 2));
    setSevenDeuceRule(s.game === 'holdem' && !!s.sevenDeuceRule);
    setActionTimerSec(s.actionTimerSec ?? 0);
    setFlipCardCount(clampFlipCardCount(s.twelveCardFlipCardCount));
    if (s.game === 'blackjack') {
      if (s.blackjackNumDecks) setBjNumDecks(s.blackjackNumDecks);
      if (s.blackjackMinBet) setBjMinBet(String(s.blackjackMinBet));
      if (s.blackjackMaxBet) setBjMaxBet(String(s.blackjackMaxBet));
      if (s.blackjackDealerSoftSeventeen) setBjSoftSeventeen(s.blackjackDealerSoftSeventeen);
    }
  }

  function buildCurrentSettings(): VariantConfig | null {
    if (!selectedPreset || parsedBuyIn === null) return null;
    const base = selectedPreset.config;
    if (isTwelveCardFlip) {
      return {
        ...base,
        buyIn: parsedBuyIn,
        minBuyIn: parsedBuyIn,
        maxBuyIn: parsedBuyIn,
        twelveCardFlipAnte: parsedBuyIn,
        twelveCardFlipCardCount: clampFlipCardCount(flipCardCount),
        actionTimerSec: actionTimerSec > 0 ? actionTimerSec : undefined,
      };
    }
    if (isBlackjack) {
      const parsedMinBet = parsePositiveInt(bjMinBet);
      const parsedMaxBet = parsePositiveInt(bjMaxBet);
      if (!parsedMinBet || !parsedMaxBet || parsedMinBet > parsedMaxBet) return null;
      return {
        ...base,
        buyIn: parsedBuyIn,
        minBuyIn: parsedBuyIn,
        maxBuyIn: Math.max(parsedBuyIn, base.maxBuyIn),
        blackjackNumDecks: bjNumDecks,
        blackjackMinBet: parsedMinBet,
        blackjackMaxBet: parsedMaxBet,
        blackjackDealerSoftSeventeen: bjSoftSeventeen,
        actionTimerSec: actionTimerSec > 0 ? actionTimerSec : undefined,
      };
    }
    if (parsedSmallBlind === null || parsedBigBlind === null) return null;
    return {
      ...base,
      buyIn: parsedBuyIn,
      minBuyIn: parsedBuyIn,
      maxBuyIn: Math.max(parsedBuyIn, base.maxBuyIn),
      blinds: { ...base.blinds, small: parsedSmallBlind, big: parsedBigBlind },
      straddle: base.game === 'holdem' ? straddleEnabled : false,
      straddleAmount:
        base.game === 'holdem' && straddleEnabled
          ? Math.max(parsedBigBlind, parsedStraddleAmount ?? parsedBigBlind)
          : undefined,
      sevenDeuceRule: base.game === 'holdem' ? sevenDeuceRule : false,
      actionTimerSec: actionTimerSec > 0 ? actionTimerSec : undefined,
    };
  }

  async function handleSaveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    const settings = buildCurrentSettings();
    if (!settings) {
      setTemplateError('Fix form errors before saving.');
      return;
    }
    setTemplateSaving(true);
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      const saved = await saveTemplate({ name, settings });
      setTemplates((prev) => [...prev, saved]);
      setTemplateName('');
      setTemplateSuccess(`"${saved.name}" saved`);
      setTimeout(() => setTemplateSuccess(null), 3000);
    } catch (err) {
      setTemplateError((err as Error).message ?? 'Could not save template.');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    setDeletingId(id);
    try {
      await deleteMyTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // silent
    } finally {
      setDeletingId(null);
    }
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) {
      setError('Please enter valid buy-in and blind values before continuing.');
      return;
    }
    const settings = buildCurrentSettings();
    if (!settings) {
      setError(isBlackjack ? 'Bet limits must be valid positive numbers with min ≤ max.' : 'Please enter valid values before continuing.');
      return;
    }
    navigate('/name', { state: { mode: 'create', presetId, settings } });
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Create table</h1>
        <p>Set up your game rules and invite players.</p>
      </header>
      <form className="panel" onSubmit={handleNext}>

        {/* ── Lobby Templates ─────────────────────────────────────── */}
        {!isRegistered ? (
          <p className="field-hint templates-guest-hint">
            <a href="/login">Sign up</a> to save your favourite settings as reusable templates.
          </p>
        ) : (
          <fieldset className="settings-group">
            <legend>My templates</legend>

            {templates.length > 0 && (
              <ul className="templates-list">
                {templates.map((t) => (
                  <li key={t.id} className="templates-list-item">
                    <span className="templates-list-name">{t.name}</span>
                    <div className="templates-list-actions">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => loadTemplateIntoForm(t)}
                        aria-label={`Apply template "${t.name}"`}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className="btn danger small"
                        disabled={deletingId === t.id}
                        onClick={() => handleDeleteTemplate(t.id)}
                        aria-label={`Delete template "${t.name}"`}
                      >
                        {deletingId === t.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {templates.length < 20 ? (
              <div className="templates-save-form">
                <label>
                  Save current settings as template
                  <input
                    type="text"
                    placeholder='e.g. "Friday Night $1/$2"'
                    maxLength={64}
                    value={templateName}
                    onChange={(e) => { setTemplateName(e.target.value); setTemplateError(null); }}
                  />
                </label>
                {templateError && <p className="form-error">{templateError}</p>}
                {templateSuccess && <p className="templates-success">{templateSuccess}</p>}
                <button
                  type="button"
                  className="btn small"
                  disabled={!templateName.trim() || templateSaving || !isFormValid}
                  onClick={handleSaveTemplate}
                >
                  {templateSaving ? 'Saving…' : 'Save template'}
                </button>
              </div>
            ) : (
              <p className="field-hint">Template limit reached (20 max). Delete one to save a new template.</p>
            )}
          </fieldset>
        )}

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

        {isTwelveCardFlip && (
          <>
            <label>
              Cards per player: <strong>{flipCardCount}</strong>
              <input
                type="range"
                min={FLIP_MIN_CARDS}
                max={FLIP_MAX_CARDS}
                step={1}
                value={flipCardCount}
                onChange={(e) => setFlipCardCount(clampFlipCardCount(Number(e.target.value)))}
              />
            </label>
            <p className="twelve-card-flip-note">
              Heads-up bomb-pot: each player is dealt {flipCardCount} private cards ({FLIP_MIN_CARDS}–{FLIP_MAX_CARDS})
              and takes turns revealing them. Both players ante the buy-in amount before cards are dealt. No blinds, no folding.
            </p>
          </>
        )}

        {isBlackjack && (
          <fieldset className="settings-group">
            <legend>Blackjack options</legend>
            <label>
              Number of decks
              <select value={bjNumDecks} onChange={(e) => setBjNumDecks(Number(e.target.value) as 1 | 4 | 6 | 8)}>
                {([1, 4, 6, 8] as const).map((d) => (
                  <option key={d} value={d}>{d} deck{d > 1 ? 's' : ''}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum bet per hand
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={bjMinBet}
                onChange={(e) => setBjMinBet(digitsOnly(e.target.value))}
              />
            </label>
            <label>
              Maximum bet per hand
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={bjMaxBet}
                onChange={(e) => setBjMaxBet(digitsOnly(e.target.value))}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={bjSoftSeventeen === 'hit'}
                onChange={(e) => setBjSoftSeventeen(e.target.checked ? 'hit' : 'stand')}
              />
              Dealer hits soft 17 (H17 — harder for players)
            </label>
          </fieldset>
        )}

        {!isTwelveCardFlip && !isBlackjack && (
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
        )}

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
        <div className="name-selection-actions">
          <button type="submit" className="btn primary" disabled={!isFormValid}>
            Next: Choose Avatar
          </button>
          <button type="button" className="btn" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}

