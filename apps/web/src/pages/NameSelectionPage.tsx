import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import type { VariantConfig } from '@vct/shared-types';
import { createTableAndEnter, enterLobby, getLobbyById } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface CreateState {
  mode: 'create';
  presetId?: string;
  settings: VariantConfig;
}

interface JoinState {
  mode: 'join';
}

type LocationState = CreateState | JoinState | null;

export default function NameSelectionPage() {
  const { lobbyId } = useParams<{ lobbyId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { setAuthDirect } = useAuth();

  const state = (location.state ?? null) as LocationState;
  const isCreate = state?.mode === 'create';

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lobbyName, setLobbyName] = useState<string | null>(null);

  // Redirect to home if we're in create mode but have no settings state
  useEffect(() => {
    if (!isCreate && !lobbyId) {
      navigate('/', { replace: true });
      return;
    }
    if (isCreate && (!state || state.mode !== 'create' || !state.settings)) {
      navigate('/create', { replace: true });
      return;
    }
  }, [isCreate, lobbyId, state, navigate]);

  // Fetch lobby name for display in join mode
  useEffect(() => {
    if (!isCreate && lobbyId) {
      getLobbyById(lobbyId)
        .then(({ lobby }) => setLobbyName(`${lobby.hostDisplayName}'s Table`))
        .catch(() => {});
    }
  }, [isCreate, lobbyId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    setLoading(true);

    try {
      if (isCreate && state?.mode === 'create') {
        const res = await createTableAndEnter(trimmed, {
          presetId: state.presetId,
          settings: state.settings,
        });
        setAuthDirect(res.user, res.token, res.sessionId);
        navigate(`/table/${res.lobby.id}`, { replace: true });
      } else if (lobbyId) {
        const res = await enterLobby(lobbyId, trimmed);
        setAuthDirect(res.user, res.token, res.sessionId);
        navigate(`/table/${lobbyId}`, { replace: true });
      }
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'NAME_TAKEN') {
        setError('That name is already taken at this table. Please choose another name.');
      } else if (e.code === 'TABLE_FULL') {
        setError('This table is full. Ask the host to make room or try another table.');
      } else {
        setError(e.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const title = isCreate ? 'Choose your name' : 'Choose your name';
  const subtitle = isCreate
    ? 'Pick the display name others will see at your table.'
    : lobbyName
    ? `Joining ${lobbyName}`
    : 'Choose your name for this table.';

  return (
    <div className="page">
      <form className="panel" onSubmit={handleSubmit}>
        <h2>{title}</h2>
        <p className="field-hint">{subtitle}</p>
        <input
          type="text"
          placeholder="Your display name"
          value={name}
          onChange={(e) => {
            setName(e.target.value.slice(0, 10));
            if (error) setError(null);
          }}
          maxLength={10}
          autoComplete="nickname"
          autoFocus
          disabled={loading}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="field-hint">Max 10 characters.</p>
        <div className="name-selection-actions">
          <button type="submit" className="btn primary" disabled={loading || !name.trim()}>
            {loading ? (isCreate ? 'Creating table…' : 'Joining…') : isCreate ? 'Create & enter table' : 'Enter table'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(isCreate ? '/create' : '/join')}
            disabled={loading}
          >
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
