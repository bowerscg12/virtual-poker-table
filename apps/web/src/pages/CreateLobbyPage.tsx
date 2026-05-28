import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RulesPreset } from '@vct/shared-types';
import { createLobby, getPresets } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function CreateLobbyPage() {
  const { token, user, loginGuest } = useAuth();
  const [presets, setPresets] = useState<RulesPreset[]>([]);
  const [presetId, setPresetId] = useState('nlhe-standard');
  const [name, setName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getPresets().then((r) => setPresets(r.presets));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user && name.trim()) await loginGuest(name.trim());
    const preset = presets.find((p) => p.id === presetId);
    const { lobby } = await createLobby({
      presetId,
      settings: preset?.config ?? presets[0]!.config,
    });
    navigate(`/table/${lobby.id}`);
  }

  if (!token && !name) {
    return (
      <div className="page">
        <form className="card" onSubmit={(e) => { e.preventDefault(); handleCreate(e); }}>
          <h2>Your name</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
          <button type="submit">Next</button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <form className="card" onSubmit={handleCreate}>
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
        <button type="submit" className="btn primary">
          Create &amp; open table
        </button>
      </form>
    </div>
  );
}
