"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const { user, ready, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/kpi-review");
  }, [ready, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.replace("/kpi-review");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 423
            ? "계정이 잠겼습니다. 잠시 후 다시 시도하세요 (실패 5회 초과)."
            : err.status === 401
              ? "이메일 또는 비밀번호가 올바르지 않습니다."
              : err.status === 400
                ? "이메일과 비밀번호를 입력하세요."
                : `로그인 실패: ${err.detail}`,
        );
      } else {
        setError("서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold">가상오피스 운영 콘솔</h1>
          <p className="mt-1 text-sm text-sub">관리자 계정으로 로그인하세요.</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-sub" htmlFor="email">
            이메일
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-sub" htmlFor="password">
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
