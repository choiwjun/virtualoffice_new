# Handoff — 온보딩 완성 세션 (2026-07-27)

> **한 줄 상태**: 24-스펙 **Phase 3·4 완결**(E3 유저 CRUD + E4 초대·비번설정 + E5 화이트라벨) + **Phase 1d 잔여 스코프 전량 종결**. ERP 없는 회사가 사람을 채우고, 관리자가 남의 비밀번호를 모른 채 팀을 들이고, 테넌트별 브랜드로 표시되며, 남아 있던 교차 테넌트 누수 6곳이 닫혔다. 다음은 **첫실행 온보딩(Phase 5)**.
> 정본 감사: [22 백엔드/SaaS](22-commercialization-gap-audit.md) · [23 프론트/에셋/UX](23-frontend-design-asset-commercialization-audit.md) · [24 온보딩·화이트라벨 스펙](24-onboarding-whitelabel-workstream-spec.md).

---

## 1. 이번 세션 완료

| 영역 | 내용 | 검증 |
|---|---|---|
| **E3** | admin 유저 CRUD — 생성·수정·비활성·재활성 + `ErpUser.source`(erp/native) + `Company.seat_limit` | 격리 10 + CRUD 24 + 라이브 30/30 |
| **E4** | 비밀번호 설정 링크 — 초대(최초 설정)·재설정 공용 `auth_token` + 본인 비번 변경 | 링크 22 + 라이브 34/34 |
| **Phase 1d** | `audit_log`·`room`·`floor`·`org_group`·`team`·`consent` 테넌트 스코프 | 격리 15 |
| **E5** | 화이트라벨 — 브랜드명·색·로고 + 업로드 매직바이트 검증 | 브랜딩 25 + 라이브 33/33 |
| **E6** | 첫실행 체크리스트(실측 파생) + 최초 투어 | 온보딩 17 + 라이브 22/22 |
| **T0-1 종결** | 실시간 join의 테넌트 경계 — JWT `company_id` ↔ 방 회사 대조 | realtime 20 |
| **A7 잔여** | 토큰과 중복되던 표면 hex → CSS 변수 (모달·셸·게이지) | tsc 0 · 시각 불변 |
| **dev DB** | `0001`(또는 미스탬프) → `0009`, 컬럼 드리프트 복구 | 실서버 기동 12/12 |

**누적**: pytest **529 passed / 0 failed**(세션 시작 414 → +115), realtime **74 passed**, 마이그레이션 체인 `0001→…→0009`, 프론트·realtime `tsc 0`.

### 1-1. E3 — admin 유저 CRUD (24-spec Phase 3 · 23 E3/E12)

`api/employees.py` 신설(erp.py에서 분리). 조회·생성·수정·비활성·재활성 6개 엔드포인트.

- **원래 문제**: `/api/employees`가 `DEFAULT_COMPANY_ID = 1` 하드코딩 → **신규 가입 회사의 admin이 1번 회사 직원명부를 그대로 봤다.** 생성 API는 0이라 ERP 없는 회사는 사람을 못 채웠다.
- **`ErpUser.source`(`erp`|`native`)**: ERP 전체 대사(`sync_users`)를 `source='erp'`로 한정. 없으면 콘솔에서 만든 유저가 "ERP에서 사라진 사용자"로 오탐돼 매 동기화마다 비활성화된다. 기존 `password_hash is None` 예외는 유지(시드 계정 보호).
- **가드**: 이메일 중복 409 · 권한상승(admin→super_admin 발급) 403 · 마지막 활성 관리자 강등/비활성 409 · 본인 비활성 409 · `seat_limit` 초과 409(NULL=무제한 → 기존 회사 무영향).
- **`initial_password` 선택**: 주면 즉시 로그인, 생략하면 `has_login=false` 명부 등재(E4 링크가 이어받음).
- **부수 수리**: `POST /api/erp/sync`·`GET /api/attendances`가 company 1 하드코딩이라 **회사 2 admin이 "ERP 동기화"를 누르면 회사 1에 유저를 썼다** → 호출자 회사 스코프로 전환(ERP가 그 회사를 모르면 리더가 빈 목록 → 안전한 no-op).

### 1-2. E4 — 비밀번호 설정 링크 (24-spec Phase 3 초대 + Phase 6 리셋)

