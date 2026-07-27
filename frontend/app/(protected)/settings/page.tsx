'use client';

// @TASK C4 - 아바타 커스터마이징 (D35 배지 규격 개편, 2026-07-22)
// @SPEC docs/planning/00-decisions.md §P(D35: 아바타 = 프로필 사진 배지) + 06-screens.md §3.9
// @API GET/PUT /api/avatar · POST/DELETE /api/avatar/photo
//      (user_avatar: preset_id·bottom_color는 레거시 보존 필드 — UI 미노출, 저장 시 기존 값 유지)

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  PageHeader,
  ToolbarButton,
  SectionCard,
  LoadingState,
} from '@/components/ui/console';
import { Button } from '@/components/ui/Button';
import { LabeledInput } from '@/components/ui/Field';

const MIN_PASSWORD_LENGTH = 8; // 서버 tokens.MIN_PASSWORD_LENGTH와 동일

const ICON = {
  badge: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="10" cy="7" r="3.2" /><path d="M4.5 16c.6-2.6 2.8-4 5.5-4s4.9 1.4 5.5 4" /></svg>,
  photo: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="4.5" width="14" height="11" rx="2" /><circle cx="8" cy="9" r="1.6" /><path d="M4 15l4-4 3 2.5 3-2.5 2 2" /></svg>,
  palette: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 3a7 7 0 1 0 0 14c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.8.7-1.3 1.5-1.3H13a4 4 0 0 0 4-4c0-3.3-3.1-6-7-6z" /><circle cx="7" cy="8" r=".8" fill="currentColor" stroke="none" /><circle cx="10" cy="6.5" r=".8" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r=".8" fill="currentColor" stroke="none" /></svg>,
  tag: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 4h6l6 6-6 6-6-6z" /><circle cx="7" cy="7" r="1.1" /></svg>,
  check: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 10.5l3.5 3.5L16 6" /></svg>,
  key: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="7" cy="10" r="3" /><path d="M10 10h7" /><path d="M14.5 10v2.5" /><path d="M17 10v3.5" /></svg>,
};

interface Avatar {
  user_id: number;
  preset_id: string;
  top_color: string;
  bottom_color: string;
  show_nameplate: boolean;
  photo_url: string | null;
}

// 정체성 색 팔레트 — 배지 그라디언트·이름표 테두리·상태점(타인 시점)에 쓰인다.
const IDENTITY_COLORS = ['#3B5BFE', '#EF4444', '#22C55E', '#F59E0B', '#8B5CF6'];

const DEFAULT_DRAFT = {
  preset_id: 'badge', // D35: 캐릭터 프리셋 폐기 — 서버 필드 호환용 고정값
  top_color: IDENTITY_COLORS[0],
  bottom_color: '#1E293B',
  show_nameplate: true,
};

/** 업로드 전 클라이언트 다운스케일(256px, cover 크롭) — 서버 2MB 제한 방어 + 배지 표시 크기 최적화. */
async function downscaleImage(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - s) / 2;
  const sy = (bitmap.height - s) / 2;
  ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/webp',
      0.9,
    );
  });
}

/** D35 배지 미리보기 — /office 씬·프레즌스 패널과 동일 규격(라운드 22% 타일, 사진 or 이니셜). */
function BadgePreview({
  name,
  accent,
  photoSrc,
  size = 112,
}: {
  name: string;
  accent: string;
  photoSrc: string | null;
  size?: number;
}) {
  const initials = name.length >= 3 ? name.slice(1) : name.slice(0, 2);
  return (
    <div
      className="flex items-center justify-center relative overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: '22%',
        background: `linear-gradient(150deg, ${accent} 0%, rgba(20,32,52,.96) 95%)`,
        border: '2px solid rgba(255,255,255,.55)',
        boxShadow: '0 3px 10px rgba(0,0,0,.35)',
        color: '#fff',
        fontWeight: 800,
        fontSize: size * 0.34,
        letterSpacing: '.02em',
      }}
    >
      {photoSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={photoSrc} alt="프로필 사진" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      ) : (
        initials
      )}
    </div>
  );
}

function Swatch({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`색상 ${color}`}
      aria-pressed={selected}
      className={`w-8 h-8 rounded-full border-2 transition-transform ${
        selected ? 'border-primary scale-110' : 'border-transparent hover:scale-105'
      }`}
      style={{ background: color }}
    />
  );
}

