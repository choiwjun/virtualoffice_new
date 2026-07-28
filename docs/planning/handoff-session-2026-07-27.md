# Handoff — 온보딩 완성 + 관리 화면 실사용 세션 (2026-07-27)

> ⏭️ **후속: [handoff 2026-07-28](handoff-session-2026-07-28.md)** — 여기서 남긴 작업 대부분이 그날 닫혔다(D40). 최신 상태는 그쪽을 본다.

> **한 줄 상태**: 24-스펙 **Phase 1~5 전량 종결**(E3 유저 CRUD · E4 초대·비번설정 · E5 화이트라벨 · E6 첫실행 온보딩 · Phase 1d 테넌트 스코프)에 이어, **관리 화면을 실제 회사처럼 굴려 보며(HORIZON 데모 시딩) 드러난 결함을 닫았다** — 좌석 편집기 재설계(D37)·자리 주인 지정(D38)·팀 이름 정본화(D39)·`company_id` 타입 드리프트(0010).
> 정본 감사: [22 백엔드/SaaS](22-commercialization-gap-audit.md) · [23 프론트/에셋/UX](23-frontend-design-asset-commercialization-audit.md) · [24 온보딩·화이트라벨 스펙](24-onboarding-whitelabel-workstream-spec.md).
>
> **이 문서는 하루치 두 구간을 담는다.** §1 = 오전(24-스펙 Phase 3~5), §1B = 오후(도그푸딩에서 나온 D37~D39). 다음 세션은 §6부터 읽으면 된다.

---

## 1. 오전 — 24-스펙 Phase 3~5

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

**오전 종료 시점 누적**: pytest **529 passed**(세션 시작 414 → +115), realtime **74 passed**, 마이그레이션 체인 `0001→…→0009`.
**하루 종료 시점 누적**: pytest **569 passed / 85 skipped**, realtime **89 passed / 0 failed**(smoke 30 · scene-floor 13 · v3-floor 11 · tenant-scope 20 · call-signal 15), 체인 `0001→…→0011`, 프론트·realtime `tsc 0`.

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

## 1B. 오후 — 관리 화면 도그푸딩 (D37 · D38 · D39)

> 방법이 바뀐 구간이다. 스펙 항목을 따라가는 대신 **실제 회사 하나를 통째로 만들어 놓고 관리자 동선을 끝까지 걸었다**. 결함이 스펙에서 나오지 않고 화면에서 나왔다.

| 커밋 | 내용 | 결정 |
|---|---|---|
| `30e21bb` | 배포 레이아웃을 V3 씬 **위에 겹쳐** 렌더 — 배포하면 사무실이 통째로 사라지던 문제 | — |
| `5663cfe` | 좌석 배치 편집기 전면 재설계 — 도면 은유·반영 3단계·용어 한국어화 | D37 |
| `d3de76b` | 자리 주인 지정/해제를 편집기 안에서 | D38 |
| `25a5208` | `company_id` 타입 드리프트 교정 + 회귀 테스트 | 0010 |
| `ed6d578` | 팀 이름의 정본을 조직도에 | D39 · 0011 |

### 1B-1. HORIZON 판교 HQ 데모 시딩 — 결함을 끌어낸 장치

조직 13그룹(본부 4·부서 7·파트 2) · 인원 29명 · 좌석 44개(팀별 섬) · 레이아웃 v4 배포 · 공지 3 · 회의 6 · 업무일지 13.

- **모든 쓰기를 실제 API로** 넣었다(직접 DB 쓰기 금지). 그래야 권한·검증·테넌트 스코프가 운영과 같은 경로를 탄다 — 실제로 아래 0010 버그가 **시딩 중 404로 터져서** 발견됐다. 직접 INSERT였으면 조용히 통과했다.
- 좌석 재생성은 멱등이 아니다(비활성 좌석이 `seat_number` 부분 unique를 붙들고 있다) → 단계 선택 실행(`org` `people` `seats` `layout` `presence` `work`).
- 시딩 스크립트는 세션 스크래치패드에 있고 **저장소에 없다**. 다시 필요하면 재작성해야 한다 — 결정 근거는 여기에, 데이터는 `dev.db`에 남아 있다.

### 1B-2. 좌석 배치 편집기 재설계 (D37)