> **스펙 재정의**: 원안은 이메일 초대였으나 **메일 발송 없이 링크를 관리자에게 돌려주는 방식**으로 축소했다. 근거·경계는 [00-decisions.md D36](00-decisions.md) 참조.

`services/tokens.py` + `auth_token` 테이블. 초대와 재설정은 "1회용 링크 → 본인이 설정 → 즉시 로그인"으로 코드가 같아 `purpose`로만 구분한다.

```
POST   /api/employees/{id}/access-link   admin. 발급 → { url, purpose, expires_at }
DELETE /api/employees/{id}/access-link   admin. 회수
GET    /api/auth/set-password?token=     공개. 유효성 + 대상·회사명
POST   /api/auth/set-password            공개. 설정 → 즉시 로그인 토큰
POST   /api/auth/change-password         인증. 현재 비번 확인 후 변경
```

- **평문 미저장** — sha256만 보관, 원문은 발급 응답에서 한 번만.
- **단회성 · 재발급 시 이전 링크 자동 무효** — 안 그러면 "회수"가 의미를 잃는다.
- **상태는 파생** — `expires_at`으로 조회 시점 판정. 만료 전이 배치가 없어 스테일이 안 생긴다.
- **오류 동일화** — 만료/사용됨/회수됨/미존재를 전부 410 `invalid_or_expired_token`으로(토큰 추측 단서 차단).
- **비활성 계정의 링크는 죽는다**(퇴사자 재진입 차단) · **본인이 비번을 바꾸면 관리자가 뿌린 링크가 무효화**된다(탈취 창 차단) · **재설정 시 로그인 백오프 해제**(잠긴 채 새 비번을 못 쓰는 함정 제거).
- 만료: 초대 7일 / 재설정 24시간. 비번 최소 8자(`tokens.MIN_PASSWORD_LENGTH` 단일 상수).

프론트: `/set-password` 공개 화면(초대·재설정 공용) · 직원명부 행 **초대/재설정** 버튼 + 링크 모달(복사·만료·회수) · 설정 **계정** 섹션(비번 변경) · 로그인 화면 안내.

### 1-3. Phase 1d — 잔여 테넌트 스코프 (22 T0-1 종결)

Phase 1b/1c가 meeting·seat·fact를 닫은 뒤에도 남아 있던 6곳:

| 표면 | 이전 상태 | 조치 |
|---|---|---|
| `GET /api/audit-logs` | 전 테넌트 공용 — 타사 권한변경·KPI조정 이력 노출 | `audit_log.company_id` 신설 + 스코프. `record_audit(company_id=…)` **필수 키워드**(호출부 20곳) |
| `GET /api/rooms` · 회의 예약 | 타사 방이 피커에 뜨고 **예약까지 됐다**(남의 방 이중예약) | `room.company_id` 신설 + 스코프 |
| `GET /api/floors` | 좌석 편집기에 타사 층 노출 | `floor.company_id` 신설 + 스코프 |
| `GET /api/teams` | `DEFAULT_COMPANY_ID=1` 하드코딩 | 호출자 회사 |
| org_group CRUD | 목록 무필터, **단건 수정·삭제에 소유 검사 없음** | 전량 스코프 + `assert_same_company` + 부모 지정도 검사 |
| 녹화 동의(consent) | 타사 회의 참석자 동의를 읽고 쓸 수 있었다(D20-b 개인정보) | 회의 로드 시 `assert_same_company` |

**room/floor는 조인 대신 비정규화**를 택했다. 둘 다 직접 쿼리되는 표면이고, 소유 체인이 끊긴 행에서도 스코프가 유지돼야 하며, Phase 1b/1c와 규약이 같아진다. (조인 방식을 먼저 시도했다가 고아 `floor_id`를 쓰는 기존 픽스처 40개가 깨져 판단을 바꿨다 — 픽스처가 아니라 설계가 틀린 쪽이었다.)

### 1-5. E5 — 화이트라벨 (24-spec Phase 4 · 23 E5/A7)

`Company.brand_name`·`accent_color` 추가(`logo_url`·`primary_color`는 Phase 1a 플레이스홀더 재사용) + `api/branding.py`.

