import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0f172a",
        panel: "#1e293b",
        panel2: "#334155",
        ink: "#e2e8f0",
        sub: "#94a3b8",
        brand: "#6366f1",
        ok: "#22c55e",
        warn: "#f59e0b",
        danger: "#ef4444",
      },
    },
  },
  plugins: [],
};

export default config;
