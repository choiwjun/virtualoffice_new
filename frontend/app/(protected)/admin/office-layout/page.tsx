'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, ApiError } from '@/lib/api';
import { getUser, isAdmin } from '@/lib/auth';
import type { SeatBox } from '@/components/office/SeatCanvas';

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

function toBox(s: ApiSeat, i: number): SeatBox {
  const c = s.coords || {};
  const x = typeof c.x === 'number' ? c.x : 40 + (i % 6) * 120;
  const y = typeof c.y === 'number' ? c.y : 40 + Math.floor(i / 6) * 90;
  return { id: s.id, label: s.seat_number || `좌석 ${i + 1}`, x, y, status: s.status, type: s.type };
}

export default function OfficeLayoutPage() {
  const me = getUser();
  const allowed = isAdmin(me);
  const [seats, setSeats] = useState<SeatBox[]>([]);
  const [apiCount, setApiCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ w: 800, h: 520 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!allowed) return;
    api
      .get<ApiSeat[]>('/api/seats')
      .then((data) => {
        setApiCount(data.length);
        setSeats(data.map(toBox));
      })
      .catch((e) => setError(e instanceof ApiError ? `조회 실패 (${e.status})` : '서버 연결 오류'))
      .finally(() => setLoading(false));
  }, [allowed]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(320, el.clientWidth - 2), h: Math.max(360, el.clientHeight - 2) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const move = useCallback((id: string, x: number, y: number) => {
    setSeats((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
  }, []);

  const addLocal = () => {
    const n = seats.length + 1;
    setSeats((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        label: `좌석 ${n}`,
        x: 40 + ((n - 1) % 6) * 130,
        y: 40 + Math.floor((n - 1) / 6) * 90,
        status: 'available',
        type: 'desk',
        local: true,
      },
    ]);
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
          <p className="text-xs text-gray-400">2D 평면도 (D11) · 좌석 드래그로 배치 · API 좌석 {apiCount}개</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={addLocal} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">
            + 좌석 추가
          </button>
          <span className="text-[11px] text-gray-400">드래그 위치는 로컬 (좌석 좌표 저장 API 후속)</span>
        </div>
      </div>
      <div ref={wrapRef} className="flex-1 min-h-0 m-4 border border-gray-200 rounded-xl overflow-hidden bg-white relative">
        {loading ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-red-600 text-sm">{error}</div>
        ) : (
          <>
            {seats.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 text-gray-400 text-sm">
                API 좌석이 없습니다. &quot;+ 좌석 추가&quot;로 배치를 시작하세요.
              </div>
            )}
            <SeatCanvas seats={seats} width={size.w} height={size.h} onMove={move} />
          </>
        )}
      </div>
    </div>
  );
}
