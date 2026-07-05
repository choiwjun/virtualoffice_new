"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EmployeeApi, MeetingApi, type Employee, type Meeting,
} from "@/lib/api";
import {
  IconSearch, IconPlus, IconChevron, IconMic, IconVideo, IconScreen, IconHand, IconPhone,
} from "@/components/icons";

/** 시안형 오피스 뷰(하이브리드): 고품질 오피스 렌더 배경 + 실시간 HTML 오버레이(사람/룸/회의) + 실시간 3D 토글 */
export default function OfficePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    (async () => {
      const settle = async <T,>(p: Promise<T>, fb: T) => { try { return await p; } catch { return fb; } };
      const [emp, meet] = await Promise.all([
        settle(EmployeeApi.list(), { items: [] as Employee[], total: 0 }),
        settle(MeetingApi.list(), { meetings: [] as Meeting[] }),
      ]);
      setEmployees((emp.items ?? []).filter((e) => e.is_active));
      setMeetings(meet.meetings ?? []);
    })();
  }, []);

  const liveMeeting = useMemo(() => meetings.find((m) => m.status === "in_progress") ?? null, [meetings]);
  const inMeetingIds = useMemo(
    () => new Set(meetings.filter((m) => m.status === "in_progress").map((m) => m.host_user_id)),
    [meetings],
  );
  const inMeeting = employees.filter((e) => inMeetingIds.has(e.id));
  const inOffice = employees.filter((e) => !inMeetingIds.has(e.id));

  return (
    <div className="flex h-full min-h-0">
      <section className="relative min-w-0 flex-1 p-4">
        <OfficeStage employees={inOffice} liveMeeting={liveMeeting} meetingParticipants={inMeeting} total={employees.length} />
      </section>

      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto p-4 pl-0 lg:flex">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">피플 <span className="text-sub">({employees.length})</span></h2>
          <div className="flex gap-1.5">
            <button className="icon-btn h-8 w-8"><IconSearch className="h-4 w-4" /></button>
            <button className="icon-btn h-8 w-8"><IconPlus className="h-4 w-4" /></button>
          </div>
        </div>
        <PeopleGroup title="회의 중" tone="brand" people={inMeeting} statusLabel="회의 중" />
        <PeopleGroup title="오피스 내" tone="ok" people={inOffice} statusLabel={(e) => e.position ?? e.role} />
      </aside>
    </div>
  );
}

// 렌더 이미지 좌표(%) — 책상/룸 앵커. render_capture.gd가 카메라 투영으로 자동 산출(불변).
const DESK_ANCHORS = [
  { x: 15.1, y: 57.3 }, { x: 24.7, y: 50.9 }, { x: 18.8, y: 63.9 }, { x: 28.7, y: 56.3 },
  { x: 35.8, y: 43.4 }, { x: 41.4, y: 39.6 }, { x: 40.2, y: 47.6 }, { x: 45.8, y: 43.4 },
  { x: 26.5, y: 77.8 }, { x: 37.2, y: 67.6 }, { x: 32.5, y: 88.7 }, { x: 43.6, y: 76.2 },
];
const ROOMS = [
  { name: "회의실 A", x: 58.7, y: 28.0, cap: 6 },
  { name: "회의실 B", x: 72.7, y: 35.6, cap: 4 },
];

