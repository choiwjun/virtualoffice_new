# 11. 기술 스택 결정

## 문서 개요
- **대상**: 개발팀(L3+), 아키텍처 리뷰어
- **목적**: 가상오피스 플랫폼 기술 스택 확정 및 근거 문서화
- **유효 범위**: 단일 조직(단일 company_id) 도그푸딩 버전
- **버전**: v2.0
- **마지막 갱신**: 2026-07-06 (D26 WorkAdventure 전환 — 2.1/2.2절 교체)

> 본 문서의 모든 결정은 **00-decisions.md(정본)** 를 따른다. 충돌 시 정본이 이긴다. 변경 이력은 하단 참조.
>
> ⚠️ **D26 (2026-07-06)**: 2.1절(3D 클라이언트)·2.2절(실시간 서버)을 WorkAdventure self-host 스택으로 교체. Godot/GDScript 노선 보류.

---

## 1. 기술 스택 선택 기준

### 1.1 의사결정 원칙

| 원칙 | 설명 |
|-----|------|
| **품질 최우선** | 완성된 MVP가 아닌 스펙 전체를 제대로 구현 |
| **도그푸딩 최적화** | 사내(단일조직) 설치/운영 기준. B2B·멀티테넌트는 이후 |
| **기존 ERP 통합** | Space-Daily(FastAPI + SQLAlchemy + PostgreSQL)와 무결한 양방향 연동 |
| **3D 품질 기준** | Godot 4 Forward+ 렌더러 → 최고품질 네이티브 데스크톱 |
| **1인 개발 + AI 협업** | 최소한의 팀 규모. 자동화·코드생성·문서화 수용적 |

### 1.2 선택 카테고리 구분

**Mechanical (기술적 필연)**
- ERP 통합을 위해 FastAPI 선택 (언어·ORM·비동기 통일)
- PostgreSQL (ERP와 동일 DB)
- Godot 4 (3D 품질 요건의 유일한 선택지)
- LiveKit (WebRTC 자체호스팅, Apache-2.0 라이선스)

**Taste (조직 선호)**
- Next.js + TailwindCSS (사내 웹 도구, TDS 불필요)
- Claude / Gemini (AI KPI 초안. Claude = Anthropic 직원 선호, Gemini = ERP와 통일)

---

## 2. 기술 스택 상세

### 2.1 가상오피스 클라이언트 — WorkAdventure ⭐D26

> ⚠️ **D26**: 기존 "3D 클라이언트 (Godot 4 Forward+)" 절 대체. Godot 노선 보류.

```
Layer        | Component                      | Version  | License              | Why
-------------|--------------------------------|----------|----------------------|--------------------------------------------------
클라이언트   | WorkAdventure (play)           | latest   | AGPL-3.0+CC          | 2D 웹 기반 가상오피스, 브라우저 직접 접근, 자체호스팅
프레임워크   | Phaser 3                       | 3.x      | MIT                  | WA 내부 2D 렌더러 (수정 금지 — 라이선스 경계)
확장 API    | WA scripting API               | -        | -                    | 커스텀 UI, 상태 변수, zone 이벤트 (iframe/JS)
UI 확장     | React + iframe 패널            | 18+      | MIT                  | 직원 패널, presence 상태 배지 (WA 외부 iframe)
맵 포맷     | TMJ (Tiled JSON)               | -        | -                    | map-storage 서버 업로드, 조직→맵 자동 생성
인증        | OIDC (FastAPI 브리지)          | -        | -                    | ERP 사용자 → WA 로그인 (D4 자체 JWT 공존)
```

**라이선스 경계** (D26):
- WorkAdventure 소스 직접 수정 금지
- 확장은 scripting API / iframe / OIDC / Room API 만 사용
- 사내 도그푸딩: AGPL-3.0 적법. B2B 판매 시 Enterprise 라이선스 또는 재구현 필요

**근거**:
- Gather.town: 클라우드 종속, ERP 통합 불가
- 자체 Godot 3D: 12주+ 개발 비용, 라이브 협업 인프라 구축 부담
- **결정**: WorkAdventure self-host **확정**(D26)

---

### 2.2 실시간 서버 — WorkAdventure Back + FastAPI ⭐D26

> ⚠️ **D26**: 기존 "실시간 서버 (Godot 4 헤드리스)" 절 대체. Godot 헤드리스 노선 보류.

