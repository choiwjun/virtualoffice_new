# 기술 아키텍처(TRD) — 가상오피스 운영 플랫폼

> 🔵 **D28 피벗(2026-07-09) — 렌더 아키텍처 대체.** 아래 "Blender Cycles 오프라인 렌더 배경 + 깊이합성"은 폐기, 현행 = **실시간 스타일라이즈드 R3F 단일 렌더**(같은 렌더러라 오클루전 자동 — 별도 깊이합성 없음). Colyseus 이동서버·단일세션 JWT·데이터/ERP/보안/KPI/회의 시퀀스는 유지. 정본 = **00-decisions §I(D28)**.

> ✅ **D27 반영(2026-07-09) — 포토리얼 웹임베드 아키텍처로 재작성 완료.** D26(WorkAdventure) 및 그 이전의 Godot 네이티브 스택은 **전면 폐기**되었다. 현행 정본 = 00-decisions §H(D27) · 14-virtual-office-spec · 15-realtime-server-spec · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}. 데이터 계층·ERP 연동·보안·KPI·회의 시퀀스의 도메인 로직은 D27에서도 유효하며 보존한다.

> **[전환 이력]** ① Godot 4 네이티브 데스크톱/헤드리스 서버(v1.x) → ② D26 WorkAdventure self-host(2026-07-06) → ③ **D27 포토리얼 웹임베드(2026-07-08)**. 최종 확정 = R3F(three.js) 뷰포트 + Blender Cycles 오프라인 렌더 배경 + 깊이합성 + Colyseus(Node/TS) 권위 서버 + 단일세션 JWT. 이전 두 아키텍처의 렌더·클라·서버·배포 서술은 모두 폐기됨(도메인 로직 제외).


**문서 ID**: 02-trd-architecture.md  
**버전**: v2.0  
**작성일**: 2026-07-09 (최초 2026-07-01)  
**상태**: 확정 반영(00-decisions.md §H / D27 정합)  
**대상**: 개발팀 L3 실무자  

> 본 문서의 모든 결정은 **00-decisions.md(정본)** 를 따른다. 충돌 시 00-decisions.md가 이긴다.
> 변경 이력은 문서 하단 **변경 이력** 절 참조.

---

## 개요

가상오피스 운영 플랫폼은 기존 사내 ERP(Space-Daily/DailyLog) 위에 얹는 2.5D 포토리얼 프레즌스 + 협업 계층이다. **단일 통합 웹앱(Next.js)** 을 주력 배포 형식으로 하며, 그 안의 **react-three-fiber(R3F/three.js) 뷰포트**가 3D 씬을 렌더링한다. 배경은 **Blender Cycles로 오프라인 렌더한 포토리얼 이미지 + Z깊이패스**를 사용하고, 런타임에는 경량 GLTF 아바타만 R3F로 렌더하여 배경 깊이맵과 **깊이합성(depth composite)** 함으로써 아바타가 가구·유리벽 뒤로 픽셀 정확하게 가려지는 고정 아이소메트릭 2.5D를 구현한다. 실시간 동기화는 **Colyseus(Node/TS) 권위 서버**(SkyOffice 이식)가 20Hz tick으로 아바타 이동·프레즌스·회의실 점유를 관리한다. FastAPI 백엔드 + Next.js 웹 콘솔이 운영 및 업무 기록을 담당하고, LiveKit를 통해 화상회의를 제공한다. EOD 배치는 협업 신호와 KPI를 ERP로 push하여 분기 인사평가 자료로 활용한다.

> 렌더 예산에 대하여: 배경이 오프라인 렌더 이미지이므로 런타임 3D 렌더 부담은 **아바타(경량 GLTF) + 깊이합성 셰이더**뿐이다. 실시간 렌더러(Forward+/SDFGI/LOD/오클루전 컬링 등)의 GPU 예산 산정은 이 아키텍처에서 무의미하다.

---

## 1. 시스템 구성도

```mermaid
graph TB
    subgraph "클라이언트 계층 (단일 웹앱)"
        WebApp["🌐 Next.js 통합 웹앱<br/>(TypeScript, App Router)<br/>┣ R3F 3D 뷰포트<br/>┃  - 아바타 렌더(경량 GLTF)<br/>┃  - 오프라인 배경 + 깊이합성<br/>┣ 관리 콘솔(조직도/좌석/KPI/회의록)<br/>┗ 업무기록 UI"]
    end

    subgraph "실시간 서버 (권위)"
        Colyseus["🎮 Colyseus 서버<br/>(Node/TS, SkyOffice 이식)<br/>- 20Hz tick 권위 이동<br/>- 충돌/근접 검증<br/>- 회의실 점유 관리<br/>- 프레즌스(메모리 권위)<br/>- Schema binary delta"]
    end

    subgraph "백엔드 API 계층"
        FastAPI["🔧 FastAPI 백엔드<br/>(Python, 단일 데이터 진입)<br/>- 비즈니스 로직<br/>- 데이터 영속(Persistence)<br/>- 배치 작업<br/>- ERP 동기화<br/>- JWT 발급"]
    end

    subgraph "협업 & 회의"
        LiveKit["📞 LiveKit 화상회의<br/>(Self-host)<br/>- 실시간 영상/음성<br/>- 회의실 토폴로지"]
    end

    subgraph "데이터 저장소"
        PostgreSQL["🗃️ PostgreSQL<br/>(우리 DB)<br/>- erp_user, org_group<br/>- office_layout, seat<br/>- presence, meeting<br/>- work_log, kpi_result<br/>- daily_status_push"]
    end

    subgraph "ERP 연동 (Space-Daily)"
        ERPDB["📊 ERP PostgreSQL<br/>(Read-only)<br/>- users, teams<br/>- job_positions<br/>- attendances, leaves"]
        ERPWrite["📤 ERP API<br/>- POST /api/reports<br/>- POST /kpi-results<br/>(신규 엔드포인트)"]
    end

    subgraph "AI 워커"
        AIWorker["🤖 AI 워커<br/>- KPI 초안 생성<br/>- 회의록 요약 검토<br/>(Claude 기본, Gemini 대안)"]
    end

    subgraph "에셋/렌더 파이프라인 (오프라인)"
        Blender["🎨 Blender Cycles<br/>- 배경 오프라인 렌더<br/>- Z깊이패스 + camera.json<br/>- 아바타 GLTF 제작"]
        Optimization["⚙️ 웹 최적화<br/>(glTF-Transform, Draco/meshopt)<br/>- KTX2/Basis 텍스처"]
        AssetDB["📦 에셋 레지스트리<br/>(asset 테이블)<br/>- 라이선스 추적<br/>- 해시 검증"]
    end

    subgraph "배포 (온프렘 단일 서버 PC)"
        WebDeploy["🚀 웹앱 배포<br/>- Next.js 정적/SSR<br/>- Docker Compose + Caddy(TLS)"]
        ServerDeploy["☁️ 백엔드 호스팅<br/>- FastAPI + Uvicorn<br/>- Colyseus(Node) 서버"]
        LiveKitDeploy["🏢 Self-host LiveKit<br/>- 온프레미스 배포"]
    end

    %% 연결 관계
    WebApp -->|WebSocket(WSS) Colyseus Schema| Colyseus
    WebApp -->|REST API| FastAPI
    WebApp -->|LiveKit WebRTC| LiveKit

    Colyseus -->|onAuth JWT 검증| FastAPI
    Colyseus -->|presence batch(1~5s)| FastAPI

    FastAPI -->|읽기/쓰기| PostgreSQL
    FastAPI -->|읽기(SELECT)| ERPDB
    FastAPI -->|쓰기(write API)| ERPWrite

    AIWorker -->|쿼리| PostgreSQL
    AIWorker -->|업데이트| FastAPI

    FastAPI -->|룸 생성/삭제| LiveKit
    LiveKit -->|웹훅 메타데이터| FastAPI

    Blender -->|배경 PNG+깊이+GLTF| Optimization
    Optimization -->|웹 에셋 등록| AssetDB
    AssetDB -->|정적 서빙/로드| WebApp

    WebDeploy -.->|배포| WebApp
    ServerDeploy -.->|배포| FastAPI
    ServerDeploy -.->|배포| Colyseus
    LiveKitDeploy -.->|배포| LiveKit

    style WebApp fill:#9C27B0,color:#fff
    style Colyseus fill:#2196F3,color:#fff
    style FastAPI fill:#FF9800,color:#fff
    style LiveKit fill:#F44336,color:#fff
    style PostgreSQL fill:#37474F,color:#fff
    style ERPDB fill:#616161,color:#fff
    style ERPWrite fill:#616161,color:#fff
    style AIWorker fill:#FFC107,color:#000
```

