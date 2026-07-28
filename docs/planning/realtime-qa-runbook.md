# 실시간 스택 QA 런북 (2026-07-12, D35 v3 갱신 2026-07-23)

> C2(프론트 Colyseus 배선)·서버 스텁 실체화(JWT/presence/layout)·C3(LiveKit) 검증용.
> **자동 검증은 이미 통과**(아래 §3). 이 문서는 **2.5D 씬/미디어 육안 QA**(브라우저 필요)를 위한 절차.
> ⚠ **씬 정본 = D35 텍스처드 탑다운 V3**(캔버스 데이터 렌더 + 프로필 사진 배지 아바타). HORIZON 스프라이트·legacy
>   씬 계층은 D35-b에서 제거됨 — realtime는 `SCENE_FLOOR=v3`로 기동해야 클라 V3와 지오메트리 정합.

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
# ⚠ SCENE_FLOOR=v3 필수(탑다운 축정렬 · officeV3.ts 정본과 SYNC). LAYOUT_SOURCE_URL을 함께 주면
#   배포 레이아웃이 우선하지만, **씬과 크기가 다르면 거부하고 씬 층으로 돌아간다**(D40-c, 2026-07-28).
#   `[layout] world mismatch ...` 경고가 한 번 찍히면 그 배포본은 무시된 것이다 — 씬(20×11.256m)과
#   다른 세계를 그대로 받으면 같은 좌표가 다른 자리를 뜻해 조용히 어긋난다.
#   미배포(404) 폴백도 SCENE_FLOOR를 따른다(2026-07-17 수리 — 이전엔 Demo 20×15로 떨어져 전 이동 거부).
#   (SCENE_FLOOR=horizon은 구 다이아 legacy 폴백값 — 클라 씬 계층이 제거되어 QA 무의미.)
cd realtime && npm run build
PORT=2567 \
SCENE_FLOOR=v3 \
PRESENCE_SINK_URL="http://127.0.0.1:8000" \
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

> D33(2026-07-21) 몰입 모드 반영판 — 배지·미디어바·회의 칩은 **하단 중앙 독**, 사이드바=아이콘 레일, 우측 패널=접힘 기본.

- [ ] V3 텍스처드 탑다운 캔버스 씬 렌더(절차적 텍스처, 외부 에셋 0) + 프로필 사진 배지 아바타(사진 없으면 이니셜)
- [ ] **하단 독**: 연결 점(초록=연결·툴팁, 오프라인 시 문구+"다시 연결") · 내 자리로 · 테마 · 상태 메뉴(위로 열림) · (LIVE 회의 시) 입장 칩 · (회의 연결 시) MediaBar
- [ ] **본인 아바타**: 발밑 파란 링 + 네임플레이트 파란 테두리. 다른 탭/브라우저로 alice·bob 동시 접속 시 상대 아바타 표시
- [ ] **바닥 클릭 → 아바타가 그 지점으로 걸어감**(walk 애니 → 도착 시 idle). 다른 탭에서 실시간 반영
- [ ] 좌하단 미니맵: 층 버튼(4F~B1F) 헤더 + 실시간 점 + 접기/열기
- [ ] (진행중 회의 있을 때) 하단 독 **"입장하기"** → LiveKit 연결 → MediaBar 마이크/카메라/화면공유 활성
  - ⚠️ LiveKit 미디어는 `docker-compose.local.yml`의 livekit(:7880)·coturn 기동 + 브라우저 카메라/마이크 권한 필요

**D33 수용 기준(19-office-ux-simplify-spec G1~G5):**

- [ ] G1: 공간 캔버스 ≥ 뷰포트 85% (사이드바 레일 56px + 우측 패널 접힘 기본)
- [ ] G2: 상시 UI ≤ 3클러스터(상단바 · 하단 독 · 접이식 우측 패널/핸들)
- [ ] G3: 네임플레이트 높이 ≤ 아바타 40% (이름+상태점만, "(나)"·상태 텍스트 없음)
- [ ] G4: 본인 식별 = 발밑 링(1초 내 식별)
- [ ] G5: 존 바닥 색면으로 구획 식별(라벨은 호버/클릭 시에만)
- [ ] 사이드바 펼치기/접기, 우측 패널 핸들 열기/접기 동작
- [ ] 회귀: 착석(sit/typing) · 재연결 · 테마 순환 · 좌석 클릭 · 회의 근접 프롬프트 정상

**D34 공간 진입점(20-office-spatial-entrypoints-spec S1~S5):**

- [ ] 아바타 클릭 → 프로필 카드(타인) / 내 업무 카드(본인: 오늘 업무·KPI·자리 비우기)
- [ ] 방 라벨 클릭 → 오늘 일정 카드 + 예약, 진행중 회의 시 ● 입장하기(D24 흐름)
- [ ] 📌 게시판 칩 → 공지 카드 · 🗂️ 서류함 칩 → 보고서 카드(+보고서 열기)
- [ ] 카드 액션 → 해당 화면이 **씬 위 오버레이 창**으로 열림(닫으면 몰입 모드 복귀)
- [ ] 빈 곳 클릭(이동) 시 카드 닫힘 · 빈 자율석 sit 프롬프트 회귀 없음
- [ ] (배포 레이아웃 시) 팀 존 라벨 클릭 → 존 카드(업무현황·팀 채팅)

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
