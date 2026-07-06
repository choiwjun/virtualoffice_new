'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { KpiResult, metricLabel, formatScore, formatKst, OBJECTION_STATUS } from '@/lib/kpi';

const CATEGORIES = ['계산 오류', '누락된 성과', '평가 기준 이견', '기타'];

export default function KpiObjectionPage() {
  const me = getUser();
  const [results, setResults] = useState<KpiResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<KpiResult | null>(null);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');

  const fetchResults = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setError('');
    try {
      // 본인의 확정된 결과만 이의신청 대상
      const data = await api.get<KpiResult[]>(`/api/kpi-results?user_id=${me.id}`);
      setResults(data.filter((r) => r.finalized_at !== null));
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  async function submit() {
    if (!target) return;
    if (text.trim().length < 10) {
      setSaveError('이의 내용은 10자 이상이어야 합니다.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const updated = await api.post<KpiResult>(`/api/kpi-results/${target.id}/objections`, {
        category,
        text,
        evidence: evidence.trim() || null,
      });
      setResults((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setTarget(null);
      setText('');
      setEvidence('');
      flash('이의신청이 접수되었습니다.');
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          not_finalized_yet: '확정되지 않은 결과입니다.',
          objection_window_expired: '이의신청 기간(확정 후 7일)이 만료되었습니다.',
        };
        setSaveError(map[err.message] ?? `접수 실패 (${err.status})`);
      } else {
        setSaveError('서버 오류');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">KPI 이의신청</h1>
      <p className="text-xs text-gray-400 mb-5">확정된 본인 KPI에 대해 이의를 제기할 수 있습니다 (확정 후 7일 이내).</p>

      {toast && (
        <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={fetchResults} className="text-xs text-indigo-600 underline">재시도</button>
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">확정된 KPI 결과가 없습니다. 확정 후 이의신청이 가능합니다.</div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => {
            const obj = OBJECTION_STATUS[r.objection_status];
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{metricLabel(r.metric)}</span>
                    <span className="text-xs text-gray-400">{r.period_key}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${obj.color}`}>{obj.label}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    최종 점수 {formatScore(r.final_score ?? r.value)} · 확정 {formatKst(r.finalized_at)}
                  </div>
                  {r.objection_detail?.text && (
                    <div className="text-xs text-gray-400 mt-1">내 사유: {r.objection_detail.text}</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setTarget(r);
                    setSaveError('');
                  }}
                  disabled={r.objection_status !== 'none'}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {r.objection_status === 'none' ? '이의신청' : '접수됨'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">이의신청 — {metricLabel(target.metric)}</h2>
              <button onClick={() => setTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이의 내용 (10자 이상)</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="점수에 이의를 제기하는 근거를 구체적으로 작성하세요."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">증거 링크 (선택)</label>
                <input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://..."
                />
              </div>
              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setTarget(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? '접수 중...' : '접수'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
