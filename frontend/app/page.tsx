'use client';

/**
 * 공개 랜딩 (감사 23 E1) — 이전엔 `/`가 곧장 `/office`로 리다이렉트해 비로그인 방문자가
 * 제품을 발견·평가할 입구가 전혀 없었다. 이제 로그인 세션이 있으면 /office로, 없으면
 * 제품 소개 + 로그인/데모 CTA를 보여준다. (본격 마케팅/가격은 24-스펙 E1에서 확장.)
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';

const FEATURES: { title: string; desc: string; path: string }[] = [
  {
    title: '실시간 공간 프레즌스',
    desc: '팀이 한 사무실에 있는 것처럼 — 자리·상태·이동이 2.5D 오피스에 실시간으로 보입니다.',
    path: 'M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M9.5 20v-5h5v5',
  },
  {
    title: 'KPI · 업무일지 · 보고서',
    desc: '성과 지표부터 EOD 업무일지·보고서까지, 운영 데이터가 하나의 콘솔에 모입니다.',
    path: 'M4 19V5m0 14h16M8 15l3-4 3 2 4-6',
  },
  {
    title: '회의 · 화상 · 회의록',
    desc: 'LiveKit 화상 회의와 자동 회의록으로, 흩어지던 회의가 기록으로 남습니다.',
    path: 'M4 6h11v9H4zM15 9l5-3v9l-5-3',
  },
  {
    title: '조직 · 좌석 셀프 구성',
    desc: '드래그로 좌석을 배치하고 조직도를 구성 — 초안·검증·배포·롤백까지 스스로.',
    path: 'M12 7a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2',
  },
];

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace('/office');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0B1120' }}>
        <div className="text-sm text-text-muted">로딩 중...</div>
      </div>
    );
  }

  return (
    <main
      className="min-h-screen text-text-primary font-sans"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(59,91,254,0.18), transparent 60%), linear-gradient(180deg, #0B1120 0%, #0E1626 100%)',
      }}
    >
      {/* 상단바 */}
      <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-8 h-8 rounded-lg text-white font-extrabold" style={{ background: '#3B5BFE' }}>
            V
          </span>
          <span className="font-bold tracking-tight">VirtualOffice</span>
        </div>
        <Link
          href="/login"
          className="px-4 py-2 rounded-lg text-[13px] font-semibold text-text-secondary border border-border-subtle hover:bg-white/5 transition-colors"
        >
          로그인
        </Link>
      </header>

      {/* 히어로 */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-14 text-center">
        <span
          className="inline-block mb-5 px-3 py-1 rounded-full text-[12px] font-medium"
          style={{ background: 'rgba(59,91,254,0.14)', color: '#93A9FF' }}
        >
          가상 사무실 · 협업 · 운영을 하나로
        </span>
        <h1 className="text-4xl md:text-5xl font-extrabold leading-[1.15] tracking-tight">
          팀이 같은 공간에서 일하는
          <br />
          <span style={{ color: '#7E9BFF' }}>가상 오피스</span>
        </h1>
        <p className="mt-5 text-[15px] md:text-base text-text-secondary leading-relaxed">
          실시간 프레즌스와 화상 회의, KPI·업무일지·보고서까지 —
          <br className="hidden md:block" />
          분산된 팀의 하루를 하나의 오피스 콘솔에서 운영하세요.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5"
            style={{ background: '#3B5BFE' }}
          >
            시작하기
          </Link>
          <Link
            href="/login?demo=1"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-text-primary border border-border-subtle hover:bg-white/5 transition-colors"
          >
            데모 둘러보기
          </Link>
        </div>
        <p className="mt-3 text-[12px] text-text-muted">데모 계정 demo2001@virtualoffice.local · 비밀번호 password123</p>
      </section>

      {/* 기능 카드 */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border-subtle p-5 flex items-start gap-4"
              style={{
                background: 'rgba(22,31,50,0.6)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <span
                className="flex-shrink-0 grid place-items-center w-10 h-10 rounded-xl"
                style={{ background: 'rgba(59,91,254,0.14)', color: '#93A9FF' }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d={f.path} />
                </svg>
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-text-primary">{f.title}</h3>
                <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border-subtle">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between text-[12px] text-text-muted">
          <span>© VirtualOffice</span>
          <Link href="/login" className="hover:text-text-secondary transition-colors">
            로그인 →
          </Link>
        </div>
      </footer>
    </main>
  );
}
