'use client';

// @TASK E5 - 테넌트 화이트라벨 (브랜드명·색·로고)
// @SPEC docs/planning/24-onboarding-whitelabel-workstream-spec.md Phase 4 · 23 E5/A7
// @API GET/PUT /api/branding · POST/DELETE /api/branding/logo
//
// 색 변경은 저장 전에도 화면 전체에 즉시 반영된다(preview) — 저장 없이 벗어나면 원복.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { useBranding } from '@/components/BrandingProvider';
import { applyBrandColors, type Branding } from '@/lib/branding';
import { PageHeader, SectionCard, ToolbarButton, LoadingState } from '@/components/ui/console';
import { Button } from '@/components/ui/Button';
import { LabeledInput, Label } from '@/components/ui/Field';
import { useToast, useConfirm } from '@/components/ui/feedback';

const ICON = {
  brush: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M13.5 3.5 16.5 6.5 8 15H5v-3z" /><path d="M4 17.5c1.5.5 3 0 3.5-1.5" /></svg>,
  tag: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 4h6l6 6-6 6-6-6z" /><circle cx="7" cy="7" r="1.1" /></svg>,
  image: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="4.5" width="14" height="11" rx="2" /><circle cx="8" cy="9" r="1.6" /><path d="M4 15l4-4 3 2.5 3-2.5 2 2" /></svg>,
  eye: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M1.8 10S4.6 5 10 5s8.2 5 8.2 5-2.8 5-8.2 5-8.2-5-8.2-5z" /><circle cx="10" cy="10" r="2.2" /></svg>,
};

/** 기본 테마 값 — "되돌리기" 표시와 컬러피커 초기값에 쓴다. */
const DEFAULT_PRIMARY = '#3B5BFE';
const DEFAULT_ACCENT = '#38BDF8';