이 화면의 사용자는 CAD 경험 없는 총무 담당자다. 기존 화면은 내부 코드(`(D11)`/`(D12)`)와 DB enum(`free`/`available`/`deployed`)을 그대로 노출했고, 하단은 버전/상태/액션 표에 버튼만 있어 **순서도 의미도 화면에 없었다**. "변경하고 반영했는데 가상사무실에 안 나온다"는 신고가 여기서 나왔다.

- **도면 은유** — 사무실 경계만 종이색, 바깥은 셸 배경. 경계 크기는 `buildOfficeLayout`의 `dimensions` 규칙(최외곽+2m)과 **동일 계산**을 쓴다(갈리면 편집기와 반영 결과가 어긋난다). 1m 보조선 + 5m 주선 + `모눈 1칸 = 1m` 범례.
- **반영 = ① 안 만들기 → ② 안전 검사 → ③ 반영** 스테퍼. 대상은 "미반영 최신 안" 하나로 고정. **못 누르는 버튼에는 반드시 이유를 붙인다** — 이유 없이 회색인 버튼이 이 화면 최대의 벽이었다. D12 규칙(검증 통과 후에만 배포)은 그대로, 표현만 바뀌었다.
- 점유석의 **빨강 제거**(빨강은 오류 신호 → 사용 중 = 파랑). 좌석 96×64 3줄 카드 → 62×42 칩.
- 색·라벨은 `components/office/seatStyles.ts` 단일 정본. `SeatCanvas`에서 export하면 **konva가 서버 번들로 딸려온다** → 값만 담은 별도 모듈로 분리.

### 1B-3. 자리 주인 지정 (D38)

D37로 자리를 **놓는** 일은 끝났지만 **누구 자리인지**는 어디에서도 정할 수 없었다. `PUT /seat-assignments/{seat_id}`는 구현돼 있었으나 호출하는 화면이 없었고, 해제는 본인 반납(`POST .../release`)뿐이라 관리자가 남의 자리를 비울 방법이 없었다. `seat.assigned_user_id`는 시드 이후 **아무도 바꾸지 못하는 값**이었다.

- 지정·해제를 **한 엔드포인트**로(`user_id` nullable). 분기를 화면에 떠넘기면 그 분기가 곧 부분 실패 지점이 된다.
- **한 사람 = 한 자리** — 새 자리를 주면 서버가 이전 자리를 비운다(`employees.seat_number`가 단수라 두 자리를 허용하면 어느 쪽이 보일지가 조회 순서에 좌우된다). 화면이 **누르기 전에** 알린다.
- 대상은 같은 회사의 활성 사원만 — 아니면 404(존재 은닉). 같은 사원 재지정은 무변경(반복 저장이 이력을 불리지 않게).
- 부수 수리: `GET /seat-assignments`에 회사 필터가 없어 **타사 좌석 이력을 통째로 읽을 수 있었다**(부모 `seat` 조인으로 스코프).

### 1B-4. `company_id` 타입 드리프트 (0010) — 조직도가 계층을 못 만들던 원인

레거시 dev DB의 `org_group`·`office.company_id`가 `CHAR(32)`로 만들어져 값이 문자열 `'1'`이었다. SQLite는 `'1' == 1`을 통과시켜 **목록 필터는 멀쩡해 보였지만**, 파이썬으로 올라온 값은 `str`이라 단건 검사에서 깨졌다:

```python
assert_same_company(user, group.company_id)   # '1' != 1 → 404
```

실측 영향 — **부모를 지정한 `org_group` 생성이 전부 404**. 조직도 편집기에서 본부 아래 부서를 넣지 못하고 전부 최상위로만 생겼다. PUT/DELETE도 같은 이유로 404. Postgres는 `varchar = integer` 비교가 타입 에러라 조용히 넘어가지도 않는다.

