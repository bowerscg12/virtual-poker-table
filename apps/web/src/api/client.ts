import type { AuthResponse, CreateLobbyRequest, LobbySummary, RulesPreset } from '@vct/shared-types';

const API = '/api';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('vct_token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
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

export async function createLobby(req: CreateLobbyRequest): Promise<{ lobby: LobbySummary }> {
  const res = await fetch(`${API}/lobbies`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error('Create lobby failed');
  return res.json();
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