- **주입 방식이 스펙과 다르다**: `globals.css` 토큰은 hex가 아니라 **RGB 채널**(`59 91 254`)이고 Tailwind가 `rgb(var(--x) / <alpha-value>)`로 참조한다(불투명도 유틸 `bg-primary/20`을 살리는 구조). 24-스펙 §4-3의 hex 직접 주입 예시를 그대로 쓰면 **모든 색 유틸이 조용히 깨진다** → `lib/branding.ts`의 `hexToChannels()`로 변환한다.
- **덮어쓰는 변수는 3개뿐**: `--color-primary`·`--color-primary-hover`(primary에서 파생)·`--color-accent-cyan`. 서피스·텍스트는 고정이라 어떤 브랜드 색을 넣어도 본문 대비(23 A11)가 유지된다.
- **`BrandingProvider`**(`(protected)` 최상단) — 로그인 후 fetch → CSS 변수 주입 + 컨텍스트 공급. `refresh()`로 저장 즉시 반영(재로그인 불필요), `preview()`로 저장 전 실시간 미리보기.
- **공개 브랜딩**: 로그인 전에는 인증이 없으므로 slug(`?company=` 또는 서브도메인)로만 조회한다. **없는 slug도 200 + 빈 브랜딩** — 404로 갈리면 slug 존재 여부를 훑는 열거 수단이 된다.
- **로고 업로드는 매직바이트로 판정**(22 T1-12). `content_type`은 클라가 보낸 문자열이라 HTML/JS를 `image/png`로 주장하면 `/media` 정적 서빙에서 실행돼 저장형 XSS가 된다. SVG는 스크립트를 품을 수 있어 형식에서 제외. 회사별 디렉터리(`/media/branding/{company_id}/`)로 경로 열거도 차단.
- **아바타 업로드도 같은 취약점이 있어 함께 수리**했다(`core/images.py` 공용 검사기). 기존 테스트 2개가 "content_type이 형식을 결정한다"는 취약한 계약을 고정하고 있어 **바이트가 결정한다**로 정정했다.
- 프론트: `/admin/branding` 관리 화면(브랜드명·컬러피커·로고·라이브 미리보기) · 셸 로고/브랜드명 주입 · 로그인 화면 브랜딩.

### 1-6. E6 — 첫실행 온보딩 (24-spec Phase 5 · 23 E6)

- **체크리스트는 저장하지 않는다**. `seat_placed`·`notice_posted`·`team_invited`를 조회 시점에 실측 파생한다. 플래그로 저장하면 데이터를 지워도 "완료"가 남는다. 저장하는 건 사람의 의사표시 둘뿐 — `company.onboarding_dismissed`(회사 단위)·`erp_user.tour_completed`(유저 단위). 스펙의 JSONB `onboarding_state` 대신 boolean 두 개면 충분하다.
- **공지는 `is_active` 필터가 필수**다. 공지 삭제는 soft-delete(D18)라 행이 남는다 — 전체를 세면 "지웠는데도 완료"가 된다. 유닛 테스트(물리 삭제한 좌석)는 통과했는데 **라이브 스모크에서 실제 API 경로로 눌러 보고서야 걸렸다.**
- **기존 회사는 자동으로 숨는다** — 좌석·공지·인원이 이미 있어 세 항목이 전부 true다(스테일 유도 없음).
- 투어는 셸의 `data-tour` 요소를 찾아 스포트라이트를 그리고, 요소가 없으면(레일 모드·좁은 화면) 중앙 카드로 폴백해 레이아웃에 상관없이 깨지지 않는다. ESC·화살표 키 지원.

### 1-7. 실시간 테넌트 경계 — 22 T0-1 종결

`realtime/`의 `onAuth`가 JWT의 `sub`/`email`만 취하고 **`companyId`는 클라이언트가 준 값을 그대로 썼다.** 회사 2의 유저가 회사 1의 방에 들어가 `companyId: "1"`을 주장하면 그 층의 아바타·프레즌스를 그대로 봤다.

