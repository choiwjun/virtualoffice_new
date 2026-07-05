# 가상오피스 웹 관리 콘솔 (Next.js)

계획 스택(11-tech-stack): **Next.js(App Router, TS) + Tailwind + Konva.js**. 백엔드 FastAPI(`../backend`, management-api)를 소비하는 순수 클라이언트 SPA. 자체 API route/NextAuth 없음 — 인증은 백엔드 JWT(HS256, D4)를 localStorage에 보관.

## 실행

```bash
# 1) 백엔드 (별도 터미널) — CORS 는 http://localhost:3000 허용(config.py)
cd ../backend
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# 개발 편의: 테이블 자동 생성이 필요하면 .env 에 AUTO_CREATE_TABLES=true

# 2) 프론트엔드
cd frontend
npm install
npm run dev            # http://localhost:3000
```

백엔드 주소 변경은 `.env.local` 의 `NEXT_PUBLIC_API_BASE`.

## 검증

```bash
npm run build      # 타입체크 + 프로덕션 빌드 (통과 확인됨)
npm run typecheck  # tsc --noEmit
```

## 구현 화면 (1차, 파생게이트 대응)

| 경로 | 화면 | 대응 |
|------|------|------|
| `/login` | 로그인 (JWT, 401/423 잠금 안내) | P2-R2-T0 / HG-AUTH |
| `/kpi-review` | KPI 검토 — 카드·AI 초안·조정(슬라이더)·확정·이의신청 모달, 역할별 액션 | P6-R3-T1/T4 / REQ-007 |
| `/seat-editor` | 좌석·배치 편집기 — Konva 2D 드래그·스냅(0.5m)·좌석 속성·**서버검증 ERROR 게이팅**·draft 저장·배포 | P3-R2 / REQ-003 |

## 구조

```
app/
  layout.tsx            # AuthProvider 루트
  page.tsx              # 인증 상태에 따라 /kpi-review | /login 리다이렉트
  login/page.tsx
  (app)/layout.tsx      # 인증 가드 + 사이드 네비 셸
  (app)/kpi-review/page.tsx
  (app)/seat-editor/page.tsx
components/
  Modal.tsx
  editor/LayoutCanvas.tsx   # react-konva (ssr:false 동적 로드)
lib/
  api.ts                # fetch 래퍼 + 401 refresh + 도메인 API(Auth/Kpi/Seat/Layout)
  auth.tsx              # AuthProvider/useAuth (localStorage 세션)
```

## 미구현 (후속)
직원명부·조직도(React Flow)·회의·업무기록·동기화·감사로그 화면은 기존 임시 콘솔(`backend/app/static/console.html`)이 읽기중심으로 커버 중. 순차 이관 예정. 상세: `../docs/planning/loop/implementation-gap-report.md`.
