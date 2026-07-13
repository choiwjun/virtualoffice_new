'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove } from '@/lib/auth';
import { KpiResult, metricLabel, formatScore, formatKst, OBJECTION_STATUS } from '@/lib/kpi';

interface Employee {
  id: number;
  name: string;
  email: string;
}

interface ObjectionRow extends KpiResult {
  _employee?: Employee;
}

export default function AdminObjectionsPage() {
  const me = getUser();
  const allowed = isLeaderOrAbove(me);
  const [rows, setRows] = useState<ObjectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  const fetchObjections = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const employees = await api.get<Employee[]>('/api/employees');
      const perUser = await Promise.all(
        employees.map(async (emp) => {
          try {
            const list = await api.get<KpiResult[]>(`/api/kpi-results?user_id=${emp.id}`);
            return list
              .filter((r) => r.objection_status !== 'none')
              .map((r) => ({ ...r, _employee: emp }) as ObjectionRow);
          } catch {
            return [] as ObjectionRow[];
          }
        }),
      );
      const flat = perUser.flat().sort((a, b) => {
        const rank: Record<string, number> = { submitted: 0, reviewing: 1, resolved: 2, none: 3 };
        return rank[a.objection_status] - rank[b.objection_status];
      });
      setRows(flat);
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    fetchObjections();
  }, [fetchObjections]);

  async function review(r: ObjectionRow, action: 'advance' | 'resolve') {
    let revised: number | null = null;
    let note = '';
    if (action === 'resolve') {
      // ±10% 한도(08 §3.2)는 백엔드에서도 강제되지만 입력 단계에서 안내·검증
      const base = r.value;
      const lo = Math.min(base * 0.9, base * 1.1);
      const hi = Math.max(base * 0.9, base * 1.1);
      const raw = window.prompt(
        `재조정 최종 점수 (원점수 ${formatScore(base)}의 ±10%: ${formatScore(lo)}~${formatScore(hi)}, 변경 없으면 비워두고 확인)\n※ 처리 완료 시 final_score가 확정됩니다`,
        '',
      );
      if (raw === null) return;
      if (raw.trim() !== '') {
        revised = Number(raw);
        if (Number.isNaN(revised)) return flash('숫자를 입력하세요');
        if (revised < lo || revised > hi) return flash(`조정 점수는 원점수 ±10%(${formatScore(lo)}~${formatScore(hi)}) 이내여야 합니다`);
      }
      note = window.prompt('처리 메모 (선택)') || '';
    }
    setBusy(r.id);
    try {
      const body: Record<string, unknown> = { action };
      if (note) body.note = note;
      if (revised !== null) body.revised_score = revised;
      const updated = await api.post<KpiResult>(`/api/kpi-results/${r.id}/objections/review`, body);
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...updated, _employee: r._employee } : x)));
      flash(action === 'advance' ? '검토 시작(reviewing)' : '처리 완료(resolved — final_score 확정)');
    } catch (err) {
      flash(err instanceof ApiError ? `실패: ${err.message}` : '오류');
    } finally {
      setBusy('');
    }
  }

  // 신/구 objection_detail 포맷 호환 (구: category/text/evidence 문자열, 신: objection_category/objection_text/evidence 배열)
  function detailView(d: Record<string, unknown> | null | undefined): { category: string; text: string; links: string[] } | null {
    if (!d) return null;
    const category = String(d.objection_category ?? d.category ?? '');
    const text = String(d.objection_text ?? d.text ?? '');
    const ev = d.evidence;
    const links = Array.isArray(ev)
      ? ev.map((e) => (typeof e === 'object' && e !== null && 'url' in e ? String((e as { url: unknown }).url) : String(e))).filter(Boolean)
      : typeof ev === 'string' && ev
        ? [ev]
        : [];
    return { category, text, links };
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-20 text-center bg-white border border-gray-200 rounded-xl p-8">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-gray-700 font-medium">관리자 전용 화면</p>
          <p className="text-sm text-gray-400 mt-1">이의신청 재검토는 관리자/리더만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-800">KPI 이의신청 재검토</h1>
        <button onClick={fetchObjections} disabled={loading} className="text-xs px-3 py-1.5 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          새로고침
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">D15 상태머신: 접수(submitted) → 검토중(reviewing) → 처리완료(resolved)</p>

      {toast && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>}
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">접수된 이의신청이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const obj = OBJECTION_STATUS[r.objection_status];
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">{r._employee?.name ?? `user ${r.user_id}`}</span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-sm text-gray-600">{metricLabel(r.metric)}</span>
                      <span className="text-xs text-gray-400">{r.period_key}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${obj.color}`}>{obj.label}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      최종 {formatScore(r.final_score ?? r.value)} · 접수 {formatKst(r.objection_submitted_at)}
                    </div>
                    {(() => {
                      const d = detailView(r.objection_detail as Record<string, unknown> | null);
                      if (!d) return null;
                      return (
                        <div className="text-xs text-gray-600 mt-1 bg-gray-50 rounded px-2 py-1.5">
                          <span className="text-gray-400">[{d.category}]</span> {d.text}
                          {d.links.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="text-indigo-600 underline ml-1">
                              증거{d.links.length > 1 ? i + 1 : ''}
                            </a>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => review(r, 'advance')}
                      disabled={busy === r.id || r.objection_status !== 'submitted'}
                      className="text-xs px-3 py-1.5 border border-blue-300 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-40"
                    >
                      검토 시작
                    </button>
                    <button
                      onClick={() => review(r, 'resolve')}
                      disabled={busy === r.id || r.objection_status !== 'reviewing'}
                      className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-40"
                    >
                      처리 완료
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