- 토큰의 `company_id` 클레임을 정본으로 삼고, **방의 회사와 다르면 join 거부**(`forbidden: company mismatch`).
- 클라가 준 `companyId`는 토큰 값으로 덮어쓴다(위조 무력화).
- `filterBy`에 `companyId`를 추가 — floorId가 새어도 서로 다른 테넌트가 같은 방에 합류하지 않는다(2중 방어).
- `company_id` 없는 구 토큰은 통과(백엔드 `get_current_user`와 동일한 하위호환 정책).
- 부수 수리: `onCreate` 전에 dispose되면 `flushPresence`가 `this.state` 없이 터져 onDispose 경로 전체가 죽었다 → 가드 추가.

### 1-8. 잔여 hex 변수화 (23 A7/A1 부분)

토큰과 **값이 중복되던** 표면색만 CSS 변수로 바꿨다(`#161F32`→`rgb(var(--color-bg-surface))` 등, 13개 파일). 값 치환이라 className 수술이 없고 렌더 결과도 동일하다. 브랜드 마크(`#3B5BFE`)는 `--color-primary`를 타므로 이제 signup·set-password·확인 다이얼로그·StatCard도 테넌트 색을 따른다.

**캔버스 씬(`OfficeViewport2D` 43건·`SeatCanvas` 18건)은 제외했다** — 캔버스는 CSS 변수를 읽을 수 없고(`getComputedStyle` 경유가 필요), 그 색들은 브랜드가 아니라 씬 팔레트(T1B 웜블랙 계열)다. 상태 시맨틱 색(`#22C55E` 등)과 아바타 정체성 팔레트도 의도적으로 고정이다.

### 1-4. dev DB 정상화

pull 직후 dev.db는 `0001_initial` 스탬프에 **`company` 테이블조차 없었고**, 앱이 뜨지 않았다.

- `0002~0007` 적용 — 데이터 보존(유저 8·회의 2·좌석 4·KPI 16), 백필 후 NULL 0건.
- **`user_integration` 테이블 누락** — `0001` 스탬프 때문에 `create_all`이 재실행되지 않아 D31 테이블이 없었다 → 누락분만 생성.
- **컬럼 드리프트 4개**(`notice.category`·`published_at`·`expires_at`, `user_avatar.photo_url`) — `/api/notices`가 실제로 **500**을 뱉었다. 두 테이블 모두 0행·피참조 없음을 확인하고 모델 정의로 재생성.
- `dev_qa.db`도 동일 처리. 두 DB 모두 모델 대비 드리프트 **0**.

---

## 2. 다음 작업

> **24-스펙 Phase 1~5가 모두 닫혔고 22 T0-1(멀티테넌시)도 종결됐다.** 남은 건 아래 곁가지와 별도 워크스트림이다.

### 🟠 P1
- **메일 발송 어댑터** — `tokens.set_password_url()`이 이미 링크 본문을 만든다. 발송 채널만 얹으면 셀프서비스 forgot-password(23 E9 = Phase 6 잔여)까지 같은 토큰 코드로 열린다. **SMTP / SES 중 무엇을 쓸지가 결정 사항**이라 착수 전 합의가 필요하다.
- **`office.company_id` 타입 드리프트** — dev.db에서 `CHAR(32)`(모델은 `Integer`). SQLite 비교는 통과하지만 Postgres 이관 시 문제가 된다. `floor`·`office_layout`이 FK로 참조해 재작성 비용이 있다.
- **캔버스 씬 색 토큰화**(23 A8/A13) — `OfficeViewport2D`·`SeatCanvas`는 캔버스라 CSS 변수를 읽을 수 없다. 필요해지면 `getComputedStyle`로 한 번 읽어 렌더 컨텍스트에 주입하는 방식이 필요하다.

### 🟡 P2 — 22-doc Tier 1/2
Redis 수평확장(T0-3) · 관측성(구조화 로깅·Sentry·/ready) · graceful shutdown · 개인정보 팩(동의 게이트·보존기간·열람/삭제).

### 🟢 병행 품질
i18n(C1, 한국어 1,695건) · 프리미티브 확산 · 접근성 잔여(C10/A11).

---

## 3. 확립된 레시피

**멀티테넌시 스코프 작업**:
1. 목록 = `.where(Model.company_id == cid)` via `Depends(company_scope)`
2. 단건/변조 = 로드 **직후·변조 전** `assert_same_company`(404 존재 은닉)
3. 생성 = 서버가 `company_id` 주입 — **클라 불신**
4. 자체 `company_id`가 없는 테이블은 **직접 쿼리되면 비정규화**, 부모 경유로만 접근되면 부모 FK 유도
5. 격리 테스트 필수 — 타사 리소스 GET/PATCH/DELETE/action → 404, 목록 필터, 생성 시 주입 확인

