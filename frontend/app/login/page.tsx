'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { login, getToken } from '@/lib/auth';
import { ApiError, api, mediaUrl } from '@/lib/api';
import { applyBrandColors, slugFromLocation, type PublicBranding } from '@/lib/branding';
import { Button } from '@/components/ui/Button';
import { LabeledInput } from '@/components/ui/Field';
import { useT } from '@/components/I18nProvider';

function LoginForm() {
  const { t } = useT();
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

  // E5 화이트라벨 — 로그인 **전**이라 slug(?company= 또는 서브도메인)로만 브랜딩을 읽는다.
  // slug가 없으면 중립 기본 브랜딩(단일 테넌트·직접 접속 시 정상 동작).
  const [brand, setBrand] = useState<PublicBranding | null>(null);
  useEffect(() => {
    const slug = slugFromLocation();
    if (!slug) return;
    let alive = true;
    api
      .get<PublicBranding>(`/api/branding/public?slug=${encodeURIComponent(slug)}`)
      .then((b) => {
        if (!alive || !b.brand_name) return; // 없는 slug → 빈 응답 → 기본 유지
        setBrand(b);
        applyBrandColors(b);
      })
      .catch(() => {
        /* 브랜딩 실패가 로그인을 막지 않는다 */
      });
    return () => {
      alive = false;
    };
  }, []);

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
        setError(t('login.failed'));
      } else {
        setError(t('login.networkError'));
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
        {/* Logo / Title — 이모지 대신 브랜드 마크(A10). E5: 테넌트 로고·이름이 있으면 대체. */}
        <div className="text-center mb-7">
          {brand?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(brand.logo_url) ?? ''}
              alt=""
              className="inline-block w-11 h-11 rounded-xl object-contain mb-3"
            />
          ) : (
            <div className="inline-grid place-items-center w-11 h-11 rounded-xl text-white font-extrabold text-lg mb-3 bg-primary">
              {(brand?.brand_name ?? 'V').charAt(0)}
            </div>
          )}
          <h1 className="text-xl font-bold text-text-primary">
            {brand?.brand_name ?? 'VirtualOffice'}
          </h1>
          <p className="text-[13px] text-text-muted mt-1">{t('login.title')}</p>
        </div>

        {/* Session expired banner */}
        {expired && (
          <div
            className="mb-4 px-3 py-2 rounded-lg text-[13px]"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#F5C97B' }}
            role="status"
          >
            {t('login.expired')}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <LabeledInput
            label={t('login.email')}
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
            label={t('login.password')}
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
            {loading ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>

        {/* E4: 셀프 비번찾기(메일)는 아직 없다 — 실제로 동작하는 복구 경로만 안내한다. */}
        <p className="mt-4 text-center text-xs text-text-muted leading-relaxed">
          {t('login.forgot')}
        </p>

        <p className="mt-4 text-center text-[13px] text-text-muted">
          {t('login.signupPrompt')}{' '}
          <Link href="/signup" className="text-accent-cyan hover:underline font-medium">
            {t('login.signupLink')}
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
