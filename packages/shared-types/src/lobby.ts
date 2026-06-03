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
  /** Player has requested to sit out starting next hand */
  sitOutNextHand: boolean;
  /** True on the first sit-out hand — player still owes their next blind cycle */
  sitOutBlindOwed: boolean;
  /** Player rebuyed after busting and must post a big blind before re-entering active play */
  waitingForReentryBlind: boolean;
}

export interface LobbySummary {
  id: string;
  inviteCode: string;
  /** null when the original host guest account has been cleaned up */
  hostUserId: string | null;
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
