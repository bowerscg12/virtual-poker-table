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
