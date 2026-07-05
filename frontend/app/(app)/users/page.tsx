"use client";

import { useEffect, useState } from "react";
import { ApiError, Employee, EmployeeApi } from "@/lib/api";

const ROLE: Record<string, { label: string; cls: string }> = {
  super_admin: { label: "슈퍼관리자", cls: "bg-danger/20 text-danger" },
  admin: { label: "관리자", cls: "bg-brand/20 text-brand" },
  leader: { label: "팀장", cls: "bg-warn/20 text-warn" },
  employee: { label: "직원", cls: "bg-panel2 text-sub" },
};

export default function UsersPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await EmployeeApi.list();
        setRows(d.items);
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "직원 목록 로딩 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = rows.filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(q.toLowerCase()));

  if (loading) return <div className="text-sub">불러오는 중…</div>;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">사용자</h1>
          <p className="mt-1 text-sm text-sub">ERP 동기화 직원 디렉터리 (읽기 전용 — 인사정보 원본은 ERP)</p>
        </div>
        <input className="input w-56" placeholder="이름/이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-panel2 text-left text-xs text-sub">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">이름</th>
              <th className="px-4 py-2">이메일</th>
              <th className="px-4 py-2">직책</th>
              <th className="px-4 py-2">역할</th>
              <th className="px-4 py-2">근무</th>
              <th className="px-4 py-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const role = ROLE[u.role] ?? ROLE.employee;
              return (
                <tr key={u.id} className="border-b border-panel2/50">
                  <td className="px-4 py-2 text-sub">#{u.id}</td>
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2 text-sub">{u.email}</td>
                  <td className="px-4 py-2">{u.position ?? "-"}</td>
                  <td className="px-4 py-2"><span className={`badge ${role.cls}`}>{role.label}</span></td>
                  <td className="px-4 py-2">{u.work_type ?? "-"}</td>
                  <td className="px-4 py-2">{u.is_active ? <span className="text-ok">활성</span> : <span className="text-sub">비활성</span>}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sub">직원이 없습니다. (ERP 동기화 필요)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
