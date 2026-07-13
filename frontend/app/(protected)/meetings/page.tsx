'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';

type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

interface Meeting {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  started_at: string | null;
  ended_at: string | null;
  status: MeetingStatus;
  host_user_id: number;
  participant_count: number;
  livekit_room: string | null;
}

interface Room {
  id: string;
  name: string;
  type: string;
  capacity: number;
  floor_id: string;
}

type InviteStatus = 'invited' | 'accepted' | 'declined';
type ParticipantRole = 'organizer' | 'participant' | 'presenter';

interface Participant {
  id: string;
  meeting_id: string;
  user_id: number;
  user_name: string | null;
  invited_at: string;
  joined_at: string | null;
  left_at: string | null;
  role: ParticipantRole;
  invite_status: InviteStatus;
}

interface Employee {
  id: number;
  name: string;
  position?: string | null;
  is_active?: boolean;
}

interface ConsentRow {
  user_id: number;
  recording: boolean | null;
  stt: boolean | null;
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

type ActionItemStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

interface ActionItem {
  id: string;
  title: string;
  assignee_user_id: number;
  due_date: string;
  priority: string;
  status: ActionItemStatus;
}

const STATUS_LABEL: Record<string, { label: string; color: string; pulse?: boolean }> = {
  scheduled: { label: '시작 전', color: 'bg-gray-100 text-gray-500' },
  in_progress: { label: '진행중', color: 'bg-green-100 text-green-700', pulse: true },
  completed: { label: '종료', color: 'bg-blue-100 text-blue-700' },
  cancelled: { label: '취소', color: 'bg-red-100 text-red-600' },
};

const AI_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  completed: { label: '완료', dot: 'bg-green-500', badge: 'bg-green-100 text-green-700' },
  in_progress: { label: '진행', dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' },
  open: { label: '대기', dot: 'bg-gray-300', badge: 'bg-gray-100 text-gray-500' },
  cancelled: { label: '취소', dot: 'bg-red-400', badge: 'bg-red-100 text-red-600' },
};

function StatusBadge({ status }: { status: string }) {
  const st = STATUS_LABEL[status] ?? { label: status, color: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${st.color}`}>
      {st.pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {st.label}
    </span>
  );
}

const INVITE_BADGE: Record<InviteStatus, { label: string; className: string }> = {
  accepted: { label: '수락함', className: 'bg-green-100 text-green-700' },
  declined: { label: '거절함', className: 'bg-red-100 text-red-600' },
  invited: { label: '응답 대기', className: 'bg-amber-100 text-amber-700' },
};

function InviteStatusIcon({ status }: { status: InviteStatus }) {
  if (status === 'accepted') return <span className="text-green-600 font-bold" title="수락함">✓</span>;
  if (status === 'declined') return <span className="text-red-500 font-bold" title="거절함">✕</span>;
  return <span className="text-amber-500 font-bold" title="응답 대기">?</span>;
}

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

function monthRange(y: number, m: number): { from: string; to: string } {
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

export default function MeetingsPage() {
  const me = getUser();
  const [tab, setTab] = useState<RangeTab>('week');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
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
  const [showInvite, setShowInvite] = useState(false);
  const [myInvites, setMyInvites] = useState<Record<string, InviteStatus>>({});
  const [respondBusy, setRespondBusy] = useState('');
  const [toast, setToast] = useState('');
  const [showDash, setShowDash] = useState(false);
  const [dash, setDash] = useState<{ item: ActionItem; meeting: string }[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [consentState, setConsentState] = useState<Record<string, 'granted' | 'declined'>>({});
  const [consentSaving, setConsentSaving] = useState(false);

  const canManage = (m: Meeting) => !!me && (me.id === m.host_user_id || isLeaderOrAbove(me));

  const loadDash = useCallback(async () => {
    setDashLoading(true);
    try {
      const collected: { item: ActionItem; meeting: string }[] = [];
      for (const m of meetings) {
        const mins = await api.get<Minute[]>(`/api/meeting-minutes?meeting_id=${m.id}`).catch(() => [] as Minute[]);
        if (mins.length === 0) continue;
        const items = await api.get<ActionItem[]>(`/api/meeting-minutes/${mins[0].id}/action-items`).catch(() => [] as ActionItem[]);
        for (const it of items) collected.push({ item: it, meeting: m.title });
      }
      setDash(collected);
    } finally {
      setDashLoading(false);
    }
  }, [meetings]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { from, to } = viewMode === 'calendar' ? monthRange(calMonth.y, calMonth.m) : rangeFor(tab);
      const qs = new URLSearchParams({ scheduled_from: from, scheduled_to: to });
      const data = await api.get<Meeting[]>(`/api/meetings?${qs.toString()}`);
      setMeetings(data);
    } catch (err) {
      setError(err instanceof ApiError ? `조회 실패: ${err.message}` : '서버 연결 오류');
    } finally {
      setLoading(false);
    }
  }, [tab, viewMode, calMonth]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // 내 초대 상태 (meeting_id → invite_status) — 목록 행의 수락/거절 버튼·뱃지용
  const myId = me?.id;
  useEffect(() => {
    if (!myId || meetings.length === 0) {
      setMyInvites({});
      return;
    }
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        meetings.map(async (m) => {
          const ps = await api.get<Participant[]>(`/api/meetings/${m.id}/participants`).catch(() => [] as Participant[]);
          const mine = ps.find((p) => p.user_id === myId);
          return [m.id, mine?.invite_status] as const;
        }),
      );
      if (!alive) return;
      const map: Record<string, InviteStatus> = {};
      for (const [id, st] of entries) if (st) map[id] = st;
      setMyInvites(map);
    })();
    return () => { alive = false; };
  }, [meetings, myId]);

  const refreshParticipants = useCallback(async (meetingId: string) => {
    const p = await api.get<Participant[]>(`/api/meetings/${meetingId}/participants`).catch(() => [] as Participant[]);
    setParticipants(p);
  }, []);

  const respondInvite = useCallback(async (meetingId: string, status: 'accepted' | 'declined') => {
    setRespondBusy(meetingId);
    try {
      const updated = await api.patch<Participant>(`/api/meetings/${meetingId}/participants/me`, { status });
      setMyInvites((prev) => ({ ...prev, [meetingId]: updated.invite_status }));
      setParticipants((prev) => prev.map((p) => (p.meeting_id === meetingId && p.user_id === myId ? updated : p)));
      flash(status === 'accepted' ? '초대를 수락했습니다.' : '초대를 거절했습니다.');
      if (status === 'accepted') fetchMeetings();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : '서버 연결 오류');
    } finally {
      setRespondBusy('');
    }
  }, [fetchMeetings, myId]);

  const openDetail = useCallback(async (m: Meeting) => {
    setSelected(m);
    setDetailLoading(true);
    try {
      const [p, mn, consents] = await Promise.all([
        api.get<Participant[]>(`/api/meetings/${m.id}/participants`).catch(() => [] as Participant[]),
        api.get<Minute[]>(`/api/meeting-minutes?meeting_id=${m.id}`).catch(() => [] as Minute[]),
        api.get<ConsentRow[]>(`/api/meetings/${m.id}/consent`).catch(() => [] as ConsentRow[]),
      ]);
      setParticipants(p);
      setMinutes(mn);
      const mine = consents.find((c) => c.user_id === me?.id);
      setConsentState((prev) => {
        const next = { ...prev };
        if (mine && mine.recording === true && mine.stt === true) next[m.id] = 'granted';
        else if (mine && (mine.recording === false || mine.stt === false)) next[m.id] = 'declined';
        else delete next[m.id];
        return next;
      });
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
  }, [me?.id]);

  const transitionMeeting = useCallback(async (m: Meeting, action: 'start' | 'end') => {
    try {
      const updated = await api.post<Meeting>(`/api/meetings/${m.id}/${action}`, {});
      setSelected((prev) => (prev && prev.id === m.id ? { ...prev, ...updated } : prev));
      fetchMeetings();
      flash(action === 'start' ? '회의가 시작되었습니다.' : '회의가 종료되었습니다.');
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : '서버 연결 오류');
    }
  }, [fetchMeetings]);

  async function join() {
    if (!selected) return;
    try {
      await api.post(`/api/meetings/${selected.id}/join`, {});
      const p = await api.get<Participant[]>(`/api/meetings/${selected.id}/participants`);
      setParticipants(p);
      flash('참석 처리되었습니다.');
    } catch (err) {
      flash(err instanceof ApiError ? `참석 실패: ${err.message}` : '오류');
    }
  }

  async function submitConsent(granted: boolean) {
    if (!selected) return;
    setConsentSaving(true);
    try {
      await Promise.all([
        api.post(`/api/meetings/${selected.id}/consent`, { consent_type: 'recording', granted }),
        api.post(`/api/meetings/${selected.id}/consent`, { consent_type: 'stt', granted }),
      ]);
      setConsentState((prev) => ({ ...prev, [selected.id]: granted ? 'granted' : 'declined' }));
      flash(granted ? '녹음/STT 사용에 동의했습니다.' : '녹음/STT를 거부했습니다. 회의에는 참여할 수 있습니다.');
    } catch (err) {
      flash(err instanceof ApiError ? `동의 처리 실패: ${err.message}` : '오류');
    } finally {
      setConsentSaving(false);
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
      flash(err instanceof ApiError ? `취소 실패: ${err.message}` : '오류');
    }
  }

  async function finalizeMinute(id: string) {
    try {
      const updated = await api.post<Minute>(`/api/meeting-minutes/${id}/finalize`, {});
      setMinutes((prev) => prev.map((x) => (x.id === id ? updated : x)));
      flash('회의록이 확정되었습니다.');
    } catch (err) {
      flash(err instanceof ApiError ? `확정 실패: ${err.message}` : '오류');
    }
  }

  async function deleteMinute(id: string) {
    if (!window.confirm('이 회의록(초안)을 삭제하시겠습니까?')) return;
    try {
      await api.delete(`/api/meeting-minutes/${id}`);
      setMinutes((prev) => prev.filter((x) => x.id !== id));
      if (minutes.length > 0 && minutes[0].id === id) setActionItems([]);
      flash('회의록이 삭제되었습니다.');
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : '서버 연결 오류');
    }
  }

  // group meetings by date (KST)
  const groups: Record<string, Meeting[]> = {};
  for (const m of [...meetings].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
    const key = new Date(m.scheduled_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    (groups[key] ||= []).push(m);
  }

  const selectedConsent = selected ? consentState[selected.id] : undefined;
  const myParticipant = selected ? participants.find((p) => p.user_id === me?.id) : undefined;
  const dashActive = dash.filter((d) => d.item.status !== 'cancelled');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-800">회의 / 회의록</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const n = !showDash; setShowDash(n); if (n) loadDash(); }}
            className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50"
          >
            {showDash ? '액션 대시보드 닫기' : '액션 대시보드'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
          >
            + 회의 예약
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 mb-4">
        {viewMode === 'list' ? (
          <div className="flex gap-1">
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
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCalMonth(({ y, m }) => { const d = new Date(y, m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}
              aria-label="이전 달"
              className="px-2.5 py-1.5 text-sm rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              ‹
            </button>
            <span className="px-2 text-sm font-semibold text-gray-700 min-w-[104px] text-center">{calMonth.y}년 {calMonth.m + 1}월</span>
            <button
              onClick={() => setCalMonth(({ y, m }) => { const d = new Date(y, m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}
              aria-label="다음 달"
              className="px-2.5 py-1.5 text-sm rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              ›
            </button>
          </div>
        )}
        <div className="flex rounded-md border border-gray-200 overflow-hidden">
          {(['list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-3 py-1.5 text-sm ${viewMode === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {v === 'list' ? '목록' : '캘린더'}
            </button>
          ))}
        </div>
      </div>

      {showDash && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">액션 아이템 대시보드</span>
            <span className="text-xs text-gray-400">
              {dashActive.length}건 · 완료 {dashActive.filter((d) => d.item.status === 'completed').length} · 진행 {dashActive.filter((d) => d.item.status === 'in_progress').length} · 대기 {dashActive.filter((d) => d.item.status === 'open').length}
            </span>
          </div>
          {dashLoading ? (
            <p className="text-xs text-gray-400">불러오는 중...</p>
          ) : dash.length === 0 ? (
            <p className="text-xs text-gray-400">이 기간의 액션 아이템이 없습니다.</p>
          ) : (
            <div className="space-y-1">
              {dash.map(({ item, meeting }) => {
                const st = AI_STATUS[item.status] ?? AI_STATUS.open;
                return (
                  <div key={item.id} className="flex items-center gap-2 text-sm border-b border-gray-50 last:border-0 py-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                    <span className={`flex-1 truncate ${item.status === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.title}</span>
                    <span className="text-xs text-gray-400 truncate">{meeting}</span>
                    <span className="text-xs text-gray-400">~{item.due_date}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.badge}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {toast && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{toast}</div>}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-red-600 text-sm mb-2">{error}</p>
          <button onClick={fetchMeetings} className="text-xs text-indigo-600 underline">재시도</button>
        </div>
      ) : viewMode === 'calendar' ? (
        <MonthCalendar year={calMonth.y} month={calMonth.m} meetings={meetings} onSelect={openDetail} />
      ) : meetings.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">이 기간에 예약된 회의가 없습니다.</div>
      ) : (
        <div className="space-y-5">
          {Object.entries(groups).map(([date, list]) => (
            <div key={date}>
              <div className="text-xs font-semibold text-gray-400 mb-2">{date}</div>
              <div className="space-y-2">
                {list.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(m)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDetail(m); }}
                    className="w-full text-left bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-indigo-300 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">{m.title}</span>
                      <div className="flex items-center gap-2">
                        {myInvites[m.id] === 'invited' ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); respondInvite(m.id, 'accepted'); }}
                              disabled={respondBusy === m.id}
                              className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              수락
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); respondInvite(m.id, 'declined'); }}
                              disabled={respondBusy === m.id}
                              className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                            >
                              거절
                            </button>
                          </span>
                        ) : myInvites[m.id] ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${INVITE_BADGE[myInvites[m.id]].className}`}>
                            {INVITE_BADGE[myInvites[m.id]].label}
                          </span>
                        ) : null}
                        {canManage(m) && m.status === 'scheduled' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); transitionMeeting(m, 'start'); }}
                            className="text-[10px] px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50"
                          >
                            회의 시작
                          </button>
                        )}
                        {canManage(m) && m.status === 'in_progress' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); transitionMeeting(m, 'end'); }}
                            className="text-[10px] px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                          >
                            회의 종료
                          </button>
                        )}
                        <StatusBadge status={m.status} />
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(m.scheduled_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })} · {m.duration_minutes ?? 60}분 · 참석 {m.participant_count ?? 0}명
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-800">{selected.title}</h2>
                <StatusBadge status={selected.status} />
              </div>
              <div className="flex items-center gap-2">
                {canManage(selected) && selected.status === 'scheduled' && (
                  <button onClick={() => transitionMeeting(selected, 'start')} className="text-xs px-2 py-1 border border-green-300 text-green-700 rounded hover:bg-green-50">
                    회의 시작
                  </button>
                )}
                {canManage(selected) && selected.status === 'in_progress' && (
                  <button onClick={() => transitionMeeting(selected, 'end')} className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50">
                    회의 종료
                  </button>
                )}
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
                {formatKst(selected.scheduled_at)} · {selected.duration_minutes ?? 60}분 · 참석 {selected.participant_count ?? 0}명 · 호스트 user {selected.host_user_id}
              </div>
              {selected.description && <p className="text-gray-700">{selected.description}</p>}

              {myParticipant?.invite_status === 'invited' && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-indigo-800">이 회의에 초대되었습니다. 참석하시겠습니까?</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => respondInvite(selected.id, 'accepted')}
                      disabled={respondBusy === selected.id}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      수락
                    </button>
                    <button
                      onClick={() => respondInvite(selected.id, 'declined')}
                      disabled={respondBusy === selected.id}
                      className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      거절
                    </button>
                  </div>
                </div>
              )}

              <div className={`rounded-lg border px-3 py-3 ${selectedConsent === 'granted' ? 'border-green-200 bg-green-50' : selectedConsent === 'declined' ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className={`text-sm font-medium ${selectedConsent === 'granted' ? 'text-green-800' : selectedConsent === 'declined' ? 'text-gray-700' : 'text-amber-800'}`}>
                      {selectedConsent === 'granted'
                        ? '녹음/STT 동의됨'
                        : selectedConsent === 'declined'
                          ? '녹음/STT 거부됨 (회의 참여만)'
                          : '이 회의는 녹음/STT가 사용될 수 있습니다'}
                    </p>
                    <p className={`mt-0.5 text-xs ${selectedConsent === 'granted' ? 'text-green-700' : selectedConsent === 'declined' ? 'text-gray-500' : 'text-amber-700'}`}>
                      {selectedConsent === 'declined' ? '내 발화는 녹음/STT에 사용되지 않습니다' : '참석자 동의 후 초안 생성 가능'}
                    </p>
                  </div>
                  {selectedConsent === 'granted' ? (
                    <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
                      동의됨
                    </span>
                  ) : selectedConsent === 'declined' ? (
                    <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-500 ring-1 ring-gray-200">
                      거부됨
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => submitConsent(true)}
                        disabled={consentSaving}
                        className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {consentSaving ? '처리 중...' : '동의'}
                      </button>
                      <button
                        onClick={() => submitConsent(false)}
                        disabled={consentSaving}
                        className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        거부(참여만)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-700">참석자 ({participants.length})</span>
                  <div className="flex items-center gap-1.5">
                    {canManage(selected) && (
                      <button onClick={() => setShowInvite(true)} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700">
                        + 참석자 초대
                      </button>
                    )}
                    <button onClick={join} className="text-xs px-2 py-1 border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50">
                      참석
                    </button>
                  </div>
                </div>
                {detailLoading ? (
                  <p className="text-xs text-gray-400">불러오는 중...</p>
                ) : participants.length === 0 ? (
                  <p className="text-xs text-gray-400">참석자 없음</p>
                ) : (
                  <div className="space-y-1">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 text-xs">
                        <InviteStatusIcon status={p.invite_status} />
                        <span className="text-gray-700">
                          {p.user_name || `user ${p.user_id}`}{p.user_id === me?.id ? ' (나)' : ''}
                        </span>
                        {p.role === 'organizer' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">👑 주최</span>
                        )}
                        {p.role === 'presenter' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">발표</span>
                        )}
                        {p.joined_at && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            입장함
                          </span>
                        )}
                      </div>
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
                          <span className="flex items-center gap-1">
                            <button onClick={() => finalizeMinute(mn.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">확정</button>
                            <button onClick={() => deleteMinute(mn.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50">삭제</button>
                          </span>
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
                    {actionItems.map((ai) => {
                      const st = AI_STATUS[ai.status] ?? AI_STATUS.open;
                      return (
                        <div key={ai.id} className="text-xs text-gray-600 flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                          <span className={`truncate ${ai.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>{ai.title}</span>
                          <span className="text-gray-400">· ~{ai.due_date} · user {ai.assignee_user_id}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.badge}`}>{st.label}</span>
                        </div>
                      );
                    })}
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
      {showInvite && selected && (
        <InviteParticipantsModal
          meetingId={selected.id}
          excludeUserIds={participants.map((p) => p.user_id)}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            refreshParticipants(selected.id);
            fetchMeetings();
            flash('참석자를 초대했습니다.');
          }}
        />
      )}
    </div>
  );
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function MonthCalendar({
  year,
  month,
  meetings,
  onSelect,
}: {
  year: number;
  month: number;
  meetings: Meeting[];
  onSelect: (m: Meeting) => void;
}) {
  const byDay: Record<string, Meeting[]> = {};
  for (const m of [...meetings].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
    (byDay[kstDateKey(m.scheduled_at)] ||= []).push(m);
  }

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = first.getDay();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells: { key: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < cellCount; i++) {
    const d = new Date(year, month, i - startOffset + 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push({ key, day: d.getDate(), inMonth: d.getMonth() === month });
  }
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-1.5 text-center text-xs font-semibold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          const dayMeetings = byDay[c.key] ?? [];
          const extra = dayMeetings.length - 2;
          return (
            <div
              key={c.key}
              className={`min-h-[84px] p-1 border-gray-100 ${i % 7 !== 0 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} ${c.inMonth ? 'bg-white' : 'bg-gray-50'}`}
            >
              <div className="flex justify-end">
                <span
                  className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full ${
                    c.key === todayKey ? 'bg-indigo-600 text-white font-semibold' : c.inMonth ? 'text-gray-600' : 'text-gray-300'
                  }`}
                >
                  {c.day}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {dayMeetings.slice(0, 2).map((m) => {
                  const st = STATUS_LABEL[m.status] ?? { label: m.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <button
                      key={m.id}
                      onClick={() => onSelect(m)}
                      title={m.title}
                      className={`block w-full truncate text-left text-[10px] px-1 py-0.5 rounded hover:opacity-80 ${st.color}`}
                    >
                      {m.title}
                    </button>
                  );
                })}
                {extra > 0 && <div className="text-[10px] text-gray-400 px-1">+{extra}개 더보기</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InviteParticipantsModal({
  meetingId,
  excludeUserIds,
  onClose,
  onInvited,
}: {
  meetingId: string;
  excludeUserIds: number[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.get<Employee[]>('/api/employees');
        if (alive) setEmployees(data.filter((e) => e.is_active !== false && !excludeUserIds.includes(e.id)));
      } catch (e) {
        if (alive) setErr(e instanceof ApiError ? `직원 목록 조회 실패: ${e.message}` : '서버 오류');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = employees.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (id: number) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function invite() {
    if (checked.length === 0) { setErr('초대할 직원을 선택하세요.'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.post(`/api/meetings/${meetingId}/participants`, { user_ids: checked });
      onInvited();
    } catch (e) {
      setErr(e instanceof ApiError ? `초대 실패: ${e.message}` : '서버 오류');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">참석자 초대</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 검색"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {loading ? (
            <p className="text-xs text-gray-400 py-4 text-center">직원 목록 불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">초대 가능한 직원이 없습니다.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-50">
              {filtered.map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked.includes(e.id)}
                    onChange={() => toggle(e.id)}
                    className="accent-indigo-600"
                  />
                  <span className="flex-1">{e.name}</span>
                  {e.position && <span className="text-xs text-gray-400">{e.position}</span>}
                </label>
              ))}
            </div>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">취소</button>
            <button
              onClick={invite}
              disabled={saving || checked.length === 0}
              className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '초대 중...' : `초대 (${checked.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const DURATION_OPTIONS = [30, 60, 90, 120];

function CreateMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomId, setRoomId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.get<Room[]>('/api/rooms');
        if (!alive) return;
        setRooms(data);
        if (data.length > 0) setRoomId(data[0].id);
      } catch (e) {
        if (alive) setErr(e instanceof ApiError ? `회의실 목록 조회 실패: ${e.message}` : '서버 오류');
      } finally {
        if (alive) setRoomsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function save() {
    if (!title.trim() || !scheduledAt) { setErr('제목과 시간은 필수입니다.'); return; }
    if (!roomId) { setErr('회의실을 선택하세요.'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.post('/api/meetings', {
        room_id: roomId,
        title,
        description: description.trim() || null,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_minutes: duration,
      });
      onCreated();
    } catch (e) {
      if (e instanceof ApiError) setErr(e.status === 409 ? '해당 시간에 회의실이 이미 예약되어 있습니다.' : `예약 실패: ${e.message}`);
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">회의실</label>
            {roomsLoading ? (
              <p className="text-xs text-gray-400 py-2">회의실 목록 불러오는 중...</p>
            ) : rooms.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">등록된 회의실이 없습니다</p>
            ) : (
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} (정원 {r.capacity}명)</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시간</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">소요시간</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}분</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">취소</button>
            <button onClick={save} disabled={saving || roomsLoading || rooms.length === 0} className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">{saving ? '예약 중...' : '예약'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateMinuteModal({ meetingId, onClose, onCreated }: { meetingId: string; onClose: () => void; onCreated: () => void }) {
  const me = getUser();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ title: string; due_date: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const addItem = () => setItems((prev) => [...prev, { title: '', due_date: new Date().toISOString().split('T')[0] }]);
  const setItem = (i: number, patch: Partial<{ title: string; due_date: string }>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  async function save() {
    if (!decisions.trim()) { setErr('결정 사항은 필수입니다.'); return; }
    setSaving(true);
    setErr('');
    try {
      const minute = await api.post<{ id: string }>('/api/meeting-minutes', {
        meeting_id: meetingId,
        title: title.trim() || null,
        summary: summary.trim() || null,
        decisions,
        notes: notes.trim() || null,
      });
      // 액션 아이템 생성 (POST /api/meeting-minutes/{id}/action-items)
      for (const it of items) {
        if (!it.title.trim()) continue;
        await api.post(`/api/meeting-minutes/${minute.id}/action-items`, {
          title: it.title.trim(),
          assignee_user_id: me?.id ?? 0,
          due_date: it.due_date,
        });
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? `작성 실패: ${e.message}` : '서버 오류');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">노트</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">액션 아이템</label>
              <button type="button" onClick={addItem} className="text-xs text-indigo-600 hover:underline">+ 추가</button>
            </div>
            {items.length === 0 && <p className="text-xs text-gray-400">액션 아이템 없음</p>}
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="할 일" className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input type="date" value={it.due_date} onChange={(e) => setItem(i, { due_date: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button type="button" onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500 text-sm">×</button>
                </div>
              ))}
            </div>
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
