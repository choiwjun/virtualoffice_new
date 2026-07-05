"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? "/kpi-review" : "/login");
  }, [ready, user, router]);

  return <div className="grid min-h-screen place-items-center text-sub">불러오는 중…</div>;
}
