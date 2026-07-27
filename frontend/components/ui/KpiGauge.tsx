'use client';

// design-style-analysis §4 — KPI 도넛 게이지
// SVG 원형 프로그레스 링 (초록 진행 + 어두운 트랙, 중앙 큰 숫자)

interface KpiGaugeProps {
  score: number;      // 0–100
  maxScore?: number;  // 기본 100
  size?: number;      // px
}

export function KpiGauge({ score, maxScore = 100, size = 120 }: KpiGaugeProps) {
  const pct = Math.min(Math.max(score / maxScore, 0), 1);
  const radius = 44;
  const cx = 60;
  const cy = 60;
  const strokeWidth = 9;
  const circumference = 2 * Math.PI * radius;
  const dash = pct * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        aria-label={`KPI 점수 ${score}/${maxScore}`}
        role="img"
      >
        {/* 트랙 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-border-subtle))"
          strokeWidth={strokeWidth}
        />
        {/* 진행 링 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#22C55E"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        {/* 중앙 점수 */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgb(var(--color-text-primary))"
          fontSize="26"
          fontWeight="700"
          fontFamily="Pretendard, Inter, sans-serif"
        >
          {score}
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgb(var(--color-text-muted))"
          fontSize="11"
          fontFamily="Pretendard, Inter, sans-serif"
        >
          /{maxScore}
        </text>
      </svg>
    </div>
  );
}
