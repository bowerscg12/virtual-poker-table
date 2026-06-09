import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BlindLevel, TournamentSettings, TournamentTemplate } from '@vct/shared-types';
import {
  createTournament,
  getTournamentTemplates,
  saveTournamentTemplate,
  deleteTournamentTemplate,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

function buildBlindSchedule(
  initialSmall: number,
  numLevels: number,
  multiplier: number,
  durationMinutes: number
): BlindLevel[] {
  const levels: BlindLevel[] = [];
  let small = initialSmall;
  for (let i = 0; i < numLevels; i++) {
    levels.push({
      level: i + 1,
      small: Math.round(small),
      big: Math.round(small * 2),
      durationMinutes,
    });
    small = small * multiplier;
  }
  return levels;
}

function digitsOnly(v: string) { return v.replace(/[^\d]/g, ''); }
function parsePositiveInt(v: string): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function minFutureDate(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateTournamentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [variant, setVariant] = useState<'holdem' | 'omaha'>('holdem');
  const [buyIn, setBuyIn] = useState('1000');
  const [startingStack, setStartingStack] = useState('5000');
  const [numTables, setNumTables] = useState('1');
  const [seatsPerTable, setSeatsPerTable] = useState('9');
  const [scheduledStart, setScheduledStart] = useState(minFutureDate());
  const [initialSmall, setInitialSmall] = useState('25');
  const [numLevels, setNumLevels] = useState('8');
  const [multiplier, setMultiplier] = useState<2 | 3 | 4>(2);
  const [levelDuration, setLevelDuration] = useState('15');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  useEffect(() => {
    getTournamentTemplates().then((d) => setTemplates(d.templates)).catch(() => setTemplates([]));
  }, []);

  const blindSchedule = useMemo(() => {
    const small = parsePositiveInt(initialSmall);
    const levels = parsePositiveInt(numLevels);
    const dur = parsePositiveInt(levelDuration);
    if (!small || !levels || !dur) return [];
    return buildBlindSchedule(small, Math.min(levels, 20), multiplier, dur);
  }, [initialSmall, numLevels, multiplier, levelDuration]);

  function buildSettings(): TournamentSettings | null {
    const bi = parsePositiveInt(buyIn);
    const ss = parsePositiveInt(startingStack);
    const nt = parsePositiveInt(numTables);
    const spt = parsePositiveInt(seatsPerTable);
    if (!bi || !ss || !nt || !spt) return null;
    if (blindSchedule.length < 3) return null;
    const startDate = new Date(scheduledStart);
    if (isNaN(startDate.getTime()) || startDate < new Date(Date.now() + 60_000)) return null;
    return {
      variant,
      buyIn: bi,
      startingStack: ss,
      numTables: Math.min(nt, 10),
      seatsPerTable: Math.min(Math.max(spt, 2), 9),
      scheduledStart: startDate.toISOString(),
      blindSchedule,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const settings = buildSettings();
    if (!settings) {
      setError('Please fill in all fields correctly. Need at least 3 blind levels and a future start time.');
      return;
    }
    setSubmitting(true);
    try {
      const { id } = await createTournament(settings);
      navigate(`/tournaments/${id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function loadTemplate(template: TournamentTemplate) {
    const s = template.settings;
    setVariant(s.variant);
    setBuyIn(String(s.buyIn));
    setStartingStack(String(s.startingStack));
    setNumTables(String(s.numTables));
    setSeatsPerTable(String(s.seatsPerTable));
    if (s.blindSchedule.length > 0) {
      const first = s.blindSchedule[0];
      setInitialSmall(String(first.small));
      setNumLevels(String(s.blindSchedule.length));
      setLevelDuration(String(first.durationMinutes));
      if (s.blindSchedule.length >= 2) {
        const ratio = s.blindSchedule[1].small / s.blindSchedule[0].small;
        if (Math.round(ratio) === 4) setMultiplier(4);
        else if (Math.round(ratio) === 3) setMultiplier(3);
        else setMultiplier(2);
      }
    }
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    const settings = buildSettings();
    if (!settings || !templateName.trim()) return;
    setSavingTemplate(true);
    try {
      const t = await saveTournamentTemplate(templateName.trim(), settings);
      setTemplates((prev) => [...prev, t]);
      setTemplateName('');
      setShowSaveTemplate(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    await deleteTournamentTemplate(id).catch(() => {});
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  if (user?.isGuest) {
    return (
      <div className="page home">
        <header className="hero">
          <h1>Create Tournament</h1>
        </header>
        <div className="panel">
          <p>You need an account to create tournaments.</p>
          <button className="btn" onClick={() => navigate('/')}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Create Tournament</h1>
        <p>Set up blind schedules and prize pools.</p>
      </header>

      {templates.length > 0 && (
        <div className="panel">
          <p className="home-section-label"><span aria-hidden="true">♠</span> Load Template</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {templates.map((t) => (
              <div key={t.id} className="templates-list-item">
                <button className="btn small" onClick={() => loadTemplate(t)} style={{ flex: 1, textAlign: 'left' }}>
                  {t.name}
                </button>
                <button className="btn small" style={{ opacity: 0.6 }} onClick={() => handleDeleteTemplate(t.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form className="panel" onSubmit={handleSubmit}>
        <p className="home-section-label"><span aria-hidden="true">♦</span> Tournament Settings</p>

        <div className="form-field">
          <label>Variant</label>
          <div className="radio-group">
            {(['holdem', 'omaha'] as const).map((v) => (
              <label key={v} className="radio-label">
                <input type="radio" value={v} checked={variant === v} onChange={() => setVariant(v)} />
                {v === 'holdem' ? "Hold'em" : 'Omaha'}
              </label>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="buyIn">Buy-in (chips)</label>
          <input
            id="buyIn"
            type="text"
            inputMode="numeric"
            value={buyIn}
            onChange={(e) => setBuyIn(digitsOnly(e.target.value).slice(0, 7))}
          />
        </div>

        <div className="form-field">
          <label htmlFor="startingStack">Starting Stack (chips)</label>
          <input
            id="startingStack"
            type="text"
            inputMode="numeric"
            value={startingStack}
            onChange={(e) => setStartingStack(digitsOnly(e.target.value).slice(0, 8))}
          />
        </div>

        <div className="form-grid-2">
          <div className="form-field">
            <label htmlFor="numTables">Tables</label>
            <input
              id="numTables"
              type="text"
              inputMode="numeric"
              value={numTables}
              onChange={(e) => setNumTables(digitsOnly(e.target.value).slice(0, 2))}
            />
          </div>
          <div className="form-field">
            <label htmlFor="seatsPerTable">Seats per Table</label>
            <input
              id="seatsPerTable"
              type="text"
              inputMode="numeric"
              value={seatsPerTable}
              onChange={(e) => setSeatsPerTable(digitsOnly(e.target.value).slice(0, 1))}
            />
            <span className="form-hint">2–9</span>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="scheduledStart">Scheduled Start</label>
          <input
            id="scheduledStart"
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            min={minFutureDate()}
          />
        </div>

        <div className="home-suit-divider" aria-hidden="true"><span>♣</span><span>♣</span></div>

        <p className="home-section-label" style={{ margin: 0 }}><span aria-hidden="true">♥</span> Blind Schedule</p>

        <div className="form-grid-2">
          <div className="form-field">
            <label htmlFor="initialSmall">Initial Small Blind</label>
            <input
              id="initialSmall"
              type="text"
              inputMode="numeric"
              value={initialSmall}
              onChange={(e) => setInitialSmall(digitsOnly(e.target.value).slice(0, 6))}
            />
          </div>
          <div className="form-field">
            <label htmlFor="levelDuration">Level Duration (min)</label>
            <input
              id="levelDuration"
              type="text"
              inputMode="numeric"
              value={levelDuration}
              onChange={(e) => setLevelDuration(digitsOnly(e.target.value).slice(0, 3))}
            />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-field">
            <label>Blind Multiplier</label>
            <div className="radio-group">
              {([2, 3, 4] as const).map((m) => (
                <label key={m} className="radio-label">
                  <input type="radio" value={m} checked={multiplier === m} onChange={() => setMultiplier(m)} />
                  {m}×
                </label>
              ))}
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="numLevels">Number of Levels</label>
            <input
              id="numLevels"
              type="text"
              inputMode="numeric"
              value={numLevels}
              onChange={(e) => setNumLevels(digitsOnly(e.target.value).slice(0, 2))}
            />
            <span className="form-hint">min 3</span>
          </div>
        </div>

        {blindSchedule.length > 0 && (
          <div className="blind-schedule-preview">
            <p className="blind-schedule-label">Blind Schedule Preview</p>
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
                {blindSchedule.map((l) => (
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
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="name-selection-actions">
          <button type="submit" className="btn primary" disabled={submitting || blindSchedule.length < 3}>
            {submitting ? 'Creating...' : 'Create Tournament'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowSaveTemplate(!showSaveTemplate)}
            disabled={blindSchedule.length < 3}
          >
            Save as Template
          </button>
          <button type="button" className="btn" onClick={() => navigate('/tournaments')}>
            Back
          </button>
        </div>

        {showSaveTemplate && (
          <form onSubmit={handleSaveTemplate} className="join-code-row" style={{ marginTop: '0.25rem' }}>
            <input
              type="text"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value.slice(0, 40))}
            />
            <button type="submit" className="btn small primary" disabled={savingTemplate || !templateName.trim()}>
              {savingTemplate ? 'Saving...' : 'Save'}
            </button>
          </form>
        )}
      </form>
    </div>
  );
}
