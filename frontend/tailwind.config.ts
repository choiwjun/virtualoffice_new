import type { Config } from "tailwindcss";

// 디자인 시안(가상오피스 3D 콘솔) 팔레트 — 다크 네이비 + 블루 액센트 + 글래스모피즘
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0e17", // 캔버스(최심부)
        bg2: "#0d111c", // 상단바/사이드바
        panel: "#121826", // 카드/패널
        panel2: "#232b3d", // 보더/구분선
        panel3: "#1a2130", // 호버/부드러운 표면
        ink: "#e6ebf4", // 본문 텍스트
        sub: "#8a94a6", // 보조 텍스트
        brand: "#3b82f6", // 액센트 블루(활성/버튼)
        brand2: "#2563eb", // 진한 블루
        accent: "#38bdf8", // 글래스 LED 시안
        ok: "#22c55e", // 온라인/성공
        warn: "#f59e0b", // 경고
        danger: "#ef4444", // LIVE/오류
        focus: "#a855f7", // 집중(포커스) 상태
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.45)",
        panel: "0 2px 12px rgba(0,0,0,0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
