// 경량 인라인 SVG 아이콘(외부 의존성 없음). stroke=currentColor, 24 그리드.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const IconOffice = (p: P) => (
  <svg {...base(p)}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 9h.01M15 9h.01M9 12h.01M15 12h.01" /></svg>
);
export const IconRooms = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
export const IconPeople = (p: P) => (
  <svg {...base(p)}><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.8" /><path d="M17 20a5.5 5.5 0 0 0-3-4.9" /></svg>
);
export const IconChat = (p: P) => (
  <svg {...base(p)}><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>
);
export const IconEvents = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
);
export const IconVideo = (p: P) => (
  <svg {...base(p)}><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8z" /></svg>
);
export const IconWhiteboard = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8" /></svg>
);
export const IconFiles = (p: P) => (
  <svg {...base(p)}><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M13 3v5h5" /></svg>
);
export const IconSettings = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.8 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 6.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.4A1.6 1.6 0 0 0 11 3v-.1a2 2 0 1 1 4 0V3a1.6 1.6 0 0 0 2.6 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9.4a1.6 1.6 0 0 0 1.5 1.1h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>
);
export const IconChart = (p: P) => (
  <svg {...base(p)}><path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 5-7" /></svg>
);
export const IconAward = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="9" r="5" /><path d="M9 13.5 7 22l5-3 5 3-2-8.5" /></svg>
);
export const IconLayout = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
);
export const IconOrg = (p: P) => (
  <svg {...base(p)}><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 7v5M6 16v-2h12v2" /></svg>
);
export const IconDoc = (p: P) => (
  <svg {...base(p)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
);
export const IconActivity = (p: P) => (
  <svg {...base(p)}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconBell = (p: P) => (
  <svg {...base(p)}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
);
export const IconSync = (p: P) => (
  <svg {...base(p)}><path d="M21 2v6h-6M3 22v-6h6" /><path d="M21 8A9 9 0 0 0 6 5L3 8m0 8a9 9 0 0 0 15 3l3-3" /></svg>
);
export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const IconCalendar = IconEvents;
export const IconChevron = (p: P) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMic = (p: P) => (
  <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const IconScreen = (p: P) => (
  <svg {...base(p)}><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
);
export const IconHand = (p: P) => (
  <svg {...base(p)}><path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V6a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-3.2a1.5 1.5 0 0 1 2.5-1.6L7 12" /></svg>
);
export const IconPhone = (p: P) => (
  <svg {...base(p)}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
);
