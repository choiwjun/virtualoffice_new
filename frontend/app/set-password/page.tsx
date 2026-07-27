'use client';

// @TASK E4 - 비밀번호 설정 (초대 수락 = 최초 설정 / 관리자 발급 재설정 공용)
// @SPEC docs/planning/24-onboarding-whitelabel-workstream-spec.md Phase 3 · Phase 6
// @API GET /api/auth/set-password?token= · POST /api/auth/set-password
//
// 공개 라우트. 관리자가 전달한 1회용 링크로 들어와 본인이 비밀번호를 정하고 즉시 로그인한다.
// 초대와 재설정은 같은 화면이며 서버가 내려주는 purpose로 문구만 달라진다.

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { LabeledInput } from '@/components/ui/Field';

const MIN_PASSWORD_LENGTH = 8; // 서버 tokens.MIN_PASSWORD_LENGTH와 동일

interface TokenCheck {
  valid: boolean;
  purpose: string | null;
  email: string | null;
  name: string | null;
  company_name: string | null;
}

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  team_id?: number | null;
  company_id: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

const SHELL_BG =
  'radial-gradient(1000px 500px at 50% -10%, rgba(59,91,254,0.16), transparent 60%), linear-gradient(180deg, #0B1120 0%, #0E1626 100%)';

function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [check, setCheck] = useState<TokenCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const verify = useCallback(async () => {
    if (!token) {
      setCheck({ valid: false, purpose: null, email: null, name: null, company_name: null });
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      setCheck(await api.get<TokenCheck>(`/api/auth/set-password?token=${encodeURIComponent(token)}`));
    } catch {
      setCheck({ valid: false, purpose: null, email: null, name: null, company_name: null });
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    verify();
  }, [verify]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('두 비밀번호가 일치하지 않습니다.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<TokenResponse>('/api/auth/set-password', { token, password });
      // 즉시 로그인 — 링크 하나로 설정부터 진입까지 끝낸다.
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('user', JSON.stringify(res.user));
      router.replace('/office');
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        // 화면을 열어둔 사이 만료·회수·사용된 경우 — 폼 대신 안내로 전환한다.
        setCheck({ valid: false, purpose: null, email: null, name: null, company_name: null });
      } else {
        setError(err instanceof ApiError ? err.message : '비밀번호 설정에 실패했습니다.');
      }
      setSubmitting(false);
    }
  }

  const isInvite = check?.purpose === 'invitation';

  return (
    <main className="min-h-screen flex items-center justify-center px-4 font-sans" style={{ background: SHELL_BG }}>
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-surface p-8 shadow-2xl">
        {checking ? (
          <p className="text-center text-[13px] text-text-muted py-8">링크를 확인하는 중…</p>
        ) : !check?.valid ? (
          <div className="text-center">
            <div className="inline-grid place-items-center w-11 h-11 rounded-xl mb-3 text-xl" style={{ background: 'rgba(239,68,68,0.15)' }}>
              ⛔
            </div>
            <h1 className="text-lg font-bold text-text-primary">사용할 수 없는 링크입니다</h1>
            <p className="text-[13px] text-text-muted mt-2 leading-relaxed">
              링크가 만료되었거나, 이미 사용되었거나, 회수되었습니다.
              <br />
              관리자에게 새 링크를 요청해 주세요.
            </p>
            <Link
              href="/login"
              className="inline-block mt-5 text-[13px] text-accent-cyan hover:underline font-medium"
            >
              로그인 화면으로
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div
                className="inline-grid place-items-center w-11 h-11 rounded-xl text-white font-extrabold text-lg mb-3"
                style={{ background: 'rgb(var(--color-primary))' }}
              >
                {check.company_name?.charAt(0) ?? 'V'}
              </div>
              <h1 className="text-xl font-bold text-text-primary">
                {isInvite ? '비밀번호를 설정하세요' : '비밀번호를 재설정하세요'}
              </h1>
              <p className="text-[13px] text-text-muted mt-1.5 leading-relaxed">
                {isInvite && check.company_name ? (
                  <>
                    <span className="text-text-secondary font-medium">{check.company_name}</span>에 초대되었습니다.
                    <br />
                  </>
                ) : null}
                {check.name} · {check.email}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 브라우저 비밀번호 관리자가 계정을 인식하도록 이메일을 숨겨서 함께 제출 */}
              <input type="hidden" name="username" autoComplete="username" value={check.email ?? ''} readOnly />

              <LabeledInput
                label="새 비밀번호"
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
                autoComplete="new-password"
                autoFocus
                placeholder="••••••••"
                hint={`${MIN_PASSWORD_LENGTH}자 이상`}
              />
              <LabeledInput
                label="새 비밀번호 확인"
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={submitting}
                autoComplete="new-password"
                placeholder="••••••••"
                invalid={confirmPassword.length > 0 && confirmPassword !== password}
              />

              {error && (
                <p className="text-[13px] text-danger flex items-center gap-1.5" role="alert">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 6h2v5H9V6zm0 6h2v2H9v-2z" clipRule="evenodd" />
                  </svg>
                  <span>{error}</span>
                </p>
              )}

              <Button type="submit" variant="primary" size="md" loading={submitting} className="w-full">
                {submitting ? '설정 중...' : isInvite ? '설정하고 시작하기' : '비밀번호 변경'}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