```
Layer        | Component                      | Role                | Language   | Why
-------------|--------------------------------|---------------------|------------|----------------------------------
WA 게임서버  | WorkAdventure (back)           | 아바타·zone 권위    | Node.js    | WA 내장 실시간 서버, WebSocket(WSS) 내장
상태 캐시    | Redis                          | WA back 세션 캐시   | -          | 아바타 위치·room 상태 임시 저장
Presence 권위| FastAPI (우리)                 | D13 7종 상태 권위   | Python     | WA scripting API push, 배치 DB 저장 (D3)
맵 서버      | WorkAdventure (map-storage)    | TMJ 맵 파일 서빙    | Node.js    | 맵 업로드·버전 관리 API
Room API     | WorkAdventure Room API         | 회의 제어           | REST/WS    | 명시적 입장(D24), LiveKit 토큰 발급
TURN         | coturn                         | WebRTC 릴레이       | C          | TURN-TLS 443 폴백, VPN 없음(D21-r)
```

**Presence vs Attendance 분리** (D13, D3 정신 유지):
- WA back = 아바타 이동·zone 점유 권위 (WA 내장)
- FastAPI = D13 presence 7종 권위 (`offline/online/working/meeting/focus/away/external`)
  - WA zone 진입/퇴장 이벤트 → scripting API 훅 → FastAPI push → DB 저장 (1~5초 주기)
  - focus/external: scripting API 변수로 WA에 노출, FastAPI DB 단일 저장
  - away: WA idle 타이머(5분) 이벤트 → FastAPI 전이 (D13)
  - GPS 기반 trip_*/returning 폐기 (D13/D20-c)
- ERP 출퇴근 = ERP read-only (가상오피스 장애가 근태에 영향 없음, 격리 원칙)

**결정**: WorkAdventure back + FastAPI presence 권위 이중 구조 **확정**(D26). WebSocket(WSS) 내장(D1).

---

### 2.3 백엔드 API (업무/KPI/연동)

```
Framework    | FastAPI
Version      | 0.115+
Language     | Python 3.11+
Async        | asyncio + uvicorn
ORM          | SQLAlchemy async (SQLModel)
DB           | PostgreSQL 17.5+
Auth         | PyJWT (HS256, 자체 시크릿) — D4
Task Queue   | APScheduler + DB 영속 재시도 큐 (D21)
Monitoring   | Prometheus + Grafana + Loki + Uptime Kuma (D21)
```

**근거**:
- **ERP 통일**: Space-Daily는 FastAPI + SQLAlchemy async + PostgreSQL → 동일 스택으로 직접 읽기·쓰기·브랜치 작업 효율↑
- Python 강점: 데이터 파이프라인, AI(Claude/Gemini SDK), 비동기 DB 읽기
- 대안(Rust/Go): 성능 이득 < ERP 통일 비용
- **결정**: FastAPI + SQLAlchemy async **확정**

---

### 2.4 데이터베이스

| 역할 | DB | 버전 | 근거 |
|-----|----|----|------|
| **Primary (우리)** | PostgreSQL | 17.5+ | JSON/JSONB(office_layout), 비동기, ERP와 동일 |
| **Cache (선택)** | Redis | 7.0+ | 캐시용. **배치 재시도 큐는 Redis가 아닌 PostgreSQL 영속 테이블 사용**(D21) |
| **Search** | PostgreSQL fulltext | 17.5+ | **PG fulltext 확정**(D21). Elasticsearch/ELK 배제(1인 운영 규모 초과, B2B 확대 시 재검토) |

**근거**:
- MySQL: JSON 문법 차이, 비동기 드라이버 성숙도↓
- 단일 조직 도그푸딩이므로 샤딩/다중 인스턴스 불필요
- **결정**: PostgreSQL 17.5+ **확정**

---

### 2.5 웹 관리/업무 콘솔

```
Framework    | Next.js (App Router)
Language     | TypeScript
CSS          | TailwindCSS
Version      | Node.js 20+
Hosting      | 사내 VM (도그푸딩)
```

**기능 범위**:
- 대시보드(KPI, 통계)
- 사무실 배치 편집기(Konva.js 2D 전용, 정밀 확인은 데스크톱 draft 모드 — D11)
- 조직도 편집(React Flow)
- 회의록/액션아이템 관리
- 근태/휴가 조회(ERP read-only)
- KPI 검토 & 조정(관리자)

