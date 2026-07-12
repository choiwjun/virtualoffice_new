'use client';

// @TASK C4 - 아바타 커스터마이징
// @SPEC docs/planning/06-screens.md §3.9 (프리셋 + 색상 팔레트 + 이름표)
// @API GET/PUT /api/avatar (user_avatar: user_id, preset_id, top_color, bottom_color, show_nameplate)

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface Avatar {
  user_id: number;
  preset_id: string;
  top_color: string;
  bottom_color: string;
  show_nameplate: boolean;
}

const PRESETS: { id: string; label: string }[] = [
  { id: 'humanoid_a', label: '기본 휴머노이드 A' },
  { id: 'humanoid_b', label: '기본 휴머노이드 B' },
];

const TOP_COLORS = ['#3B5BFE', '#EF4444', '#22C55E', '#F59E0B', '#8B5CF6'];
const BOTTOM_COLORS = ['#1E293B', '#64748B', '#0F766E', '#7C2D12', '#334155'];

const DEFAULT_AVATAR: Omit<Avatar, 'user_id'> = {
  preset_id: 'humanoid_a',
  top_color: TOP_COLORS[0],
  bottom_color: BOTTOM_COLORS[0],
  show_nameplate: true,
};

// 경량 휴머노이드 미리보기 (프리셋별 실루엣 + 상/하의 색상)
function AvatarPreview({
  preset,
  top,
  bottom,
}: {
  preset: string;
  top: string;
  bottom: string;
}) {
  const headR = preset === 'humanoid_b' ? 11 : 13;
  return (
    <svg viewBox="0 0 100 140" className="w-32 h-44" role="img" aria-label="아바타 미리보기">
      {/* 머리 */}
      <circle cx="50" cy={26} r={headR} fill="#E9C6A8" stroke="#00000022" />
      {/* 상의 (몸통) */}
      <rect x="30" y="42" width="40" height="46" rx="10" fill={top} />
      {/* 팔 */}
      <rect x="20" y="46" width="10" height="38" rx="5" fill={top} />
      <rect x="70" y="46" width="10" height="38" rx="5" fill={top} />
      {/* 하의 (다리) */}
      <rect x="34" y="86" width="14" height="44" rx="6" fill={bottom} />
      <rect x="52" y="86" width="14" height="44" rx="6" fill={bottom} />
    </svg>
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
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [draft, setDraft] = useState<Omit<Avatar, 'user_id'>>(DEFAULT_AVATAR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Avatar>('/api/avatar');
      setAvatar(data);
      setDraft({
        preset_id: data.preset_id,
        top_color: data.top_color,
        bottom_color: data.bottom_color,
        show_nameplate: data.show_nameplate,
      });
    } catch (err) {
      // 아바타 미설정(404)이면 기본값으로 시작
      if (err instanceof ApiError && err.status === 404) {
        setDraft(DEFAULT_AVATAR);
      } else {
        setError('아바타 정보를 불러오지 못했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    !avatar ||
    avatar.preset_id !== draft.preset_id ||
    avatar.top_color !== draft.top_color ||
    avatar.bottom_color !== draft.bottom_color ||
    avatar.show_nameplate !== draft.show_nameplate;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<Avatar>('/api/avatar', draft);
      setAvatar(updated);
      setSavedAt(Date.now());
    } catch {
      setError('저장에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">아바타 설정</h1>
        <p className="text-sm text-gray-500 mt-1">
          가상 오피스에서 표시될 내 아바타의 프리셋과 색상을 설정합니다. (06-screens §3.9)
        </p>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col md:flex-row gap-8">
          {/* 미리보기 */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
              <AvatarPreview preset={draft.preset_id} top={draft.top_color} bottom={draft.bottom_color} />
            </div>
            {draft.show_nameplate && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-white">이름표 표시</span>
            )}
          </div>

          {/* 컨트롤 */}
          <div className="flex-1 flex flex-col gap-5">
            {/* 프리셋 */}
            <fieldset>
              <legend className="text-sm font-semibold text-gray-700 mb-2">프리셋</legend>
              <div className="flex flex-col gap-2">
                {PRESETS.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="preset"
                      value={p.id}
                      checked={draft.preset_id === p.id}
                      onChange={() => setDraft((d) => ({ ...d, preset_id: p.id }))}
                      className="accent-indigo-600"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* 상의 색상 */}
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">상의 색상</div>
              <div className="flex gap-2">
                {TOP_COLORS.map((c) => (
                  <Swatch key={c} color={c} selected={draft.top_color === c} onClick={() => setDraft((d) => ({ ...d, top_color: c }))} />
                ))}
              </div>
            </div>

            {/* 하의 색상 */}
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">하의 색상</div>
              <div className="flex gap-2">
                {BOTTOM_COLORS.map((c) => (
                  <Swatch key={c} color={c} selected={draft.bottom_color === c} onClick={() => setDraft((d) => ({ ...d, bottom_color: c }))} />
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

            {/* 저장 */}
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
