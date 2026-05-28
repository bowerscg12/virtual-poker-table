import type { VariantConfig } from './variant.js';

export type LobbyStatus = 'open' | 'playing' | 'paused' | 'closed';

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface TableSeat {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  stack: number;
  sittingOut: boolean;
  isConnected: boolean;
}

export interface LobbySummary {
  id: string;
  inviteCode: string;
  hostUserId: string;
  status: LobbyStatus;
  settings: VariantConfig;
  seats: TableSeat[];
  createdAt: string;
}

export interface CreateLobbyRequest {
  settings: VariantConfig;
  presetId?: string;
}

export interface JoinLobbyResponse {
  lobby: LobbySummary;
  token: string;
}
