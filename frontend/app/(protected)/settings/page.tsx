'use client';

// @TASK C4 - 아바타 커스터마이징 (D35 배지 규격 개편, 2026-07-22)
// @SPEC docs/planning/00-decisions.md §P(D35: 아바타 = 프로필 사진 배지) + 06-screens.md §3.9
// @API GET/PUT /api/avatar · POST/DELETE /api/avatar/photo
//      (user_avatar: preset_id·bottom_color는 레거시 보존 필드 — UI 미노출, 저장 시 기존 값 유지)

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { getUser } from '@/lib/auth';

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
        selected ? 'border-indigo-600 scale-110' : 'border-transparent hover:scale-105'
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
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">아바타 설정</h1>
        <p className="text-sm text-gray-500 mt-1">
          가상 오피스에서 표시될 내 배지(프로필 사진·정체성 색)와 이름표를 설정합니다. (D35)
        </p>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col md:flex-row gap-8">
          {/* 배지 미리보기 — /office 씬과 동일 규격 */}
          <div className="flex flex-col items-center gap-3 flex-shrink-0">
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-5">
              <BadgePreview name={myName} accent={draft.top_color} photoSrc={mediaUrl(photoUrl)} />
            </div>
            {draft.show_nameplate && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-white"
                style={{ border: `1px solid ${draft.top_color}` }}
              >
                {myName}
              </span>
            )}
          </div>

          {/* 컨트롤 */}
          <div className="flex-1 flex flex-col gap-5">
            {/* 프로필 사진 */}
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">프로필 사진</div>
              <p className="text-xs text-gray-500 mb-2">
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
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={photoBusy}
                  className="px-3 py-1.5 rounded-md bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {photoBusy ? '처리 중...' : photoUrl ? '사진 변경' : '사진 업로드'}
                </button>
                {photoUrl && (
                  <button
                    type="button"
                    onClick={removePhoto}
                    disabled={photoBusy}
                    className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    사진 삭제
                  </button>
                )}
              </div>
            </div>

            {/* 정체성 색 */}
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">정체성 색상</div>
              <p className="text-xs text-gray-500 mb-2">배지 배경·이름표 테두리에 쓰이는 내 고유 색입니다.</p>
              <div className="flex gap-2">
                {IDENTITY_COLORS.map((c) => (
                  <Swatch key={c} color={c} selected={draft.top_color === c} onClick={() => setDraft((d) => ({ ...d, top_color: c }))} />
                ))}
              </div>
            </div>

            {/* 이름표 */}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.show_nameplate}
                onChange={(e) => setDraft((d) => ({ ...d, show_nameplate: e.target.checked }))}
                className="accent-indigo-600"
              />
              이름표(이름/직급) 표시
            </label>

            {/* 저장 — 사진은 업로드/삭제 즉시 반영, 색·이름표만 저장 버튼 대상 */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
              {savedAt && !dirty && <span className="text-xs text-green-600">저장되었습니다.</span>}
              {error && <span className="text-xs text-red-600">{error}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