**근거**:
- 사내 도구 → TDS(Toss Design System) 불필요
- React Flow: 조직도 드래그·레이아웃 자동화 → 수동 SVG 편집보다 생산성↑
- Konva.js: 좌석 배치 2D 편집, 다중 선택·변형 지원
- **결정**: Next.js + TailwindCSS **확정**

---

### 2.6 화상회의 (LiveKit)

```
Component     | LiveKit
Deployment    | Self-hosted (사내 VM)
License       | Apache-2.0
Protocol      | WebRTC (STUN/TURN)
Capacity      | 최대 100명(1회의실) 이상 확장 가능
```

**기능**:
- 회의실 스트리밍(카메라·마이크)
- 스크린 공유
- 녹화(선택)
- 회의 메타데이터(참석자, 시간, 상태)

**근거**:
- Jitsi: 경량이나 LiveKit 대비 메타데이터 API↓
- Zoom/Teams: 클라우드 종속, 용역 복잡성
- **자체호스팅(On-Premise)**: 미디어 데이터 주권(회의가 인사평가 근거), ERP·백엔드과 동일 사내망 지연 이점, 단일 SFU 노드로 충분(오토스케일 불필요→1인 운영 부담 경감)
- **LiveKit Cloud 배제**: 민감 미디어 외부 경유, SaaS 구독비, B2B 이후 우선순위
- **신규 AWS 배제**: 데이터 주권, 사내 우선 고려
- **접속 경로**: 재택·하이브리드·외근자는 공개 엔드포인트 직결 + TURN-TLS 443 폴백(VPN 없음, 2026-07-02)
- **결정**: 사내 self-host(LiveKit+coturn Docker), 단일 SFU 확정. LiveKit Cloud·신규 AWS 배제.

---

### 2.6.1 STT 회의록 스택 (D5, 정식 포함)

```
Component     | 역할                        | 후보 / 비고
--------------|-----------------------------|------------------------------------------
LiveKit Egress| 회의 트랙별 오디오 추출     | 화자별 분리 저장(원본 90일 보존, D20(b))
STT 엔진      | 한국어 화자분리 음성→텍스트 | 후보: (a) OpenAI Whisper + pyannote 화자분리(self-host), (b) 클라우드 STT(국외이전 고지 필요), (c) 상용 한국어 STT API
후처리(AI)    | 요약·결정사항·액션아이템    | Claude(기본)/Gemini(대안). 실명→사번 가명화 후 전송(D20(d))
```

- **흐름**: LiveKit Egress → STT(화자분리) → 회의록 초안 자동 생성 → 호스트/참석자 검토·확정(수동 입력은 폴백).
- **컴플라이언스**: 회의 시작 시 전원 고지+동의(D20(b)). 누락률 < 5% 목표(수동 전사 대조 측정, D22).
- **검증**: 스파이크 S2(STT 파이프라인 PoC, 한국어 화자분리 품질 측정)에서 후보 확정.
- **결정**: STT 정식 포함 확정. 엔진 후보는 S2에서 품질·비용·데이터 주권 기준으로 선정.

---

### 2.7 3D 에셋 (모델·텍스처·오디오)

| 에셋 유형 | 도구 | 형식 | 최적화 |
|----------|------|------|--------|
| **모델(가구/건축)** | Blender | glTF 2.0 / GLB | gltfpack, glTF-Transform |
| **텍스처** | Blender + CC0 라이브러리 | PNG/WebP | 압축(tinypng, webp) |
| **소스(외부)** | ambientCG, Poly Haven, Kenney, Quaternius | glTF / OBJ | 원본 저장, CC0 확인 |
| **레지스트리** | asset 테이블(우리 DB) | JSON 메타 | author, license, hash, modified_by |

**근거**:
- 자체 오피스 키트(로비, 회의실, 라운지, 집중실 모듈)로 맞춤 어셈블리 → 번들 크기 최소
- CC0 우선 → 상업 이용/재배포 자유, 귀속표시 간소화
- glTF-Transform: 메시 최적화, 드레이닝, 컬러공간 정규화 → 로딩시간↓
- **결정**: Blender + glTF + CC0 **확정**

---