- `batch_alter_table`로 재작성(SQLite에 ALTER COLUMN TYPE이 없다). 값은 먼저 정수로 정규화하고 숫자가 아닌 값은 기본 테넌트로 떨군다(NOT NULL을 깨지 않게).
- **회귀 테스트가 이 리비전의 유일한 실행 경로다.** 기존 체인 테스트는 `0001`이 `create_all`이라 어느 경로로 올라가도 이미 INTEGER → **0010을 한 번도 실행하지 않았다.** 드리프트는 체인으로 만들 수 없는 모양이므로 `sqlite_master`를 직접 고쳐 재현한다(테이블 재작성이 아니라 **선언만** 바꿔 인덱스·FK를 그대로 둔다 — 실제 드리프트 DB와 같은 모양이어야 재작성이 인덱스를 잃는지까지 검증된다).

### 1B-5. 팀 이름의 정본 = 조직도 (D39 · 0011)

`erp_user`는 팀을 **숫자로만** 들고 있고 팀 이름을 가진 테이블이 없었다. 그 공백을 화면마다 다르게 메웠다 — 직원명부는 프론트에 숫자↔이름 표를 **하드코딩**했고(시드 시절 이름에 멈춰 있어 "데이터팀장인데 소속은 디자인팀"으로 읽혔다), 조직도 그래프는 포기하고 `팀 #1`을 찍었다. **같은 화면 안에서** 좌측 트리는 `플랫폼개발팀`, 우측 그래프는 `팀 #1`이었다.

- **`org_group.erp_team_id`(nullable)** 신설. 새 `team` 테이블을 만들지 않은 이유: ERP 없는 회사(E3 native)에서도 조직도는 관리자가 직접 만들므로 별도 테이블은 그 회사에서 빈 채로 남아 **이중 관리**가 된다.
- **NULL 허용이 핵심** — 본부·파트는 팀이 아니다. NOT NULL이면 조직 계층이 곧 팀 목록이 돼 본부를 만들 수 없다. 유니크는 `(company_id, erp_team_id)`(NULL은 서로 구별되므로 팀 없는 계층은 얼마든지 공존).
- **팀 0은 400으로 거부** — E3 유저 생성의 "미배정" 센티널이라 그룹이 맡으면 소속 없는 사람 전원이 그 이름으로 뭉친다. (실제로 `경영지원본부`를 0에 이었다가 되돌렸다.)
- **이름 없는 팀은 번호를 그대로** — 서버가 `name: null`을 돌려주고 이름을 지어내지 않는다. 지어내면 화면이 "이름이 없다"와 "이름이 정말 그렇다"를 구별하지 못해 연결 안내를 띄울 수 없다. 그래프는 **점선**으로 표시. 미연결은 오류가 아니라 **경고**라 배포를 막지 않는다.
- **연결 해제는 `-1`** — `null`은 "이 필드 안 건드림"이라 해제를 표현할 수 없다(이름만 고치는 요청이 매핑을 날리면 안 된다).
- 조직도 편집기에 **수정 경로 신설** — 기존엔 생성만 가능해 만든 뒤 손댈 수 없었다. 자기 자손은 상위 후보에서 뺀다(고르게 두면 순환참조를 만들고 검증에서야 걸린다).
- 직원명부의 팀 선택지는 `/api/teams`가 아니라 **조직도**에서 만든다 — `/api/teams`는 사람이 있는 팀만 돌려줘서 **방금 만든 빈 팀에 첫 사람을 넣을 수 없다.**

**같은 병이 셸에도 있었다** — 오피스 필이 `HORIZON · 판교 HQ`를 하드코딩해 **어느 테넌트로 로그인해도 남의 간판이 걸렸다**(E5 화이트라벨 전체가 무의미해진다). `useBranding()`으로 교체하고 로고 없으면 브랜드명 첫 글자 모노그램.

**API 오류의 구조화 `detail` 통로**도 함께 열었다 — 코드만으로는 못 쓰는 안내가 있다("팀 1은 이미 **플랫폼개발팀**이 맡고 있습니다"의 그룹명은 서버만 안다). `detail`이 객체면 `{code, ...맥락}`으로 읽어 `ApiError.detail`에 싣는다. 배열은 제외(FastAPI 422는 필드 목록이지 맥락이 아니다). 문자열 `detail`은 지금까지대로 `code`로만 오므로 기존 호출부 무영향.

### 1B-6. presence 스키마 드리프트 (부수)

실시간 서버가 프레즌스를 밀어넣자 백엔드가 죽었다 — `IntegrityError: NOT NULL constraint failed: presence.office_id`. 모델은 nullable인데 dev.db의 `presence`만 구스키마 NOT NULL이었고, `office-demo` 같은 논리 키는 UUID가 아니라 `None`이 되므로 삽입이 실패한다.

