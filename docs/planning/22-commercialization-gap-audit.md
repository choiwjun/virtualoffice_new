# 22 — 상용화 갭 감사: B2B SaaS 판매 수준으로 끌어올리기 (2026-07-23)

> 6축 병렬 코드 감사(멀티테넌시·보안·확장성·운영·기능완성도·SaaS계층/컴플라이언스). 모든 항목 file:line 근거.
> **한 줄 결론**: 이 제품은 **잘 만들어진 "단일 회사 사내 도구"**다. 코어(KPI·회의·업무일지·보고서·출장·동의·프레즌스 쓰기경로)는 실제 동작하고 보안·패키징도 성숙하다. 그러나 **"여러 고객사에 파는 SaaS"를 만드는 계층 — 멀티테넌시·과금·셀프서브 온보딩·엔터프라이즈 인증 — 이 통째로 없다.** 이게 상용화의 실제 벽이다.

---

## 0. 지금 좋은 것 (기반은 탄탄 — 재작성 불필요)

- **보안 성숙**: bcrypt·JWT 알고리즘 고정·서버측 RBAC 전수 강제·프로덕션 시크릿 fail-fast·토큰 Fernet 암호화·로그인 이중 레이트리밋. 과거 kpi 권한상승 버그 수정 확인. (`core/security.py`, `core/deps.py:59-77`, `config.py:93-115`)
- **데이터 모델 탄탄**: ~30 테이블, 이력 테이블(seat/team history), 감사로그, 동의 테이블, Alembic 존재.
- **기능 코어 실제 동작**: KPI 계산·이의/승인 워크플로우·회의·회의록·업무일지·보고서·출장·채팅 영속.
- **배포 패키징 강함**: 멀티스테이지 Dockerfile·풀 prod 컴포즈(Postgres+backend+realtime+frontend+LiveKit+coturn+Caddy TLS).

→ **재작성이 아니라 "SaaS 계층 추가 + 확장·운영 성숙화"**가 과제다.

---

## 1. Tier 0 — BLOCKER (두 번째 고객사를 받는 순간 깨짐 / 팔 수 없음)

### T0-1. 멀티테넌시가 실질적으로 없음 (최우선)
- JWT·`CurrentUser`에 `company_id` 없음 → 어떤 쿼리도 테넌트로 스코프 불가 (`api/auth.py`, `core/deps.py`).
- Company/Tenant 엔티티·프로비저닝 경로 없음, `company_id=1` 하드코딩.
- 라우터 전수 회사 필터 없음: reports·work_logs·kpi·meetings·seats·notices·office_layouts는 user/role만 검사. **meetings·seats는 UUID 추측으로 타사 데이터 직접 열람·변조(IDOR)**.
- 아바타 `/media/avatars/{user_id}_{ts}` 평면·비인증 공개·열거 가능(회사 네임스페이스 없음).
- 실시간: 방=회사 체크가 있으나 **클라이언트가 주장한 room/company를 토큰 검증 없이 신뢰**.
- **판정**: single-tenant-in-practice. **효과: L(대). 최우선.** 정체성에 company_id 삽입 → 모든 쿼리 스코프 강제 미들웨어/의존성 → Company 테이블·프로비저닝.

### T0-2. 실제 DB 마이그레이션 부재
- 유일한 스키마 생성이 `create_all()`이고 prod `.env.example`에 `AUTO_CREATE_TABLES=true` → **모델 변경 시 스키마 드리프트 확정**, migrate-on-deploy 단계 없음. (`backend/alembic`은 골격만)
- **효과: M.** Alembic 마이그레이션 규율 확립 + 배포 파이프라인에 `alembic upgrade head` 삽입 + AUTO_CREATE 금지.

### T0-3. 실시간 서버가 단일 프로세스·SPOF·수평확장 불가
- `realtime/src/index.ts`: 단일 Server, Redis 드라이버/프레즌스 없음(LocalPresence/LocalDriver). 컴포즈에 replicas·Redis 없음. **크래시/배포마다 전 회사 전원 드롭.** 방당 `maxClients=100` 하드캡.
- **현실적 동시접속 천장 ~150–250명**(단일 코어가 20Hz 틱+JWT+프레즌스 직렬화 감당 한계).
- **효과: L.** `@colyseus/redis-driver`+`redis-presence` + Redis + 스티키 LB + 스테이트리스화 → replica 스케일.

