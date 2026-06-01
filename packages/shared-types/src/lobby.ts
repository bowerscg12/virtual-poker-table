import type { VariantConfig } from './variant.js';
import type { AvatarConfig } from './avatar.js';

export type LobbyStatus = 'open' | 'playing' | 'paused' | 'closed';

export interface UserProfile {
  id: string;
  displayName: string;
  avatar?: AvatarConfig;
}

export interface TableSeat {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  avatar?: AvatarConfig;
  stack: number;
  sittingOut: boolean;
  isConnected: boolean;
}

export interface LobbySummary {
  id: string;
  inviteCode: string;
  hostUserId: string;
  hostDisplayName: string;
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
