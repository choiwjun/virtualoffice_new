'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { login, getToken } from '@/lib/auth';
import { ApiError } from '@/lib/api';

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white shadow-lg rounded-xl p-8 w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🏢</div>
          <h1 className="text-2xl font-bold text-gray-800">VirtualOffice</h1>
          <p className="text-sm text-gray-500 mt-1">가상오피스 로그인</p>
        </div>

        {/* Session expired banner */}
        {expired && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-700">
            세션이 만료되었습니다. 보안을 위해 다시 로그인하세요.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              이메일
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
              placeholder="alice@virtualoffice.local"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <span>✗</span>
              <span>{error}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                로그인 중...
              </span>
            ) : (
              '로그인'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
