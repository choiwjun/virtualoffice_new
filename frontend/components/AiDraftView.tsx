'use client';

/**
 * AI KPI 서술 초안 렌더 (공용) — 08 §6.2.2 구조 + 구 평면 구조 하위호환.
 *
 * 신 구조(2026-07-13 #27 전환, ai_draft.py):
 *   { strengths: [{strength, example}], improvement_areas: [{area, rationale, actions[]}],
 *     overall_assessment: '상|중상|중|중하|하', overall_rationale, team_percentile, _source }
 * 구 구조(저장된 이력): { 강점, 개선, 근거, _source } — 문자열 또는 배열.
 */

interface StrengthItem {
  strength?: string;
  example?: string;
}

interface ImprovementItem {
  area?: string;
  rationale?: string;
  actions?: string[];
}

interface AiDraft {
  // 신 구조 (08 §6.2.2)
  strengths?: StrengthItem[];
  improvement_areas?: ImprovementItem[];
  overall_assessment?: string;
  overall_rationale?: string;
  team_percentile?: number | null;
  // 구 평면 구조 (하위호환)
  강점?: string[] | string;
  개선?: string[] | string;
  근거?: string;
  _source?: string;
}

const ASSESSMENT_STYLE: Record<string, string> = {
  상: 'bg-emerald-100 text-emerald-700',
  중상: 'bg-teal-100 text-teal-700',
  중: 'bg-sky-100 text-sky-700',
  중하: 'bg-amber-100 text-amber-700',
  하: 'bg-rose-100 text-rose-700',
};

function LegacyVal({ v }: { v: string[] | string | undefined }) {
  if (Array.isArray(v)) {
    return (
      <ul className="list-disc list-inside space-y-0.5">
        {v.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    );
  }
  if (v) return <p className="whitespace-pre-wrap">{v}</p>;
  return null;
}

export default function AiDraftView({ draft }: { draft: unknown }) {
  if (typeof draft === 'string') {
    return <p className="whitespace-pre-wrap">{draft}</p>;
  }
  if (!draft || typeof draft !== 'object') return null;
  const d = draft as AiDraft;
  const structured = Array.isArray(d.strengths) || Array.isArray(d.improvement_areas);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {d._source && (
          <span
            className={`inline-block text-[9px] px-1 py-0.5 rounded ${d._source === 'nvidia' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
          >
            {d._source === 'nvidia' ? 'NVIDIA 생성' : 'MOCK 생성'}
          </span>
        )}
        {structured && d.overall_assessment && (
          <span
            className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${ASSESSMENT_STYLE[d.overall_assessment] ?? 'bg-gray-100 text-gray-600'}`}
          >
            종합 {d.overall_assessment}
          </span>
        )}
        {structured && typeof d.team_percentile === 'number' && (
          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
            팀 상위 {Math.round(100 - d.team_percentile)}% (백분위 {d.team_percentile})
          </span>
        )}
      </div>

      {structured ? (
        <>
          {Array.isArray(d.strengths) && d.strengths.length > 0 && (
            <div>
              <span className="font-semibold text-gray-500">강점</span>
              <ul className="list-disc list-inside space-y-0.5">
                {d.strengths.map((s, i) => (
                  <li key={i}>
                    {s.strength}
                    {s.example && <span className="text-gray-400"> — {s.example}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(d.improvement_areas) && d.improvement_areas.length > 0 && (
            <div>
              <span className="font-semibold text-gray-500">개선 영역</span>
              <ul className="list-disc list-inside space-y-1">
                {d.improvement_areas.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.area}</span>
                    {m.rationale && <span className="text-gray-500"> — {m.rationale}</span>}
                    {Array.isArray(m.actions) && m.actions.length > 0 && (
                      <ul className="list-[circle] list-inside ml-4 text-gray-500">
                        {m.actions.map((a, j) => (
                          <li key={j}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.overall_rationale && (
            <div>
              <span className="font-semibold text-gray-500">종합 근거</span>
              <p className="whitespace-pre-wrap">{d.overall_rationale}</p>
            </div>
          )}
        </>
      ) : (
        <>
          {d.강점 && (
            <div>
              <span className="font-semibold text-gray-500">강점</span>
              <LegacyVal v={d.강점} />
            </div>
          )}
          {d.개선 && (
            <div>
              <span className="font-semibold text-gray-500">개선</span>
              <LegacyVal v={d.개선} />
            </div>
          )}
          {d.근거 && (
            <div>
              <span className="font-semibold text-gray-500">근거</span>
              <LegacyVal v={d.근거} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
