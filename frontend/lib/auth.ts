import { api } from './api';

export type UserRole = 'employee' | 'leader' | 'admin' | 'super_admin';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  team_id?: number | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/api/auth/login', { email, password });
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', res.access_token);
    localStorage.setItem('user', JSON.stringify(res.user));
  }
  return res;
}

export interface Company {
  id: number;
  name: string;
  slug: string;
}

export interface RegisterResponse extends LoginResponse {
  company: Company;
}

export interface RegisterInput {
  company_name: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
}

/** 셀프 가입(E2): 회사 개설 + 첫 admin 발급 → 자동 로그인(토큰 저장). */
export async function register(input: RegisterInput): Promise<RegisterResponse> {
  const res = await api.post<RegisterResponse>('/api/auth/register', input);
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', res.access_token);
    localStorage.setItem('user', JSON.stringify(res.user));
  }
  return res;
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

export function isLeaderOrAbove(user: User | null): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'leader';
}
