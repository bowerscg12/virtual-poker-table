export interface AuthUser {
  id: string;
  displayName: string;
  avatarUrl?: string;
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
