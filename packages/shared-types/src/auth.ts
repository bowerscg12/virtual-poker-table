import type { AvatarConfig } from './avatar.js';

export interface AuthUser {
  id: string;
  displayName: string;
  avatar?: AvatarConfig;
  isGuest: boolean;
}

export interface RegisterRequest {
  displayName: string;
  email?: string;
  password?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GuestLoginRequest {
  displayName: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

/** Returned by POST /api/lobbies and POST /api/lobbies/:id/enter */
export interface EnterLobbyResponse {
  user: AuthUser;
  token: string;
  sessionId: string;
}

/** Returned by GET /api/me/seat when the player has an active reserved seat */
export interface ActiveSeatInfo {
  lobbyId: string;
  inviteCode: string;
  hostDisplayName: string;
  seatIndex: number;
  stack: number;
  /** ISO timestamp when the player's WS disconnected; null if still connected. */
  disconnectedAt: string | null;
  /** ISO timestamp when the rejoin window closes; null if no expiry (still connected). */
  expiresAt: string | null;
}
