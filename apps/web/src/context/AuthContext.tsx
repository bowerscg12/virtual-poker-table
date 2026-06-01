import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AuthUser } from '@vct/shared-types';
import { guestLogin, loginAccount as apiLoginAccount, registerAccount as apiRegisterAccount } from '../api/client';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  /** True while verifying a stored token on first load — prevents a flash-to-login. */
  loading: boolean;
  loginGuest: (name: string) => Promise<void>;
  loginAccount: (email: string, password: string) => Promise<void>;
  registerAccount: (displayName: string, email: string, password: string) => Promise<void>;
  /** Set auth state directly from an EnterLobbyResponse (bypasses guest-login flow). */
  setAuthDirect: (user: AuthUser, token: string, sessionId: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('vct_token'));
  const [loading, setLoading] = useState(() => !!localStorage.getItem('vct_token'));

  useEffect(() => {
    const t = localStorage.getItem('vct_token');
    if (!t || user) {
      setLoading(false);
      return;
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user: AuthUser } | null) => {
        if (data?.user) {
          setUser(data.user);
          setToken(t);
        } else {
          localStorage.removeItem('vct_token');
        }
      })
      .catch(() => localStorage.removeItem('vct_token'))
      .finally(() => setLoading(false));
  }, [user]);

  const loginGuest = useCallback(async (name: string) => {
    const res = await guestLogin(name);
    localStorage.setItem('vct_token', res.token);
    setUser(res.user);
    setToken(res.token);
  }, []);

  const loginAccount = useCallback(async (email: string, password: string) => {
    const res = await apiLoginAccount(email, password);
    localStorage.setItem('vct_token', res.token);
    setUser(res.user);
    setToken(res.token);
  }, []);

  const registerAccount = useCallback(async (displayName: string, email: string, password: string) => {
    const res = await apiRegisterAccount(displayName, email, password);
    localStorage.setItem('vct_token', res.token);
    setUser(res.user);
    setToken(res.token);
  }, []);

  const setAuthDirect = useCallback((u: AuthUser, t: string, sessionId: string) => {
    localStorage.setItem('vct_token', t);
    localStorage.setItem('vct_session_id', sessionId);
    setUser(u);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('vct_token');
    localStorage.removeItem('vct_session_id');
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, loginGuest, loginAccount, registerAccount, setAuthDirect, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
