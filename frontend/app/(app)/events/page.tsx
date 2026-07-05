"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, Meeting, MeetingApi } from "@/lib/api";

interface EventItem {
  date: string;
  time: string;
  title: string;
  kind: string;
  href?: string;
  status?: string;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "예정", cls: "bg-brand/20 text-brand" },
  in_progress: { label: "진행", cls: "bg-ok/20 text-ok" },
  completed: { label: "완료", cls: "bg-panel2 text-sub" },
  cancelled: { label: "취소", cls: "bg-danger/20 text-danger" },
};

export default function EventsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await MeetingApi.list();
        setMeetings(d.meetings);
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "이벤트 로딩 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 회의 → 이벤트로 통합(D26: MVP는 회의 캘린더가 이벤트 허브 역할). 날짜별 그룹.
  const grouped = useMemo(() => {
    const items: EventItem[] = meetings.map((m) => {
      const dt = (m.scheduled_at || "").replace("T", " ");
      return {
        date: dt.slice(0, 10) || "-",
        time: dt.slice(11, 16),
        title: m.title,
        kind: "회의",
        href: `/meetings/${m.meeting_id}/minutes`,
        status: m.status,
      };
    });
    const byDate = new Map<string, EventItem[]>();
    for (const it of items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
      const arr = byDate.get(it.date) ?? [];
      arr.push(it);
      byDate.set(it.date, arr);
    }
    return Array.from(byDate.entries());
  }, [meetings]);

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">이벤트</h1>
        <p className="mt-1 text-sm text-sub">전사 일정 허브 — 회의·마감 통합 (D26: MVP는 회의 캘린더 기반)</p>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {grouped.length === 0 && <div className="card text-sub">등록된 이벤트가 없습니다.</div>}

      <div className="space-y-4">
        {grouped.map(([date, items]) => (
          <section key={date}>
            <h2 className="mb-2 text-sm font-medium text-sub">{date}</h2>
            <div className="space-y-2">
              {items.map((it, i) => {
                const st = it.status ? STATUS[it.status] : undefined;
                const body = (
                  <div className="card flex items-center gap-3">
                    <div className="w-14 shrink-0 text-center">
                      <div className="text-lg font-semibold">{it.time || "—"}</div>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{it.title}</div>
                      <div className="text-xs text-sub">{it.kind}</div>
                    </div>
                    {st && <span className={`badge ${st.cls}`}>{st.label}</span>}
                  </div>
                );
                return it.href ? (
                  <Link key={i} href={it.href} className="block hover:opacity-90">{body}</Link>
                ) : (
                  <div key={i}>{body}</div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
