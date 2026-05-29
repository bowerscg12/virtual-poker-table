import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RulesPreset, VariantConfig } from '@vct/shared-types';
import { createLobby, getPresets } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function CreateLobbyPage() {
  const { token, user, loginGuest } = useAuth();
  const [presets, setPresets] = useState<RulesPreset[]>([]);
  const [presetId, setPresetId] = useState('nlhe-standard');
  const [buyIn, setBuyIn] = useState(500);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getPresets().then((r) => {
      setPresets(r.presets);
      const first = r.presets.find((p) => p.id === 'nlhe-standard') ?? r.presets[0];
      if (first) setBuyIn(first.config.buyIn ?? first.config.minBuyIn);
    });
  }, []);

  useEffect(() => {
    const preset = presets.find((p) => p.id === presetId);
    if (preset) setBuyIn(preset.config.buyIn ?? preset.config.minBuyIn);
  }, [presetId, presets]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user && name.trim()) await loginGuest(name.trim());
    const preset = presets.find((p) => p.id === presetId);
    const base: VariantConfig = preset?.config ?? presets[0]!.config;
    const settings: VariantConfig = {
      ...base,
      buyIn,
      minBuyIn: buyIn,
      maxBuyIn: Math.max(buyIn, base.maxBuyIn),
    };
    const { lobby } = await createLobby({ presetId, settings });
    navigate(`/table/${lobby.id}`);
  }

  if (!token && !name) {
    return (
      <div className="page">
        <form className="panel" onSubmit={(e) => { e.preventDefault(); handleCreate(e); }}>
          <h2>Your name</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
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
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buy-in per player (chips)
          <input
            type="number"
            min={1}
            step={50}
            value={buyIn}
            onChange={(e) => setBuyIn(Math.max(1, parseInt(e.target.value, 10) || 0))}
          />
        </label>
        <p className="field-hint">Each player receives this stack when they join the table.</p>
        <button type="submit" className="btn primary">
          Create &amp; open table
        </button>
      </form>
    </div>
  );
}