**앞선 드리프트 검사가 컬럼 이름만 비교해 nullability 불일치를 놓쳤다.** 전수 재검사로 dev.db 6건을 찾아 재생성. `dev_qa.db`에 4건이 남아 있다(§5 참조).

---

## 2. 다음 작업

> **24-스펙 Phase 1~5가 모두 닫혔고 22 T0-1(멀티테넌시)도 종결됐다.** 남은 건 아래 곁가지와 별도 워크스트림이다.

### 🟠 P1
- **메일 발송 어댑터** — `tokens.set_password_url()`이 이미 링크 본문을 만든다. 발송 채널만 얹으면 셀프서비스 forgot-password(23 E9 = Phase 6 잔여)까지 같은 토큰 코드로 열린다. **SMTP / SES 중 무엇을 쓸지가 결정 사항**이라 착수 전 합의가 필요하다.
- **`dev_qa.db` nullability 드리프트 4건** — `meeting.duration_minutes` · `meeting_participant.invite_status` · `notice.category` · `published_at`. 전부 **DB=nullable / 모델=NOT NULL** 방향이라 삽입은 통과하지만(그래서 조용하다), 해당 테이블에 데이터가 있어 재생성에 보존 작업이 필요하다. dev.db 쪽은 종결(§1B-6).
- **드리프트 검사기를 nullability·타입까지** — 이번 하루에 같은 부류가 **두 번**(presence NOT NULL, company_id CHAR(32)) 터졌고 둘 다 컬럼 **이름만** 비교하는 검사를 통과했다. 검사를 스크립트로 고정해 두면 다음 pull에서 자동으로 잡힌다.
- **캔버스 씬 색 토큰화**(23 A8/A13) — `OfficeViewport2D`·`SeatCanvas`는 캔버스라 CSS 변수를 읽을 수 없다. 필요해지면 `getComputedStyle`로 한 번 읽어 렌더 컨텍스트에 주입하는 방식이 필요하다.

### 🟠 P1 — D39 후속 (팀 정본이 생기면서 열린 것)
- **`sync_users`가 ERP 팀 이름을 `org_group`에 반영하지 않는다.** `ErpTeamDTO`에는 `name`·`color`·`leader_name`이 이미 있고 `fetch_teams()`도 구현돼 있는데 아무도 호출하지 않는다. ERP 연동 회사는 지금도 관리자가 손으로 이어야 한다 — 동기화가 `erp_team_id` 기준으로 그룹을 만들거나 이름을 갱신하도록 이으면 된다. **덮어쓸지 말지가 결정 사항**(관리자가 고친 이름을 ERP가 되돌리면 안 된다).
- **조직도 그래프가 `org_group` 계층을 안 쓴다** — 좌측 트리는 본부/부서/파트 3단인데 그래프는 여전히 `회사 → 팀 → 사람` 2단이다. 이름은 D39로 맞췄지만 **구조는 아직 두 개**다. 그래프를 `parent_id` 체인으로 그리면 하나가 된다.
- **`team_zone`의 위치** — `erp_team_id ↔ org_group_id`를 잇는 테이블이 이미 있는데(구역 매핑용) D39가 `org_group`에 직접 이었다. 지금은 `team_zone`이 비어 있어 충돌이 없지만, 구역 기능을 켜기 전에 **어느 쪽이 매핑 정본인지** 정리해야 한다(권장: `team_zone`은 순수 구역 지오메트리로 좁히고 팀 식별은 `org_group`만).

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

**마이그레이션**: `0001`이 `create_all`이라 신규 배포는 그 경로가 정본. 후속 리비전은 기존 DB용 **멱등 ALTER**로 쓰고(존재 검사 가드), 체인 경로와 ALTER 경로를 **둘 다** 검증한다.

