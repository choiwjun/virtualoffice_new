# 실시간 스택 QA 런북 (2026-07-12)

> C2(프론트 Colyseus 배선)·서버 스텁 실체화(JWT/presence/layout)·C3(LiveKit) 검증용.
> **자동 검증은 이미 통과**(아래 §3). 이 문서는 **3D/미디어 육안 QA**(브라우저 필요)를 위한 절차.

## 1. 3개 서비스 기동 (각각 별 터미널)

로컬은 SQLite로 실증(운영은 PostgreSQL). 백엔드 python은 `backend/.venv/Scripts/python.exe`.

```bash
# (0) DB 시드 — alice/bob/charlie @virtualoffice.local, password123
cd backend
DATABASE_URL="sqlite+aiosqlite:///./dev_qa.db" ./.venv/Scripts/python.exe scripts/seed_dev.py

# (1) 백엔드 :8000
DATABASE_URL="sqlite+aiosqlite:///./dev_qa.db" \
INTERNAL_API_TOKEN="dev-internal-token-CHANGE-IN-PRODUCTION" \
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# (2) 실시간 이동서버 :2567  (JWT_SECRET 기본값이 백엔드 jwt_secret_key 기본과 일치)
cd realtime && npm run build
PORT=2567 \
PRESENCE_SINK_URL="http://127.0.0.1:8000" \
LAYOUT_SOURCE_URL="http://127.0.0.1:8000" \
PRESENCE_SINK_TOKEN="dev-internal-token-CHANGE-IN-PRODUCTION" \
node dist/index.js

# (3) 프론트 :3000
cd frontend
NEXT_PUBLIC_API_BASE="http://localhost:8000" \
NEXT_PUBLIC_REALTIME_URL="ws://localhost:2567" \
npm run dev
```

로그인: `http://localhost:3000` → alice@virtualoffice.local / password123 → `/office`.

## 2. 육안 체크리스트 (/office)

- [ ] 3D 씬(scene_v4.glb) + 장식 아바타 렌더 (v10 PBR)
- [ ] 좌상단 **연결 배지**: "실시간 연결 · N명 접속"(초록). 서버 미기동 시 "실시간 서버 오프라인"(회색)
- [ ] **본인 아바타**(파란 링) 스폰. 다른 탭/브라우저로 alice·bob 동시 접속 시 상대 아바타 표시
- [ ] **바닥 클릭 → 아바타가 그 지점으로 걸어감**(walk 애니 → 도착 시 idle). 다른 탭에서 실시간 반영
- [ ] 우측 층 선택기, 좌하단 미니맵(정적, 준비중), 우패널 사용자목록
- [ ] (진행중 회의 있을 때) 우하단 오버레이 **"입장하기"** → LiveKit 연결 → MediaBar 마이크/카메라/화면공유 활성 + "연결됨"
  - ⚠️ LiveKit 미디어는 `docker-compose.local.yml`의 livekit(:7880)·coturn 기동 + 브라우저 카메라/마이크 권한 필요

## 3. 자동 검증 (이미 통과 — 회귀 시 재실행)

```bash
# 백엔드: 275 passed / 0 failed
cd backend && ./.venv/Scripts/python.exe -m pytest -q

# 실시간 유닛/통합 스모크 (인프로세스, 브라우저 불필요)
cd realtime
npm run smoke           # 룸 로직 25/0 (이동검증8·근접검증8·reconnect)
npm run client-smoke    # 클라↔서버 프로토콜 8/0 (join·스폰·walker이동·로스터·JWT)
npm run presence-smoke  # HttpPresenceSink 요청 계약 6/0
npm run layout-smoke    # HttpFloorLayoutProvider 4/0 (fetch·토큰·404폴백·팩토리)

# 라이브 E2E (backend+realtime 기동 상태에서) — 실 JWT→onAuth→join→이동
npm run live-check      # 4/0

# 프론트 타입: tsc 0 errors
cd frontend && npx tsc --noEmit
```

**2026-07-12 라이브 확인 완료**: backend 부팅+로그인(alice) · realtime onAuth 실토큰 수락+join+이동(live-check 4/0) · presence write path Colyseus→FastAPI→DB(presence row 기록 확인) · layout fetch(404→demo 폴백). **잔여 = 3D 캔버스·LiveKit 미디어 육안 확인**(위 §2).
