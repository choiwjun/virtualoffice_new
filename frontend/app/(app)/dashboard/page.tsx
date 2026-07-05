"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EmployeeApi, MeetingApi, type Employee, type Meeting,
} from "@/lib/api";
import {
  IconSearch, IconPlus, IconChevron, IconMic, IconVideo, IconScreen, IconHand, IconPhone,
} from "@/components/icons";

/** 시안형 오피스 뷰: 중앙 3D(Godot WASM) + 우측 People 패널 + 하단 입장 힌트 + 플로팅 회의 패널 */
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

  const liveMeeting = useMemo(
    () => meetings.find((m) => m.status === "in_progress") ?? null,
    [meetings],
  );
  // 회의 중 = 진행 중 회의 호스트, 나머지 재직자는 In Office
  const inMeetingIds = useMemo(
    () => new Set(meetings.filter((m) => m.status === "in_progress").map((m) => m.host_user_id)),
    [meetings],
  );
  const inMeeting = employees.filter((e) => inMeetingIds.has(e.id));
  const inOffice = employees.filter((e) => !inMeetingIds.has(e.id));

  return (
    <div className="flex h-full min-h-0">
      {/* 중앙: 3D 오피스 + HUD */}
      <section className="relative min-w-0 flex-1 p-4">
        <div className="relative h-full overflow-hidden rounded-2xl border border-panel2/60 bg-bg2">
          <OfficeCanvas />

          {/* 상단 좌측: 오피스 라벨 */}
          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
            <span className="glass px-3 py-1.5 text-xs">
              <span className="font-semibold">가상오피스 · 1F</span>
              <span className="ml-2 text-sub">Godot 실시간</span>
            </span>
            <span className="badge glass px-2.5 py-1 text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> {employees.length} 온라인
            </span>
          </div>

          {/* 하단 중앙: 입장 힌트 */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="glass flex items-center gap-2 px-4 py-2.5 text-sm text-sub">
              룸에 다가가 <kbd className="rounded border border-panel2 bg-bg px-2 py-0.5 text-xs text-ink">E</kbd> 를 눌러 입장
            </div>
          </div>

          {/* 하단 우측: 진행 중 회의 플로팅 패널 */}
          {liveMeeting && <MeetingPanel meeting={liveMeeting} participants={inMeeting} />}
        </div>
      </section>

      {/* 우측: People 패널 */}
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

/** Godot WASM 3D 캔버스(지연 로드 — 87MB, 입장 클릭 시 iframe 로드). */
function OfficeCanvas() {
  const [entered, setEntered] = useState(false);
  if (entered) {
    return <iframe src="/office/index.html" title="가상오피스 3D" className="h-full w-full border-0" allow="autoplay; fullscreen" />;
  }
  return (
    <button
      onClick={() => setEntered(true)}
      className="group flex h-full w-full flex-col items-center justify-center gap-4
        bg-[radial-gradient(ellipse_at_center,#141a28_0%,#0a0e17_70%)] text-center"
    >
      <div className="grid h-20 w-20 place-items-center rounded-full bg-brand/20 text-3xl text-brand ring-1 ring-brand/40
        transition-transform group-hover:scale-110">▶</div>
      <div>
        <div className="text-base font-semibold">3D 오피스 입장</div>
        <div className="mt-1 max-w-sm text-xs text-sub">
          데이터 기반 실시간 3D(Godot 엔진). 좌석·조직 배치가 바뀌면 그대로 반영됩니다.
        </div>
      </div>
    </button>
  );
}

/** 진행 중 회의 플로팅 패널(참석자 이니셜 타일 + 컨트롤바). 실 화상은 회의 화면에서. */
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
        <button className="grid h-8 w-8 place-items-center rounded-full bg-danger text-white">
          <IconPhone className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PeopleGroup({
  title, tone, people, statusLabel,
}: {
  title: string;
  tone: "brand" | "ok";
  people: Employee[];
  statusLabel: string | ((e: Employee) => string);
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
                <div className="truncate text-[11px] text-sub">
                  {typeof statusLabel === "function" ? statusLabel(e) : statusLabel}
                </div>
              </div>
            </li>
          ))}
          {people.length === 0 && <li className="py-2 text-center text-xs text-sub">없음</li>}
        </ul>
      )}
    </div>
  );
}
