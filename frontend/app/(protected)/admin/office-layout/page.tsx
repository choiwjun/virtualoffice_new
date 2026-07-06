'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import type { SeatBox } from '@/components/office/SeatCanvas';
import { buildOfficeLayout } from '@/lib/officeLayout';

const SeatCanvas = dynamic(() => import('@/components/office/SeatCanvas'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-gray-400 text-sm">캔버스 로딩...</div>,
});

interface ApiSeat {
  id: string;
  floor_id: string;
  type: string;
  status: string;
  assigned_user_id: number | null;
  seat_number: string | null;
  coords: Record<string, unknown>;
}
interface Floor {
  id: string;
  office_id: string;
  level: number;
  name: string | null;
}
interface LayoutRow {
  id: string;
  version: number;
  status: string;
  deployed_at: string | null;
}

function toBox(s: ApiSeat, i: number): SeatBox {
  const c = s.coords || {};
  const x = typeof c.x === 'number' ? c.x : 40 + (i % 6) * 130;
  const y = typeof c.y === 'number' ? c.y : 40 + Math.floor(i / 6) * 90;
  return { id: s.id, label: s.seat_number || `좌석 ${i + 1}`, x, y, status: s.status, type: s.type };
}

export default function OfficeLayoutPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [seats, setSeats] = useState<SeatBox[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [floorName, setFloorName] = useState<string | null>(null);
  const [floorLevel, setFloorLevel] = useState<number | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [layouts, setLayouts] = useState<LayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [size, setSize] = useState({ w: 800, h: 520 });
  const wrapRef = useRef<HTMLDivElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const [floors, apiSeats, lays] = await Promise.all([
        api.get<Floor[]>('/api/floors').catch(() => [] as Floor[]),
        api.get<ApiSeat[]>('/api/seats'),
        api.get<LayoutRow[]>('/api/office-layouts').catch(() => [] as LayoutRow[]),
      ]);
      setFloorId(floors[0]?.id ?? null);
      setFloorName(floors[0]?.name ?? null);
      setFloorLevel(floors[0]?.level ?? null);
      setOfficeId(floors[0]?.office_id ?? null);
      setLayouts(lays);
      setSeats(apiSeats.filter((s) => s.status !== 'disabled').map(toBox));
    } catch (e) {
      setError(e instanceof ApiError ? `조회 실패 (${e.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(320, el.clientWidth - 2), h: Math.max(360, el.clientHeight - 2) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // 드래그 종료 → 좌표 실저장 (PUT /api/seats/{id})
  const move = useCallback((id: string, x: number, y: number) => {
    setSeats((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
    api.put(`/api/seats/${id}`, { coords: { x, y } }).catch(() => flash('좌표 저장 실패'));
  }, []);

  // 좌석 생성 (POST /api/seats)
  const addSeat = async () => {
    if (!floorId) { flash('층(floor) 데이터가 없어 생성할 수 없습니다.'); return; }
    const n = seats.length + 1;
    const coords = { x: 40 + ((n - 1) % 6) * 130, y: 40 + Math.floor((n - 1) / 6) * 90 };
    try {
      const created = await api.post<ApiSeat>('/api/seats', { floor_id: floorId, type: 'free', coords, seat_number: `A-${String(n).padStart(2, '0')}` });
      setSeats((prev) => [...prev, toBox(created, prev.length)]);
      flash('좌석 생성됨 (저장)');
    } catch (e) {
      flash(e instanceof ApiError ? `생성 실패 (${e.status})` : '오류');
    }
  };

  // 좌석 삭제 (DELETE /api/seats/{id}, soft disable) — 더블클릭
  const removeSeat = async (id: string) => {
    if (!window.confirm('이 좌석을 비활성화(삭제)하시겠습니까?')) return;
    try {
      await api.delete(`/api/seats/${id}`);
      setSeats((prev) => prev.filter((s) => s.id !== id));
      flash('좌석 삭제됨');
    } catch (e) {
      flash(e instanceof ApiError ? `삭제 실패 (${e.status})` : '오류');
    }
  };

  // ── 오피스 레이아웃 버전 (D12) ──
  const createDraft = async () => {
    if (!officeId || !floorId) { flash('office/floor 없음'); return; }
    try {

      const json = buildOfficeLayout({
        officeId,
        floorId,
        floorName: floorName ?? undefined,
        floorLevel: floorLevel ?? undefined,
        seats: seats.map((s) => ({ id: s.id, x: s.x, y: s.y, type: s.type })),
        createdBy: me?.id ?? 0,
      });
      await api.post('/api/office-layouts', { office_id: officeId, floor_id: floorId, json });
      flash('스키마-유효 레이아웃 초안 생성됨 · 검증하세요');
      load();
    } catch (e) {
      flash(e instanceof ApiError ? `초안 생성 실패 (${e.status})` : '오류');
    }
  };

  const validateLayout = async (id: string) => {
    try {
      const res = await api.post<{ status: string; error_count: number; warning_count: number }>(`/api/office-layouts/${id}/validate`, {});
      flash(`검증: ${res.status} (오류 ${res.error_count} / 경고 ${res.warning_count})`);
      load();
    } catch (e) {
      flash(e instanceof ApiError ? `검증 실패 (${e.status})` : '오류');
    }
  };

  const deployLayout = async (id: string) => {
    try {
      await api.post(`/api/office-layouts/${id}/deploy`, {});
      flash('배포 완료');
      load();
    } catch (e) {
      flash(e instanceof ApiError ? (e.status === 409 ? '검증(validated) 후에만 배포 가능 (D12)' : `배포 실패 (${e.status})`) : '오류');
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">좌석 배치 편집은 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">좌석 배치 편집기</h1>
          <p className="text-xs text-gray-400">2D 평면도 (D11) · 드래그=좌표 저장 · 더블클릭=삭제 · 좌석 {seats.length}개{floorId ? '' : ' · 층 없음'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={addSeat} disabled={!floorId} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40">
            + 좌석 추가
          </button>
          <button onClick={load} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">새로고침</button>
        </div>
      </div>
      {toast && <div className="mx-6 mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-xs text-green-700">{toast}</div>}
      <div ref={wrapRef} className="flex-1 min-h-0 m-4 border border-gray-200 rounded-xl overflow-hidden bg-white relative">
        {loading ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-red-600 text-sm">{error}</div>
        ) : (
          <>
            {seats.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 text-gray-400 text-sm">
                좌석이 없습니다. &quot;+ 좌석 추가&quot;로 배치를 시작하세요.
              </div>
            )}
            <SeatCanvas seats={seats} width={size.w} height={size.h} onMove={move} onDelete={removeSeat} />
          </>
        )}
      </div>
      {/* 오피스 레이아웃 버전 (D12 검증·배포) */}
      <div className="flex-shrink-0 mx-4 mb-4 border border-gray-200 rounded-xl bg-white p-3 max-h-52 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700">레이아웃 버전 (D12) · {layouts.length}개</span>
          <button onClick={createDraft} disabled={!officeId} className="text-xs px-2 py-1 border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50 disabled:opacity-40">
            현재 배치로 초안 생성
          </button>
        </div>
        {layouts.length === 0 ? (
          <p className="text-xs text-gray-400">레이아웃 버전이 없습니다. 초안을 생성해 검증→배포하세요. (검증 ERROR 0건일 때만 배포 — D12)</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-gray-400"><tr><th className="text-left py-1">버전</th><th className="text-left py-1">상태</th><th className="text-right py-1">액션</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {layouts.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 text-gray-700">v{l.version}</td>
                  <td className="py-1.5">
                    <span className={`px-1.5 py-0.5 rounded ${l.status === 'deployed' ? 'bg-green-100 text-green-700' : l.status === 'validated' ? 'bg-blue-100 text-blue-700' : l.status === 'archived' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{l.status}</span>
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => validateLayout(l.id)} className="px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 mr-1">검증</button>
                    <button onClick={() => deployLayout(l.id)} disabled={l.status !== 'validated'} className="px-2 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40">배포</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