### 2.8 인공지능 (KPI 초안)

| 용도 | 선택 | 근거 |
|-----|------|------|
| **KPI 평가 초안** | Claude(Anthropic) | 추론 품질, 1인 개발 친화적 |
| **대안** | Gemini | ERP Space-Daily와 통일(현재 사용 중) |

**역할**:
- 업무결과(work_log) + 회의록(meeting_minute) 수집 (외부활동 테이블은 D20-c 폐기로 제외, 2026-07-02)
- 프롬프트: 확정 정량점수 기반 강점/개선/근거 서술 생성(D14-e — AI는 서술만, 정량은 결정론적 코드)
- 출력: ai_draft(텍스트) → kpi_result 저장 → 관리자 검토 & 조정
- **최종이 아닌 초안**: 사유+개선액션 함께 제시, 관리자 개입 필수

**근거**:
- 로컬 LLM(Ollama): 초안 품질 저하, 추론 시간↑ → 야간 배치 3시간 윈도우 한계
- **결정**: Claude(기본) + Gemini(대안) **확정**

---

### 2.9 편집 & 레이아웃 도구 (웹 UI)

| 도구 | 용도 | 라이선스 | 선택 이유 |
|-----|------|---------|----------|
| **Konva.js** | 좌석 배치 2D 편집(드래그, 회전, 다중선택) | MIT | 캔버스 추상화, 이벤트 처리↑ |
| **React Flow** | 조직도 편집(계층, 라인, 색, 레이아웃 자동화) | MIT | 그래프 레이아웃 라이브러리 내장 |
| **Mermaid** | 다이어그램 프리뷰(플로우, ER, 간트) | MIT | 문서 포함 용이 |

**근거**:
- Canvas 직접 작성: 이벤트 처리·변형·대칭이동 번거로움
- **결정**: Konva.js + React Flow **확정**

---

## 3. Mechanical vs Taste 매트릭스

### 3.1 강제 사항 (기술적 필연)

```mermaid
graph TD
    A["필연"] --> B["FastAPI (ERP 통합)"]
    A --> C["PostgreSQL (ERP 일치)"]
    A --> D["Godot 4 (3D 품질)"]
    A --> E["LiveKit (WebRTC 자체호스팅)"]
    A --> F["Godot 헤드리스 (권위서버)"]
    
    B --> B1["asyncio, SQLAlchemy, uvicorn"]
    C --> C1["JSON/JSONB 컬럼(office_layout)"]
    D --> D1["Forward+ 렌더러, GDScript"]
    
    style A fill:#ffcccc
    style B fill:#ffdddd
    style C fill:#ffdddd
    style D fill:#ffdddd
    style E fill:#ffdddd
    style F fill:#ffdddd
```

### 3.2 선택 사항 (조직 취향)

```
조직 선호도 | 선택       | 대안              | 결정
-----------|-----------|------------------|--------
높음       | Next.js    | SvelteKit, Remix  | ✓ Next.js
높음       | TailwindCSS| Bootstrap, Pico   | ✓ Tailwind
중간       | Claude     | Gemini, GPT-4     | ✓ Claude(기본)
낮음(선택) | Redis      | Memcached, DragonflyDB | ✓ 선택사항
```

---

## 4. 개발 환경 & 툴체인

### 4.1 로컬 개발 환경

#### 4.1.1 필수 설치

```bash
# 3D 클라이언트
Godot 4.3+ 안정(stable) 버전 (네이티브 + 헤드리스, 별도 LTS 채널 없음)
Git LFS (대용량 에셋: .blend, .glb)

# 백엔드
Python 3.11+
pip, venv
PostgreSQL 17.5+ (로컬 또는 Docker)
Redis 7.0+ (선택)

# 웹 프론트엔드
Node.js 20+ (npm/pnpm)

# 3D 에셋 제작
Blender 4.0+ (GLB export)

# 공통
Docker / Docker Compose
Git (GitHub private)
```

#### 4.1.2 IDE & 확장

| 역할 | IDE | 확장/플러그인 |
|-----|-----|----|
| **GDScript** | Godot Editor | 내장 + LSP |
| **Python** | VS Code / PyCharm | Pylance, FastAPI, SQLAlchemy |
| **TypeScript** | VS Code | TypeScript LSP, ESLint, Prettier |
| **SQL** | pgAdmin / DBeaver | PostgreSQL 드라이버 |
| **3D** | Blender | glTF-Transform addon |

