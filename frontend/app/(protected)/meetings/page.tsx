'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

interface Meeting {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  host_user_id: number;
  livekit_room: string | null;
}

interface Participant {
  id: string;
  meeting_id: string;
  user_id: number;
  joined_at: string | null;
  role: string;
}

interface Minute {
  id: string;
  meeting_id: string;
  title: string | null;
  summary: string | null;
  decisions: string;
  action_items_summary: string | null;
  notes: string | null;
  status: string;
  created_by: number;
  created_at: string;
}

interface ActionItem {
  id: string;
  title: string;
  assignee_user_id: number;
  due_date: string;
  priority: string;
  status: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  scheduled: { label: '예정', color: 'bg-blue-100 text-blue-700' },
  started: { label: '진행중', color: 'bg-green-100 text-green-700' },
  ended: { label: '종료', color: 'bg-gray-100 text-gray-500' },
  cancelled: { label: '취소', color: 'bg-red-100 text-red-600' },
};

type RangeTab = 'day' | 'week' | 'month';

function rangeFor(tab: RangeTab): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (tab === 'day') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 0);
  } else if (tab === 'week') {
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 0);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

export default function MeetingsPage() {
  const me = getUser();
  const [tab, setTab] = useState<RangeTab>('week');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [minutes, setMinutes] = useState<Minute[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showMinute, setShowMinute] = useState(false);
  const [toast, setToast] = useState('');

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { from, to } = rangeFor(tab);
      const qs = new URLSearchParams({ scheduled_from: from, scheduled_to: to });
      const data = await api.get<Meeting[]>(`/api/meetings?${qs.toString()}`);
      setMeetings(data);
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패 (${err.status})` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const openDetail = useCallback(async (m: Meeting) => {
    setSelected(m);
    setDetailLoading(true);
    try {
      const [p, mn] = await Promise.all([
        api.get<Participant[]>(`/api/meetings/${m.id}/participants`).catch(() => [] as Participant[]),
        api.get<Minute[]>(`/api/meeting-minutes?meeting_id=${m.id}`).catch(() => [] as Minute[]),
      ]);
      setParticipants(p);
      setMinutes(mn);
      if (mn.length > 0) {
        const items = await api
          .get<ActionItem[]>(`/api/meeting-minutes/${mn[0].id}/action-items`)
          .catch(() => [] as ActionItem[]);
        setActionItems(items);
      } else {
        setActionItems([]);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function join() {
    if (!selected) return;
    try {
      await api.post(`/api/meetings/${selected.id}/join`, {});
      const p = await api.get<Participant[]>(`/api/meetings/${selected.id}/participants`);
      setParticipants(p);
      flash('참석 처리되었습니다.');
    } catch (err) {
      flash(err instanceof ApiError ? `참석 실패 (${err.status})` : '오류');
    }
  }

  async function cancelMeeting() {
    if (!selected) return;
    if (!window.confirm(`"${selected.title}" 회의를 취소하시겠습니까?`)) return;
    try {
      await api.delete(`/api/meetings/${selected.id}`);
      setSelected(null);
      fetchMeetings();
      flash('회의가 취소되었습니다.');
    } catch (err) {
      flash(err instanceof ApiError ? `취소 실패 (${err.status})` : '오류');
    }
  }

  async function finalizeMinute(id: string) {
    try {
      const updated = await api.post<Minute>(`/api/meeting-minutes/${id}/finalize`, {});
      setMinutes((prev) => prev.map((x) => (x.id === id ? updated : x)));
      flash('회의록이 확정되었습니다.');
    } catch (err) {
      flash(err instanceof ApiError ? `확정 실패 (${err.status})` : '오류');
    }
  }

  // group meetings by date (KST)
  const groups: Record<string, Meeting[]> = {};
  for (const m of [...meetings].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
    const key = new Date(m.scheduled_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    (groups[key] ||= []).push(m);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-800">회의 / 회의록</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
        >
          + 회의 예약
        </button>
      </div>
      <div className="flex gap-1 mt-3 mb-4">
        {(['day', 'week', 'month'] as RangeTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-md ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {t === 'day' ? '오늘' : t === 'week' ? '이번 주' : '이번 달'}
          </button>
        ))}
      </div>

      {toast && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={fetchMeetings} className="text-xs text-indigo-600 underline">재시도</button>
        </div>
      ) : meetings.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">이 기간에 예약된 회의가 없습니다.</div>
      ) : (
        <div className="space-y-5">
          {Object.entries(groups).map(([date, list]) => (
            <div key={date}>
              <div className="text-xs font-semibold text-gray-400 mb-2">{date}</div>
              <div className="space-y-2">
                {list.map((m) => {
                  const st = STATUS_LABEL[m.status] ?? { label: m.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <button
                      key={m.id}
                      onClick={() => openDetail(m)}
                      className="w-full text-left bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-indigo-300 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{m.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.color}`}>{st.label}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {new Date(m.scheduled_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })} · {m.room_id}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{selected.title}</h2>
              <div className="flex items-center gap-2">
                {isLeaderOrAbove(me) && selected.status !== 'cancelled' && (
                  <button onClick={cancelMeeting} className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50">
                    회의 취소
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm">
              <div className="text-gray-500 text-xs">
                {formatKst(selected.scheduled_at)} · 방 {selected.room_id} · 호스트 user {selected.host_user_id}
              </div>
              {selected.description && <p className="text-gray-700">{selected.description}</p>}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-700">참석자 ({participants.length})</span>
                  <button onClick={join} className="text-xs px-2 py-1 border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50">
                    참석
                  </button>
                </div>
                {detailLoading ? (
                  <p className="text-xs text-gray-400">불러오는 중...</p>
                ) : participants.length === 0 ? (
                  <p className="text-xs text-gray-400">참석자 없음</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {participants.map((p) => (
                      <span key={p.id} className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                        user {p.user_id}{p.user_id === me?.id ? ' (나)' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-700">회의록 ({minutes.length})</span>
                  <button onClick={() => setShowMinute(true)} className="text-xs px-2 py-1 border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50">
                    + 작성
                  </button>
                </div>
                {minutes.length === 0 ? (
                  <p className="text-xs text-gray-400">작성된 회의록 없음</p>
                ) : (
                  minutes.map((mn) => (
                    <div key={mn.id} className="border border-gray-100 rounded-lg p-3 mb-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-700 text-sm">{mn.title || '회의록'}</span>
                        {mn.status === 'finalized' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">확정</span>
                        ) : (
                          <button onClick={() => finalizeMinute(mn.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">확정</button>
                        )}
                      </div>
                      {mn.summary && <p className="text-xs text-gray-600 mt-1">{mn.summary}</p>}
                      <p className="text-xs text-gray-500 mt-1"><span className="text-gray-400">결정: </span>{mn.decisions}</p>
                    </div>
                  ))
                )}
              </div>

              {actionItems.length > 0 && (
                <div>
                  <span className="font-medium text-gray-700">액션 아이템 ({actionItems.length})</span>
                  <div className="mt-1 space-y-1">
                    {actionItems.map((ai) => (
                      <div key={ai.id} className="text-xs text-gray-600 flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${ai.status === 'completed' ? 'bg-green-500' : 'bg-amber-400'}`} />
                        {ai.title} <span className="text-gray-400">· ~{ai.due_date} · user {ai.assignee_user_id}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreate && <CreateMeetingModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchMeetings(); flash('회의가 예약되었습니다.'); }} />}
      {showMinute && selected && (
        <CreateMinuteModal
          meetingId={selected.id}
          onClose={() => setShowMinute(false)}
          onCreated={() => { setShowMinute(false); openDetail(selected); flash('회의록이 작성되었습니다.'); }}
        />
      )}
    </div>
  );
}

function CreateMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [roomId, setRoomId] = useState('room-1');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!title.trim() || !scheduledAt) { setErr('제목과 시간은 필수입니다.'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.post('/api/meetings', {
        room_id: roomId,
        title,
        description: description.trim() || null,
        scheduled_at: new Date(scheduledAt).toISOString(),
      });
      onCreated();
    } catch (e) {
      if (e instanceof ApiError) setErr(e.status === 409 ? '해당 시간에 회의실이 이미 예약되어 있습니다.' : `예약 실패 (${e.status})`);
      else setErr('서버 오류');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">회의 예약</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">회의실</label>
              <input value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시간</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">취소</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">{saving ? '예약 중...' : '예약'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateMinuteModal({ meetingId, onClose, onCreated }: { meetingId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!decisions.trim()) { setErr('결정 사항은 필수입니다.'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.post('/api/meeting-minutes', {
        meeting_id: meetingId,
        title: title.trim() || null,
        summary: summary.trim() || null,
        decisions,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? `작성 실패 (${e.status})` : '서버 오류');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">회의록 작성</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">제목 (선택)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">요약</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">결정 사항 (필수)</label>
            <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">취소</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">{saving ? '저장 중...' : '작성'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
