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
  // Format for datetime-local input: YYYY-MM-DDTHH:MM
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
      // Try to detect multiplier
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
      <div className="page">
        <div className="panel">
          <p>You need an account to create tournaments.</p>
          <button className="btn" onClick={() => navigate('/')}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.8rem', margin: '0 0 1.25rem' }}>
        Create Tournament
      </h1>

      {templates.length > 0 && (
        <div className="panel">
          <h2>Load Template</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {templates.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
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

      <form className="panel" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2>Tournament Settings</h2>

        <div>
          <label>Variant</label>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem' }}>
            {(['holdem', 'omaha'] as const).map((v) => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input type="radio" value={v} checked={variant === v} onChange={() => setVariant(v)} />
                {v === 'holdem' ? "Hold'em" : 'Omaha'}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="buyIn">Buy-in (chips)</label>
          <input
            id="buyIn"
            type="text"
            inputMode="numeric"
            value={buyIn}
            onChange={(e) => setBuyIn(digitsOnly(e.target.value).slice(0, 7))}
          />
        </div>

        <div>
          <label htmlFor="startingStack">Starting Stack (chips)</label>
          <input
            id="startingStack"
            type="text"
            inputMode="numeric"
            value={startingStack}
            onChange={(e) => setStartingStack(digitsOnly(e.target.value).slice(0, 8))}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label htmlFor="numTables">Tables</label>
            <input
              id="numTables"
              type="text"
              inputMode="numeric"
              value={numTables}
              onChange={(e) => setNumTables(digitsOnly(e.target.value).slice(0, 2))}
            />
          </div>
          <div>
            <label htmlFor="seatsPerTable">Seats per Table</label>
            <input
              id="seatsPerTable"
              type="text"
              inputMode="numeric"
              value={seatsPerTable}
              onChange={(e) => setSeatsPerTable(digitsOnly(e.target.value).slice(0, 1))}
            />
            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>2–9</span>
          </div>
        </div>

        <div>
          <label htmlFor="scheduledStart">Scheduled Start</label>
          <input
            id="scheduledStart"
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            min={minFutureDate()}
          />
        </div>

        <h3 style={{ margin: '0.5rem 0 0', fontSize: '1rem', color: 'var(--gold)' }}>Blind Schedule</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label htmlFor="initialSmall">Initial Small Blind</label>
            <input
              id="initialSmall"
              type="text"
              inputMode="numeric"
              value={initialSmall}
              onChange={(e) => setInitialSmall(digitsOnly(e.target.value).slice(0, 6))}
            />
          </div>
          <div>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label>Blind Multiplier</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
              {([2, 3, 4] as const).map((m) => (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                  <input type="radio" value={m} checked={multiplier === m} onChange={() => setMultiplier(m)} />
                  {m}×
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="numLevels">Number of Levels</label>
            <input
              id="numLevels"
              type="text"
              inputMode="numeric"
              value={numLevels}
              onChange={(e) => setNumLevels(digitsOnly(e.target.value).slice(0, 2))}
            />
            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>min 3</span>
          </div>
        </div>

        {blindSchedule.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '0.75rem', overflowX: 'auto' }}>
            <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>Blind Schedule Preview</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ opacity: 0.6 }}>
                  <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Level</th>
                  <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Small</th>
                  <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Big</th>
                  <th style={{ textAlign: 'left' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {blindSchedule.map((l) => (
                  <tr key={l.level}>
                    <td style={{ paddingRight: '1rem', paddingTop: '0.2rem' }}>{l.level}</td>
                    <td style={{ paddingRight: '1rem' }}>{l.small.toLocaleString()}</td>
                    <td style={{ paddingRight: '1rem' }}>{l.big.toLocaleString()}</td>
                    <td>{l.durationMinutes}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p style={{ color: 'var(--error, #f56)', margin: 0 }}>{error}</p>}

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
          <form onSubmit={handleSaveTemplate} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value.slice(0, 40))}
              style={{ flex: 1 }}
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