> ⚠ **0010에서 배운 것 — 체인 테스트는 ALTER 경로를 덮지 않는다.** `0001`이 최신 모델을 만들므로 "기존 DB만의 모양"(드리프트·구스키마)은 **체인으로 재현되지 않고**, 리비전은 존재 검사에서 그냥 건너뛴다. 즉 그 리비전은 어떤 테스트에서도 실행되지 않는다. 고치는 리비전을 쓸 때는 **그 모양을 손으로 만드는 테스트를 같이 쓴다** — SQLite면 `PRAGMA writable_schema`로 선언만 바꾸는 게 정석이다(테이블을 재작성해 버리면 인덱스·FK가 사라져 실제 드리프트 DB와 다른 모양이 된다).
>
> **유니크 제약은 경로마다 다른 물건으로 존재한다** — `create_all`은 `CREATE TABLE` 안의 `CONSTRAINT`, 마이그레이션은 `CREATE UNIQUE INDEX`(SQLite에 ALTER ADD CONSTRAINT가 없다). **존재 검사는 인덱스+제약을 둘 다 보고, DROP은 인덱스인 것만** 해야 한다. 안 그러면 downgrade가 `no such index`로 터진다(0011에서 체인 downgrade 테스트가 실제로 잡았다).

**"정본이 없으면 화면이 지어낸다"**(D39에서 확립): 어떤 값의 정본 테이블이 없으면 각 화면이 제 나름의 표를 만들고, 그 표들은 **반드시 서로 어긋난다**(직원명부 하드코딩 vs 그래프 `팀 #1` vs 셸 `HORIZON` 하드코딩 — 세 곳이 각자 달랐다). 새 표기값을 화면에 넣기 전에 **"이 값의 정본은 어디인가"**를 먼저 답한다. 정본이 없으면 만들고, 만들 수 없으면 **번호·ID를 날것으로 보여 준다**(지어낸 이름은 어긋난 채 남지만 날것은 이으면 사라진다).

**토큰 규율**(E4에서 확립, Phase 6이 재사용): 평문 미저장(sha256) · 단회성 · 재발급 시 이전 무효 · 상태는 파생 · 무효 사유 동일화.

---

## 4. 라이브 스택 상태 + 재현

- DB: `backend/dev.db`·`dev_qa.db` 둘 다 `0011_org_team`. `company_id` 타입 드리프트 0, dev.db nullability 드리프트 0(dev_qa 4건 잔여 — §2). `AUTO_CREATE_TABLES`는 false여도 된다.
- **dev.db = HORIZON 판교 HQ 데모**(인원 29 · 좌석 44 · 조직 13그룹, 팀 8개 연결 완료 · 레이아웃 v4 배포 · 브랜드명 설정됨). 빈 상태가 아니라 **굴러가는 회사 하나**다 — 화면을 실제처럼 보려면 이걸 쓰고, 첫실행 온보딩(E6)을 보려면 `/signup`으로 새 회사를 판다.
- 로그인: `alice@virtualoffice.local` / `password123`(company 1). 시딩된 신규 계정은 `{roman}@horizon.local` / `horizon2026!`.
- **서버 기동에 `DATABASE_URL`이 필수다** — 기본값이 postgres라 안 주면 `asyncpg` 없음으로 죽는다:
  `cd backend && DATABASE_URL="sqlite+aiosqlite:///./dev.db" INTERNAL_API_TOKEN=dev-internal-token-CHANGE-IN-PRODUCTION python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
- 검증 명령(백엔드): `cd backend && DATABASE_URL="sqlite+aiosqlite:///:memory:" python -m pytest -q` (~3분)
- 타겟 검증: `pytest tests/test_employees_crud.py tests/test_access_links.py tests/test_org_groups.py tests/test_tenant_isolation*.py tests/test_migrations.py -q`
- realtime: `cd realtime && npm test` (89 passed / 0 failed, ~30초)

---

## 5. 함정 / 주의 (gotchas)

- **⚠ ~~프론트도 Windows에서 실행 불가~~ → 2026-07-28에 반증됨**: `vitest`(56 passed)·`next build`(exit 0) 모두 Windows에서 정상 동작한다. 이 항목은 틀렸다. 다만 **`backend/.venv`가 WSL 전용인 것은 사실** — pytest·fastapi가 없어 Windows에서는 `python -m venv` + `pip install -r requirements.txt`로 새로 만들어야 한다(`asyncpg` 제외).
- **⚠ `PUBLIC_APP_URL`을 운영에서 반드시 설정**: E4 링크의 호스트는 백엔드가 아니라 **프론트** 주소다. 기본값 `http://localhost:3000`을 그대로 두면 사용자가 링크를 열 수 없다. `.env.example` 참조.
- **PowerShell로 한글 소스를 rewrite 금지**: `Get-Content | Set-Content`는 CP949로 읽고 UTF-8로 써서 한글 주석을 전부 깨뜨린다(이번 세션에 `consent.py`가 당해 `git checkout`으로 복구). 소스 편집은 반드시 편집 도구로.
- ~~**dev.db `office.company_id`가 `CHAR(32)` 레거시 타입**~~ → **0010에서 종결**(§1B-4). `org_group`도 같은 병이었고 그쪽은 잠복이 아니라 실제로 조직도를 망가뜨리고 있었다.
- **드리프트는 컬럼 이름만 보면 안 잡힌다**: 하루에 두 번 당했다 — `presence`의 nullability(삽입 실패), `company_id`의 타입(단건 검사 404). 둘 다 컬럼 이름 대조는 통과한다. **타입·nullable까지 비교**해야 한다.
- **백엔드 venv가 이 저장소에 없다**: `backend/.venv`는 WSL용이라 Windows에서 못 쓴다. 이번 세션 검증은 세션 스크래치패드의 임시 venv(`tvenv`)로 했고 **그건 세션과 함께 사라진다**. 다음 세션은 `python -m venv` + `pip install -r requirements.txt`로 새로 만들어야 한다(`asyncpg` 제외).
- **`asyncpg`는 Python 3.14 Windows 휠이 없다**(MSVC 요구). SQLite 테스트에는 불필요하므로 제외 설치 가능.
- **_html 미러 훅**: `docs/*.md` 편집 시 전역 PostToolUse 훅이 미러를 일괄 열화 재생성. 복구 = `git checkout -- docs/_html/` → `tools/docs-html`에서 `node generate.js` → 새 문서 미러만 스테이징.
- **pytest full ~3분**: 타겟 파일 지정으로 빠르게, full은 커밋 전에만.
- **커밋 메시지 백틱 금지**: bash `-m "…`토큰`…"`은 명령치환.

