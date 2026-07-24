'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getUser, isLeaderOrAbove } from '@/lib/auth';
import { formatKst } from '@/lib/kpi';
import {
  PageHeader,
  ToolbarButton,
  Segmented,
  SectionCard,
  EmptyState,
  ErrorBanner,
  LoadingState,
  CARD_SURFACE,
} from '@/components/ui/console';

const ICON = {
  calendar: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8h14M7 3v3M13 3v3" /></svg>,
  plus: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M10 4v12M4 10h12" /></svg>,
  clipboard: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="5" y="4" width="10" height="13" rx="2" /><path d="M8 4V3h4v1M7.5 9h5M7.5 12h3" /></svg>,
  list: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 6h12M4 10h12M4 14h8" /></svg>,
};

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
  scheduled: { label: '시작 전', color: 'bg-bg-surface text-text-muted' },
  in_progress: { label: '진행중', color: 'bg-[rgba(34,197,94,0.16)] text-status-online', pulse: true },
  completed: { label: '종료', color: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan' },
  cancelled: { label: '취소', color: 'bg-[rgba(239,68,68,0.12)] text-red-300' },
};

const AI_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  completed: { label: '완료', dot: 'bg-green-500', badge: 'bg-[rgba(34,197,94,0.16)] text-status-online' },
  in_progress: { label: '진행', dot: 'bg-blue-500', badge: 'bg-[rgba(56,189,248,0.15)] text-accent-cyan' },
  open: { label: '대기', dot: 'bg-gray-300', badge: 'bg-bg-surface text-text-muted' },
  cancelled: { label: '취소', dot: 'bg-red-400', badge: 'bg-[rgba(239,68,68,0.12)] text-red-300' },
};

