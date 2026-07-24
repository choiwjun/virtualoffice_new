'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { login, getToken } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { LabeledInput } from '@/components/ui/Field';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  // 세션 만료 복귀(06 §3.8): 안전한 내부 경로만 허용(/로 시작, //·백슬래시 아님 → 오픈 리다이렉트 차단)
  const returnToParam = searchParams.get('returnTo');
  const returnTo =
    returnToParam &&
    returnToParam.startsWith('/') &&
    !returnToParam.startsWith('//') &&
    !returnToParam.startsWith('/\\')
      ? returnToParam
      : null;
  const destination = returnTo ?? '/office';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already logged in → redirect
  useEffect(() => {
    if (getToken()) {
      router.replace(destination);
    }
  }, [router, destination]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      // returnTo가 안전한 내부 경로면 원래 화면으로 복귀, 아니면 기본 목적지(/office)
      router.replace(destination);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('이메일 또는 비밀번호 오류');
      } else {
        setError('서버 연결 오류. 잠시 후 다시 시도하세요.');
      }
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 font-sans"
      style={{
        background:
          'radial-gradient(1000px 500px at 50% -10%, rgba(59,91,254,0.16), transparent 60%), linear-gradient(180deg, #0B1120 0%, #0E1626 100%)',
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-surface p-8 shadow-2xl">
        {/* Logo / Title — 이모지 대신 브랜드 마크(A10) */}
        <div className="text-center mb-7">
          <div
            className="inline-grid place-items-center w-11 h-11 rounded-xl text-white font-extrabold text-lg mb-3"
            style={{ background: '#3B5BFE' }}
          >
            V
          </div>
          <h1 className="text-xl font-bold text-text-primary">VirtualOffice</h1>
          <p className="text-[13px] text-text-muted mt-1">가상 오피스에 로그인</p>
        </div>

        {/* Session expired banner */}
        {expired && (
          <div
            className="mb-4 px-3 py-2 rounded-lg text-[13px]"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#F5C97B' }}
            role="status"
          >
            세션이 만료되었습니다. 보안을 위해 다시 로그인하세요.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <LabeledInput
            label="이메일"
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            autoComplete="email"
            placeholder="you@company.com"
          />

          <LabeledInput
            label="비밀번호"
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            autoComplete="current-password"
            placeholder="••••••••"
          />

          {error && (
            <p className="text-[13px] text-danger flex items-center gap-1.5" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0" aria-hidden="true">
                <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 6h2v5H9V6zm0 6h2v2H9v-2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </p>
          )}

          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            {loading ? '로그인 중...' : '로그인'}
          </Button>
        </form>

        <p className="mt-5 text-center text-[13px] text-text-muted">
          회사가 처음이신가요?{' '}
          <Link href="/signup" className="text-accent-cyan hover:underline font-medium">
            회사 만들기
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
