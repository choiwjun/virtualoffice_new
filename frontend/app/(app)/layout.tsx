"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/kpi-review", label: "KPI 검토" },
  { href: "/kpi-results", label: "내 평가" },
  { href: "/seat-editor", label: "좌석·배치 편집기" },
  { href: "/org-chart", label: "조직도" },
  { href: "/work-logs", label: "업무기록" },
  { href: "/meetings", label: "회의" },
  { href: "/spaces", label: "공간 관리" },
  { href: "/users", label: "사용자" },
  { href: "/activity-feed", label: "활동 피드" },
  { href: "/audit-logs", label: "감사 로그" },
  { href: "/notifications", label: "알림" },
  { href: "/feedback", label: "피드백" },
  { href: "/sync-monitoring", label: "동기화 모니터링" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-sub">불러오는 중…</div>;
  }
  if (!user) return null; // 리다이렉트 진행 중

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-panel2 bg-panel">
        <div className="border-b border-panel2 px-4 py-4">
          <div className="text-sm font-semibold">가상오피스</div>
          <div className="text-xs text-sub">운영 콘솔</div>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active ? "bg-brand text-white" : "text-ink hover:bg-panel2/40"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-panel2 p-3">
          <div className="mb-2 px-1 text-xs text-sub">
            {user.name} · <span className="uppercase">{user.role}</span>
          </div>
          <button className="btn-ghost w-full" onClick={logout}>
            로그아웃
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