function StatusBadge({ status }: { status: string }) {
  const st = STATUS_LABEL[status] ?? { label: status, color: 'bg-bg-surface text-text-muted' };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${st.color}`}>
      {st.pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {st.label}
    </span>
  );
}

const INVITE_BADGE: Record<InviteStatus, { label: string; className: string }> = {
  accepted: { label: '수락함', className: 'bg-[rgba(34,197,94,0.16)] text-status-online' },
  declined: { label: '거절함', className: 'bg-[rgba(239,68,68,0.12)] text-red-300' },
  invited: { label: '응답 대기', className: 'bg-[rgba(245,158,11,0.16)] text-status-external' },
};

function InviteStatusIcon({ status }: { status: InviteStatus }) {
  if (status === 'accepted') return <span className="text-status-online font-bold" title="수락함">✓</span>;
  if (status === 'declined') return <span className="text-red-300 font-bold" title="거절함">✕</span>;
  return <span className="text-status-external font-bold" title="응답 대기">?</span>;
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
    <div className="p-6 flex flex-col gap-5 h-full text-text-secondary max-w-6xl mx-auto w-full">
      <PageHeader
        title="회의 / 회의록"
        subtitle="회의를 예약하고 회의록·액션 아이템을 관리합니다"
        icon={ICON.calendar}
        actions={
          <>
            <ToolbarButton onClick={() => { const n = !showDash; setShowDash(n); if (n) loadDash(); }} icon={ICON.list}>
              {showDash ? '액션 대시보드 닫기' : '액션 대시보드'}
            </ToolbarButton>
            <ToolbarButton variant="primary" onClick={() => setShowCreate(true)} icon={ICON.plus}>
              회의 예약
            </ToolbarButton>
          </>
        }
      />

      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        {viewMode === 'list' ? (
          <Segmented
            value={tab}
            onChange={setTab}
            options={(['day', 'week', 'month'] as RangeTab[]).map((t) => ({
              value: t,
              label: t === 'day' ? '오늘' : t === 'week' ? '이번 주' : '이번 달',
            }))}
          />
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCalMonth(({ y, m }) => { const d = new Date(y, m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}
              aria-label="이전 달"
              className="px-2.5 py-1.5 text-sm rounded-md bg-bg-surface border border-border-subtle text-text-secondary hover:bg-bg-surface-raised"
            >
              ‹
            </button>
            <span className="px-2 text-sm font-semibold text-text-secondary min-w-[104px] text-center">{calMonth.y}년 {calMonth.m + 1}월</span>
            <button
              onClick={() => setCalMonth(({ y, m }) => { const d = new Date(y, m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}
              aria-label="다음 달"
              className="px-2.5 py-1.5 text-sm rounded-md bg-bg-surface border border-border-subtle text-text-secondary hover:bg-bg-surface-raised"
            >
              ›
            </button>
          </div>
        )}
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          options={(['list', 'calendar'] as const).map((v) => ({ value: v, label: v === 'list' ? '목록' : '캘린더' }))}
        />
      </div>

      {showDash && (
        <SectionCard
          title="액션 아이템 대시보드"
          icon={ICON.clipboard}
          action={
            <span className="text-xs text-text-muted">
              {dashActive.length}건 · 완료 {dashActive.filter((d) => d.item.status === 'completed').length} · 진행 {dashActive.filter((d) => d.item.status === 'in_progress').length} · 대기 {dashActive.filter((d) => d.item.status === 'open').length}
            </span>
          }
        >
          {dashLoading ? (
            <p className="text-xs text-text-muted">불러오는 중...</p>
          ) : dash.length === 0 ? (
            <EmptyState icon="📋" title="이 기간의 액션 아이템이 없습니다" compact />
          ) : (
            <div className="space-y-1">
              {dash.map(({ item, meeting }) => {
                const st = AI_STATUS[item.status] ?? AI_STATUS.open;
                return (
                  <div key={item.id} className="flex items-center gap-2 text-sm border-b border-border-subtle last:border-0 py-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                    <span className={`flex-1 truncate ${item.status === 'cancelled' ? 'text-text-muted line-through' : 'text-text-primary'}`}>{item.title}</span>
                    <span className="text-xs text-text-muted truncate">{meeting}</span>
                    <span className="text-xs text-text-muted">~{item.due_date}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.badge}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {toast && <div className="px-3 py-2 bg-[rgba(34,197,94,0.16)] border border-[rgba(34,197,94,0.4)] rounded-md text-sm text-status-online">{toast}</div>}

      {loading ? (
        <LoadingState label="불러오는 중…" />
      ) : error ? (
        <ErrorBanner message={error} onRetry={fetchMeetings} />
      ) : viewMode === 'calendar' ? (
        <MonthCalendar year={calMonth.y} month={calMonth.m} meetings={meetings} onSelect={openDetail} />
      ) : meetings.length === 0 ? (
        <EmptyState icon="📅" title="이 기간에 예약된 회의가 없습니다" hint="회의 예약 버튼으로 새 회의를 만들어 보세요." />
      ) : (
        <SectionCard title="예약된 회의" icon={ICON.calendar} bodyClassName="p-4 space-y-5">
          {Object.entries(groups).map(([date, list]) => (
            <div key={date}>
              <div className="text-xs font-semibold text-text-muted mb-2">{date}</div>
              <div className="space-y-2">
                {list.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(m)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDetail(m); }}
                    className="w-full text-left bg-bg-surface border border-border-subtle rounded-lg px-4 py-3 hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text-primary">{m.title}</span>
                      <div className="flex items-center gap-2">
                        {myInvites[m.id] === 'invited' ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); respondInvite(m.id, 'accepted'); }}
                              disabled={respondBusy === m.id}
                              className="text-[10px] px-2 py-0.5 rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                            >
                              수락
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); respondInvite(m.id, 'declined'); }}
                              disabled={respondBusy === m.id}
                              className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-text-secondary hover:bg-bg-surface-raised disabled:opacity-50"
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
                            className="text-[10px] px-2 py-0.5 rounded border border-[rgba(34,197,94,0.4)] text-status-online hover:bg-[rgba(34,197,94,0.12)]"
                          >
                            회의 시작
                          </button>
                        )}
                        {canManage(m) && m.status === 'in_progress' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); transitionMeeting(m, 'end'); }}
                            className="text-[10px] px-2 py-0.5 rounded border border-[rgba(56,189,248,0.4)] text-accent-cyan hover:bg-[rgba(56,189,248,0.12)]"
                          >
                            회의 종료
                          </button>
                        )}
                        <StatusBadge status={m.status} />
                      </div>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {new Date(m.scheduled_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })} · {m.duration_minutes ?? 60}분 · 참석 {m.participant_count ?? 0}명
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div className="rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-border-subtle" style={{ background: '#161F32' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-text-primary">{selected.title}</h2>
                <StatusBadge status={selected.status} />
              </div>
              <div className="flex items-center gap-2">
                {canManage(selected) && selected.status === 'scheduled' && (
                  <button onClick={() => transitionMeeting(selected, 'start')} className="text-xs px-2 py-1 border border-[rgba(34,197,94,0.4)] text-status-online rounded hover:bg-[rgba(34,197,94,0.12)]">
                    회의 시작
                  </button>
                )}
                {canManage(selected) && selected.status === 'in_progress' && (
                  <button onClick={() => transitionMeeting(selected, 'end')} className="text-xs px-2 py-1 border border-[rgba(56,189,248,0.4)] text-accent-cyan rounded hover:bg-[rgba(56,189,248,0.12)]">
                    회의 종료
                  </button>
                )}
                {isLeaderOrAbove(me) && selected.status !== 'cancelled' && (
                  <button onClick={cancelMeeting} className="text-xs px-2 py-1 border border-[rgba(239,68,68,0.35)] text-red-300 rounded hover:bg-[rgba(239,68,68,0.12)]">
                    회의 취소
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-primary text-xl">×</button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm">
              <div className="text-text-muted text-xs">
                {formatKst(selected.scheduled_at)} · {selected.duration_minutes ?? 60}분 · 참석 {selected.participant_count ?? 0}명 · 호스트 user {selected.host_user_id}
              </div>
              {selected.description && <p className="text-text-secondary">{selected.description}</p>}

              {myParticipant?.invite_status === 'invited' && (
                <div className="rounded-lg border border-[rgba(59,91,254,0.35)] bg-[rgba(59,91,254,0.15)] px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#93A9FF]">이 회의에 초대되었습니다. 참석하시겠습니까?</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => respondInvite(selected.id, 'accepted')}
                      disabled={respondBusy === selected.id}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                      수락
                    </button>
                    <button
                      onClick={() => respondInvite(selected.id, 'declined')}
                      disabled={respondBusy === selected.id}
                      className="rounded-md border border-primary/50 bg-bg-surface px-3 py-1.5 text-xs font-medium text-accent-cyan hover:bg-primary/10 disabled:opacity-50"
                    >
                      거절
                    </button>
                  </div>
                </div>
              )}

              <div className={`rounded-lg border px-3 py-3 ${selectedConsent === 'granted' ? 'border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.12)]' : selectedConsent === 'declined' ? 'border-border-subtle bg-bg-base' : 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.12)]'}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className={`text-sm font-medium ${selectedConsent === 'granted' ? 'text-status-online' : selectedConsent === 'declined' ? 'text-text-secondary' : 'text-status-external'}`}>
                      {selectedConsent === 'granted'
                        ? '녹음/STT 동의됨'
                        : selectedConsent === 'declined'
                          ? '녹음/STT 거부됨 (회의 참여만)'
                          : '이 회의는 녹음/STT가 사용될 수 있습니다'}
                    </p>
                    <p className={`mt-0.5 text-xs ${selectedConsent === 'granted' ? 'text-status-online' : selectedConsent === 'declined' ? 'text-text-muted' : 'text-status-external'}`}>
                      {selectedConsent === 'declined' ? '내 발화는 녹음/STT에 사용되지 않습니다' : '참석자 동의 후 초안 생성 가능'}
                    </p>
                  </div>
                  {selectedConsent === 'granted' ? (
                    <span className="shrink-0 rounded-md bg-bg-surface px-2 py-1 text-xs font-medium text-status-online ring-1 ring-[rgba(34,197,94,0.4)]">
                      동의됨
                    </span>
                  ) : selectedConsent === 'declined' ? (
                    <span className="shrink-0 rounded-md bg-bg-surface px-2 py-1 text-xs font-medium text-text-muted ring-1 ring-border-subtle">
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
                        className="rounded-md border border-[rgba(245,158,11,0.4)] bg-bg-surface px-3 py-1.5 text-xs font-medium text-status-external hover:bg-[rgba(245,158,11,0.12)] disabled:opacity-50"
                      >
                        거부(참여만)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-text-secondary">참석자 ({participants.length})</span>
                  <div className="flex items-center gap-1.5">
                    {canManage(selected) && (
                      <button onClick={() => setShowInvite(true)} className="text-xs px-2 py-1 bg-primary text-white rounded hover:bg-primary-hover">
                        + 참석자 초대
                      </button>
                    )}
                    <button onClick={join} className="text-xs px-2 py-1 border border-primary/50 text-accent-cyan rounded hover:bg-primary/10">
                      참석
                    </button>
                  </div>
                </div>
                {detailLoading ? (
                  <p className="text-xs text-text-muted">불러오는 중...</p>
                ) : participants.length === 0 ? (
                  <p className="text-xs text-text-muted">참석자 없음</p>
                ) : (
                  <div className="space-y-1">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 text-xs">
                        <InviteStatusIcon status={p.invite_status} />
                        <span className="text-text-secondary">
                          {p.user_name || `user ${p.user_id}`}{p.user_id === me?.id ? ' (나)' : ''}
                        </span>
                        {p.role === 'organizer' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(59,91,254,0.2)] text-[#93A9FF]">👑 주최</span>
                        )}
                        {p.role === 'presenter' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(56,189,248,0.15)] text-accent-cyan">발표</span>
                        )}
                        {p.joined_at && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-status-online">
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
                  <span className="font-medium text-text-secondary">회의록 ({minutes.length})</span>
                  <button onClick={() => setShowMinute(true)} className="text-xs px-2 py-1 border border-primary/50 text-accent-cyan rounded hover:bg-primary/10">
                    + 작성
                  </button>
                </div>
                {minutes.length === 0 ? (
                  <p className="text-xs text-text-muted">작성된 회의록 없음</p>
                ) : (
                  minutes.map((mn) => (
                    <div key={mn.id} className="border border-border-subtle rounded-lg p-3 mb-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-text-secondary text-sm">{mn.title || '회의록'}</span>
                        {mn.status === 'finalized' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(34,197,94,0.16)] text-status-online">확정</span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <button onClick={() => finalizeMinute(mn.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-white">확정</button>
                            <button onClick={() => deleteMinute(mn.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-[rgba(239,68,68,0.35)] text-red-300 hover:bg-[rgba(239,68,68,0.12)]">삭제</button>
                          </span>
                        )}
                      </div>
                      {mn.summary && <p className="text-xs text-text-secondary mt-1">{mn.summary}</p>}
                      <p className="text-xs text-text-muted mt-1"><span className="text-text-muted">결정: </span>{mn.decisions}</p>
                    </div>
                  ))
                )}
              </div>

              {actionItems.length > 0 && (
                <div>
                  <span className="font-medium text-text-secondary">액션 아이템 ({actionItems.length})</span>
                  <div className="mt-1 space-y-1">
                    {actionItems.map((ai) => {
                      const st = AI_STATUS[ai.status] ?? AI_STATUS.open;
                      return (
                        <div key={ai.id} className="text-xs text-text-secondary flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                          <span className={`truncate ${ai.status === 'cancelled' ? 'text-text-muted line-through' : ''}`}>{ai.title}</span>
                          <span className="text-text-muted">· ~{ai.due_date} · user {ai.assignee_user_id}</span>
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
    <div className={`${CARD_SURFACE} overflow-hidden`}>
      <div className="grid grid-cols-7 border-b border-border-subtle">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-1.5 text-center text-xs font-semibold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-text-muted'}`}>
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
              className={`min-h-[84px] p-1 border-border-subtle ${i % 7 !== 0 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} ${c.inMonth ? 'bg-bg-surface' : 'bg-bg-base'}`}
            >
              <div className="flex justify-end">
                <span
                  className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full ${
                    c.key === todayKey ? 'bg-primary text-white font-semibold' : c.inMonth ? 'text-text-secondary' : 'text-text-muted'
                  }`}
                >
                  {c.day}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {dayMeetings.slice(0, 2).map((m) => {
                  const st = STATUS_LABEL[m.status] ?? { label: m.status, color: 'bg-bg-surface text-text-muted' };
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
                {extra > 0 && <div className="text-[10px] text-text-muted px-1">+{extra}개 더보기</div>}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="rounded-xl shadow-2xl w-full max-w-md border border-border-subtle" style={{ background: '#161F32' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="font-semibold text-text-primary">참석자 초대</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 검색"
            className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
          />
          {loading ? (
            <p className="text-xs text-text-muted py-4 text-center">직원 목록 불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-text-muted py-4 text-center">초대 가능한 직원이 없습니다.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-border-subtle rounded-md divide-y divide-border-subtle">
              {filtered.map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-surface-raised cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked.includes(e.id)}
                    onChange={() => toggle(e.id)}
                    className="accent-primary"
                  />
                  <span className="flex-1">{e.name}</span>
                  {e.position && <span className="text-xs text-text-muted">{e.position}</span>}
                </label>
              ))}
            </div>
          )}
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised">취소</button>
            <button
              onClick={invite}
              disabled={saving || checked.length === 0}
              className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-xl shadow-2xl w-full max-w-md border border-border-subtle" style={{ background: '#161F32' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="font-semibold text-text-primary">회의 예약</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">제목</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">회의실</label>
            {roomsLoading ? (
              <p className="text-xs text-text-muted py-2">회의실 목록 불러오는 중...</p>
            ) : rooms.length === 0 ? (
              <p className="text-xs text-text-muted py-2">등록된 회의실이 없습니다</p>
            ) : (
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} (정원 {r.capacity}명)</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">시간</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">소요시간</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full border border-border-subtle bg-bg-base text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}분</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">설명 (선택)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised">취소</button>
            <button onClick={save} disabled={saving || roomsLoading || rooms.length === 0} className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50">{saving ? '예약 중...' : '예약'}</button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-border-subtle" style={{ background: '#161F32' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="font-semibold text-text-primary">회의록 작성</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">제목 (선택)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">요약</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">결정 사항 (필수)</label>
            <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={3} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">노트</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-text-secondary">액션 아이템</label>
              <button type="button" onClick={addItem} className="text-xs text-accent-cyan hover:underline">+ 추가</button>
            </div>
            {items.length === 0 && <p className="text-xs text-text-muted">액션 아이템 없음</p>}
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="할 일" className="flex-1 border border-border-subtle bg-bg-base text-text-primary placeholder:text-text-muted rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan" />
                  <input type="date" value={it.due_date} onChange={(e) => setItem(i, { due_date: e.target.value })} className="border border-border-subtle bg-bg-base text-text-primary rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan [color-scheme:dark]" />
                  <button type="button" onClick={() => removeItem(i)} className="text-text-muted hover:text-red-300 text-sm">×</button>
                </div>
              ))}
            </div>
          </div>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-border-subtle rounded-md text-text-secondary hover:bg-bg-surface-raised">취소</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50">{saving ? '저장 중...' : '작성'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