---

### 4.2 빌드 & 배포 파이프라인

#### 4.2.1 자동화 도구

```yaml
CI/CD:
  Platform: GitHub Actions (또는 GitLab CI)
  Trigger:
    - 각 단계(Phase) 브랜치 push
    - PR 병합 시 통합 테스트
  
  Job:
    - Python 린트/타입 체크 (ruff, mypy)
    - TypeScript 컴파일 (tsc)
    - 유닛테스트 (pytest, vitest)
    - 통합테스트 (API + DB)
    - Godot 빌드 (headless 서버, 클라이언트)
    - 에셋 최적화 체크 (gltfpack 결과)

Deployment:
  개발: 사내 VM (수동 또는 cron)
  테스트: GitHub Actions 아티팩트
  프로덕션(도그푸딩): 사내 배포 스크립트
```

#### 4.2.2 FastAPI 빌드

```bash
# requirements.txt 의존성
fastapi==0.115+
uvicorn[standard]==0.27+
sqlalchemy==2.0+
sqlmodel==0.0.14+
psycopg[binary]==3.2+
pydantic==2.0+
alembic==1.13+      # DB 마이그레이션
PyJWT==2.9+         # JWT (HS256, 자체 시크릿). python-jose는 유지보수 중단·CVE로 폐기 (D4)
apscheduler==3.10+  # 배치 스케줄 (Celery 미사용, DB 영속 재시도 큐 병행) — D21
anthropic==0.20+    # Claude SDK
google-generativeai==0.3+  # Gemini SDK (대안)
aiosqlite==0.19+    # async SQLite (테스트용)

# 빌드
pip install -r requirements.txt
alembic upgrade head  # DB 마이그레이션
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

#### 4.2.3 Next.js 빌드

```bash
npm install
npm run build
npm run start      # 프로덕션 서버
# 또는 PM2로 관리
pm2 start "npm run start" --name "voffice-web"
```

#### 4.2.4 Godot 빌드

```bash
# 클라이언트 (데스크톱) — Godot 4 export 형식
godot --headless --export-release "Windows Desktop" build/windows/voffice.exe

# 헤드리스 서버 (동일 프로젝트, 서버 export 프리셋)
# 존재하지 않는 --standalone-mode 플래그는 제거
godot --headless --export-release "Linux/X11" build/server/voffice-server

# 에셋 최적화
gltfpack -i model.gltf -o model-opt.glb
```

#### 4.2.5 데이터베이스 마이그레이션

```bash
# Alembic 초기화 (이미 완료)
# alembic init alembic

# 마이그레이션 생성
alembic revision --autogenerate -m "Add kpi_results table"

# 적용
alembic upgrade head

# 롤백
alembic downgrade -1
```

---

### 4.3 자동 업데이트 & 버전 관리

#### 4.3.1 클라이언트 자동 업데이트 (Godot)

```gdscript
# 실시간 체크 (백그라운드)
func check_for_update():
    var http = HTTPRequest.new()
    add_child(http)
    var response = await http.request_completed
    # 파일 다운로드 → 압축해제 → 재시작
    if newer_version:
        download_and_apply_patch()
```

**규칙**:
- 서버에서 최신 버전 메타(버전, 체크섬, 다운로드 URL) 배포
- 클라이언트 기동 시 버전 체크
- 바이너리 델타(diff)로 다운로드 용량↓(선택)

#### 4.3.2 서버 무중단 업데이트

```bash
# Blue-Green 배포
1. 신 서버(Green) 기동
2. 로드밸런서(Nginx) 라우팅 전환
3. 구 서버(Blue) 종료

# 또는 롤링 업데이트 (Kubernetes 없이)
1. API 게이트웨이: 신규 연결만 Green으로
2. 기존 연결 drain (timeout 60초)
3. Blue 배포 완료 → 상태 동기화
```

#### 4.3.3 의존성 업데이트

| 주기 | 항목 | 전략 |
|-----|------|------|
| **주 1회** | Python 보안 패치 | dependabot 또는 pip-audit |
| **월 1회** | FastAPI, SQLAlchemy, Godot minor | 호환성 테스트 후 적용 |
| **분기 1회** | Node.js, Next.js, Tailwind | 브랜치별 테스트 |
| **긴급** | 보안 취약점 | 즉시 패치 후 재배포 |

---

### 4.4 로깅 & 모니터링

#### 4.4.1 애플리케이션 로그

```python
# FastAPI
import logging
logger = logging.getLogger("voffice")
logger.info("User connected", extra={"user_id": uid})
logger.error("DB sync failed", exc_info=True)