function OfficeStage({
  employees, liveMeeting, meetingParticipants, total,
}: {
  employees: Employee[];
  liveMeeting: Meeting | null;
  meetingParticipants: Employee[];
  total: number;
}) {
  const [live3d, setLive3d] = useState(false);

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-panel2/60 bg-bg2">
      {live3d ? (
        <iframe src="/office/index.html" title="가상오피스 3D" className="h-full w-full border-0" allow="autoplay; fullscreen" />
      ) : (
        <>
          {/* 고품질 오피스 렌더 배경 */}
          <img src="/office-render.png" alt="가상오피스" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg/40 via-transparent to-bg/20" />

          {/* 룸 상태 라벨 */}
          {ROOMS.map((r) => {
            const occ = liveMeeting && liveMeeting.title.includes(r.name.slice(-1)) ? meetingParticipants.length : 0;
            return (
              <div key={r.name} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
                <div className="glass whitespace-nowrap px-2.5 py-1.5 text-xs">
                  <div className="font-medium">{r.name}</div>
                  <div className="flex items-center gap-1 text-sub">
                    <span className={`h-1.5 w-1.5 rounded-full ${occ > 0 ? "bg-ok" : "bg-sub/50"}`} />
                    {occ > 0 ? `${occ}명 회의 중` : `정원 ${r.cap}`}
                  </div>
                </div>
              </div>
            );
          })}

          {/* 사람 핀(오피스 내 직원 — 책상 앵커에 배치) */}
          {employees.slice(0, DESK_ANCHORS.length).map((e, i) => (
            <div key={e.id} className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${DESK_ANCHORS[i].x}%`, top: `${DESK_ANCHORS[i].y}%` }}>
              <div className="flex flex-col items-center gap-1">
                <div className="glass flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                  {e.name}
                </div>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/30 text-xs font-semibold text-white shadow-glass ring-2 ring-brand/60">
                  {e.name?.[0] ?? "?"}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* 상단 좌측: 오피스 라벨 */}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
        <span className="glass px-3 py-1.5 text-xs">
          <span className="font-semibold">가상오피스 · 1F</span>
          <span className="ml-2 text-sub">{live3d ? "3D 둘러보기 · Godot" : "실시간 현황"}</span>
        </span>
        <span className="badge glass px-2.5 py-1 text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> {total} 온라인</span>
      </div>

      {/* 상단 우측: 3D 입장/나가기 (현황이 메인, 필요할 때만 입장) */}
      <button
        onClick={() => setLive3d((v) => !v)}
        className="absolute right-4 top-4 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-glass hover:bg-brand2"
      >
        <IconVideo className="h-4 w-4" />
        {live3d ? "← 현황으로 나가기" : "3D로 입장 →"}
      </button>

      {/* 하단 중앙: 입장 힌트 */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="glass flex items-center gap-2 px-4 py-2.5 text-sm text-sub">
          룸에 다가가 <kbd className="rounded border border-panel2 bg-bg px-2 py-0.5 text-xs text-ink">E</kbd> 를 눌러 입장
        </div>
      </div>

      {/* 하단 우측: 진행 중 회의 플로팅 패널 */}
      {liveMeeting && <MeetingPanel meeting={liveMeeting} participants={meetingParticipants} />}
    </div>
  );
}

function MeetingPanel({ meeting, participants }: { meeting: Meeting; participants: Employee[] }) {
  const tiles = participants.length ? participants.slice(0, 5) : [{ id: 0, name: meeting.title } as Employee];
  return (
    <div className="glass absolute bottom-4 right-4 w-72 overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {meeting.title}
          <span className="badge bg-danger/20 text-danger">● LIVE</span>
        </div>
        <span className="text-xs tabular-nums text-sub">진행 중</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map((p, i) => (
          <div key={p.id || i} className="flex aspect-video items-center justify-center rounded-lg bg-panel3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/25 text-xs font-semibold text-brand">
              {p.name?.[0] ?? "?"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        {[IconMic, IconVideo, IconScreen, IconHand].map((Ic, i) => (
          <button key={i} className="grid h-8 w-8 place-items-center rounded-full bg-panel3 text-sub hover:text-ink">
            <Ic className="h-4 w-4" />
          </button>
        ))}
        <button className="grid h-8 w-8 place-items-center rounded-full bg-danger text-white"><IconPhone className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function PeopleGroup({
  title, tone, people, statusLabel,
}: {
  title: string; tone: "brand" | "ok"; people: Employee[]; statusLabel: string | ((e: Employee) => string);
}) {
  const [open, setOpen] = useState(true);
  const dot = tone === "brand" ? "bg-brand" : "bg-ok";
  return (
    <div className="card p-3">
      <button onClick={() => setOpen((v) => !v)} className="mb-2 flex w-full items-center justify-between">
        <span className="text-xs font-semibold text-sub">{title} <span className="text-sub/70">({people.length})</span></span>
        <IconChevron className={`h-4 w-4 text-sub transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <ul className="space-y-1">
          {people.slice(0, 12).map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-panel3">
              <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-semibold text-brand">
                {e.name?.[0] ?? "?"}
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel ${dot}`} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm">{e.name}</div>
                <div className="truncate text-[11px] text-sub">{typeof statusLabel === "function" ? statusLabel(e) : statusLabel}</div>
              </div>
            </li>
          ))}
          {people.length === 0 && <li className="py-2 text-center text-xs text-sub">없음</li>}
        </ul>
      )}
    </div>
  );
}