export default function SettingsPage() {
  const me = getUser();
  const myName = me?.name ?? '나';

  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const applyServer = useCallback((data: Avatar) => {
    setAvatar(data);
    setDraft({
      preset_id: data.preset_id,
      top_color: data.top_color,
      bottom_color: data.bottom_color,
      show_nameplate: data.show_nameplate,
    });
    setPhotoUrl(data.photo_url);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyServer(await api.get<Avatar>('/api/avatar'));
    } catch (err) {
      // 아바타 미설정(404)이면 기본값으로 시작
      if (err instanceof ApiError && err.status === 404) {
        setDraft(DEFAULT_DRAFT);
      } else {
        setError('아바타 정보를 불러오지 못했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [applyServer]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    !avatar ||
    avatar.top_color !== draft.top_color ||
    avatar.show_nameplate !== draft.show_nameplate;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<Avatar>('/api/avatar', draft);
      applyServer(updated);
      setSavedAt(Date.now());
    } catch {
      setError('저장에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setPhotoBusy(true);
    setError(null);
    try {
      const blob = await downscaleImage(file);
      const form = new FormData();
      form.append('file', blob, 'avatar.webp');
      applyServer(await api.upload<Avatar>('/api/avatar/photo', form));
    } catch {
      setError('사진 업로드에 실패했습니다. (png/jpeg/webp, 2MB 이하)');
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    setError(null);
    try {
      applyServer(await api.delete<Avatar>('/api/avatar/photo'));
    } catch {
      setError('사진 삭제에 실패했습니다.');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary">
      <PageHeader
        title="아바타 설정"
        subtitle="가상 오피스에서 표시될 내 배지(프로필 사진·정체성 색)와 이름표를 설정합니다. (D35)"
        icon={ICON.badge}
      />

      {loading ? (
        <LoadingState />
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row gap-5 pr-0.5">
          {/* 배지 미리보기 — /office 씬과 동일 규격 */}
          <SectionCard title="배지 미리보기" icon={ICON.badge} className="lg:w-64 flex-shrink-0" bodyClassName="p-5 flex flex-col items-center gap-3">
            <div className="rounded-lg bg-bg-base border border-border-subtle p-5">
              <BadgePreview name={myName} accent={draft.top_color} photoSrc={mediaUrl(photoUrl)} />
            </div>
            {draft.show_nameplate && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full bg-bg-surface-raised text-text-primary"
                style={{ border: `1px solid ${draft.top_color}` }}
              >
                {myName}
              </span>
            )}
          </SectionCard>

          {/* 컨트롤 */}
          <div className="flex-1 flex flex-col gap-5 min-w-0">
            {/* 프로필 사진 */}
            <SectionCard title="프로필 사진" icon={ICON.photo}>
              <p className="text-xs text-text-muted mb-2">
                씬 아바타·구성원 목록 배지에 표시됩니다. 없으면 이름 이니셜로 표시됩니다.
              </p>
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto(f);
                  }}
                />
                <ToolbarButton
                  variant="primary"
                  onClick={() => fileRef.current?.click()}
                  disabled={photoBusy}
                  icon={ICON.photo}
                >
                  {photoBusy ? '처리 중...' : photoUrl ? '사진 변경' : '사진 업로드'}
                </ToolbarButton>
                {photoUrl && (
                  <ToolbarButton onClick={removePhoto} disabled={photoBusy}>
                    사진 삭제
                  </ToolbarButton>
                )}
              </div>
            </SectionCard>

            {/* 정체성 색 */}
            <SectionCard title="정체성 색상" icon={ICON.palette}>
              <p className="text-xs text-text-muted mb-2">배지 배경·이름표 테두리에 쓰이는 내 고유 색입니다.</p>
              <div className="flex gap-2">
                {IDENTITY_COLORS.map((c) => (
                  <Swatch key={c} color={c} selected={draft.top_color === c} onClick={() => setDraft((d) => ({ ...d, top_color: c }))} />
                ))}
              </div>
            </SectionCard>

            {/* 이름표 + 저장 */}
            <SectionCard title="표시" icon={ICON.tag}>
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.show_nameplate}
                  onChange={(e) => setDraft((d) => ({ ...d, show_nameplate: e.target.checked }))}
                  className="accent-primary"
                />
                이름표(이름/직급) 표시
              </label>

              {/* 저장 — 사진은 업로드/삭제 즉시 반영, 색·이름표만 저장 버튼 대상 */}
              <div className="flex items-center gap-3 pt-4 mt-1 border-t border-border-subtle">
                <ToolbarButton
                  variant="primary"
                  type="submit"
                  onClick={save}
                  disabled={saving || !dirty}
                  icon={ICON.check}
                >
                  {saving ? '저장 중...' : '저장'}
                </ToolbarButton>
                {savedAt && !dirty && <span className="text-xs text-status-online">저장되었습니다.</span>}
                {error && <span className="text-xs text-red-300">{error}</span>}
              </div>
            </SectionCard>

            {/* 계정 — 비밀번호 변경 (E4 / 23 E7·C11) */}
            <AccountSection />
          </div>
        </div>
      )}
    </div>
  );
}

/** 계정 설정 — 본인 비밀번호 변경 (E4 · 23 E7). 분실 시 재설정은 관리자 발급 링크로 처리한다. */
function AccountSection() {
  const me = getUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (next.length < MIN_PASSWORD_LENGTH) {
      setErr(`새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      return;
    }
    if (next !== confirmNext) {
      setErr('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (next === current) {
      setErr('현재 비밀번호와 다른 값을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setConfirmNext('');
      setMsg('비밀번호를 변경했습니다.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : '비밀번호 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="계정" icon={ICON.key}>
      <p className="text-xs text-text-muted mb-3">
        로그인 계정: <span className="text-text-secondary">{me?.email ?? '—'}</span>
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 max-w-sm">
        <input type="hidden" name="username" autoComplete="username" value={me?.email ?? ''} readOnly />
        <LabeledInput
          label="현재 비밀번호"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          disabled={busy}
          autoComplete="current-password"
        />
        <LabeledInput
          label="새 비밀번호"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          disabled={busy}
          autoComplete="new-password"
          hint={`${MIN_PASSWORD_LENGTH}자 이상`}
        />
        <LabeledInput
          label="새 비밀번호 확인"
          type="password"
          value={confirmNext}
          onChange={(e) => setConfirmNext(e.target.value)}
          required
          disabled={busy}
          autoComplete="new-password"
          invalid={confirmNext.length > 0 && confirmNext !== next}
        />
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" loading={busy}>
            비밀번호 변경
          </Button>
          {msg && <span className="text-xs text-status-online">{msg}</span>}
          {err && (
            <span className="text-xs text-danger" role="alert">
              {err}
            </span>
          )}
        </div>
      </form>
      <p className="text-xs text-text-muted mt-3 leading-relaxed">
        비밀번호를 잊으셨다면 관리자에게 재설정 링크를 요청하세요.
      </p>
    </SectionCard>
  );
}
