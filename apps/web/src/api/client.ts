import type { AuthResponse, CreateLobbyRequest, EnterLobbyResponse, LobbySummary, RulesPreset } from '@vct/shared-types';

const API = '/api';

export async function guestLogin(displayName: string): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  } catch {
    throw new Error('Cannot reach game server. Run: npm run dev -w @vct/game-server');
  }
  if (!res.ok) throw new Error('Login failed');
  const data = (await res.json()) as AuthResponse;
  localStorage.setItem('vct_token', data.token);
  return data;
}

export async function register(displayName: string, email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, email, password }),
  });
  if (!res.ok) throw new Error('Register failed');
  const data = (await res.json()) as AuthResponse;
  localStorage.setItem('vct_token', data.token);
  return data;
}

/**
 * Create a new table and enter it in one request.
 * No auth required — identity is created server-side.
 * Returns user, token, sessionId, and the new lobby.
 */
export async function createTableAndEnter(
  displayName: string,
  req: CreateLobbyRequest
): Promise<EnterLobbyResponse & { lobby: LobbySummary }> {
  let res: Response;
  try {
    res = await fetch(`${API}/lobbies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, ...req }),
    });
  } catch {
    throw new Error('Cannot reach game server. Run: npm run dev -w @vct/game-server');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
    const e = new Error(err.error ?? 'Could not create table') as Error & { code?: string };
    e.code = err.code;
    throw e;
  }
  const data = await res.json() as EnterLobbyResponse & { lobby: LobbySummary };
  localStorage.setItem('vct_token', data.token);
  localStorage.setItem('vct_session_id', data.sessionId);
  return data;
}

/**
 * Join an existing table by lobbyId with a chosen display name.
 * No auth required — identity is created server-side after name validation.
 * Throws with code 'NAME_TAKEN' if the name is already in use at this table.
 */
export async function enterLobby(lobbyId: string, displayName: string): Promise<EnterLobbyResponse> {
  let res: Response;
  try {
    res = await fetch(`${API}/lobbies/${lobbyId}/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  } catch {
    throw new Error('Cannot reach game server. Run: npm run dev -w @vct/game-server');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
    const e = new Error(err.error ?? 'Could not join table') as Error & { code?: string };
    e.code = err.code;
    throw e;
  }
  const data = await res.json() as EnterLobbyResponse;
  localStorage.setItem('vct_token', data.token);
  localStorage.setItem('vct_session_id', data.sessionId);
  return data;
}

export async function getLobbyByInvite(code: string): Promise<{ lobby: LobbySummary }> {
  const res = await fetch(`${API}/lobbies/invite/${code}`);
  if (!res.ok) throw new Error('Lobby not found');
  return res.json();
}

export async function getLobbyById(id: string): Promise<{ lobby: LobbySummary }> {
  const res = await fetch(`${API}/lobbies/${id}`);
  if (!res.ok) throw new Error('Lobby not found');
  return res.json();
}

export async function getPresets(): Promise<{ presets: RulesPreset[] }> {
  const res = await fetch(`${API}/presets`);
  return res.json();
}

export async function getHandHistory(lobbyId: string): Promise<{ hands: unknown[] }> {
  const res = await fetch(`${API}/lobbies/${lobbyId}/hands`);
  return res.json();
}

export function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  if (import.meta.env.DEV) return `${proto}//${host}/ws`;
  return `${proto}//${host}/ws`;
}