---

## 6. 진입점 (다음 세션 시작)

**먼저 할 일 (5분)**: 백엔드 venv 재생성(§5) → `DATABASE_URL` 붙여 서버 기동(§4) → `/admin/employees`·`/admin/org-chart`·`/office`가 HORIZON 데모로 뜨는지 확인. 이게 되면 어제 상태가 그대로 복원된 것이다.

**다음 후보**

| 후보 | 왜 지금 | 착수 조건 |
|---|---|---|
| **도그푸딩 계속** | 오늘 하루 이 방식으로만 결함 5건(D37·D38·D39·0010·presence)이 나왔다. 스펙 훑기보다 수율이 높았다. **아직 안 걸어 본 동선**: KPI 워크플로우 · 회의 예약→입장→회의록 · 공지 · 이의신청 · 설정 전반. | 없음 — 바로 시작 가능 |
| **메일 발송 어댑터** | `tokens.set_password_url()`이 이미 링크 본문을 만든다. 발송만 얹으면 E9 self-service가 같은 코드로 열린다. | **SMTP / SES 결정 필요** |
| **ERP 팀 동기화 ↔ org_group** | D39로 정본은 생겼지만 ERP 연동 회사는 여전히 손으로 잇는다(§2 P1). | **덮어쓰기 정책 결정 필요**(관리자 수정 vs ERP 값) |
| **관측성** | 22 Tier 1. 구조화 로깅·Sentry·`/ready`. | 없음 |
| **i18n** | C1, 한국어 1,695건. 재판매 전 조기 착수 권장 — **오늘 하루에만 한국어 문자열이 또 늘었다**(D37 용어 한국어화·D39 안내문). 늦출수록 비싸진다. | 없음 |
| **개인정보 팩** | 22 §3 동의 게이트·보존기간·열람/삭제. | 없음 |

> 🔎 **읽는 순서 제안**: 이 문서 §1B → `00-decisions.md` §R·S·T(D37~D39) → 실제 화면. 결정의 "왜"는 전부 00-decisions에 있고, 이 문서는 그날의 경위만 담는다.
