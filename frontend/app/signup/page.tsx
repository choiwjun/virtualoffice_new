'use client';

/**
 * 셀프 가입 / 회사 개설 (감사 23 E2 · 24-스펙 Phase 2).
 *
 * 이전엔 신규 고객사가 seed 스크립트로만 생겼다. 이 화면에서 회사명 + 첫 admin을 입력하면
 * POST /api/auth/register가 Company + 첫 admin을 만들고 자동 로그인 → /office로 진입한다.
 * 로그인/랜딩과 동일한 다크 테마 + Button/Field 프리미티브.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register, getToken } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { LabeledInput } from '@/components/ui/Field';

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace('/office');
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await register({
        company_name: companyName.trim(),
        admin_name: adminName.trim(),
        admin_email: email.trim(),
        admin_password: password,
      });
      router.replace('/office');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('이미 가입된 이메일입니다. 로그인해 주세요.');
      } else if (err instanceof ApiError && err.status === 422) {
        setError('입력값을 확인해 주세요 (이메일 형식·비밀번호 8자 이상).');
      } else {
        setError('서버 연결 오류. 잠시 후 다시 시도하세요.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-10 font-sans"
      style={{
        background:
          'radial-gradient(1000px 500px at 50% -10%, rgba(59,91,254,0.16), transparent 60%), linear-gradient(180deg, #0B1120 0%, #0E1626 100%)',
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-surface p-8 shadow-2xl">
        <div className="text-center mb-7">
          <div
            className="inline-grid place-items-center w-11 h-11 rounded-xl text-white font-extrabold text-lg mb-3"
            style={{ background: 'rgb(var(--color-primary))' }}
          >
            V
          </div>
          <h1 className="text-xl font-bold text-text-primary">회사 만들기</h1>
          <p className="text-[13px] text-text-muted mt-1">가상 오피스를 우리 팀용으로 개설하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <LabeledInput
            label="회사명"
            id="company_name"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            disabled={loading}
            autoComplete="organization"
            placeholder="예: 비바리퍼블리카"
          />
          <LabeledInput
            label="관리자 이름"
            id="admin_name"
            type="text"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            required
            disabled={loading}
            autoComplete="name"
            placeholder="홍길동"
          />
          <LabeledInput
            label="관리자 이메일"
            id="admin_email"
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
            id="admin_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            autoComplete="new-password"
            hint="8자 이상"
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
            {loading ? '개설 중...' : '회사 개설하고 시작하기'}
          </Button>
        </form>

        <p className="mt-5 text-center text-[13px] text-text-muted">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="text-accent-cyan hover:underline font-medium">
            로그인
          </Link>
        </p>
      </div>
    </main>
  );
}
