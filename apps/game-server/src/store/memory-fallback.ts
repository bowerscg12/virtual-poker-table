import type { AvatarConfig, VariantConfig } from '@vct/shared-types';
import type { LobbyStatus } from '@vct/shared-types';
import { randomUUID } from 'crypto';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 5);

export interface MemoryUser {
  id: string;
  displayName: string;
  email?: string;
  passwordHash?: string;
  avatarUrl?: string;
  avatar?: AvatarConfig;
  isGuest: boolean;
}

export interface MemorySeat {
  seatIndex: number;
  userId: string | null;
  stack: number;
  sittingOut: boolean;
  sitOutNextHand: boolean;
  sitOutBlindOwed: boolean;
}

export interface MemoryLobby {
  id: string;
  hostUserId: string;
  inviteCode: string;
  status: LobbyStatus;
  settings: VariantConfig;
  seats: MemorySeat[];
  createdAt: string;
}

export interface MemoryHandHistory {
  id: string;
  lobbyId: string;
  handNumber: number;
  data: unknown;
  createdAt: string;
}

export interface MemorySession {
  id: string;
  userId: string;
  lobbyId: string | null;
  disconnectedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** In-memory store when Postgres is unavailable (local dev / tests) */
export const memoryStore = {
  users: new Map<string, MemoryUser>(),
  lobbies: new Map<string, MemoryLobby>(),
  inviteIndex: new Map<string, string>(),
  handHistories: [] as MemoryHandHistory[],
  sessions: new Map<string, MemorySession>(),
};

export function memoryCreateUser(data: Omit<MemoryUser, 'id'>): MemoryUser {
  const user = { id: randomUUID(), ...data };
  memoryStore.users.set(user.id, user);
  return user;
}

export function memoryCreateLobby(hostUserId: string, settings: VariantConfig): MemoryLobby {
  const maxPlayers = settings.maxPlayers;
  const lobby: MemoryLobby = {
    id: randomUUID(),
    hostUserId,
    inviteCode: nanoid(),
    status: 'open',
    settings,
    seats: Array.from({ length: maxPlayers }, (_, i) => ({
      seatIndex: i,
      userId: null,
      stack: 0,
      sittingOut: false,
      sitOutNextHand: false,
      sitOutBlindOwed: false,
    })),
    createdAt: new Date().toISOString(),
  };
  memoryStore.lobbies.set(lobby.id, lobby);
  memoryStore.inviteIndex.set(lobby.inviteCode, lobby.id);
  return lobby;
}