### T0-4. 상용 SaaS 계층 전무 (제품이 아니라 도구)
- **과금/구독/쿼터/미터링/결제 전무**(billing/subscription/stripe/plan/quota grep 0건).
- **셀프서브 온보딩 없음**: 신규 고객사 가입·유저 초대·오피스 셋업이 전부 수동 DB 시드.
- **엔터프라이즈 인증 없음**: 로컬 이메일+비번뿐, SSO/SAML/OIDC/SCIM 없음 → 기업 고객 IT 요건 미충족.
- **테넌트 셀프 관리 없음**: 고객 admin이 자사 유저·역할·레이아웃·브랜딩을 스스로 관리 불가.
- **효과: L×4.** 이게 "SaaS로 판다"의 본체. T0-1(멀티테넌시) 위에 얹힘.

---

## 2. Tier 1 — HIGH (실제 고객 트래픽·운영에서 곧바로 문제)

### 확장성/성능
- **T1-1 프레즌스 쓰기 증폭**: 3초마다 전원 upsert(델타 아님), 행별 SELECT+UPDATE → 1000명 시 **~666 쿼리/s 상시**. (`OfficeRoom.ts:545-560`, `presence.py:78-99`, `presence_store.py:91-125`) 효과 M — 변경분만·배치 `INSERT ON CONFLICT`.
- **T1-2 매 틱 무의미 브로드캐스트**: `serverSeq++`를 20Hz로 동기 필드에 → 유휴 100명 방에서 초당 2000 델타 인코딩. (`OfficeRoom.ts:504`, `OfficeState.ts:17`) 효과 S — serverSeq를 스키마 상태에서 제외.
- **T1-3 fact 테이블에 company_id 없음 → 인덱스 불가**: work_log·kpi_result·report·chat_message·presence 등 테넌트 컬럼 없어 회사+기간 롤업이 풀스캔. (`models/tables.py`) 효과 L(T0-1과 함께) — 비정규화 컬럼+`(company_id,date)` 복합 인덱스.
- **T1-4 무페이징 목록 API**: `GET /api/work-logs`·`/reports`가 admin에게 전체 테이블 반환. 효과 S–M — limit/offset + `/summary`는 SQL GROUP BY.
- **T1-5 LiveKit 정원·coturn 쿼터 없음**: 대형 회의/오설정 시 SFU·릴레이 폭주. 효과 M.

### 운영/관측성
- **T1-6 관측성 사실상 전무**: `print()`만, Sentry/메트릭/구조화 로깅 없음. `/health`가 DB 미확인, 실시간 헬스 라우트 없음. 효과 M — 구조화 로깅+Sentry+/ready(DB체크).
- **T1-7 실시간 graceful shutdown 없음**: SIGTERM 핸들러 없어 **배포마다 유저 하드 드롭**. 효과 S.
- **T1-8 프레즌스 푸시 유실**: 백엔드 blip 시 재시도/버퍼/타임아웃 없음(`PresenceSink.ts:52-71`). 효과 M.
- **T1-9 스케줄러 비영속·무알림**: KPI/EOD/ERP 배치 누락 시 재시도·알림 없음. 효과 M.

### 보안/인증
- **T1-10 실시간 JWT 기본 off**: `JWT_REQUIRED=false`(`config.ts:96`), 프로덕션 가드만 존재 → **NODE_ENV 미설정 스테이징에서 아무나 임의 userId로 join·프레즌스/이동 스푸핑**. 효과 S — 기본 true 또는 네트워크 노출 시 강제.
- **T1-11 로그인 타이밍 유저 열거**: 미존재 유저는 bcrypt 미실행 → 타이밍 델타로 이메일 열거(`auth.py:153-159`). 효과 S — 더미 해시 상수시간 비교.
- **T1-12 아바타 업로드 콘텐츠 미검증**: `content_type` 헤더만 신뢰, 매직바이트 검증 없음 → `/media`에 임의 바이트 호스팅(`avatar.py:141`) + nosniff 헤더 없음. 효과 M — Pillow verify.

