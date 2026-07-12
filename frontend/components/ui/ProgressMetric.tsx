'use client';

// design-style-analysis §4 — Progress bar (지표)
// primary 채움 + 우측 값 라벨

interface ProgressMetricProps {
  label: string;
  value: number;
  max: number;
  unit?: string;
}

export function ProgressMetric({ label, value, max, unit = '' }: ProgressMetricProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-text-secondary font-medium truncate">{label}</span>
        <span className="text-text-secondary ml-2 flex-shrink-0">
          {value}/{max}{unit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-base overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={label}
        />
      </div>
    </div>
  );
}