**마이그레이션**: `0001`이 `create_all`이라 신규 배포는 그 경로가 정본. 후속 리비전은 기존 DB용 **멱등 ALTER**로 쓰고(존재 검사 가드), 체인 경로와 ALTER 경로를 **둘 다** 검증한다. `test_migrations.py`가 체인을, dev DB 실적용이 ALTER를 커버한다.

**토큰 규율**(E4에서 확립, Phase 6이 재사용): 평문 미저장(sha256) · 단회성 · 재발급 시 이전 무효 · 상태는 파생 · 무효 사유 동일화.

---

## 4. 라이브 스택 상태 + 재현

- DB: `backend/dev.db`·`dev_qa.db` 둘 다 `0009_onboarding`, 드리프트 0. `AUTO_CREATE_TABLES`는 false여도 된다.
- 로그인: `alice@virtualoffice.local` / `password123`(company 1). `/signup`으로 새 회사 개설.
- 검증 명령(백엔드): `cd backend && DATABASE_URL="sqlite+aiosqlite:///:memory:" python -m pytest -q` (~3분)
- 타겟 검증: `pytest tests/test_employees_crud.py tests/test_access_links.py tests/test_tenant_isolation*.py -q`

---

## 5. 함정 / 주의 (gotchas)

- **⚠ 개발 환경이 Linux(WSL) 전용이다**: `backend/.venv`는 WSL로 만들어진 venv이고 pytest·fastapi가 없다. `frontend/node_modules`도 `@next/swc-linux-*`·`@rollup/rollup-linux-*`만 있어 Windows에서 `next build`·`vitest`가 실행 불가. Windows에서 작업하려면 각각 재설치가 필요하다. (이번 세션의 백엔드 검증은 별도 임시 venv로 수행, 프론트는 `tsc`까지만 확인 — vitest 미실행.)
- **⚠ `PUBLIC_APP_URL`을 운영에서 반드시 설정**: E4 링크의 호스트는 백엔드가 아니라 **프론트** 주소다. 기본값 `http://localhost:3000`을 그대로 두면 사용자가 링크를 열 수 없다. `.env.example` 참조.
- **PowerShell로 한글 소스를 rewrite 금지**: `Get-Content | Set-Content`는 CP949로 읽고 UTF-8로 써서 한글 주석을 전부 깨뜨린다(이번 세션에 `consent.py`가 당해 `git checkout`으로 복구). 소스 편집은 반드시 편집 도구로.
- **dev.db `office.company_id`가 `CHAR(32)` 레거시 타입**: 모델은 `Integer`. SQLite 비교는 통과하지만(실측 확인) Postgres로 옮기면 문제가 된다. office는 `floor`·`office_layout`이 FK로 참조해 재작성 비용이 있어 이번엔 두었다 — 별도 정리 대상.
- **`asyncpg`는 Python 3.14 Windows 휠이 없다**(MSVC 요구). SQLite 테스트에는 불필요하므로 제외 설치 가능.
- **_html 미러 훅**: `docs/*.md` 편집 시 전역 PostToolUse 훅이 미러를 일괄 열화 재생성. 복구 = `git checkout -- docs/_html/` → `tools/docs-html`에서 `node generate.js` → 새 문서 미러만 스테이징.
- **pytest full ~3분**: 타겟 파일 지정으로 빠르게, full은 커밋 전에만.
- **커밋 메시지 백틱 금지**: bash `-m "…`토큰`…"`은 명령치환.

---

## 6. 진입점 (다음 세션 시작)

> 24-스펙은 전부 닫혔다. 다음 후보: **"메일 발송 어댑터"**(SMTP/SES 결정 후 E9 self-service 개통) / **"관측성"**(구조화 로깅·Sentry·/ready, 22 Tier 1) / **"i18n"**(C1, 한국어 1,695건 — 재판매 전 조기 착수 권장) / **"개인정보 팩"**(22 §3 동의 게이트·보존기간·열람/삭제).