---

## 2. 컴포넌트별 책임과 통신 프로토콜

### 2.1 R3F(three.js) 클라이언트 (Next.js 웹앱 내 뷰포트)

3D 클라이언트는 별도 데스크톱 앱이 아니라 **단일 통합 Next.js 웹앱 내부에 임베드된 react-three-fiber(R3F/three.js) 뷰포트**다. 설치·자동 업데이트가 없으며 브라우저에서 즉시 실행된다.

**책임**
- 아바타 렌더링 및 애니메이션 (경량 GLTF, three.js WebGL2)
- **깊이합성 렌더**: Blender Cycles 오프라인 렌더 배경 PNG + Z깊이맵을 로드하고, camera.json(직교 아이소 카메라)으로 three.js 카메라를 정합시켜 아바타 프래그먼트를 배경 깊이와 비교(depth composite) → 가구·유리벽 뒤로 픽셀 정확 가림. 고정 아이소메트릭 2.5D
- 로컬 입력(키보드, 마우스) 처리
- Colyseus 서버와 실시간 위치 동기화 (Colyseus Schema 클라이언트 콜백 → 아바타 보간)
- UI: 미니맵, 직원패널(명단/상태), 하단 회의패널 (동일 웹앱의 React 컴포넌트)

**통신 프로토콜**
- **Colyseus 서버 연결**: WebSocket(WSS) 단일 확정 (D1)
  - 전송: Colyseus 클라이언트 SDK(WSS) / 상태 동기화: **Colyseus Schema binary delta**(20Hz). 메시지 어휘 정본 = 15-realtime-server-spec
  - 송신 메시지: `move_request` / `status_change` / `sit_request` / `enter_meeting` / `interact_request`
  - 수신 메시지: `world_update`(Schema delta) / `snapshot` / `layout_updated` / `presence_event`
  - **접속 경로**: 사무실 내는 사내 LAN에서 WSS 직접 접속. 재택/외근자는 443 공개 엔드포인트(WSS, Let's Encrypt) 직접 접속 — VPN 없음 확정
- **FastAPI 백엔드**: REST API (HTTPS)
  - 초기화: `GET /api/presence/init` → 현재 위치, 직원 명단, 좌석 배치 로드
  - 액션: `POST /api/meetings/join` (회의실 진입), `POST /api/work-logs` (업무 기록)
  - 인증: 단일세션 JWT (로그인 시 발급, 웹앱·Colyseus 공유)
- **LiveKit**: 직접 연결 (미디어), 룸 생성/토큰 발급은 FastAPI 경유 (D24)
  - WebRTC 미디어 스트림 (회의 참여 시)

**좌표계 정합 (D25/D27)**
- office_layout은 `top_left` 원점 미터 단위(D25). **Blender ↔ R3F(three.js Y-up) ↔ Colyseus** 3자가 동일 좌표를 공유해야 하며, 배경·깊이합성 정합은 Blender에서 export한 `camera.json`(직교 아이소 투영)을 세 계층이 공유하여 맞춘다.

**오류 처리**
- Colyseus 연결 끊김 → 로컬 보간 유지, 재연결 시도, `snapshot` 재수신으로 복구
- API 요청 실패 → 사용자 피드백 팝업 + 재시도 옵션
- 렌더링 성능 저하 → 아바타 수/그림자 품질만 조정(배경은 오프라인 렌더 정적 이미지라 조정 여지 없음). LOD/오클루전 컬링 등 실시간 씬 최적화는 해당 없음

---

### 2.2 Colyseus 실시간 서버 (권위, Node/TS)

실시간 서버는 **Colyseus(Node/TS) 권위 서버**(SkyOffice 오픈소스 이식)다. 층(floor) 단위 룸으로 확장하며, 20Hz tick으로 권위 시뮬레이션을 돌린다. 상세 정본 = **15-realtime-server-spec**.

**책임**
- **권위 있는 상태 관리**
  - 아바타 위치 검증 (충돌, 경계)
  - 회의실 점유 (최대 수용인원 체크)
  - 근접 감지 (좌석/아바타 간 거리) — 향후 협업 신호로 활용
- **클라이언트 입력 처리**
  - 이동 요청 검증 및 반영 (Schema 갱신 → binary delta 브로드캐스트)
  - 회의실 진입/퇴출 검증
- **프레즌스 상태 관리 (메모리 권위, 우리 소유, ERP 분리)** — 결정: OQ3, D13
  - 3D 프레즌스 상태 기계 = **7종 확정**: `offline / online / working / meeting / focus / away / external` (D13). GPS 기반 `trip_moving`·`trip_arrived`·`returning`은 폐기(GPS 없음)
    - `offline` → `online` (웹앱 로그인)
    - `online` → `working` (지정 좌석/팀 구역 도착)
    - `working` → `meeting` (회의실 진입)
    - `working` / `meeting` → `away` (5분 마우스/키보드 무입력)
    - `*` → `focus` (집중모드 토글 ON, 상태 무관)
    - `*` → `external` (외근/출장 **수동** 전환)
    - `*` → `offline` (웹앱 로그아웃/탭 종료)
  - 자동 타임아웃: 마지막 신호 후 **5분(설정 가능 기본값)** → `away`
  - 근거: 스펙 장애 격리 원칙(가상오피스 장애가 근태/업무 데이터에 영향 없음)
  - **참고**: 3D 화면에는 "ERP상 오늘 check_in된 직원" 목록을 read로 병기 표시 (시각적 참고용)
- **정기적 FastAPI 푸시** (D3 — 데이터 접근은 FastAPI 단일 진입)
  - Colyseus 메모리 권위 프레즌스 → **1초 ~ 5초 주기**로 `POST /api/presence/batch`(FastAPI) → DB 영속
  - 회의 상태 변경 (`POST /api/meetings/{id}/status`)

**통신 프로토콜**
- **클라이언트 입력**: Colyseus WSS + Schema (15-realtime-server-spec 정본)
  - 받음: `move_request` / `status_change` / `sit_request` / `enter_meeting` / `interact_request`
  - 응답: `world_update`(Schema binary delta, 20Hz) / `snapshot` / `layout_updated` / `presence_event`
- **FastAPI 동기화**: REST API (HTTPS)
  - 레이아웃 쿼리: `GET /api/office/{office_id}/floor/{floor_id}/layout` (오피스 좌표/콜리전)
  - 배치 업데이트: `POST /api/presence/batch` (프레즌스·아바타 위치)
  - 개별 업데이트: `PATCH /api/meetings/{room_id}` (회의 상태)
  - 인증: Bearer Token (JWT, 서버용 service account)

**오류 처리**
- 클라이언트 부정 입력 → 무시, 서버 Schema 그대로 유지 (클라이언트가 다음 delta로 재동기화)
- FastAPI 연결 끊김 → 메모리 버퍼링, 온라인 복귀 시 배치 동기화
- 데이터 불일치 → 정기적 재검증 (예: 30초마다 위치 재확인)
- **서버 크래시 시 인메모리 상태 복원**: 프레즌스·아바타 위치는 Colyseus 메모리 권위이므로 크래시 시 휘발 → 재기동 후 클라이언트 재접속 시 서버가 좌석 배정(DB)·최근 배치 push 스냅샷을 근거로 룸 상태를 재구축(reconstruct)한다.

---

### 2.2.1 WSS 핸드셰이크 & 인증 (D1/D4, 단일세션)

Colyseus 서버는 DB(자체/ERP)에 직접 접근하지 않으며(D3), 로그인 자격증명(email/password)도 받지 않는다. 인증은 **FastAPI가 발급한 단일세션 JWT를 Colyseus `onAuth`가 검증**하는 방식이다. OIDC 이중 로그인은 제거되었다.

**핸드셰이크 순서**
1. 클라이언트가 FastAPI 로그인(`POST /api/auth/login`, email/password) → **단일세션 JWT(HS256, 자체 시크릿, 8h 만료)** 수령. 시크릿은 ERP와 공유하지 않는다. 이 JWT 하나로 웹앱 REST와 Colyseus 접속을 모두 처리한다.
2. 클라이언트가 Colyseus 룸 `join`을 요청하며 옵션에 `{ jwt, protocolVersion }`을 전달.
3. Colyseus `onAuth`가 **`protocolVersion` 협상**: 지원 범위 밖이면 join 거부(업데이트 안내).
4. Colyseus `onAuth`가 **자체 시크릿으로 JWT 서명·만료 검증**(FastAPI와 동일 시크릿, ERP 시크릿 아님) → 성공 시 클라이언트를 룸에 입장시킨다. ERP 공개키는 사용하지 않는다(HS256 대칭키이므로 공개키 검증은 성립하지 않음).

**장기 접속 세션과 8h 만료(인밴드 토큰 refresh)**
- 업무 시간 내 WSS 세션은 8h를 초과할 수 있다. JWT 만료로 세션을 끊지 않도록 **인밴드 refresh**를 사용한다.
- 클라이언트는 만료 임박(예: 잔여 15분) 시 FastAPI refresh 엔드포인트로 신규 JWT를 받아 Colyseus 룸에 `reauth` 메시지로 전달, 서버가 재검증하여 세션 유효기간을 갱신한다. 재검증 실패 시에만 재접속을 요구한다.

---

### 2.3 FastAPI 백엔드

**책임**
- **데이터 영속(Persistence)**
  - 비즈니스 엔티티 CRUD: office, seat, user, team, meeting, work_log, kpi_result 등
  - 트랜잭션 관리, 동시성 제어
- **ERP 동기화**
  - 읽기: erp_user, teams, job_positions, attendances, leaves (정기 또는 요청 시)
  - 쓰기: daily_reports (업무기록), kpi_results (신규)
- **비즈니스 로직**
  - 좌석 배정 (고정/자율/임시 구분)
  - 조직 계층 관리 (org_group 등)
  - KPI 산출 (입력된 협업/완료도 집계)
- **배치 작업 (APScheduler)**
  - 근태 동기화: 매일 09:00 (ERP attendances 읽기)
  - EOD push: 매일 18:00 (work_log + kpi_result → ERP)
  - 프레즌스 정리: 오프라인 사용자 상태 초기화
- **AI 워커 오케스트레이션**
  - KPI 초안 생성 요청
  - 회의록 요약 검토 요청

**주요 엔드포인트**
- `GET /api/users` — 직원 명단 (캐시됨, 1시간)
- `GET /api/teams` — 조직 구조
- `GET /api/office/{id}/floor/{floor_id}/layout` — 사무실 배치 (office_layout JSON)
- `GET /api/presence` — 현재 프레즌스 (필터: office_id, floor_id)
- `POST /api/meetings` / `PATCH /api/meetings/{id}` — 회의 관리
- `POST /api/work-logs` — 업무기록 생성
- `POST /api/kpi-results` — KPI 결과 저장 (내부용)
- `POST /api/daily-status-push` — EOD 배치 로그 (관리자 감시)

**통신 프로토콜**
- 클라이언트(웹앱): REST API + JSON (HTTPS)
  - 인증: Bearer Token (**FastAPI 발급 단일세션 JWT, HS256 + 자체 시크릿**, ERP와 시크릿 미공유) (D4)
- Colyseus 서버: REST API + JSON (HTTPS, 같은 네트워크)
  - 인증: Bearer Token (서버용 service account JWT)
- ERP: **psycopg(3.x)** 드라이버 직결 (read-only, 같은 사내망)
  - 쓰기: REST API (ERP의 기존 + 신규 엔드포인트)
  - 인증: JWT (service account, 24h 갱신)
- AI 워커: REST API + JSON (내부)
  - 인증: Bearer Token

**오류 처리**
- ERP DB 연결 끊김 → 캐시 사용, 배치 실패 로그 + 재시도 (Retry Policy)
- ERP API 쓰기 실패 → **DB 영속 재시도 큐**(재시작 시에도 유실 없음, 지수 백오프), daily_status_push 레코드 남김. 메모리 큐/RabbitMQ는 폐기(메모리 큐는 재시작 시 유실되어 재시도 약속과 모순) (D17/D21)
- 트랜잭션 충돌 → SQLAlchemy 낙관적 잠금 사용, 충돌 시 클라이언트 재시도 권유

---

### 2.4 Next.js 웹 관리 콘솔 (동일 웹앱)

관리 콘솔은 3D 뷰포트와 **같은 Next.js 웹앱** 내 라우트다(별도 배포 없음).

**책임**
- **조직 관리**
  - 직원 명단 조회 (ERP 동기화)
  - 조직도 편집 (org_group, team_zone)
  - 팀 별 색, 3D 구역 매핑 (React Flow)
- **사무실 편집기**
  - 2D 배치 편집 (Konva.js)
  - 정밀 확인은 저장 후 동일 웹앱의 R3F 뷰포트 draft 모드(D11)
  - 좌석/회의실 정의
  - office_layout JSON 생성 → FastAPI 저장 → 배포
- **KPI & 업무 대시보드**
  - 기간별 KPI 조회 (그래프)
  - 직원별 업무기록 열람
  - AI 초안 검토 + 관리자 조정 UI
- **회의록 관리**
  - 회의 목록 (참여자, 시간, 상태)
  - 회의록 조회 (결정사항, 액션아이템)
  - 액션아이템 추적

**통신 프로토콜**
- **FastAPI 백엔드**: REST API + JSON (HTTPS)
  - 인증: 사용자 JWT (로그인)
  - 쿠키: httpOnly (CSRF 토큰 포함)
- **클라이언트 측**: JavaScript (App Router → API Routes → FastAPI)

**특이사항**
- 사내 도구이므로 TDS(Toss Design System) 불필요
- 가벼운 TailwindCSS 스타일링

---

### 2.5 LiveKit 화상회의

**책임**
- 실시간 영상/음성 스트림
- 회의실별 토폴로지 관리
- 자동 기록(선택사항)

**배포**
- Self-host (온프레미스, Docker Compose 또는 Kubernetes)
- PostgreSQL 백엔드 (메타데이터)

**통신 프로토콜**
- 클라이언트 → LiveKit: WebRTC
  - 토큰 기반 인증 (JWT 서명, 24h). **룸 생성 및 참가 토큰 발급은 FastAPI 경유 단일화**(클라이언트/게임서버가 LiveKit 룸을 직접 생성하지 않음) (D24)
- FastAPI ↔ LiveKit 웹훅: REST API
  - `POST /api/internal/livekit-webhook` (회의 시작/종료 통보)
  - 인증: **LiveKit API key/secret로 서명한 JWT를 `Authorization` 헤더로 전달**(LiveKit 웹훅 표준). "Webhook Secret (HMAC)" 표기는 정정

---

### 2.6 ERP (Space-Daily) 연동

**책임**
- 읽기: 직원, 조직, 근태, 휴가 정보 Source of Truth
- 쓰기: 업무 결과, KPI 저장소

**읽기 흐름 (FastAPI → ERP DB, 모두 read-only)** — 결정: OQ3 (근태=읽기 원칙)
- 대상 테이블: users, teams, job_positions, attendances(check_in/out, 오늘만), leaves
- 방식: **psycopg(3.x)** 드라이버 직결 (read-only 계정, INSERT/UPDATE/DELETE 불가)
- 주기: 매일 09:00 근태 동기화, 또는 요청 시
- **중요**: 우리는 ERP attendances 테이블에 **쓰기 하지 않음** (v1 범위)
  - ERP attendances = Source of Truth (공식 출퇴근, ERP가 관리)
  - 우리 프레즌스(presence) = 3D 독립 상태 (우리 소유, 업무용)
  - 분리 근거: 장애 격리(가상오피스 장애가 근태/업무에 영향 없음)
  - 3D 화면: ERP attendances 읽기 결과를 "오늘 check_in된 직원" 목록으로만 표시 (시각적 참고)
- 캐싱: 로컬 erp_user 테이블에 미러링 (company_id 스코프)
  - 필드: id(=ERP users.id), company_id, email, name, erp_team_id, role, position, position_id, manager_id, slack_user_id, github_username, jira_email, work_type, work_hours, last_synced_at

**쓰기 흐름 (FastAPI → ERP API)**
1. **업무기록** (실시간): `POST /api/reports` → ERP daily_reports
   - 필드: user_id(=erp_user.id), work_date, today_work, current_tasks, blockers, tomorrow_plan, status
   - ERP 기존 엔드포인트 재사용

2. **KPI 결과** (EOD): `POST /api/kpi-results` (신규 엔드포인트, ERP dev 브랜치 작성, 03-erp-integration.md 참조)
   - 필드: company_id, user_id(=erp_user.id), period, metric, value, source(='virtual_office'), created_at
   - ERP 서버: 신규 kpi_results 테이블 + Alembic 마이그레이션

**인증**
- 읽기: read-only 계정 (DB 수준 권한)
- 쓰기: service account JWT (HS256, 24h, 갱신 엔드포인트)

**오류 처리**
- ERP DB 읽기 실패 → 캐시 사용 + 로깅
- ERP API 쓰기 실패 → daily_status_push 큐 + 재시도 (지수 백오프)
- 데이터 불일치 → 감사 로그(audit_log) 기록

---

### 2.7 AI 워커

**책임**
- KPI 초안 생성
  - 입력: 사용자 업무기록(work_log) + 협업 신호(meeting 참여도)
  - 출력: kpi_result.ai_draft **서술 텍스트**(강점/개선/근거)만. 정량 점수는 결정론적 코드가 계산하며 AI는 산출하지 않음 (D14(e))
- 회의록 요약/검토
  - 입력: meeting_minute (원본 기록) + STT 초안
  - 출력: 자동 추출 decision, action_item, summary

**개인정보 보호 — 외부 AI 전송 가명화 (D20(d))**
- 외부 AI(Claude API 등)로 전송 시 **실명 → 사번으로 가명화**한 뒤 전송(프롬프트·입력 데이터 내 실명·이메일 제거). 처리위탁·국외이전 고지를 문서화한다.

**구현 옵션**
- Claude API (Anthropic) 기본, 또는 Gemini (ERP와 통일 가능)
- 비동기: FastAPI 백그라운드 task (**APScheduler + DB 영속 재시도 큐**). Celery/RabbitMQ는 폐기 (D21)

**통신 프로토콜**
- FastAPI 백엔드 → AI API: REST API (Bearer Token)
  - 요청: 사용자/기간/데이터 JSON
  - 응답: 생성된 텍스트 + 신뢰도 점수

---

### 2.8 에셋/렌더 파이프라인 (오프라인)

파이프라인은 두 갈래다: ① **배경**(오프라인 렌더 이미지 + 깊이) ② **아바타·소품**(경량 GLTF). 상세 정본 = 16-render-spike-and-roadmap, 3d-design/photoreal-web-strategy.

**① 배경 렌더 흐름 (오프라인)**
1. **씬 구성**: Blender에서 오피스 층 3D 씬 구성 (CC0 우선 또는 자체 제작)
2. **오프라인 렌더**: Cycles로 포토리얼 배경 PNG 렌더(직교 아이소 카메라)
3. **깊이패스**: 동일 카메라로 Z깊이패스(깊이 PNG) 렌더
4. **카메라 export**: `camera.json`(직교 투영 행렬·위치)으로 카메라 파라미터 내보내기 → R3F/three.js 카메라 정합에 사용
5. 산출물(office_bg.png / office_depth.png / camera.json)을 웹앱이 정적 로드

**② 아바타·소품 GLTF 흐름 (런타임 렌더 대상)**
1. **제작**: Blender에서 경량 아바타/소품 모델 제작
2. **내보내기**: GLB/glTF 형식
3. **웹 최적화**: glTF-Transform + Draco/meshopt(메시 압축) + KTX2/Basis(텍스처) — 웹 표준. (Godot .tscn·gltfpack→Godot 임포트 폐기)
4. **등록**: asset 테이블에 메타데이터 기록
   - asset_id, asset_name, asset_type, source_url, author, license, license_url
   - downloaded_at, modified_by, commercial_allowed, attribution_required, redistribution_allowed
   - original_file_hash, optimized_file_hash (무결성)
   - used_in_scene (참조)

**라이선스 추적**
- CC0 (저작권 해제) 우선: ambientCG, Poly Haven, Kenney, Quaternius
- CC-BY: 저작자 표시 필수 (asset.attribution_required=true, 게임 내 크레딧)
- 상용: 별도 계약

**관측성**
- asset 테이블 쿼리 → 사용 중인 에셋 목록 + 라이선스 자동 검증
- 빌드 시: 라이선스 위반 검사 (CI/CD)

---

## 3. 배포 구조

> 배포 상세 정본은 **docs/deployment/onprem-docker.md** (2026-07-02 신설).

### 3.1 통합 웹앱 배포 (설치형 없음)

**대상**: 최신 브라우저(WebGL2 지원) — Windows/macOS/Linux/크롬북 무관. **네이티브 인스톨러·PCK·NSIS/DMG/AppImage·자동 업데이터는 전면 폐기.**

**스택**
- Next.js 앱 (TypeScript, App Router) — R3F 뷰포트 + 관리 콘솔 + 업무기록을 단일 앱으로 배포
- SSR/정적 서빙 (온프렘) + 정적 에셋(office_bg.png / office_depth.png / camera.json / GLTF)

**호스팅**
- **Linux 서버 PC 단일화** (D21): 웹앱 포함 전부 Docker Compose + Caddy(TLS 종단) 배포 — 정본 docs/deployment/onprem-docker.md
- Vercel/외부 CDN은 폐기(온프렘 데이터 주권 — 회의·평가 데이터를 외부 인프라에 두지 않음)
- **배포 이점**: 설치·자동 업데이트 없음 → URL 접속 즉시 최신 버전. IT 배포 중앙화 불필요

**도메인**
- 공인 도메인(추후 구매, 그 전 임시 Caddy 내부 CA)
- SSL: **Let's Encrypt 자동 발급(Caddy)**. 상세: docs/deployment/onprem-docker.md §3.1

---

### 3.2 FastAPI 백엔드 & Colyseus 실시간 서버

**공통 호스팅**
- 온프렘 Linux 서버 PC (Ubuntu 22.04 LTS)
- Python 3.11 + Uvicorn (FastAPI)
- Node.js + Colyseus (실시간 서버)

**배포 방식**
- Docker Compose (권장)
  ```
  services:
    fastapi:
      image: voffice-backend:latest
      ports: [8000:8000]
      env: .env (DB, ERP, JWT_SECRET, AI_API_KEY 등)
      volumes: [./data:/app/data]
    colyseus:
      image: voffice-realtime:latest
      ports: [2567:2567]  # WebSocket(WSS, Caddy 프록시 종단)
      # Caddy가 WSS 경로 `/ws/office/*` → colyseus:2567 라우팅 (내부 전용 — 15-realtime-server-spec §8)
      env: FASTAPI_URL=http://fastapi:8000, JWT_SECRET(공유), COLYSEUS_TICK=20
    postgres:
      image: postgres:17-alpine
      env: POSTGRES_DB=voffice
      volumes: [./postgres_data:/var/lib/postgresql/data]
    redis:
      image: redis:7-alpine
      (옵션: 캐시 + Colyseus 다중 프로세스 presence 프리셋. 배치 재시도 큐는 Redis가 아닌 PostgreSQL 영속 테이블 사용 — D21)
  ```

**시크릿 관리 (D21)**
- 운영 시크릿은 `.env` 파일로 관리하되 **파일 권한 600**(소유자 읽기/쓰기 전용)으로 제한한다.
- **반기 1회 로테이션** 정책 문서화(JWT_SECRET, ERP service account, LiveKit API key/secret, AI_API_KEY 등). 커밋된 시크릿은 신뢰하지 않는다.

**헬스체크**
- FastAPI: `GET /healthz` (DB 연결, ERP 연결 상태)
- Colyseus 서버: `GET /matchmake/health` 또는 주기적 heartbeat 신호

**로깅 & 모니터링 (D21, 1인 운영 규모로 축소)**
- Logs: **Loki**(경량 로그 수집). ELK/CloudWatch는 폐기
- Metrics: **Prometheus + Grafana**
  - CPU/메모리, 활성 사용자 수, API 응답시간, ERP 동기화 지연
  - Colyseus 룸 수·tick 지연·네트워크 대역폭, 아바타 위치 업데이트 손실률
- 헬스 감시: **Uptime Kuma**
- 알림: **단일 채널**(1인 운영). 온콜 에스컬레이션 계층은 두지 않음

---

### 3.3 Self-host LiveKit (결정: OQ5)

**호스팅 인프라 (사내 통제)**
- 배포 대상: 온프레미스 VM 또는 사내 클라우드 계정 (AWS/Azure/GCP 자체 계정 아님)
- 근거:
  - **미디어 데이터 주권**: 회의가 인사평가 근거로 연결되는 민감 데이터 → 사내 통제 필수
  - **같은 사내망 지연 이점**: ERP·백엔드와 동일 사내망 → 낮은 레이턴시(< 10ms)
  - **규모상 단일 SFU 노드로 충분**: 설계 100명(도그푸딩 검증 20명) 기준 → 오토스케일 불필요 → 1인 운영 부담 낮음
- **배제 항목**:
  - LiveKit Cloud (SaaS, 민감 미디어 외부 경유, 구독비, B2B 이후 고려)
  - 순수 신규 AWS 계정 (데이터 주권·사내 우선 고려 시 후순위)

**배포 방식**
- Docker Compose + coturn (TURN 서버)
  ```
  services:
    livekit:
      image: livekit/livekit-server:latest
      ports: [7880:7880, 7881:7881, 7882:7882, 49152-65535:49152-65535/udp]
      env: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_PORT, WEBHOOK_KEY
      volumes: [./config.yaml:/etc/livekit.yaml]
    coturn:
      image: coturn/coturn:latest
      ports: [3478:3478/tcp, 3478:3478/udp, 5349:5349/tcp, 5349:5349/udp]
      env: TURNSERVER_USERNAME, TURNSERVER_PASSWORD
      (TURN-over-TLS: 443 공개 엔드포인트용)
    livekit-db:
      image: postgres:17-alpine
      (옵션: 메타데이터 저장)
  ```

**네트워크 접속 경로**
- **사무실 내**: 사내 LAN → LiveKit (7880-7882, UDP 49152-65535)
- **재택/하이브리드/외근**: 7881/TCP + UDP 50000-60000 공개 직결(품질 우선), 실패 시 TURN-over-TLS 443 폴백 — VPN 없음 확정(2026-07-02), 상세 docs/deployment/onprem-docker.md §3.2

**방화벽 규칙**
- TCP 7881 (WebRTC TCP) + UDP 50000-60000 (미디어 스트림) — 공개 직결 (onprem-docker §3.2)
- TCP 443 (TURN-over-TLS) — 공개 직결 실패 시 폴백
- TCP 3478, UDP 3478/5349 (coturn) — TURN 수신 포트

**모니터링**
- LiveKit 웹 콘솔 (`http://localhost:7880`)
- 활성 회의, 참여자, 네트워크 품질
- Prometheus 메트릭: 미디어 손실률, 지연, 대역폭 사용량

---

## 4. 비기능 요구사항(NFR)

**주의**: 본 섹션의 모든 성능 목표는 **이 버전 단일조직 스코프(설계 100명 / 도그푸딩 검증 20명, D22)**를 기준입니다. 1000명 이상 대규모 확장, 월드 샤딩, 멀티테넌트 성능 최적화는 완성 이후 Won't 항목입니다.

### 4.1 성능(Performance)

**웹 로딩 & 렌더** (D27, NFR 유지분)
- **초기 로딩 < 5초**: 배경 이미지(office_bg.png)·깊이맵·경량 GLTF·camera.json 로드 완료까지. 배경이 오프라인 렌더 정적 이미지이므로 씬 지오메트리 스트리밍 부담이 없다
- 런타임 GPU 부담은 **아바타(경량 GLTF) + 깊이합성 셰이더**뿐. 실시간 씬 렌더 예산(Forward+/SDFGI/LOD/오클루전 컬링/배칭)은 이 아키텍처에 해당하지 않음 — 배경은 런타임에 렌더하지 않기 때문
- 아바타 최적화: KTX2/Basis 텍스처 + Draco/meshopt 압축으로 다운로드·디코드 비용 최소화. 동일 소품은 three.js instancing으로 드로우콜 절감
- 깊이합성: 아바타 프래그먼트 깊이 vs 배경 깊이맵 비교(단일 셰이더 패스) — 픽셀 정확 오클루전, 스파이크 검증 PASS(16-render-spike / spikes/depth-composite)

**네트워크 성능** (D22 유지)
- Colyseus 서버 tick **20Hz**, 아바타 동기화 E2E(입력→원격 표시) **p95 < 500ms**
- 상태 동기화는 **Colyseus Schema binary delta**로 전송한다(변경분만 바이너리 인코딩). 자체 JSON 브로드캐스트 대비 페이로드가 작아 O(N²) 팬아웃 대역폭이 크게 줄어든다
  - 참고 산정(구 JSON, 상한): ≈150B/player 기준 100명 전체 브로드캐스트 시 송신 O(N²) ≈ 30MB/s. binary delta는 변경분만 보내므로 실측 상한은 이보다 크게 낮다
- **100명 초과 시**: 층(floor) 단위 룸 분산 + AOI(Area of Interest) 필터링(화면 밖 플레이어 송신 생략) 검토
- WebSocket 연결: 사용자당 1개 유지 (Colyseus 룸 join)

**데이터베이스 성능**
- 쿼리 응답: 평균 50ms, 최대 500ms
  - 인덱스: (user_id, updated_at), (floor_id, user_id) 등
  - 정기적 아카이빙: 90일 이상 데이터 → presence_archive 테이블
- 배치 쓰기: 배치 크기 100, 1000row/s 처리량

**API 처리량**
- FastAPI: 초당 1000 req/s (Uvicorn 4 worker, 8 core)
- 캐시: Redis (TTL 1시간)
  - 직원 명단, 조직도, 좌석 배치

**실시간 서버 확장성** (D22/D27)
- 단일 Colyseus 프로세스: **설계 100명 / 도그푸딩 검증 20명**(이 버전 스코프). "500명" 표기는 폐기
  - 확장 단위 = **Colyseus 룸(층/floor 단위)**. 층별 룸으로 부하를 분산
  - **1000명 이상 동시 접속**: 완성 이후(Won't) — 다중 노드 + Colyseus presence(Redis) + 로드밸런싱 구성 필요
  - 로드밸런서: Nginx/HAProxy → 여러 Colyseus 노드(매치메이킹 경유)

---

### 4.2 보안(Security)

**인증 & 인가** (D4)
- JWT (**HS256 + 자체 시크릿**, FastAPI 발급, **ERP와 시크릿 미공유**)
  - 유효기간: 8시간 (업무 시간)
  - Refresh token: 7일 (자동 갱신). WSS 장기 세션은 **인밴드 refresh**로 만료 갱신(§2.2.1)
  - 클레임: user_id, company_id, email, roles(employee|leader|admin|super_admin)
  - WSS 핸드셰이크에 **`protocol_version` 협상** 포함(미지원 버전 거부 + 업데이트 안내, §2.2.1)
  - "ERP 공개키 검증" 표기는 폐기(HS256은 대칭키이므로 공개키 검증이 성립하지 않음)
- 서비스 계정 (API to API)
  - Colyseus 서버 ↔ FastAPI: JWT (service_voffice_server, **자체 시크릿**)
  - FastAPI ↔ ERP API: JWT (service_voffice_erp, 24h)
  - 유효성: **자체 시크릿으로 서명 검증**, 클레임 타임스탬프
- 권한 모델:
  - employee: 자신의 업무기록, 참여한 회의만 조회
  - leader: 팀 직원 업무/KPI 조회, 회의록 승인
  - admin: 전체 오피스 관리, 좌석 배정
  - super_admin: 조직 관리, 감사 로그 조회 (ERP와 동일)

**데이터 보호**
- 네트워크: TLS 1.3 (모든 API, DB 연결, **게임 트래픽 WSS 포함** — D1)
  - 인증서: **Let's Encrypt 자동 발급(Caddy)** — WSS/HTTPS/TURN-TLS 단일 인증서로 통일(2026-07-02). 상세: docs/deployment/onprem-docker.md §3.1
- 저장소: 암호화 (옵션)
  - PII(Personal Identifiable Information): 직원명, 이메일은 평문(필수 업무용)
  - **GPS 수집 기능 삭제** (D13/D20(c)): 웹앱(데스크톱 브라우저)에 GPS 없음, ERP lat/lng/radius 미러링 금지
  - presence 좌표(x,y): KPI 산출 미사용, 보존 30일 후 삭제 (D20(a))
  - 회의록: 접근 제어 (참여자 + 리더 역할만)
- DB 접근:
  - ERP DB: read-only 계정 (SQL_DATA_READ 권한)
  - 우리 DB: 최소 권한 (application 계정은 INSERT/UPDATE/SELECT만, DDL 불가)

**API 보안**
- Colyseus 서버↔FastAPI: **서비스 계정 토큰(service account JWT) + IP allowlist**로 제한(Colyseus 서버는 브라우저가 아니므로 CORS 무의미 — "게임서버 IP CORS" 표기 폐기). Colyseus WSS 접속 자체는 `onAuth`에서 단일세션 JWT 검증
- CORS: 브라우저 원본 제한 (localhost 개발용, 공인 도메인 — 구매 후 확정, 임시 사내 IP)
- Rate limiting: 로그인은 IP당 10 req/min + 실패 누적 잠금, 일반은 1000 req/min
- Input validation: JSON Schema (FastAPI pydantic)
- CSRF: 토큰 기반 (POST/PATCH/DELETE)
- SQL Injection 방지: Parameterized queries (SQLAlchemy)

**외부 공개 엔드포인트 보강** — 외부 공개 확정(2026-07-02)에 따른 보강
- 로그인 실패 5회 시 지수 백오프/일시 잠금
- IP 기반 rate-limit (Caddy/미들웨어)
- fail2ban (반복 침입 시도 IP 차단)
- (선택) 관리자 계정 2FA

**반감시 방지**
- 위치 추적: **GPS 수집 기능 삭제** (D13/D20(c)). 사무실 내 3D 좌표(x,y)는 논리적 위치이며 KPI 산출 미사용, 보존 30일 후 삭제
- 채팅/근접 기록: 저장하지 않음 (협업 신호로만 집계)
- 화상회의: **STT 자동 회의록 정식 포함** (D5). 단, 회의 시작 시 **전원 고지 배너 + 참여 의사 확인**(거부 시 오디오 미수집), 녹음 원본 보존 90일, 회의록 텍스트만 평가 데이터로 관리 (D20(b)). LiveKit Egress(트랙별 오디오) → STT(화자분리) → 회의록 초안 경로
- 감사: 누가 누구의 업무기록을 조회했는지 기록 (audit_log, 5년 보존 — D20(e))

**ERP 저장소 접근 및 개발 규칙 (결정: OQ1)**
- **저장소 접근**: 사용자(admin@spacecl.com)가 ERP(space-daily) git 저장소 접근권한 보유
  - feature/virtual-office-integration 브랜치를 **우리가 직접 생성 및 관리** (ERP 담당자 승인 불필요)
  - 작업물: kpi_results 테이블 + Alembic 마이그레이션 + KPI 수신 엔드포인트 + service account
  - 병합: 별도 협의(우리 자체 소유 가능, 외부 담당자 병합 대기 불필요)
- **main 브랜치 보호**: 직접 수정 금지 — 항상 feature 브랜치에서 작업 후 관리
- **커밋된 시크릿 신뢰 금지** (운영 시크릿은 별도 관리)
  - 운영 시크릿: **.env 파일 권한 600 + 반기 로테이션**(D21). 외부 클라우드 시크릿 매니저는 사내 VM 단일화 원칙상 미사용

---

### 4.3 가용성(Availability)

**목표 가용성**
- FastAPI + DB: 99.5% (월간 3.6시간 다운타임 허용)
- Colyseus 실시간 서버: 95% (겹침 허용, 사용자는 재접속)
- 웹 콘솔: 99% (유지보수 제외)

**장애 격리(Fault Isolation)**
- Colyseus 서버 다운 → 아바타/프레즌스 비가용, **그러나**
  - 업무기록(work_log): FastAPI에 직접 저장 → 정상
  - 회의록(meeting_minute): LiveKit 독립 → 정상
  - KPI(kpi_result): 웹 콘솔에서 관리 → 정상
  - 결론: 핵심 업무 흐름 유지
- FastAPI 다운 → Colyseus 재접속(onAuth 검증) 불가, **그러나**
  - 캐시(Redis)의 프레즌스: 단기 유효 (TTL 5분)
  - 수동 업무기록: 오프라인 모드 (나중 동기화) 또는 웹 콘솔
- 웹 콘솔 다운 → KPI/회의록 관리 지연, **그러나**
  - 업무기록은 게임클라에서 가능
  - 기한 없음: 재배포 후 회복

**데이터 보존**
- 정기 백업 (D21, 범위 확장):
  - **PostgreSQL**: 일 1회(23:00), 증분 4시간마다
  - **LiveKit/coturn 설정**(config.yaml, TURN 자격), **`.env`**, **office_layout·렌더 에셋**(office_bg.png / office_depth.png / camera.json, 아바타 GLTF, layout JSON) 포함
  - 보관: 30일 + 월간 장기 보관(1년)
  - 복구 시간: RTO 4시간, RPO 4시간
- Colyseus 인메모리 상태(프레즌스·아바타 위치)는 백업 대상이 아니며, 크래시 시 재접속 스냅샷 재구축으로 복원(§2.2)
- 이중화(선택사항): PostgreSQL 리플리카 또는 클러스터

**헬스체크 & 자동 복구**
- Systemd 또는 Kubernetes 재시작 정책
  - 실패 시 5초 후 자동 재시작, 최대 3회
- 모니터링: Prometheus 알림
  - API 응답 시간 > 1s
  - Colyseus 연결 손실률 > 5%
  - DB 동기화 지연 > 1시간

---

### 4.4 관측성(Observability)

**로깅**
- 수준: INFO, WARN, ERROR (DEBUG는 개발 환경)
- 형식: JSON (구조화 로그)
  - 필드: timestamp, level, component, user_id, request_id, message, stacktrace
- 저장소: **Loki**(경량 로그 집계, D21). ELK는 폐기(1인 운영 규모 초과)
  - 보관: 90일 온라인, 1년 콜드 스토리지
- 중요 이벤트:
  - 사용자 로그인/로그아웃
  - 좌석 배정 변경
  - KPI 초안/승인
  - 회의 시작/종료
  - ERP 동기화 성공/실패
  - API 에러 (4xx, 5xx)

**메트릭**
- Prometheus 수집 (15초 주기)
  - 애플리케이션 메트릭:
    - api_request_duration_seconds (histogram)
    - api_request_total (counter, 상태별)
    - db_query_duration_seconds (histogram)
    - active_users_count (gauge)
    - erp_sync_duration_seconds (histogram)
  - 시스템 메트릭:
    - node_cpu_seconds_total
    - node_memory_bytes_available
    - node_disk_io_now
- Grafana 대시보드:
  - Overview (API 처리량, 에러율, 응답시간)
  - Colyseus 실시간 서버 (활성 룸/아바타, tick 지연, 네트워크 손실)
  - DB (쿼리 시간, 락 대기, 커넥션 풀)
  - ERP 동기화 (성공률, 지연)

**추적(Tracing)**
- 분산 추적(Jaeger 등)은 **1인 운영 규모에서 도입하지 않음** (D21). 필요 시 Grafana Tempo로 후속 검토
- 상관관계는 구조화 로그의 `request_id`(Loki)로 대체

**알림 (D21, 단일 채널·1인 운영)**
- **알림 채널 1개**로 통합(에러율 > 10%, API 응답시간 > 5s 등 심각 장애 + 일반 정보성 모두 동일 채널)
- Uptime Kuma가 헬스 이상을 동일 채널로 통지
- **온콜 에스컬레이션 계층 없음**(1인 운영). 담당자=운영자 단일

---

## 5. 데이터 흐름 요약

### 5.1 초기화 및 동기화 흐름

```mermaid
sequenceDiagram
    participant User as 사용자 브라우저
    participant R3FClient as R3F 웹앱<br/>클라이언트
    participant FastAPI as FastAPI 백엔드
    participant ColyseusServer as Colyseus<br/>실시간 서버
    participant ERPDB as ERP PostgreSQL
    participant OurDB as 우리<br/>PostgreSQL

    User->>R3FClient: 웹앱 접속(URL)
    R3FClient->>FastAPI: GET /api/presence/init<br/>(user_id, office_id)
    FastAPI->>OurDB: SELECT * FROM office_layout<br/>WHERE office_id=?
    OurDB-->>FastAPI: office_layout JSON
    FastAPI->>OurDB: SELECT * FROM seat<br/>WHERE office_id=?
    OurDB-->>FastAPI: 좌석 목록
    FastAPI->>ERPDB: SELECT * FROM users<br/>WHERE company_id=?<br/>(read-only)
    ERPDB-->>FastAPI: 직원 명단
    FastAPI-->>R3FClient: 초기 데이터 + camera.json/배경 에셋
    R3FClient->>ColyseusServer: 룸 join<br/>(protocolVersion, 단일세션 JWT)
    ColyseusServer->>ColyseusServer: onAuth: JWT 검증
    ColyseusServer->>FastAPI: GET /api/office/{id}/layout
    FastAPI-->>ColyseusServer: 좌표/콜리전 데이터
    ColyseusServer-->>R3FClient: snapshot(Schema 초기 상태)
    R3FClient->>User: 3D 화면 표시(깊이합성)
```

### 5.2 업무기록 및 KPI 푸시 흐름 (EOD)

```mermaid
sequenceDiagram
    participant User as 사용자
    participant R3FClient as R3F 웹앱<br/>클라이언트
    participant NextJS as Next.js 콘솔<br/>(동일 웹앱)
    participant FastAPI as FastAPI 백엔드
    participant AIWorker as AI 워커
    participant OurDB as 우리 DB
    participant ERPWrite as ERP API<br/>(신규)

    User->>R3FClient: 업무기록 입력<br/>(오늘 작업, 내일 계획)
    R3FClient->>FastAPI: POST /api/work-logs
    FastAPI->>OurDB: INSERT INTO work_log
    OurDB-->>FastAPI: OK

    Note over FastAPI,OurDB: 일과 종료, EOD 배치(18:00)

    FastAPI->>FastAPI: APScheduler: daily_eod_batch()
    FastAPI->>OurDB: SELECT * FROM work_log<br/>WHERE work_date=TODAY()
    OurDB-->>FastAPI: 오늘 기록 전체
    FastAPI->>AIWorker: POST /api/ai/kpi-draft<br/>(user_id, work_logs, meetings)
    AIWorker-->>FastAPI: KPI 초안 텍스트
    FastAPI->>OurDB: INSERT INTO kpi_result<br/>(ai_draft)
    OurDB-->>FastAPI: kpi_result.id

    FastAPI->>ERPWrite: POST /api/kpi-results<br/>(company_id, user_id, metric, value, source='virtual_office')<br/>Authorization: Bearer Token(service_account)<br/>(계약 명세: 03-erp-integration.md)
    ERPWrite-->>FastAPI: 201 Created
    FastAPI->>OurDB: INSERT INTO daily_status_push<br/>(status='success')
    OurDB-->>FastAPI: OK

    NextJS->>FastAPI: GET /api/kpi-results?date=TODAY()
    FastAPI->>OurDB: SELECT * FROM kpi_result
    OurDB-->>FastAPI: KPI 결과
    FastAPI-->>NextJS: JSON

    User->>NextJS: KPI 대시보드 접속
    NextJS->>User: AI 초안 + 관리자 검토 UI
    User->>NextJS: 승인/조정/이의신청
    NextJS->>FastAPI: PATCH /api/kpi-results/{id}<br/>(admin_reviewed=true, admin_adjusted)
    FastAPI->>OurDB: UPDATE kpi_result
    OurDB-->>FastAPI: OK
```

### 5.3 회의 흐름

```mermaid
sequenceDiagram
    participant User1 as 사용자 A<br/>(호스트)
    participant User2 as 사용자 B<br/>(참여자)
    participant R3FClient as R3F 웹앱<br/>클라이언트
    participant FastAPI as FastAPI
    participant ColyseusServer as Colyseus 서버
    participant LiveKit as LiveKit
    participant OurDB as 우리 DB

    User1->>R3FClient: 회의실 바운드 진입<br/>(아바타 이동)
    R3FClient->>ColyseusServer: enter_meeting {room_id} (15-spec 메시지)
    ColyseusServer->>FastAPI: POST /api/rooms/{id}/check-capacity
    FastAPI->>OurDB: SELECT COUNT(*) FROM meeting_participant<br/>WHERE room_id=?
    OurDB-->>FastAPI: 참여자 수 + 초대 여부
    FastAPI-->>ColyseusServer: OK(입장 가능)/Reject
    ColyseusServer-->>R3FClient: 입장 가능 통지 (자동 연결 금지)

    Note over R3FClient,User1: 명시적 입장 확인 (D24)
    R3FClient->>User1: "입장하시겠습니까?" 다이얼로그<br/>(호스트/참여자 표시)
    User1->>R3FClient: [입장하기] 클릭

    R3FClient->>FastAPI: POST /api/meetings/join<br/>(room_id, user_id)
    FastAPI->>OurDB: INSERT INTO meeting (없으면 생성)
    OurDB-->>FastAPI: meeting.id
    FastAPI->>LiveKit: POST /twirp/livekit.RoomService/CreateRoom<br/>(name, empty_timeout=300) — FastAPI 경유 단일화
    LiveKit-->>FastAPI: room 생성 확인
    FastAPI->>FastAPI: 참가 토큰(JWT, API key/secret 서명) 발급
    FastAPI-->>R3FClient: meeting.id, room_token
    R3FClient->>LiveKit: WebRTC 연결<br/>(token)
    LiveKit-->>R3FClient: 미디어 스트림

    User2->>R3FClient: (동일 프로세스)
    R3FClient->>LiveKit: 참여

    Note over User1,LiveKit: 회의 중...

    User1->>R3FClient: 회의종료 + 기록 저장
    R3FClient->>FastAPI: POST /api/meetings/{id}/close<br/>(decisions, notes, action_items)
    FastAPI->>OurDB: INSERT INTO meeting_minute<br/>INSERT INTO action_item
    OurDB-->>FastAPI: OK
    FastAPI->>LiveKit: DELETE /twirp/livekit.RoomService/DeleteRoom
    LiveKit-->>FastAPI: OK
    FastAPI-->>R3FClient: OK
```

---

## 6. 기술 결정 및 근거

> 표 정정(D27): 구 표는 "Godot 4 네이티브 채택"으로 되어 있었으나 **정반대다**. D27은 **R3F(three.js) 웹 채택**이며 Godot 네이티브·헤드리스는 전면 폐기다.

| 결정 | 선택지 | 근거 |
|-----|-------|-----|
| 3D 클라 플랫폼 | **R3F(react-three-fiber/three.js) 웹(선택)** vs Godot 네이티브 vs WA/Phaser | 단일 웹앱 임베드(설치 없음)·즉시 배포·오프라인 렌더 배경 깊이합성 조합에 최적, MIT 계열 오픈소스 (D27) |
| 렌더 방식 | **오프라인 렌더(Blender Cycles) 배경 + 깊이합성(선택)** vs 실시간 3D 렌더 | 포토리얼 품질을 런타임 GPU 없이 확보, 런타임 부담은 아바타+깊이합성 셰이더뿐 (D27) |
| 실시간 서버 권위 | **Colyseus(Node/TS, SkyOffice 이식)(선택)** vs Godot 헤드리스 vs WA 내장 | 웹 표준 WSS + Schema binary delta, 룸 단위 확장, 자체 동기화 프로토콜 부활(D1/D27) |
| 백엔드 언어 | FastAPI/Python(선택) vs Node.js | ERP와 언어 통일(DB 직접읽기·마이그레이션 작성 용이), 실시간만 Node(Colyseus) 분리 |
| 백엔드 인증 | JWT HS256 + 자체 시크릿·단일세션(선택) vs OIDC 이중로그인 | FastAPI 발급·Colyseus onAuth 검증, ERP와 시크릿 미공유(D4), OIDC 이중로그인 제거(간소화) |
| 웹 프레임워크 | Next.js(선택) vs React SPA | 사내 도구(TDS 불필요), App Router(최신), 타입세이프, 3D 뷰포트·콘솔 단일앱 |
| 화상회의 | LiveKit self-host(선택) vs LiveKit Cloud·Zoom·Teams | 미디어 데이터 주권(인사평가 근거), 사내망 지연 이점, 단일 SFU(오토스케일 불필요), 오픈소스(Apache 2.0) |
| 에셋 포맷 | glTF/GLB + KTX2/Draco/meshopt(선택) vs FBX·USDZ | 웹 표준, three.js 기본 지원, 웹 최적화 도구 풍부 |
| ERP 읽기 | read-only DB(선택) vs 읽기 API | API 벌크 엔드포인트 없음(근태), 직접 접근이 빠름·안전 |
| ERP 쓰기 | 신규 API + 테이블(선택) vs 기존 API만 | KPI는 저장 필요(기존 API에 없음), ERP 기여도 높음 |

---

## 7. 위험 및 완화 전략

| 위험 | 영향 | 완화 |
|-----|------|-----|
| 깊이합성 정합 오차(카메라/좌표계) | 아바타 오클루전 어긋남, 시각 품질 저하 | Blender↔R3F(three.js Y-up)↔Colyseus 3자 좌표계 정합, camera.json 공유, 깊이합성 스파이크 회귀 검증(16-render-spike, spikes/depth-composite PASS) |
| 브라우저 WebGL2/디바이스 편차 | 저사양 기기 프레임 저하 | 아바타 수·그림자 품질 조정(배경은 정적), KTX2/Draco 압축, 최소 사양 가이드 |
| Colyseus 스케일(층 룸 분산) | 100명 초과 시 tick 지연 | 층 단위 룸 분산 + AOI 필터링, presence(Redis) 다중 노드는 완성 이후 |
| ERP DB 스키마 변경 | 우리 쿼리 깨짐 | 마이그레이션 테스트(테스트 DB), 버전 관리 |
| ERP API 속도 저하 | 배치 지연, KPI 푸시 밀림 | 캐시(Redis), 배치 큐(지수 백오프) |
| LiveKit 자체 호스팅 비용 | 인프라 부담 | 사용자 수 기반 리소스 계획, 모니터링 |
| 3D 에셋 라이선스 위반 | 법적 책임 | asset 테이블 자동 검증, CC0 우선 |
| GPS 오수집(데이터 프라이버시) | 직원 신뢰 하락, 규제 리스크 | 수집 제한(필요한 업무만), 자동 삭제(30일), 감사 로그 |

---

## Loop Metadata

### Upstream Documents Referenced
- (생성 예정) 01-prd.md: 제품 요구사항 정의
- (생성 예정) 03-erp-integration.md: ERP 연동 상세 설계
- (생성 예정) 04-data-model.md: 데이터 모델 정의
- (생성 예정) 05-office-layout-schema.md: office_layout JSON 스키마

### Downstream Documents Affected
- 03-erp-integration.md: ERP 브랜치 작업 (kpi_results 테이블, 수신 엔드포인트)
- 04-data-model.md: 엔티티 상세 정의 (presence, work_log, kpi_result 등)
- 12-tasks.md: 개발 태스크 분해 (컴포넌트별 Phase)
- 13-risks-open-questions.md: 운영·모니터링·장애대응 관련 리스크/완화

### Open Questions
1. **Colyseus 다중 노드 샤딩**: 1000명 이상 동시 접속 시 층 룸 분산 + presence(Redis) 다중 노드 전략? (완성 이후 검토)
2. **KPI 메트릭 정의**: "협업 신호"의 구체적 수식(회의 횟수, 시간, 참여도 등)은? (Phase 6 기획 단계)
3. **LiveKit 녹음/STT 정책**: [확정] STT 자동 회의록 정식 포함(D5). 회의 시작 시 전원 고지+동의(D20(b)), LiveKit Egress→STT 경로. 녹음 원본 90일 보존.
4. **AI 워커**: Claude 확정(기본), Gemini 대안 여부만 후속 검토 (ERP 연동 및 비용/품질 검토)
5. **모바일 지원**: 이번 버전 범위 밖, B2B 이후인지 확인?

### Assumptions
1. **사내 사용자 설계 100명 / 도그푸딩 검증 20명(Phase 1-7 스코프, D22)** — "500명" 표기 폐기. 1000명 이상 대규모 조직은 완성 이후(Won't).
2. ERP DB는 같은 사내망(지연 **< 50ms**, 09와 통일), read-only 계정 제공 가능.
3. **ERP API 신규 엔드포인트(kpi_results 테이블·Alembic·수신 엔드포인트·service account)는 우리가 직접 생성·관리**(OQ1 결정, §4.2 참조). ERP 담당자 승인·병합 대기 불필요.
4. 클라이언트는 브라우저 접속(단일 웹앱)이므로 설치·자동 업데이트가 없다 — URL 접속 즉시 최신 버전 (D27).
5. 단일 조직(single company_id)이므로 멀티테넌트 복잡도 제외 — 이후 확장은 B2B 단계에서 검토.
6. **LiveKit self-host 인프라 (결정: OQ5)**: Linux 서버 PC에서 Docker Compose로 배포, 사내 IT 담당. VPN 없음 확정(2026-07-02) → 재택/외근자는 공개 엔드포인트로 확정(직결 + TURN-TLS 443 폴백), 협의 종결.

### Validation Criteria
- **Phase 0/1 끝**: 깊이합성 스파이크 PASS(아바타가 가구/유리벽 뒤 픽셀정확 가림, camera.json 정합) + 3D 골든 샘플(로비~5명 아바타) + 최소 API 호출 가능, 브라우저 로딩<5초 문서화.
- **Phase 2 끝**: ERP 직원/조직 동기화, 우리 seat/presence 동작, 아바타 시작위치 연결 확인.
- **Phase 4 끝**: 실시간 서버 권위 검증(충돌감지, 회의실 점유), 아바타 동기화 E2E p95 < 500ms(D22)로 통일.
- **Phase 5 끝**: LiveKit 화상회의 + 회의록 저장, 참여자 동기화 확인.
- **Phase 6 끝**: KPI push to ERP 성공, AI 초안 생성 확인, EOD 배치 로그 무결성.
- **일반**: 보안 감시(위반 사례 0), 가용성 모니터링(월간 99.5% 달성 추적).

### Risks & Mitigations
| 위험 | 심각도 | 완화 |
|-----|--------|-----|
| ERP DB 직접 읽기 권한 거부 | 높음 | 읽기 전용 계정 협상, 또는 ERP API 보충(벌크 엔드포인트 신설) |
| 깊이합성/브라우저 성능 미달 | 높음 | Phase 0 깊이합성 스파이크로 조기 검증(PASS), 아바타 경량화 + 압축 선반영 |
| LiveKit 호스팅 복잡도 | 중간 | 사전 POC(Proof of Concept), Docker Compose 템플릿 제공 |
| GPS 데이터 프라이버시 침해 | 높음 | 수집 제한, 암호화, 30일 자동삭제, 감사로그 필수 |
| KPI AI 초안 품질 부족 | 중간 | 관리자 수동 조정 프로세스, 여러 모델 테스트(Claude vs Gemini) |

---

## 변경 이력

| 버전 | 일자 | 변경 내용 |
|------|------|-----------|
| v1.0 | 2026-07-01 | 최초 작성 |
| v1.1 | 2026-07-02 | 00-decisions.md v1.0 정합 반영 — D1/D3/D4/D5/D7/D13/D17/D21/D24, 표기 정정(psycopg 3.x, LiveKit API key/secret 서명 JWT, IP allowlist), OQ1 내부 모순 정리 |
| v1.2 | 2026-07-02 | 배포·네트워크 확정 반영 — VPN 없음 확정, Docker Compose + Caddy + Let's Encrypt, 외부 공개 보안 보강(§4.2), 3D 미리보기 draft 모드(D11), 레이턴시 E2E p95<500ms(D22) 통일 |
| **v2.0** | **2026-07-09** | **D27 포토리얼 웹임베드 전환 반영(D26 WorkAdventure·Godot 네이티브 전면 폐기)** — ① 클라: Godot 데스크톱→**Next.js 단일 웹앱 내 R3F(three.js) 뷰포트**, 설치·자동 업데이트 제거 ② 렌더: Forward+/LOD/SDFGI/오클루전 컬링 등 실시간 렌더 서술 폐기→**Blender Cycles 오프라인 렌더 배경 + Z깊이패스 + camera.json 깊이합성**(고정 아이소 2.5D) ③ 실시간 서버: Godot 헤드리스→**Colyseus(Node/TS) 권위 서버**(SkyOffice 이식, 20Hz, Schema binary delta), 메시지 어휘 15-realtime-server-spec 정본(move_request/status_change/sit_request/enter_meeting/interact_request ↔ world_update/snapshot/layout_updated/presence_event) ④ 인증: 단일세션 JWT→Colyseus onAuth 검증, OIDC 이중로그인 제거 ⑤ presence: Colyseus 메모리 권위→1~5초 FastAPI /api/presence/batch→DB(D3 유지) ⑥ 에셋: Blender→GLTF+KTX2/Basis·Draco/meshopt, Godot .tscn/PCK/NSIS/DMG 데스크톱 배포→웹앱 배포 ⑦ NFR: 3D 60fps@GTX1650 수치 제거, 브라우저 로딩<5초 + Colyseus tick 20Hz·아바타 E2E p95<500ms 유지, 확장성=Colyseus 룸(층 단위) ⑧ 기술결정표 정정(구 "Godot 채택"은 정반대→**R3F 채택**) ⑨ 시퀀스다이어그램 노드명 GodotClient/GodotServer→R3FClient/ColyseusServer(흐름 보존) ⑩ 좌표계 정합 Blender↔R3F(three.js Y-up)↔Colyseus, camera.json 공유. **보존**: 데이터 계층·ERP 연동(§2.3/2.6)·보안(§4.2)·KPI·회의 도메인 로직 |

---

**문서 최종 검토**: 2026-07-09  
**다음 검토 일정**: Phase 0/1 골든 샘플 + 깊이합성 통합 검증 후 재검토  
**정본 참조**: 00-decisions §H(D27) · 14-virtual-office-spec · 15-realtime-server-spec · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}
