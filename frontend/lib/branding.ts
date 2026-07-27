/**
 * 테넌트 브랜딩 주입 (E5 · 24-spec Phase 4 · 감사 23 A7).
 *
 * globals.css의 디자인 토큰은 **RGB 채널 문자열**(`59 91 254`)이다. tailwind가
 * `rgb(var(--color-x) / <alpha-value>)`로 참조해 불투명도 유틸(`bg-primary/20`)까지 동작시키기
 * 위해서다. 그래서 서버가 주는 hex(`#3B5BFE`)를 그대로 넣으면 **모든 색 유틸이 조용히 깨진다**
 * — 반드시 채널로 변환해서 주입해야 한다.
 *
 * 테넌트가 덮어쓰는 건 primary/primary-hover/accent 뿐이다. 다크 서피스·텍스트 색은 고정이라
 * 어떤 브랜드 색을 넣어도 본문 대비(WCAG, 23 A11)가 무너지지 않는다.
 */

export interface Branding {
  company_id: number;
  company_name: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
}

export interface PublicBranding {
  brand_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

/** 테넌트가 덮어쓸 수 있는 변수 — 이 목록 밖은 건드리지 않는다(대비 붕괴 방지). */
const OVERRIDABLE = ['--color-primary', '--color-primary-hover', '--color-accent-cyan'] as const;

/** `#3B5BFE` → `59 91 254`. 형식이 아니면 null(무시). */
export function hexToChannels(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** hover는 별도 값이 없으므로 primary를 약간 어둡게 파생시킨다(기본 테마의 관계와 동일). */
function darken(channels: string, factor = 0.82): string {
  return channels
    .split(' ')
    .map((v) => Math.max(0, Math.min(255, Math.round(Number(v) * factor))))
    .join(' ');
}

/**
 * 브랜드 색을 `:root`에 주입. 값이 없는 항목은 기본값으로 되돌린다.
 * 서버가 색을 지웠을 때 이전 테넌트 색이 남지 않도록 항상 전체를 재설정한다.
 */
export function applyBrandColors(
  branding: Pick<Branding, 'primary_color' | 'accent_color'> | PublicBranding | null,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // 먼저 전부 해제 → :root 기본값이 다시 유효해진다.
  for (const name of OVERRIDABLE) root.style.removeProperty(name);
  if (!branding) return;

  const primary = hexToChannels(branding.primary_color);
  if (primary) {
    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-primary-hover', darken(primary));
  }
  const accent = hexToChannels(
    'accent_color' in branding ? branding.accent_color : null,
  );
  if (accent) root.style.setProperty('--color-accent-cyan', accent);
}

/** 로그인 화면이 slug로 브랜딩을 미리 읽을 때 쓰는 키(?company= 또는 서브도메인). */
export function slugFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('company');
  if (q) return q.trim().toLowerCase() || null;

  // 서브도메인 배포(acme.office.example.com) 대비 — localhost·IP·단일 라벨은 제외.
  const host = window.location.hostname;
  if (/^[\d.]+$/.test(host) || host === 'localhost') return null;
  const parts = host.split('.');
  if (parts.length < 3) return null;
  const sub = parts[0].toLowerCase();
  return sub && sub !== 'www' ? sub : null;
}