export default function BrandingPage() {
  const { branding, refresh, preview } = useBranding();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const [brandName, setBrandName] = useState('');
  const [primary, setPrimary] = useState<string>('');
  const [accent, setAccent] = useState<string>('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');

  const hydrate = useCallback((b: Branding | null) => {
    if (!b) return;
    setCompanyName(b.company_name);
    setBrandName(b.brand_name === b.company_name ? '' : b.brand_name);
    setPrimary(b.primary_color ?? '');
    setAccent(b.accent_color ?? '');
    setLogoUrl(b.logo_url);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await api.get<Branding>('/api/branding');
        if (alive) hydrate(b);
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : '브랜딩을 불러오지 못했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrate]);

  // 저장하지 않고 화면을 벗어나면 서버 값으로 원복 (미리보기가 남지 않게).
  useEffect(() => {
    return () => applyBrandColors(branding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding]);

  /** 컬러 입력 변경 → 즉시 미리보기(저장 전). */
  function onColorChange(which: 'primary' | 'accent', value: string) {
    const next = { primary_color: which === 'primary' ? value : primary || null,
                   accent_color: which === 'accent' ? value : accent || null };
    if (which === 'primary') setPrimary(value);
    else setAccent(value);
    preview({ primary_color: next.primary_color || null, accent_color: next.accent_color || null });
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      // 빈 문자열 = 기본값 복귀 (서버 계약).
      await api.put<Branding>('/api/branding', {
        brand_name: brandName.trim(),
        primary_color: primary,
        accent_color: accent,
      });
      await refresh();
      toast.success('브랜딩을 저장했습니다. 모든 화면에 즉시 반영됩니다.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '저장에 실패했습니다.';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const b = await api.upload<Branding>('/api/branding/logo', form);
      setLogoUrl(b.logo_url);
      await refresh();
      toast.success('로고를 변경했습니다.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '로고 업로드에 실패했습니다.';
      setError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    const ok = await confirm({
      title: '로고 삭제',
      message: '로고를 삭제하면 이니셜 배지로 표시됩니다. 계속할까요?',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    setUploading(true);
    try {
      const b = await api.delete<Branding>('/api/branding/logo');
      setLogoUrl(b.logo_url);
      await refresh();
      toast.success('로고를 삭제했습니다.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '로고 삭제에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  async function resetColors() {
    setPrimary('');
    setAccent('');
    preview(null);
  }

  const effectiveName = brandName.trim() || companyName;

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="브랜딩"
        subtitle="회사 로고·이름·색을 우리 브랜드로 바꿉니다. 저장하면 모든 사용자 화면에 즉시 반영됩니다."
        icon={ICON.brush}
        actions={
          <ToolbarButton onClick={save} disabled={saving || loading} variant="primary">
            {saving ? '저장 중...' : '저장'}
          </ToolbarButton>
        }
      />

      {loading ? (
        <LoadingState />
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row gap-5 pr-0.5">
          {/* 미리보기 */}
          <SectionCard
            title="미리보기"
            icon={ICON.eye}
            className="lg:w-72 flex-shrink-0"
            bodyClassName="p-5 flex flex-col gap-4"
          >
            <div className="rounded-xl border border-border-subtle bg-bg-base p-4 flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(logoUrl) ?? ''} alt="" className="w-10 h-10 rounded-lg object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-lg grid place-items-center text-white font-extrabold bg-primary">
                  {effectiveName.charAt(0) || 'V'}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[10px] text-text-muted uppercase tracking-widest truncate">
                  {effectiveName}
                </div>
                <div className="text-sm font-bold text-text-primary">가상 오피스</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button size="sm" className="w-full">기본 버튼</Button>
              <button
                type="button"
                className="w-full text-[13px] text-accent-cyan hover:underline text-left px-1"
              >
                액센트 링크 예시
              </button>
              <div className="flex gap-1.5 pt-1">
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/15 text-primary">
                  프라이머리
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-[rgba(56,189,248,0.15)] text-accent-cyan">
                  액센트
                </span>
              </div>
            </div>

            <p className="text-xs text-text-muted leading-relaxed">
              색은 버튼·액센트에만 적용됩니다. 본문 배경·글자색은 고정이라 어떤 색을 넣어도 가독성이
              유지됩니다.
            </p>
          </SectionCard>

          <div className="flex-1 flex flex-col gap-5 min-w-0">
            {/* 브랜드명 */}
            <SectionCard title="브랜드명" icon={ICON.tag}>
              <p className="text-xs text-text-muted mb-3">
                셸·로그인 화면에 표시됩니다. 비워두면 법인명(
                <span className="text-text-secondary">{companyName}</span>)이 쓰입니다.
              </p>
              <LabeledInput
                label="표시 이름"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={companyName}
                maxLength={255}
                className="max-w-sm"
              />
            </SectionCard>

            {/* 색 */}
            <SectionCard title="브랜드 색상" icon={ICON.brush}>
              <p className="text-xs text-text-muted mb-3">
                입력하는 즉시 이 화면 전체에 미리 적용됩니다. 저장하지 않고 나가면 원래대로 돌아갑니다.
              </p>
              <div className="flex flex-wrap gap-5">
                <ColorField
                  label="프라이머리 (버튼)"
                  value={primary}
                  fallback={DEFAULT_PRIMARY}
                  onChange={(v) => onColorChange('primary', v)}
                />
                <ColorField
                  label="액센트 (링크·강조)"
                  value={accent}
                  fallback={DEFAULT_ACCENT}
                  onChange={(v) => onColorChange('accent', v)}
                />
              </div>
              {(primary || accent) && (
                <button
                  type="button"
                  onClick={resetColors}
                  className="mt-3 text-xs text-accent-cyan hover:underline"
                >
                  기본 색으로 되돌리기
                </button>
              )}
            </SectionCard>

            {/* 로고 */}
            <SectionCard title="로고" icon={ICON.image}>
              <p className="text-xs text-text-muted mb-3">
                PNG · JPEG · WebP, 2MB 이하. 정사각형에 가까운 이미지가 가장 잘 보입니다.
              </p>
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                  }}
                />
                <ToolbarButton
                  variant="primary"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  icon={ICON.image}
                >
                  {uploading ? '처리 중...' : logoUrl ? '로고 변경' : '로고 업로드'}
                </ToolbarButton>
                {logoUrl && (
                  <ToolbarButton onClick={removeLogo} disabled={uploading}>
                    로고 삭제
                  </ToolbarButton>
                )}
              </div>
            </SectionCard>

            {error && (
              <p className="text-[13px] text-danger" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 컬러피커 + hex 직접 입력. 빈 값 = 기본 테마. */
function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  return (
    <Label label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} 색 선택`}
          value={value || fallback}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-10 h-9 rounded-lg border border-border-subtle bg-bg-base cursor-pointer p-1"
        />
        <input
          type="text"
          aria-label={`${label} hex 값`}
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim().toUpperCase();
            // 완성된 hex일 때만 미리보기 반영 — 타이핑 중간값으로 화면이 튀지 않게.
            if (v === '' || /^#[0-9A-F]{6}$/.test(v)) onChange(v);
          }}
          placeholder={fallback}
          maxLength={7}
          className="w-28 rounded-lg bg-bg-base border border-border-subtle text-sm text-text-primary placeholder:text-text-muted px-2.5 py-2 font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </div>
    </Label>
  );
}