# 구조화 로그 (JSON)
import structlog
structlog.configure(...)
logger = structlog.get_logger()
```

**수집**:
- 로컬 파일 → rsyslog → **Loki** 중앙화 (D21). ELK는 폐기(1인 운영 규모 초과)

#### 4.4.2 메트릭 (Prometheus 선택)

```
voffice_api_requests_total{endpoint, method, status}
voffice_db_query_duration_seconds
voffice_presence_active_users
voffice_meeting_concurrent_count
voffice_kpi_generation_duration_seconds
```

#### 4.4.3 Godot 클라이언트 로그

```gdscript
# 원격 로깅 (선택)
func report_error(error_msg: String):
    var payload = {
        "user_id": current_user_id,
        "error": error_msg,
        "version": VERSION,
        "os": OS.get_name(),
        "timestamp": Time.get_ticks_msec()
    }
    # POST /api/client-logs
```

---

## 5. 라이선스 요약

| 컴포넌트 | 라이선스 | 커머셜 사용 | 귀속표시 | 수정 재배포 |
|---------|---------|-----------|---------|----------|
| Godot | MIT | ✓ | ✓ (권장) | ✓ |
| FastAPI | MIT | ✓ | ✓ | ✓ |
| SQLAlchemy | MIT | ✓ | ✓ | ✓ |
| PostgreSQL | PostgreSQL License | ✓ | ✓ (문서) | ✓ |
| Next.js | MIT | ✓ | ✓ | ✓ |
| TailwindCSS | MIT | ✓ | ✓ | ✓ |
| LiveKit | Apache-2.0 | ✓ | ✓ | ✓ |
| Konva.js | MIT | ✓ | ✓ | ✓ |
| React Flow | MIT | ✓ | ✓ | ✓ |
| Blender | GPL-3.0 | ✓ | ✓ (수정건) | ✓ (GPL 준수) |
| Claude API | Anthropic ToS | ✓ | ✓ (계약) | N/A |
| Gemini API | Google ToS | ✓ | ✓ (계약) | N/A |

**주의**:
- Blender는 GPL-3.0 → 에셋 자체는 라이선스 불리지 않음(Blender 소스 수정 시만)
- Claude/Gemini는 API 계약상 사용료 발생 가능 (도그푸딩 시점에는 내부 협상)

---

## 6. 기술 리스크 & 완화

| 리스크 | 영향도 | 완화 방안 |
|-------|-------|---------|
| **Godot 엔진 버그** | 높음 | 안정(stable) 최신 패치 추적(Godot 4는 LTS 채널 없음), 커뮤니티 수렴 확인, fallback 계획 |
| **PostgreSQL 성능 (>1M presence 업데이트/초)** | 중간 | Redis 캐시, 배치 쓰기, 파티셔닝(필요시) |
| **ERP 의존 (direct DB 접근)** | 높음 | read-only 계정, 브랜치·마이그레이션 검증, 테스트 DB 사본 |
| **LiveKit 확장성 (회의 참석 100명+)** | 낮음(도그푸딩) | 스트리밍 프로토콜 선택, 사내 인프라 여유 |
| **AI KPI 평가 편향** | 중간 | 프롬프트 검증, 관리자 검토 필수, 이의신청 절차 |
| **클라이언트 바이너리 배포 (설치형)** | 낮음 | 자동 업데이트 기능, 버전 체크, 체크섬 검증 |

---

## 7. 차기 단계별 기술 결정

### 7.1 현재 (단일 조직, 도그푸딩)

- **선택 확정**: 위 섹션 1~4 참조
- **우선순위**: 품질, 속도(1인 개발)

### 7.2 이후 Phase (B2B, 멀티테넌트)

| Phase | 추가 기술 | 이유 |
|-------|----------|------|
| **Phase 8 (B2B 준비)** | Kubernetes(도커 오케스트레이션) | 멀티테넌트 격리, 자동 스케일링 |
| | Stripe / Toss Payments API | 결제 처리 |
| | Datadog / NewRelic | 대규모 모니터링 |
| **Phase 9 (B2B 배포)** | Three.js(웹 경량 뷰어) | 브라우저에서 3D 미리보기(낮은 그래픽 |
| | WebSocket 게이트웨이(Centrifugo) | 멀티테넌트 메시지 라우팅 |
| | S3 / GCS | 에셋 및 회의 녹화 저장 |

---

## 8. 기술 스택 체크리스트

### 마이그레이션 또는 변경 불가 항목

- [ ] Godot 4 → Unreal / Unity로 변경 안 함 (렌더러 재작업 비용 > 이득)
- [ ] FastAPI → Node.js로 변경 안 함 (ERP 통합 장점 상실)
- [ ] PostgreSQL → MySQL로 변경 안 함 (JSON 문법, 비동기 지원)

### 검증 항목

- [ ] ERP private repo 브랜치(`feature/virtual-office-integration`) 신설 및 kpi_results 테이블·Alembic 마이그레이션·KPI 수신 엔드포인트·연동용 서비스계정 작업 (사내 저장소 접근권 확보, 직접 작업 수행)
- [ ] Godot 4.3 forward+ 렌더러 테스트 완료 (로비 샘플)
- [ ] FastAPI + PostgreSQL + asyncio 프로토타입 테스트 완료
- [ ] Next.js + Konva.js 좌석편집 UI 프로토타입 완료
- [ ] LiveKit self-host 배포 가능성 확인 (사내 네트워크)
- [ ] **Godot 클라이언트에서 LiveKit 수신 PoC (스파이크 S1, 최우선)** — GDScript + WebRTC GDExtension으로 룸 접속·오디오/비디오 수신 검증. 실패 시 회의 화면만 임베디드 브라우저/외부 창 분리
- [ ] **STT 파이프라인 PoC (스파이크 S2, D5)** — LiveKit Egress → STT(한국어 화자분리) → 회의록 초안 품질 측정. 엔진 후보 선정
- [ ] **헤드리스 서버 부하 (스파이크 S3)** — GDScript 헤드리스 + PhysicsServer3D, 20명 시뮬레이션 CPU/메모리 측정
- [ ] Claude / Gemini API 접근 권한 확보 (내부 계약)

### 문서화 항목

- [ ] 각 컴포넌트별 설정 가이드 작성 (docs/setup/)
- [ ] 의존성 버전 호환성 매트릭스 작성
- [ ] 개발 환경 Docker Compose 배포 파일 작성
- [ ] GitHub Actions 워크플로우 정의 (.github/workflows/)

---

## 9. 참고 문서 및 외부 자료

### 공식 문서

- Godot 4 Docs: https://docs.godotengine.org/
- FastAPI: https://fastapi.tiangolo.com/
- SQLAlchemy: https://www.sqlalchemy.org/
- PostgreSQL: https://www.postgresql.org/docs/
- Next.js: https://nextjs.org/docs
- TailwindCSS: https://tailwindcss.com/docs
- LiveKit: https://docs.livekit.io/
- Konva.js: https://konvajs.org/
- React Flow: https://reactflow.dev/

### 사내 참고

- **ERP (Space-Daily)**: https://github.com/project-space-daily/space-daily (private)
  - 동기화 소스 테이블: users, teams, job_positions, attendances, leaves
  - 쓰기 엔드포인트: POST /api/reports (daily_reports)
  - 신규 엔드포인트: POST /api/kpi-results (dev 브랜치에서 구현 예정)

- **가상오피스 기획**: docs/planning/01-prd.md (PRD) + v3.2 개발기획서(사용자 제공)

---

## Loop Metadata

### Upstream Documents Referenced
- **v3.2 개발기획서** (사용자 제공)
- **01-prd.md** (프로젝트 개요)
- **10-roadmap.md** (로드맵·목표)
- **03-erp-integration.md** (ERP 연동 설계)
- **04-data-model.md** (스키마 정의)

### Downstream Documents Affected
- **10-roadmap.md** (각 Phase 기술 결정 반영)
- **12-tasks.md** (개발 환경 구성·셋업 태스크)
- **03-erp-integration.md** (FastAPI 엔드포인트·연동 계약)
- **02-trd-architecture.md** (빌드·배포·전체 아키텍처)

### Open Questions
- Q1: Elasticsearch 도입 필요성? (**확정: 배제**, D21)
  - A: **PostgreSQL fulltext search 확정**. ELK/Elasticsearch는 1인 운영 규모 초과로 배제. B2B 확대 시 재검토.
- Q2: Redis vs DragonflyDB vs Memcached?
  - A: Redis 7.0+ 표준. DragonflyDB 성능 이득 미미, Memcached는 persistence 부족.
- Q3: 클라이언트 자동 업데이트 구현 일정?
  - A: Phase 4(실시간 가상오피스) 이후 선택사항.

### Assumptions
1. ERP(Space-Daily) private repo에 접근 가능하며, dev 브랜치 권한 있음
2. 사내 네트워크에서 PostgreSQL, Redis, LiveKit 자체호스팅 가능
3. Godot 4.3 이상 무료 라이선스(MIT) 지속 → 비용 없음
4. Claude / Gemini API는 내부 계약으로 접근 가능 (요청 시 협상)
5. 1인 개발 + AI 협업 환경 지속 (정규 팀 증원 없음)

### Validation Criteria
- [ ] 모든 컴포넌트 라이선스 호환성 법무 검수 완료
- [ ] Godot 4.3 Forward+ 렌더러로 로비 샘플 구현 가능 확인
- [ ] FastAPI + PostgreSQL async 성능 벤치마크(>100 동시 presence)
- [ ] Next.js + Konva.js 좌석 편집 UI 반응속도 < 100ms
- [ ] LiveKit self-host 100명 회의 용량 확인(사내 테스트)
- [ ] ERP 읽기(read-only DB) + 쓰기(API + 신규 테이블) 통합 테스트 완료

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Godot 4.3 렌더러 버그 발생 | Low | High | 커뮤니티 수렴 확인, fallback 렌더러(Mobile/Compatibility) 검토 |
| PostgreSQL 성능 저하(>10M 행) | Medium | Medium | 인덱싱, 쿼리 최적화, 파티셔닝(필요시) |
| ERP 브랜치 병합 지연 | Low | High | 미리 검증, 문서화, 담당자 공조 |
| Claude API 비용 초과 | Low | Medium | 쿼터 설정, 모니터링, Gemini 대안 사용 |
| LiveKit 자체호스팅 장애 | Low | High | 이중화 구성(선택), 모니터링 알림 |

---

## 변경 이력

| 버전 | 일자 | 변경 내용 |
|------|------|-----------|
| v1.0 | 2026-07-01 | 최초 작성 |
| v1.1 | 2026-07-02 | 00-decisions.md v1.0 정합 반영 — D1(ENet/WebSocket→WSS 확정), D2(GDScript 확정·C# 표기 제거), D3(게임서버 메모리 권위+FastAPI 경유 배치 push), D4(PyJWT·자체 시크릿 HS256), D5(STT 회의록 스택 §2.6.1 신설), D13(프레즌스 6종→7종·external 추가), D21(사내 VM·관측 Grafana/Prometheus/Loki/Uptime Kuma·APScheduler+DB 영속 재시도 큐·검색 PG fulltext 확정/ELK 배제), 버전 정정(FastAPI 3.0+→0.115+, python-jose→PyJWT), Godot 4 export 명령 정정(--export-release, --standalone-mode 제거), 검증 항목에 스파이크 S1(Godot↔LiveKit 수신 PoC)·S2(STT)·S3(헤드리스 부하) 추가 |
| v1.2 | 2026-07-02 | 정합 패치 — 배치 편집기 Konva.js 2D 전용·정밀 확인은 데스크톱 draft 모드(D11), KPI 입력에서 external_activities 제외(D20-c 폐기)·프롬프트를 서술 생성으로 한정(D14-e), "EOD 배치 33시간"→야간 배치 3시간 윈도우 오타 정정, Godot 버전 표기 "4.3+ 안정 버전(LTS 채널 없음)" 통일, LiveKit 접속 경로 공개 엔드포인트 직결+TURN-TLS 443 폴백(VPN 없음 확정) |

---

**Document Version**: 1.2  
**Last Updated**: 2026-07-02  
**Authored By**: Documentation Specialist  
**Status**: 확정 (00-decisions.md v1.0 정합 반영)
