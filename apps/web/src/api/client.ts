import type { ActiveSeatInfo, AuthResponse, AuthUser, AvatarConfig, CreateLobbyRequest, CreateTemplateRequest, EnterLobbyResponse, LobbyTemplate, LobbySummary, RulesPreset, TournamentSettings, TournamentSummary, TournamentTemplate, PublicTournamentState } from '@vct/shared-types';

const API = import.meta.env.VITE_SERVER_URL ? `${import.meta.env.VITE_SERVER_URL}/api` : '/api';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  const token = localStorage.getItem('vct_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

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
  return res.json() as Promise<AuthResponse>;
}

export async function loginAccount(username: string, password: string): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('Cannot reach game server. Run: npm run dev -w @vct/game-server');
  }
  if (res.status === 401) throw new Error('Invalid username or password.');
  if (!res.ok) throw new Error('Sign in failed. Please try again.');
  return res.json() as Promise<AuthResponse>;
}

export async function registerAccount(displayName: string, username: string, password: string): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, username, password }),
    });
  } catch {
    throw new Error('Cannot reach game server. Run: npm run dev -w @vct/game-server');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Registration failed. Please try again.');
  }
  return res.json() as Promise<AuthResponse>;
}

/**
 * Create a new table and enter it in one request.
 * If the user is already authenticated, their existing identity is reused.
 * Returns user, token, sessionId, and the new lobby.
 */
export async function createTableAndEnter(
  displayName: string,
  req: CreateLobbyRequest,
  avatar?: AvatarConfig
): Promise<EnterLobbyResponse & { lobby: LobbySummary }> {
  let res: Response;
  try {
    res = await fetch(`${API}/lobbies`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ displayName, avatar, ...req }),
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
 * Join an existing table by lobbyId.
 * If the user is already authenticated, their existing identity is reused.
 * Throws with code 'NAME_TAKEN' if the name is already in use (unauthenticated path only).
 */
export async function enterLobby(lobbyId: string, displayName: string, avatar?: AvatarConfig): Promise<EnterLobbyResponse> {
  let res: Response;
  try {
    res = await fetch(`${API}/lobbies/${lobbyId}/enter`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ displayName, avatar }),
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

export async function updateDisplayName(displayName: string): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API}/auth/me`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not update display name.');
  }
  return res.json() as Promise<{ user: AuthUser }>;
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

export async function getActiveSeat(): Promise<{ seat: ActiveSeatInfo | null }> {
  try {
    const res = await fetch(`${API}/me/seat`, { headers: authHeaders() });
    if (!res.ok) return { seat: null };
    return res.json() as Promise<{ seat: ActiveSeatInfo | null }>;
  } catch {
    return { seat: null };
  }
}

export async function releaseActiveSeat(): Promise<void> {
  try {
    await fetch(`${API}/me/seat`, { method: 'DELETE', headers: authHeaders() });
  } catch {
    // ignore — seat will be released by server-side timer anyway
  }
}

export async function getMyTemplates(): Promise<{ templates: LobbyTemplate[] }> {
  try {
    const res = await fetch(`${API}/templates`, { headers: authHeaders() });
    if (!res.ok) return { templates: [] };
    return res.json() as Promise<{ templates: LobbyTemplate[] }>;
  } catch {
    return { templates: [] };
  }
}

export async function saveTemplate(req: CreateTemplateRequest): Promise<LobbyTemplate> {
  const res = await fetch(`${API}/templates`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not save template');
  }
  const data = await res.json() as { template: LobbyTemplate };
  return data.template;
}

export async function deleteMyTemplate(templateId: string): Promise<void> {
  const res = await fetch(`${API}/templates/${templateId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not delete template');
  }
}

// ── Chip wallet ───────────────────────────────────────────────────────────────

export async function getWallet(): Promise<{ chipBalance: number; lastDailyClaim: string | null }> {
  const res = await fetch(`${API}/wallet`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Could not fetch wallet');
  return res.json();
}

export async function claimDailyChips(): Promise<{ chipBalance: number }> {
  const res = await fetch(`${API}/wallet/claim-daily`, { method: 'POST', headers: authHeaders(), body: '{}' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not claim daily chips');
  }
  return res.json();
}

// ── Tournaments ───────────────────────────────────────────────────────────────

export async function createTournament(settings: TournamentSettings): Promise<{ id: string; inviteCode: string }> {
  const res = await fetch(`${API}/tournaments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not create tournament');
  }
  return res.json();
}

export async function getTournamentById(id: string): Promise<{ tournament: PublicTournamentState & { registrations: unknown[] } }> {
  const res = await fetch(`${API}/tournaments/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Tournament not found');
  return res.json();
}

export async function getTournamentByCode(code: string): Promise<{ tournament: PublicTournamentState & { registrations: unknown[] } }> {
  const res = await fetch(`${API}/tournaments/invite/${code.toUpperCase()}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Tournament not found');
  return res.json();
}

export async function listTournaments(): Promise<{ tournaments: TournamentSummary[] }> {
  const res = await fetch(`${API}/tournaments`, { headers: authHeaders() });
  if (!res.ok) return { tournaments: [] };
  return res.json();
}

export async function registerForTournament(id: string): Promise<void> {
  const res = await fetch(`${API}/tournaments/${id}/register`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not register');
  }
}

export async function unregisterFromTournament(id: string): Promise<void> {
  const res = await fetch(`${API}/tournaments/${id}/register`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not unregister');
  }
}

export async function hostStartTournament(id: string): Promise<void> {
  const res = await fetch(`${API}/tournaments/${id}/start`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not start tournament');
  }
}

export async function hostCancelTournament(id: string): Promise<void> {
  const res = await fetch(`${API}/tournaments/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not cancel tournament');
  }
}

export async function getTournamentTemplates(): Promise<{ templates: TournamentTemplate[] }> {
  const res = await fetch(`${API}/tournament-templates`, { headers: authHeaders() });
  if (!res.ok) return { templates: [] };
  return res.json();
}

export async function saveTournamentTemplate(name: string, settings: TournamentSettings): Promise<TournamentTemplate> {
  const res = await fetch(`${API}/tournament-templates`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, settings }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Could not save template');
  }
  const data = await res.json() as { template: TournamentTemplate };
  return data.template;
}

export async function deleteTournamentTemplate(id: string): Promise<void> {
  await fetch(`${API}/tournament-templates/${id}`, { method: 'DELETE', headers: authHeaders() });
}

export function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  if (import.meta.env.DEV) return `${proto}//${host}/ws`;
  const serverUrl = import.meta.env.VITE_SERVER_URL;
  if (serverUrl) return `${serverUrl.replace(/^http/, 'ws')}/ws`;
  return `${proto}//${host}/ws`;
}
