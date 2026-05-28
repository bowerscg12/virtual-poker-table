import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AuthUser } from '@vct/shared-types';
import { guestLogin } from '../api/client';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loginGuest: (name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('vct_token'));

  useEffect(() => {
    const t = localStorage.getItem('vct_token');
    if (!t || user) return;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user: AuthUser } | null) => {
        if (data?.user) {
          setUser(data.user);
          setToken(t);
        }
      })
      .catch(() => localStorage.removeItem('vct_token'));
  }, [user]);

  const loginGuest = useCallback(async (name: string) => {
    const res = await guestLogin(name);
    setUser(res.user);
    setToken(res.token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('vct_token');
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loginGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