### 프론트/클라
- **T1-13 뷰포트가 전 라우트 상시 마운트**: 메뉴 페이지(KPI/보고서/설정)에서도 WebSocket+rAF 상시 → 실시간 연결 천장을 유휴 유저가 잠식 + 클라 CPU/배터리. (`OfficeShell.tsx:1205`, `OfficeViewport2D.tsx:211`) 효과 M — `/office`에서만 enable/mount.

---

## 3. Tier 2 — 컴플라이언스 팩 (한국 개인정보보호법 — 직원 모니터링 제품이라 법적 필수)

프레즌스 추적 + 활동 기반 KPI = **근로자 감시**. 별도 트랙, 대체로 저효율·고신뢰 항목.
- **C1 동의 게이트 없음**: 프레즌스·KPI 수집에 동의 전제 없음(녹화 동의 테이블만 존재). 개인정보보호법 §15.
- **C2 보존기간 부분 구현**: 프레즌스 30일 purge ✅ / **KPI 5년·녹화 90일 미구현 ❌**. §39.
- **C3 열람·삭제(정보주체 권리) 엔드포인트 0건**. §35.
- **C4 읽기 미감사**: 변경만 audit_log, **누가 타인 KPI/프레즌스를 조회했는지 기록 없음**. §74 책임추적성.
- **C5 개인정보·모니터링 고지 없음**.
- **C6 가명처리 범위 오도**: pseudonymize가 LLM 경로에만 적용(`ai_draft.py:211`), 관리자 화면엔 실명 노출.
- **효과: 대부분 S–M.** 판매 신뢰·계약 요건. T0와 병렬 진행 권장.

---

## 4. Tier 3 — 기능 완성도 (고객 대면 차별화가 스텁)

- **F1 ERP 라이트백 스텁**: EOD 상태를 고객 ERP로 실제 전송하는 경로가 데모. mock_reader가 기본.
- **F2 STT 회의록 스텁**: 음성→텍스트 자동 초안 미구현(AI 초안은 실패 시 조용히 mock 폴백, 무로그 `ai_draft.py:216`).
- **F3 ERP 온보딩 설정 없음**: 고객이 자사 HR/ERP를 연결하는 UI·스케줄 견고성 부재.
- **F4 통합 조용한 mock/no-op 폴백 + 가드 비대칭**: ERP 읽기·AI 초안·프레즌스 싱크(`ConsolePresenceSink`=DB 미기록)가 미설정 시 조용히 no-op. prod 시크릿만 fail-fast, **mock/stub 기본값엔 기동 체크 없음** → 운영자가 "프레즌스 저장됨"으로 착각.
- **F5 채팅 4초 폴링**(실시간 아님, `chat/page.tsx` POLL 4000ms) + **죽은 프레즌스 코드 2경로**(backend pubsub 미구독 + Colyseus `presence_event` 클라 핸들러 없음).
- **효과: F1–F3 각 M–L(차별화), F4–F5 S–M.**

---

## 5. 권장 시퀀싱

1. **판매 가능 최소선(Tier 0)**: T0-1 멀티테넌시(정체성+쿼리 스코프+Company/프로비저닝) → T0-2 마이그레이션 → T0-4 과금·온보딩·SSO·테넌트 admin. (T0-3 실시간 스케일은 파일럿 규모면 후순위 가능하나 SPOF/배포드롭은 조기)
2. **컴플라이언스 팩(Tier 2)**: T0와 병렬 — 저효율·계약 필수. 동의 게이트→고지→보존/삭제·열람→읽기 감사.
3. **스케일·운영(Tier 1)**: 유료 트래픽 직전 — 프레즌스 쓰기/브로드캐스트, 관측성, graceful shutdown, 페이징, LiveKit 캡, 뷰포트 게이팅, 실시간 JWT on.
4. **차별화 완성(Tier 3)**: ERP 라이트백·STT·ERP 온보딩 — 세일즈 데모 강화.

> **가장 값싼 즉효 3건(오늘 착수 가능)**: T1-10(실시간 JWT 기본 on, S)·T1-7(graceful shutdown, S)·T1-13(뷰포트 게이팅, M) — 보안·안정·성능 즉시 개선.
> **가장 큰 레버**: T0-1 멀티테넌시 — 이것 없이는 두 번째 고객사가 불가능. 모든 SaaS 계층(과금·온보딩)이 그 위에 얹힘.
