"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  IconOffice, IconRooms, IconPeople, IconEvents, IconVideo, IconChart, IconAward,
  IconLayout, IconOrg, IconDoc, IconActivity, IconShield, IconBell, IconSync, IconChat,
  IconSearch, IconChevron,
} from "@/components/icons";

type NavItem = { href: string; label: string; icon: (p: { className?: string }) => JSX.Element };

// 워크스페이스(시안 1차 내비) + 관리(콘솔 기능) — 시안 스타일로 통합
const WORKSPACE: NavItem[] = [
  { href: "/dashboard", label: "오피스", icon: IconOffice },
  { href: "/spaces", label: "룸", icon: IconRooms },
  { href: "/users", label: "피플", icon: IconPeople },
  { href: "/meetings", label: "회의", icon: IconVideo },
  { href: "/events", label: "이벤트", icon: IconEvents },
];
const MANAGE: NavItem[] = [
  { href: "/kpi-review", label: "KPI 검토", icon: IconChart },
  { href: "/kpi-results", label: "내 평가", icon: IconAward },
  { href: "/seat-editor", label: "좌석·배치", icon: IconLayout },
  { href: "/org-chart", label: "조직도", icon: IconOrg },
  { href: "/work-logs", label: "업무기록", icon: IconDoc },
  { href: "/activity-feed", label: "활동 피드", icon: IconActivity },
  { href: "/audit-logs", label: "감사 로그", icon: IconShield },
  { href: "/notifications", label: "알림", icon: IconBell },
  { href: "/feedback", label: "피드백", icon: IconChat },
  { href: "/sync-monitoring", label: "동기화", icon: IconSync },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready) return <div className="grid min-h-screen place-items-center text-sub">불러오는 중…</div>;
  if (!user) return null;

  const renderNav = (items: NavItem[]) =>
    items.map((item) => {
      const active = pathname.startsWith(item.href);
      const Icon = item.icon;
      return (
        <Link key={item.href} href={item.href} className={`nav-item ${active ? "nav-item-active" : ""}`}>
          <Icon className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
      );
    });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      {/* 상단바 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-panel2/60 bg-bg2 px-4">
        <div className="flex w-52 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">V</span>
          <span className="text-[15px] font-semibold tracking-tight">가상오피스</span>
        </div>
        <button className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink hover:bg-panel3">
          {user.name ? `${user.name}님의 오피스` : "회사 HQ"}
          <IconChevron className="h-4 w-4 text-sub" />
        </button>
        <div className="relative ml-2 hidden max-w-md flex-1 md:block">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub" />
          <input
            className="input rounded-lg py-2 pl-9 pr-14"
            placeholder="검색…"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-panel2 px-1.5 py-0.5 text-[10px] text-sub">
            ⌘K
          </kbd>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/events" className="icon-btn" title="이벤트">
            <IconEvents className="h-[18px] w-[18px]" />
          </Link>
          <Link href="/notifications" className="icon-btn relative" title="알림">
            <IconBell className="h-[18px] w-[18px]" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg2 bg-danger" />
          </Link>
          <div className="ml-1 flex items-center gap-2 rounded-lg border border-panel2/70 bg-panel/60 py-1 pl-1 pr-2">
            <span className="relative grid h-7 w-7 place-items-center rounded-full bg-brand/25 text-xs font-semibold text-brand">
              {user.name?.[0] ?? "U"}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel bg-ok" />
            </span>
            <div className="hidden leading-tight sm:block">
              <div className="text-xs font-medium">{user.name}</div>
              <div className="text-[10px] text-ok">온라인</div>
            </div>
            <button onClick={logout} className="ml-1 text-[10px] text-sub hover:text-ink">로그아웃</button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 좌측 내비 */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-panel2/60 bg-bg2">
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
            {renderNav(WORKSPACE)}
            <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-sub/70">관리</div>
            {renderNav(MANAGE)}
          </nav>
          {/* 층 미니맵 */}
          <div className="border-t border-panel2/60 p-2.5">
            <div className="rounded-xl border border-panel2/70 bg-panel/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">Floor 1</span>
                <IconChevron className="h-3.5 w-3.5 text-sub" />
              </div>
              <svg viewBox="0 0 120 70" className="w-full rounded-md bg-bg/60">
                <rect x="4" y="4" width="112" height="62" rx="3" fill="none" stroke="#232b3d" strokeWidth="1.5" />
                <rect x="70" y="8" width="42" height="26" fill="none" stroke="#2b3448" strokeWidth="1" />
                <line x1="70" y1="34" x2="112" y2="34" stroke="#2b3448" strokeWidth="1" />
                <circle cx="20" cy="22" r="2" fill="#3b82f6" />
                <circle cx="30" cy="30" r="2" fill="#3b82f6" />
                <circle cx="24" cy="46" r="2" fill="#22c55e" />
                <circle cx="88" cy="20" r="2" fill="#f59e0b" />
                <circle cx="92" cy="46" r="2" fill="#3b82f6" />
              </svg>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-sub">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" /> 온라인 표시
              </div>
            </div>
          </div>
        </aside>

        <main className={`min-w-0 flex-1 overflow-auto ${pathname === "/dashboard" ? "" : "p-6"}`}>{children}</main>
      </div>
    </div>
  );
}
