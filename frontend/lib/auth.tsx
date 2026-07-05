"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { AuthApi, AuthUser, clearSession, getStoredUser, getToken, setSession } from "./api";

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // 초기 localStorage 복원 완료 여부
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 마운트 시 저장된 세션 복원.
    if (getToken()) setUser(getStoredUser());
    setReady(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await AuthApi.login(email, password);
    setSession(res.token, res.refresh_token, res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function isAdmin(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}
