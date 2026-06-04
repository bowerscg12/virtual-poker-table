import type { AvatarConfig, VariantConfig } from '@vct/shared-types';
import type { LobbyStatus } from '@vct/shared-types';
import { randomUUID } from 'crypto';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 5);

export interface MemoryUser {
  id: string;
  displayName: string;
  username?: string;
  passwordHash?: string;
  avatarUrl?: string;
  avatar?: AvatarConfig;
  isGuest: boolean;
  createdAt: string;
}

export interface MemorySeat {
  seatIndex: number;
  userId: string | null;
  stack: number;
  sittingOut: boolean;
  sitOutNextHand: boolean;
  sitOutBlindOwed: boolean;
  waitingForReentryBlind: boolean;
  /** ISO timestamp when the current occupant took this seat — null when empty. Drives host-succession join order. */
  seatedAt: string | null;
}

export interface MemoryLobby {
  id: string;
  hostUserId: string | null;
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

export function memoryCreateUser(data: Omit<MemoryUser, 'id' | 'createdAt'>): MemoryUser {
  const user: MemoryUser = { id: randomUUID(), createdAt: new Date().toISOString(), ...data };
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
      waitingForReentryBlind: false,
      seatedAt: null,
    })),
    createdAt: new Date().toISOString(),
  };
  memoryStore.lobbies.set(lobby.id, lobby);
  memoryStore.inviteIndex.set(lobby.inviteCode, lobby.id);
  return lobby;
}
