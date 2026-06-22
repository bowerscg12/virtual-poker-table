import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import type { AvatarConfig, VariantConfig } from '@vct/shared-types';
import { DEFAULT_AVATAR, coerceAvatar } from '@vct/shared-types';
import { createTableAndEnter, enterLobby, getLobbyById } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { AvatarCreator } from '../components/AvatarCreator';
import { CareerStatsPanel } from '../components/CareerStatsPanel';
import { BlackjackStatsPanel } from '../components/BlackjackStatsPanel';

interface CreateState {
  mode: 'create';
  presetId?: string;
  settings: VariantConfig;
}

interface JoinState {
  mode: 'join';
}

type LocationState = CreateState | JoinState | null;

const AVATAR_STORAGE_KEY = 'vct_avatar';

function loadSavedAvatar(): AvatarConfig {
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    // Coerce so older saved configs that reference removed hairstyles fall back
    // to a valid style rather than rendering a broken avatar.
    if (raw) return coerceAvatar(JSON.parse(raw) as Partial<AvatarConfig>);
  } catch {
    // ignore
  }
  return DEFAULT_AVATAR;
}

function saveAvatar(avatar: AvatarConfig) {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(avatar));
  } catch {
    // ignore
  }
}

export default function NameSelectionPage() {
  const { lobbyId } = useParams<{ lobbyId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setAuthDirect } = useAuth();

  const state = (location.state ?? null) as LocationState;
  const isCreate = state?.mode === 'create';

  // Pre-fill name from the authenticated user's display name
  const [name, setName] = useState(() => user?.displayName ?? '');
  const [avatar, setAvatar] = useState<AvatarConfig>(loadSavedAvatar);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lobbyName, setLobbyName] = useState<string | null>(null);
  // The game variant of the table being created/joined — drives which stats panel to show.
  const [joinGame, setJoinGame] = useState<VariantConfig['game'] | null>(null);
  const chosenGame: VariantConfig['game'] | null =
    isCreate && state?.mode === 'create' ? state.settings.game : joinGame;
  const isBlackjackTable = chosenGame === 'blackjack';

  // Name is fixed for registered (non-guest) accounts
  const nameIsFixed = user != null && !user.isGuest;

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
        .then(({ lobby }) => {
          setLobbyName(`${lobby.hostDisplayName}'s Table`);
          setJoinGame(lobby.settings.game);
        })
        .catch(() => {});
    }
  }, [isCreate, lobbyId]);

  function handleAvatarChange(next: AvatarConfig) {
    setAvatar(next);
    saveAvatar(next);
  }

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
        }, avatar);
        setAuthDirect(res.user, res.token, res.sessionId);
        navigate(`/table/${res.lobby.id}`, { replace: true });
      } else if (lobbyId) {
        const res = await enterLobby(lobbyId, trimmed, avatar);
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

  const subtitle = isCreate
    ? 'Customize your avatar for this table.'
    : lobbyName
    ? `Joining ${lobbyName}`
    : 'Customize your avatar for this table.';

  return (
    <div className="page home">
      <header className="hero">
        <h1>Customize your player</h1>
        <p>{subtitle}</p>
      </header>
      <form className="panel" onSubmit={handleSubmit}>
        {nameIsFixed ? (
          <div className="name-display">
            <span className="name-display-label">Playing as</span>
            <span className="name-display-value">{name}</span>
          </div>
        ) : (
          <>
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
            <p className="field-hint">Max 10 characters.</p>
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <hr className="avatar-divider" />

        <AvatarCreator value={avatar} onChange={handleAvatarChange} />

        {nameIsFixed && (isBlackjackTable ? <BlackjackStatsPanel /> : <CareerStatsPanel />)}

        <div className="name-selection-actions">
          <button type="submit" className="btn primary" disabled={loading || !name.trim()}>
            {loading
              ? (isCreate ? 'Creating table…' : 'Joining…')
              : isCreate ? 'Create & enter table' : 'Enter table'}
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
