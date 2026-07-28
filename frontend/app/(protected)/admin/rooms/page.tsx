'use client';

// @TASK 회의실 연결 — 가상오피스 씬의 방 ↔ DB 회의실
// @API GET /api/rooms · PATCH /api/rooms/{id} { scene_key }
//
// 씬 기준으로 세운 화면이다. 관리자는 "우리 회의실 목록"보다 **자기가 보는 사무실**을 안다 —
// 방 목록을 주고 "이건 씬의 어느 방입니까"를 묻는 것보다, 씬의 방을 늘어놓고 "여기는 어느
// 회의실입니까"를 묻는 편이 답할 수 있는 질문이다.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import { V3_ROOMS } from '@/lib/officeV3';
import {
  PageHeader,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '@/components/ui/console';
import { Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/feedback';

const ICON = {
  door: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="5" y="2.5" width="10" height="15" rx="1.5" /><circle cx="12.4" cy="10" r="0.9" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>,
};

interface Room {
  id: string;
  name: string;
  type: string;
  capacity: number;
  scene_key?: string | null;
}

/** 씬에서 사람이 "회의실"로 인지하는 방만 연결 대상으로 둔다. 라운지·팬트리는 예약 개념이 없다. */
const LINKABLE = new Set(['boardroom', 'meeting-a', 'booth']);

export default function AdminRoomsPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const toast = useToast();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<Room[]>('/api/rooms');
      setRooms(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? `회의실을 불러오지 못했습니다 (${e.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  /** 씬 방 하나의 연결을 바꾼다. 이전 주인이 있으면 먼저 풀어야 유니크에 걸리지 않는다. */
  async function link(sceneKey: string, roomId: string) {
    setBusyKey(sceneKey);
    const previous = rooms.find((r) => r.scene_key === sceneKey);
    try {
      // 순서가 중요하다 — 새 방을 먼저 이으면 (company_id, scene_key) 유니크에 막혀 409가 난다.
      if (previous && previous.id !== roomId) {
        await api.patch(`/api/rooms/${previous.id}`, { scene_key: null });
      }
      if (roomId) {
        await api.patch(`/api/rooms/${roomId}`, { scene_key: sceneKey });
      }
      await load();
      toast.success(roomId ? '연결했습니다.' : '연결을 해제했습니다.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'scene_key_taken') {
        toast.error(`이미 "${e.detail?.room_name}"이(가) 쓰고 있습니다.`);
      } else {
        toast.error(e instanceof ApiError ? `저장 실패 (${e.status})` : '서버 오류');
      }
      await load(); // 부분 적용(이전 해제만 성공)이 화면에 안 보이면 원인을 못 찾는다
    } finally {
      setBusyKey(null);
    }
  }

  if (!allowed) {
    return (
      <div className="p-6 text-text-secondary">
        <div className="max-w-md mx-auto mt-20">
          <SectionCard>
            <EmptyState icon={ICON.lock} title="관리자 전용 화면" hint="회의실 연결은 관리자만 바꿀 수 있습니다." />
          </SectionCard>
        </div>
      </div>
    );
  }

  const sceneRooms = V3_ROOMS.filter((r) => LINKABLE.has(r.id));
  const unlinked = rooms.filter((r) => !r.scene_key);

  return (
    <div className="p-6 flex flex-col gap-5 text-text-secondary">
      <PageHeader
        title="회의실 연결"
        subtitle="가상오피스에서 방을 눌렀을 때 어느 회의실의 일정을 보여줄지 정합니다"
        icon={ICON.door}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => void load()} />
      ) : (
        <>
          <SectionCard title="가상오피스의 방" icon={ICON.door}>
            <p className="text-xs text-text-muted leading-snug mb-3">
              연결하면 그 방을 눌렀을 때 <strong className="text-text-secondary">오늘 일정과 입장 버튼</strong>이 뜨고,
              씬의 방 이름도 회의실 이름을 따릅니다. 연결하지 않으면 방 이름이 기본값으로 남고 일정 카드가 비어 있습니다.
            </p>
            <ul className="divide-y divide-border-subtle">
              {sceneRooms.map((sr) => {
                const linked = rooms.find((r) => r.scene_key === sr.id);
                return (
                  <li key={sr.id} className="py-3 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text-primary">{linked?.name ?? sr.label}</div>
                      <div className="text-[11px] text-text-muted">
                        씬 위치 <code>{sr.id}</code>
                        {linked ? ` · 정원 ${linked.capacity}명` : ' · 연결 안 됨'}
                      </div>
                    </div>
                    <div className="w-64 flex-shrink-0">
                      <Select
                        value={linked?.id ?? ''}
                        disabled={busyKey === sr.id}
                        onChange={(e) => void link(sr.id, e.target.value)}
                      >
                        <option value="">연결 안 함</option>
                        {rooms
                          .filter((r) => !r.scene_key || r.scene_key === sr.id)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.capacity}명)
                            </option>
                          ))}
                      </Select>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <SectionCard title={`연결되지 않은 회의실 ${unlinked.length}개`}>
            {unlinked.length === 0 ? (
              <p className="text-xs text-text-muted">모든 회의실이 가상오피스의 방에 연결돼 있습니다.</p>
            ) : (
              <p className="text-xs text-text-muted leading-snug">
                {unlinked.map((r) => r.name).join(' · ')} — 예약은 정상이지만 가상오피스에서는 눌러도 일정이 보이지 않습니다.
                씬에 자리가 없는 방(다른 층 등)이라면 그대로 두어도 됩니다.
              </p>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
