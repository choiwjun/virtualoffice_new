# 24 — 온보딩 + 화이트라벨 워크스트림 구현 SPEC (2026-07-24)

> **정본 위치**: `docs/planning/24-onboarding-whitelabel-workstream-spec.md`
> **부모 감사**: [`22-commercialization-gap-audit.md`](22-commercialization-gap-audit.md)(백엔드/멀티테넌시/SaaS 계층) · [`23-frontend-design-asset-commercialization-audit.md`](23-frontend-design-asset-commercialization-audit.md)(프론트/진입면/화이트라벨)
> **이 문서의 범위**: 22-doc의 **T0-1(멀티테넌시)·T0-4(SaaS 계층)** 위에, 23-doc의 **E2·E3·E4(온보딩 축)·E5(브랜딩)·E6(첫실행)·E9/E7(계정 셀프서비스)·A7/A1(CSS 변수 화이트라벨)** 를 얹는 **"도구 → 제품" 전환의 단일 백엔드+프론트 결합 워크스트림**.
> **이 문서가 아닌 것**: 과금/구독/미터링(T0-4 나머지)·SSO/SAML/OIDC/SCIM·i18n(23 C1)·실시간 스케일(T0-3)·컴플라이언스 팩(22 Tier 2)은 **별도 워크스트림**. 단, 여기서 세우는 `company_id` 정체성이 그 전부의 선행 토대다.
> **한 줄 결론**: 지금은 `company_id`가 3개 테이블(`ErpUser`·`OrgGroup`·`Office`)에만 **FK 없는 맨 INTEGER**로 박혀 있고, JWT·`CurrentUser`는 이를 실어 나르지 않으며, `company_id=1`이 하드코딩(`erp.py:27`)돼 있다. **정체성에 `company_id`를 심고(Phase 1) → 그 위에 프로비저닝·유저관리·화이트라벨·첫실행·계정을 얹는다(Phase 2~6).**

---

## 0. 선행 의존성 (READ FIRST — 모든 것이 Phase 1에 매달린다)

**Phase 1(company_id 정체성)은 이 워크스트림 전체의 하드 블로커다.** 나머지 5개 페이즈는 전부 "인증 주체가 자기 회사를 안다"는 전제 위에서만 성립한다.

```
                    ┌─────────────────────────────────────────────┐
                    │  Phase 1 — company_id 정체성 (BLOCKER, L)    │
                    │  Company 테이블 · JWT/CurrentUser.company_id  │
                    │  · 쿼리 스코프 강제(deps) · Alembic 마이그레이션 │
                    └───────────────┬─────────────────────────────┘
                                    │ (모든 페이즈가 company_id·CurrentUser·Company를 소비)
      ┌──────────────┬─────────────┼──────────────┬───────────────┐
      ▼              ▼             ▼              ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   ┌──────────┐
│ Phase 2  │  │ Phase 3  │  │ Phase 4  │  │ Phase 5  │   │ Phase 6  │
│ 프로비저닝  │─▶│ 유저 CRUD │  │ 화이트라벨 │  │ 첫실행    │   │ 비번찾기  │
│ +셀프가입  │  │ +팀 초대  │  │ (E5+A7)  │  │ 체크리스트 │   │ +계정탭   │
│ (E2, L)  │  │ (E3/E4,L)│  │ (E5,M)   │  │ (E6, M)  │   │ (E9/E7,M)│
└──────────┘  └────┬─────┘  └──────────┘  └────┬─────┘   └──────────┘
                   │  (초대 토큰 흐름 = Phase 6 비번설정 인프라 공유)       │
                   └───────────────────────────────────────────────────┘
```

**의존 규칙**:
- **Phase 2 ⟶ Phase 3**: 프로비저닝이 "첫 admin"을 만들어야 그 admin이 유저를 CRUD·초대한다. Phase 3의 초대 온보딩(비번설정)은 Phase 6의 토큰·비번설정 인프라와 **동일 코드**를 공유하므로, Phase 6의 토큰 서브시스템(§7.2)을 Phase 3와 함께 앞당겨 구현한다.
- **Phase 4(화이트라벨)** 는 Phase 1의 `Company` 테이블에 브랜딩 컬럼을 추가하는 것이므로 Phase 1 직후 병렬 착수 가능. 단 프론트 주입점(로그인/셸)은 Phase 2의 공개 라우트가 있어야 완성도가 산다.
- **Phase 5·6** 은 Phase 1~3 위에서 독립. 병렬 가능.
- **왜 company_id가 전제인가**: 프로비저닝은 "새 회사 row 생성 + company_id 발급", 유저 CRUD·초대는 "내 company_id 스코프 내에서만", 화이트라벨은 "company_id별 브랜딩 1세트", 첫실행 상태는 "company_id에 저장", 비번찾기 토큰은 "company_id 스코프 유저"에 매인다. `company_id` 없이는 두 번째 회사가 첫 회사의 데이터를 본다(22 T0-1의 IDOR).

**감사 근거(현 상태)**:
- `company_id`는 `ErpUser`(`tables.py:260`)·`OrgGroup`(`:342`)·`Office`(`:420`)에만 존재. **FK 없음**(`Integer`, 참조 무결성 미보장), `Company` 테이블 부재.
- `WorkLog`·`KpiResult`·`Report`·`ChatMessage`·`Presence`·`Meeting`·`Seat`·`Notice`·`AuditLog` 등 **fact/운영 테이블 전부 `company_id` 없음** → 회사 스코프 쿼리·인덱스 불가(22 T1-3).
- JWT 클레임: `sub·email·role·team_id`만(`auth.py:105-113`). `CurrentUser`: `user_id·email·role·team_id`만(`deps.py:26-32`) → **company_id 미탑재**.
- `erp.py:27` `DEFAULT_COMPANY_ID = 1` 하드코딩, `:9` 주석 "멀티테넌트는 완성 이후(Won't)".

---

## 페이즈 개요 · 시퀀싱 · 공수

| # | 페이즈 | 해소 감사 ID | 공수 | 선행 | 상태 |
|---|---|---|---|---|---|
| **1** | company_id 정체성 삽입 | 22 T0-1 · (부분) T1-3 | **L** | — | ✅ 2026-07-24 (1a~1c) · ✅ 2026-07-27 (1d 잔여: audit_log·room·floor·org_group·team·consent) |
| **2** | 테넌트 프로비저닝 + 셀프서브 가입 | 23 E2 · 22 T0-4(온보딩) | **L** | 1 | ✅ 2026-07-24 |
| **3** | admin 유저 CRUD + 팀 초대 | 23 E3 · E4 | **L** | 1, 2, (6.2 토큰) | ✅ 2026-07-27 (E4는 링크 방식 — D36) |
| **4** | 화이트라벨 (Company 브랜딩 + CSS 변수) | 23 E5 · A7 · A1 · A13 | **M** | 1 | ✅ 2026-07-27 |
| **5** | 첫실행 온보딩 체크리스트 + 투어 | 23 E6 | **M** | 1, 2, 3 | ✅ 2026-07-27 |
| **6** | 비번 찾기/변경 + 계정 설정 | 23 E9 · E7 · C11 | **M** | 1 | 🟡 부분 완료 — 토큰 인프라(§6.2)·비번 변경·관리자 발급 재설정은 Phase 3에서 종결. 잔여 = 셀프 forgot-password(메일 어댑터 전제) |

**권장 시퀀싱(직렬/병렬)**:
1. **Phase 1 단독 선행**(BLOCKER). 여기서 마이그레이션 규율(22 T0-2)까지 확립.
2. **Phase 1 완료 후**: `[Phase 2 + Phase 4]` 병렬 착수(프로비저닝 팀 / 화이트라벨 팀). **Phase 6.2 토큰 서브시스템**을 이 시점에 함께 착수(Phase 3 초대가 소비).
3. **Phase 2 완료 후**: `Phase 3`(유저 CRUD·초대) 착수 — 6.2 토큰 인프라 재사용.
4. **Phase 3 완료 후**: `[Phase 5 + Phase 6.1]` 병렬(첫실행 / 비번찾기·계정탭).
5. 총 임계경로: **1 → 2 → 3 → 5**. 4·6은 곁가지로 흡수.

---

## Phase 1 — 정체성에 company_id 삽입 〔22 T0-1 · 공수 L · BLOCKER〕

### 목표
`Company` 엔티티를 신설하고, **인증 주체(JWT·`CurrentUser`)가 자기 `company_id`를 실어 나르게** 한 뒤, **모든 테넌트 스코프 쿼리를 의존성으로 강제**한다. `company_id=1` 하드코딩을 제거한다. 이 페이즈가 끝나면 "두 번째 회사"를 안전하게 받을 수 있는 최소선이 선다.

### 데이터모델 변경 (`backend/app/models/tables.py` + Alembic)

**1-1. `Company` 테이블 신설** (모든 `company_id`의 참조 대상 = 단일 정본):

```python
class CompanyPlan(str, Enum):          # T0-4 과금은 별도 워크스트림이나 컬럼은 미리 심음
    TRIAL = "trial"
    STANDARD = "standard"
    ENTERPRISE = "enterprise"

class CompanyStatus(str, Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"            # 미납/정지
    DELETED = "deleted"               # soft

class Company(Base, TimestampMixin):
    __tablename__ = "company"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)          # 표시 회사명
    slug: Mapped[str] = mapped_column(String(63), nullable=False)           # URL/서브도메인 키 (소문자·하이픈)
    status: Mapped[CompanyStatus] = mapped_column(SQLEnum(CompanyStatus), nullable=False, default=CompanyStatus.ACTIVE, index=True)
    plan: Mapped[CompanyPlan] = mapped_column(SQLEnum(CompanyPlan), nullable=False, default=CompanyPlan.TRIAL)
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seat_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)   # None=무제한(내부/엔터프라이즈)
    # ── Phase 4 화이트라벨 필드 (여기 미리 선언, Phase 4에서 UI/주입 채움) ──
    brand_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)   # 셸/로그인 표시명 (None → name)
    logo_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)    # /media/branding/{company_id}/logo.*
    primary_color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # #RRGGBB
    accent_color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)
    __table_args__ = (
        UniqueConstraint("slug", name="uq_company_slug"),
        CheckConstraint("primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'", name="ck_company_primary_hex"),  # postgresql만; sqlite는 앱 검증
    )
```

**1-2. `company_id` FK 전수 부착 + 백필**. 기존 3개(`ErpUser`·`OrgGroup`·`Office`)는 `Integer` → `ForeignKey("company.id")` 로 승격. **누락 테이블에 `company_id` 추가**(22 T1-3 동반 해소):

| 테이블 | 현재 | 조치 |
|---|---|---|
| `ErpUser`·`OrgGroup`·`Office` | `Integer` (FK 없음) | `ForeignKey("company.id", ondelete="RESTRICT")` 로 승격 |
| `WorkLog`·`KpiResult`·`Report`·`Meeting`·`Seat`·`Notice`·`ChatMessage`·`Presence`·`BusinessTrip`·`AuditLog`·`DailyStatusPush`·`MeetingMinute`·`ActionItem`·`Asset`·`UserAvatar`·`UserIntegration`·`ErpSyncLog` | **없음** | `company_id: Mapped[int] = mapped_column(ForeignKey("company.id", ondelete="RESTRICT"), nullable=False, index=True)` 추가. 자식 테이블(`Floor`·`Room`·`Seat*History`·`MeetingParticipant` 등)은 부모 FK로 스코프 유도 가능하나, **직접 쿼리되는 fact 테이블은 반드시 자체 `company_id`** (풀스캔 방지) |
| 복합 인덱스 | — | 기간 롤업 대상(`WorkLog`·`KpiResult`·`Report`·`Presence`)에 `Index("idx_{t}_company_date", "company_id", "{date컬럼}")` (22 T1-3) |

**1-3. 마이그레이션(Alembic) — 3-스텝 백필 전략** (22 T0-2 규율 확립 동반):

- 현재 `alembic/`은 골격, 운영 스키마는 `create_all()` + `AUTO_CREATE_TABLES=true`(`main.py:23-27`, `config.py:34`) → **스키마 드리프트 확정 상태**. 이 페이즈에서 Alembic을 정본화한다.
- **Step A (additive)**: `company` 테이블 create + 기존 `id=1` 시드 row(`INSERT INTO company (id, name, slug, status, plan) VALUES (1, '기본 회사', 'default', 'active', 'enterprise')`). 신규 `company_id` 컬럼은 **먼저 `nullable=True`** 로 추가.
- **Step B (backfill)**: 모든 신규 `company_id`를 `1` 로 UPDATE (기존 단일 테넌트 데이터 = default company). `Integer` 3개는 FK 제약을 나중에 붙임.
- **Step C (constrain)**: `company_id` → `NOT NULL` + FK 제약 + 인덱스. `ErpUser`의 `uq_erp_user_company_email`(`tables.py:319`)은 이미 존재 — 유지.
- **롤아웃 가드**: 배포 파이프라인에 `alembic upgrade head` 단계 삽입, **`AUTO_CREATE_TABLES` 를 staging/prod에서 강제 false**(`config.py:34` 기본 false 유지 + `assert_production_safe`에 auto_create 금지 체크 추가 권장).

### API 계약 (인증 정체성 변경 — 시그니처가 핵심)

**1-4. JWT 클레임에 `company_id` 추가** (`auth.py:_build_token`):
```python
create_access_token({
    "sub": str(user.id), "email": user.email, "role": user.role.value,
    "team_id": user.erp_team_id,
    "company_id": user.company_id,          # ← 신규 클레임
}, expires_delta=...)
```

**1-5. `CurrentUser`에 `company_id` 필드** (`deps.py`):
```python
@dataclass
class CurrentUser:
    user_id: int
    company_id: int                          # ← 신규 (필수)
    email: Optional[str]
    role: str
    team_id: Optional[int] = None

async def get_current_user(token=Depends(oauth2_scheme)) -> CurrentUser:
    payload = decode_access_token(token)
    sub, role = payload.get("sub"), payload.get("role")
    company_id = payload.get("company_id")
    if sub is None or role is None or company_id is None:   # 구 토큰(company_id 없음) → 401 재로그인
        raise credentials_exc
    return CurrentUser(user_id=int(sub), company_id=int(company_id),
                       email=payload.get("email"), role=role, team_id=payload.get("team_id"))
```

**1-6. 스코프 강제 의존성** (`deps.py` — 신규, 모든 라우터가 소비할 단일 정본):
```python
def company_scope() -> Callable:
    """CurrentUser.company_id 를 반환하는 얇은 의존성. 라우터는 이 값으로 .where(Model.company_id == cid) 강제."""
    async def _dep(user: CurrentUser = Depends(get_current_user)) -> int:
        return user.company_id
    return _dep

def assert_same_company(user: CurrentUser, obj_company_id: int) -> None:
    """단건 조회 시 obj의 company_id ≠ user.company_id 면 404(존재 은닉). IDOR(22 T0-1) 차단."""
    if obj_company_id != user.company_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
```

**1-7. 라우터 전수 스코프 적용** (기계적·전 라우터):
- 목록 쿼리: `.where(Model.company_id == cid)` 를 **모든** `select(Model)` 에 강제(`work_logs`·`reports`·`kpi`·`meetings`·`seats`·`notices`·`office_layouts`·`chat`·`trips`·`presence`).
- 단건 조회: `assert_same_company(user, row.company_id)` 로 UUID 추측 IDOR 차단(22 T0-1의 meetings·seats 직접 열람/변조).
- `erp.py` `DEFAULT_COMPANY_ID = 1` 삭제 → `cid = Depends(company_scope())` 로 치환(`:78·:119·:140·:224`).
- 쓰기(INSERT): 신규 row 생성 시 `company_id=cid` 자동 주입(클라이언트 입력 금지 — 위조 방지).
- **실시간 경계(참고, 이 워크스트림 밖이나 명시)**: `realtime/`는 클라이언트가 주장한 room/company를 토큰 검증 없이 신뢰(22 T0-1·T1-10). 최소한 join 시 JWT `company_id` 클레임과 요청 room의 company 일치 검증을 후속 트랙에 남긴다.

### 프론트 화면
- `lib/auth.ts`: 로그인 응답의 토큰을 그대로 저장하므로 프론트 코드 변경은 **없음**(company_id는 서버가 클레임에 넣음). 단 `/api/auth/me` 응답 `UserInfo`에 `company_id` 추가 노출(Phase 4 브랜딩 fetch·Phase 5 첫실행 상태 조회가 소비).

### 마이그레이션·롤아웃 주의
- **구 토큰 무효화**: `company_id` 클레임 없는 기존 발급 토큰은 1-5에서 401 → 전원 재로그인. 무중단이 필요하면 배포 전 공지 or 만료(24h) 후 자연 소멸 대기.
- **RESTRICT 선택 이유**: 회사 삭제 시 fact가 캐스케이드 삭제되면 감사·평가 영구성(D18) 위반. 회사 삭제는 `status=deleted` soft만 허용.
- **인덱스 백필 부하**: Step C의 대형 테이블 인덱스 생성은 `CREATE INDEX CONCURRENTLY`(postgres) 고려.

### 완료 기준 (게이트)
- [ ] `Company` 테이블 존재 + `id=1` default 시드 + `slug` 유니크.
- [ ] fact 테이블 전부 `company_id NOT NULL` + FK + `(company_id, date)` 인덱스(대상 4종).
- [ ] JWT 디코드 시 `company_id` 클레임 존재, `CurrentUser.company_id` 채워짐.
- [ ] **교차 테넌트 IDOR 테스트**: company A 유저 토큰으로 company B의 meeting/seat/report UUID 조회 → **404**(라우터 전수). 이 테스트가 회귀 스위트에 상주.
- [ ] `grep DEFAULT_COMPANY_ID` → 0건.
- [ ] `alembic upgrade head` 로 클린 DB 재현 가능, `AUTO_CREATE_TABLES` prod 미사용.
- [ ] 백엔드 pytest green(기존 264+ pass 유지) + 신규 스코프 테스트.

---

## Phase 2 — 테넌트 프로비저닝 + 셀프서브 가입 〔23 E2 · 공수 L〕

### 목표
"회사 개설 → 첫 admin 발급" 흐름을 코드로 자동화한다(현재 전부 수동 DB 시드). 셀프서브 트라이얼 계정을 **즉시 발급**(즉시 로그인 가능)한다. PLG 진입로를 연다.

### 데이터모델 변경
- Phase 1의 `Company`(status/plan/trial_ends_at/seat_limit) 재사용, 신규 테이블 없음.
- 첫 admin은 `ErpUser`(role=`super_admin`, `company_id`=신규회사, `password_hash` 설정)로 생성. `ErpUser.id`는 현재 `BigInteger PK`(ERP 조인키). ERP 없이 자체 생성하는 유저는 **음수 or 예약 시퀀스 대역**을 쓰거나(ERP id와 충돌 방지), `ErpUser`에 `source: Mapped[str]`(`erp`|`native`) 컬럼을 추가해 native 유저를 별도 시퀀스로 발급(Phase 3와 공유하는 결정 — §3 참조).

### API 계약 (`backend/app/api/signup.py` — 신규 라우터, `prefix="/api"`, **미인증 공개**)

```python
POST /api/signup                          # 셀프서브 회사 개설 + 첫 admin (공개, rate-limited)
  body: { company_name: str, slug: str, admin_email: EmailStr,
          admin_name: str, admin_password: str, plan: "trial" = "trial" }
  201 → { company_id: int, access_token: str, expires_in: int, user: UserInfo }
  409 → slug/email 중복 | 422 → 약한 비번(≥10자 정책)
  # 트랜잭션: Company insert → 첫 admin ErpUser(super_admin) insert →
  #           기본 Office/Floor 1개 시드(office-layout 편집기 진입 가능하게) →
  #           trial이면 trial_ends_at = now + 14d, seat_limit=10 →
  #           즉시 JWT 발급(로그인 스텝 생략, 즉시 /office 진입)

POST /api/signup/check-slug               # 실시간 slug 가용성 (공개)
  body: { slug: str } → { available: bool, normalized: str }
```

- **레이트리밋**: `LoginRateLimitMiddleware`(`main.py:57`) 패턴 재사용 or IP당 회사개설 N/hour. 남용 방지.
- **트라이얼 즉시발급**: `plan="trial"` 이면 이메일 검증 스텝 없이 즉시 토큰(마찰 최소). 이메일 검증은 후속(가입 후 배너로 "이메일 확인" 유도). 정식 전환 시 검증 강제.
- **가입 이벤트 감사**: `AuditLog`에 `company.created`·`user.created(super_admin)` 기록.

### 프론트 화면 (23 E1 공개 진입면과 결합)
- **`app/signup/page.tsx`** (신규, 공개): 회사명·slug(실시간 체크)·admin 이메일/이름/비번 → `POST /api/signup` → 토큰 저장 → `/office` (또는 Phase 5 첫실행 체크리스트로).
- **`app/page.tsx`**: 현재 `redirect('/office')`(`page.tsx:4`). 공개 랜딩/CTA로 교체(또는 최소 로그인/가입 분기). 이 워크스트림에선 **가입 CTA·로그인 링크가 있는 최소 진입 페이지**까지만 필수(마케팅 랜딩 E1 풀버전은 별도).
- **`app/login/page.tsx`**: "회원가입" 링크 추가(`login/page.tsx:65` 부제 하단). placeholder `alice@virtualoffice.local`(`:91`)는 Phase 6/E13 정리 대상이나 여기서 중립화 겸수.

### 마이그레이션·롤아웃 주의
- **native 유저 id 충돌**: ERP 동기화가 켜진 회사에서 native 유저 id가 미래 ERP id와 충돌하면 대사(reconcile)가 깨진다. §3의 `source` 컬럼 + native 전용 시퀀스(예: `>= 1_000_000_000` 대역 or 별도 시퀀스)로 격리. **Phase 2·3 착수 전 이 결정을 확정**.
- **slug 정규화**: 소문자·영숫자·하이픈만, 예약어(`admin`·`api`·`www`) 블랙리스트.
- **seat_limit 게이트**: 트라이얼 10석 초과 유저 생성 시 Phase 3에서 402/409(업그레이드 유도). 과금 연결은 별도지만 카운트 게이트는 여기서.

### 완료 기준 (게이트)
- [ ] `POST /api/signup` 로 새 회사+admin 생성, 반환 토큰으로 즉시 `/api/auth/me` 200 + 올바른 `company_id`.
- [ ] 신규 회사의 admin이 **오직 자기 회사만** 조회(Phase 1 스코프와 결합 테스트).
- [ ] slug 중복 409, 약한 비번 422, 실시간 slug 체크 동작.
- [ ] 가입 직후 기본 Office/Floor 존재 → office-layout 편집기 진입 가능.
- [ ] 트라이얼 `trial_ends_at`·`seat_limit` 설정 확인.

---

## Phase 3 — admin 유저 CRUD + 팀 초대 〔23 E3 · E4 · 공수 L〕

> ✅ **완료 (2026-07-27)** — 구현 기록은 [handoff-session-2026-07-27.md](handoff-session-2026-07-27.md) §1-1·1-2.
> **단, E4는 메일 없는 링크 방식으로 재정의됐다([00-decisions.md D36](00-decisions.md)).** 아래 §"API 계약"의
> `Invitation` 테이블·`POST /api/invitations`·이메일 발송·재발송은 **폐기**되고, Phase 6의
> `PasswordResetToken`과 통합된 단일 `auth_token`(+`purpose`) + 관리자 발급 링크로 대체됐다.
> 실제 계약:
> ```
> POST   /api/employees                    유저 직접 생성 (source='native', initial_password 선택)
> PATCH  /api/employees/{id}                역할·팀·직책·근무형태·이름
> DELETE /api/employees/{id}                비활성(soft)      POST .../activate 재활성
> POST   /api/employees/{id}/access-link    비밀번호 설정 링크 발급 → { url, purpose, expires_at }
> DELETE /api/employees/{id}/access-link    링크 회수
> GET    /api/auth/set-password?token=      공개. 링크 유효성 + 대상·회사명
> POST   /api/auth/set-password             공개. 설정 → 즉시 로그인       (Phase 6 리셋과 동일 경로)
> POST   /api/auth/change-password          인증. 현재 비번 확인 후 변경    (Phase 6 §6.1 선반영)
> ```
> 이로써 **Phase 6의 토큰 서브시스템(§6.2)과 비번 변경은 여기서 함께 완료**됐다. Phase 6에 남은 것은
> 셀프서비스 `forgot-password`(메일 발송 어댑터가 전제)와 설정 "계정" 탭의 잔여 항목뿐이다.

### 목표
회사 admin이 **자기 회사 유저를 생성·비활성·역할변경**하고, **이메일 토큰 초대 → 최초 비번설정 온보딩**으로 팀을 데려온다. **ERP有 = sync(읽기전용) / ERP無 = 수동 CRUD** 이중 경로를 명시 분리(현재 `employees`는 읽기전용 ERP sync만, 생성 API 0 — 23 E3).

### 데이터모델 변경
- **`ErpUser`에 `source` 컬럼**(§2와 공유 결정): `Mapped[str]`(`erp`|`native`, default per context). ERP sync는 `source='erp'` 만 대사 대상으로 삼아 native 유저를 **덮어쓰거나 비활성화하지 않음**(ERP 하드삭제 감지 로직이 native를 오탐하지 않게). `erp/sync.py`의 대사 쿼리에 `.where(ErpUser.source == 'erp')` 추가.
- **`Invitation` 테이블 신설**(초대 토큰 — Phase 6.2 토큰 인프라와 스키마 공유 or 통합 `AuthToken` 테이블):

```python
class InvitationStatus(str, Enum):
    PENDING = "pending"; ACCEPTED = "accepted"; EXPIRED = "expired"; REVOKED = "revoked"

class Invitation(Base, TimestampMixin):
    __tablename__ = "invitation"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    company_id: Mapped[int] = mapped_column(ForeignKey("company.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[ErpRole] = mapped_column(SQLEnum(ErpRole), nullable=False, default=ErpRole.EMPLOYEE)
    erp_team_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)   # 초대 시 팀 지정(선택)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True) # sha256(token) — 평문 미저장
    status: Mapped[InvitationStatus] = mapped_column(SQLEnum(InvitationStatus), nullable=False, default=InvitationStatus.PENDING, index=True)
    invited_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("erp_user.id", ondelete="SET NULL"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)   # now + 7d
    accepted_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    __table_args__ = (Index("idx_invitation_company_status", "company_id", "status"),
                      Index("idx_invitation_token", "token_hash"))
```

### API 계약 (`backend/app/api/employees.py` 확장 or 신규 `admin_users.py`, `require_role("admin")`)

```python
# ── 유저 CRUD (수동 경로, ERP無) ──
POST   /api/employees                     # 유저 직접 생성 (source='native')
  body: { email, name, role, erp_team_id?, position?, send_invite: bool=false }
  201 → EmployeeOut  |  409 email 중복  |  402/409 seat_limit 초과
  # send_invite=true 면 Invitation 생성 + 이메일 발송(§3 초대 흐름), password_hash 미설정
  # send_invite=false 면 password_hash None(로그인 불가) 상태로 디렉터리에만 등재
PATCH  /api/employees/{id}                # 역할변경·직책·팀 이동 (native·erp 공통, 단 erp 필드는 sync가 정본)
  body: { role?, erp_team_id?, position?, work_type? } → EmployeeOut
DELETE /api/employees/{id}                # 비활성 (soft, is_active=false) — 물리삭제 금지(D18)
  204  |  409 본인 super_admin 최후 1인 비활성 차단

# ── 팀 초대 (E4) ──
POST   /api/invitations                   # 이메일 초대 발송 (admin)
  body: { email, role, erp_team_id? } → { id, email, status, expires_at }
  # token 생성 → token_hash 저장 → 이메일에 /accept-invite?token=... 링크
GET    /api/invitations                   # 대기중 초대 목록 (company 스코프)
DELETE /api/invitations/{id}              # 초대 회수 (status=revoked)
POST   /api/invitations/resend/{id}       # 재발송 (새 토큰·만료 갱신)

# ── 초대 수락 (공개, 최초 비번설정 = Phase 6.2 인프라 공유) ──
GET    /api/invitations/accept?token=...  # 토큰 검증 → { valid, company_name, email, role } (미인증 공개)
POST   /api/invitations/accept            # 비번 설정 → ErpUser 생성/활성화 → 즉시 로그인 토큰
  body: { token, password, name? }
  200 → { access_token, expires_in, user }  |  410 만료/사용됨
```

- **ERP有 vs ERP無 이중 경로(23 E3·E12)**:
  - **ERP有**: `POST /api/erp/sync`(`erp.py:129`) 가 정본. UI는 "ERP 연동(읽기전용)" 표기, native 생성 버튼은 비활성/경고.
  - **ERP無**(Mock reader): admin이 `POST /api/employees` 로 직접 생성 + 초대. UI에서 "직접 관리" 모드로 명시(E12 오해 해소).
  - `source` 컬럼으로 두 경로를 데이터에서 분리. sync는 `source='erp'`만 건드림.
- **이메일 발송**: 발송 어댑터(`app/services/mailer.py` 신규) — 개발/미설정 시 콘솔 로그 폴백(초대 링크 출력), 운영은 SMTP/SES. **미설정 시 조용한 no-op 금지**(22 F4 교훈 — 발송 실패 시 초대 status를 pending 유지 + admin에게 배너).
- **seat_limit 게이트**: 생성/수락 시 `active user count >= company.seat_limit` → 409(업그레이드 유도, Phase 2 트라이얼과 연결).

### 프론트 화면
- **`app/(protected)/admin/employees/page.tsx`**(현재 읽기전용 `employees:170·438` — 23 E3): "유저 추가" 버튼 → 생성 모달(이메일·이름·역할·팀, "초대 발송" 체크박스). 행 액션: 역할 드롭다운·비활성 토글. **ERP有 회사는 편집 잠금 + "ERP에서 관리됨" 배지**(E12).
- **`app/(protected)/admin/employees/invitations` 섹션**(or 탭): 대기 초대 목록·회수·재발송.
- **`app/accept-invite/page.tsx`**(신규, 공개): 토큰 검증 → 이름·비번 설정 폼 → 즉시 로그인 → `/office`(+ Phase 5 첫실행). 만료 토큰은 "관리자에게 재발송 요청" 안내.
- 파괴적 확인(비활성)은 native `confirm` 금지, 공용 `ConfirmDialog`(23 C2, `ScoreNoteModal` 모범) 사용 권장.

### 마이그레이션·롤아웃 주의
- **native/erp id 대역 분리**(§2 결정) — 이 페이즈의 하드 전제. 미결정 시 착수 금지.
- **토큰 보안**: 초대·비번설정 토큰은 **평문 미저장**(sha256 해시), 단회성(수락 시 status 전이), 만료 7d, 회수 가능.
- **최후 admin 보호**: 마지막 `super_admin` 비활성/역할강등 차단(자기 회사 잠금 방지).

### 완료 기준 (게이트)
- [ ] admin이 native 유저 생성 → 초대 발송 → 수락 링크로 비번설정 → 로그인 성공(E2E).
- [ ] 생성/수정/비활성이 **자기 company_id 스코프**에서만(교차 테넌트 403/404).
- [ ] ERP sync가 native 유저를 비활성화·덮어쓰지 않음(`source` 격리 테스트).
- [ ] seat_limit 초과 생성 409.
- [ ] 초대 토큰: 만료·재사용·회수 각각 410/차단. 평문 토큰 DB 미저장 확인.
- [ ] 최후 super_admin 비활성 409.

---

## Phase 4 — 화이트라벨 (Company 브랜딩 + CSS 변수 토큰) 〔23 E5 · A7 · A1 · A13 · 공수 M〕

> ✅ **완료 (2026-07-27)** — 구현 기록은 [handoff-session-2026-07-27.md](handoff-session-2026-07-27.md) §1-5.
> **아래 §4-3의 주입 예시는 이 코드베이스에서 틀리다.** `globals.css` 토큰은 hex가 아니라
> **RGB 채널**(`59 91 254`)로 정의돼 있고 Tailwind가 `rgb(var(--x) / <alpha-value>)`로 참조한다
> (불투명도 유틸 `bg-primary/20`을 살리기 위한 구조). hex를 그대로 `setProperty` 하면 **모든 색
> 유틸이 조용히 깨진다** → `lib/branding.ts`의 `hexToChannels()`로 변환해 주입한다.
> 실제 계약:
> ```
> GET    /api/branding          인증. { company_id, company_name, brand_name, logo_url, primary_color, accent_color }
> GET    /api/branding/public   미인증. ?slug= → { brand_name, logo_url, primary_color }
> PUT    /api/branding          admin. 미지정=유지 / 빈 문자열=기본값 복귀
> POST   /api/branding/logo     admin. multipart — **매직바이트 판정**(content_type 불신)
> DELETE /api/branding/logo     admin.
> ```
> 덮어쓰는 변수는 `--color-primary`·`--color-primary-hover`(primary에서 파생)·`--color-accent-cyan`
> **3개뿐**이다. 서피스·텍스트는 고정이라 어떤 브랜드 색에도 본문 대비(23 A11)가 유지된다.

### 목표
테넌트 브랜드 교체를 **"CSS 변수 1세트 플립"** 으로 만든다. 백엔드 `Company` 브랜딩 필드(Phase 1에서 선언) + 프론트 `:root --color-*` 변수 레이어 + admin 브랜딩 UI + 셸/로그인 주입점. "VirtualOffice" 하드코딩(`login:63`·`OfficeShell:1145`)과 hex 산재(`tailwind.config.js`·인라인 `style`)를 걷어낸다.

### 데이터모델 변경
- Phase 1의 `Company.brand_name·logo_url·primary_color·accent_color` 재사용. 로고 업로드 저장: `media_root/branding/{company_id}/logo.{ext}` → `/media/branding/...`(기존 `/media` 마운트 `main.py:66` 재사용). 매직바이트 검증(Pillow, 22 T1-12 교훈) + nosniff.

### API 계약 (`backend/app/api/branding.py` — 신규)
```python
GET  /api/branding                        # 현재 회사 브랜딩 (인증 유저 — 셸/설정이 소비)
  → { brand_name, logo_url, primary_color, accent_color, company_name }
GET  /api/branding/public?slug=...        # 로그인 화면용 (미인증 공개, slug로 회사 브랜딩 pre-fetch)
  → { brand_name, logo_url, primary_color }   # 로그인 전 브랜드 표시
PUT  /api/branding                        # 브랜딩 수정 (admin)
  body: { brand_name?, primary_color?, accent_color? }  → 갱신된 브랜딩
POST /api/branding/logo                   # 로고 업로드 (admin, multipart) → { logo_url }
  # content_type만 신뢰 금지 → Pillow verify + 크기 상한
```

### 프론트 화면 (CSS 변수화 = A7/A1의 핵심)

**4-1. `:root` CSS 변수 레이어 신설**(`globals.css` — 현재 색 변수 0, 23 A7):
```css
:root {
  --color-bg-base: #0E1626; --color-bg-surface: #161F32; --color-bg-surface-raised: #1E2940;
  --color-border-subtle: #273350;
  --color-primary: #3B5BFE; --color-primary-hover: #2F4BE0; --color-accent: #38BDF8;
  --color-text-primary: #F1F5F9; --color-text-secondary: #B4C0D3; --color-text-muted: #7A899E;
  /* 상태색은 시맨틱 고정(테넌트 override 안 함) */
}
```

**4-2. Tailwind가 `var()` 참조**(`tailwind.config.js:11-33` — 현재 hex 직접):
```js
colors: {
  'bg-base': 'var(--color-bg-base)', 'bg-surface': 'var(--color-bg-surface)',
  primary: 'var(--color-primary)', 'primary-hover': 'var(--color-primary-hover)',
  'accent-cyan': 'var(--color-accent)', 'text-primary': 'var(--color-text-primary)', /* … */
}
```
- 클래스명 불변 → 페이지 코드 변경 없이 값만 변수화. `OfficeShell.tsx`의 인라인 `style={{ background: '#161F32' }}`(`:1140`)·`T1B` 웜블랙 하드코딩(23 A1)·`KpiGauge`/`MeetingStage` 원오프 SVG 색(23 A13)은 `var(--color-*)`/`currentColor`로 순차 치환(전량 아니어도 브랜드 영향 표면 우선).

**4-3. 테넌트 override 주입**(단일 진입점 — `(protected)/layout.tsx` or `OfficeShell` 마운트 시):
```tsx
// 로그인 후: GET /api/branding → 응답 primary_color 있으면 document.documentElement.style.setProperty
useEffect(() => {
  fetch('/api/branding').then(r=>r.json()).then(b => {
    if (b.primary_color) document.documentElement.style.setProperty('--color-primary', b.primary_color);
    if (b.accent_color)  document.documentElement.style.setProperty('--color-accent', b.accent_color);
  });
}, []);
```
- **테넌트 override = 변수 1세트**(`--color-primary`·`--color-accent`만 override, 나머지 다크 서피스는 고정 → 대비 붕괴 방지). FOUC 방지: 초기값은 `:root` 기본 → fetch 후 덮어쓰기(깜빡임 최소, 또는 SSR/쿠키 프리로드는 후속).

**4-4. 브랜드명·로고 주입점**:
- `login/page.tsx:62-63`(🏢·"VirtualOffice") → `GET /api/branding/public?slug` 로 `brand_name`·`logo_url` 렌더(slug는 서브도메인/쿼리에서). 없으면 중립 기본.
- `OfficeShell.tsx:1145-1146`("VirtualOffice"/"가상 오피스") → 브랜딩 컨텍스트의 `brand_name`.
- **admin 브랜딩 UI**: `app/(protected)/admin/branding/page.tsx`(신규) — 회사명·primary/accent 컬러피커·로고 업로드 + 라이브 프리뷰.

### 마이그레이션·롤아웃 주의
- **대비 안전**: 테넌트가 primary를 밝은 색으로 바꿔도 텍스트/서피스는 고정이라 WCAG 대비(23 A11) 유지. primary는 버튼/액센트에만 → 위험 최소.
- **hex 산재 전량 치환은 L**(23 A7 원 규모). 이 페이즈는 **브랜드 체감 표면(로고·회사명·primary 버튼·액센트)** 우선, 잔여 hex는 부채로 명시(23 A8/A13와 함께 후속).
- **로고 보안**: 22 T1-12(매직바이트·nosniff) 준수, 회사 네임스페이스 경로로 열거 방지.

### 완료 기준 (게이트)
- [ ] `:root --color-*` 존재, Tailwind가 `var()` 참조, 기존 화면 시각 회귀 없음.
- [ ] admin이 primary 색·회사명·로고 변경 → 셸/로그인에 즉시 반영(재로그인 불필요).
- [ ] 두 회사가 서로 다른 브랜드로 동시 표시(테넌트 격리).
- [ ] 로고 업로드 매직바이트 검증 + `/media/branding/{company_id}/` 네임스페이스.
- [ ] `grep "VirtualOffice"` 하드코딩 → 브랜딩 컨텍스트 경유로 대체(로그인·셸).

---

## Phase 5 — 첫실행 온보딩 체크리스트 + 최초 투어 〔23 E6 · 공수 M〕

> ✅ **완료 (2026-07-27)** — 구현 기록은 [handoff-session-2026-07-27.md](handoff-session-2026-07-27.md) §1-6.
> 아래 §데이터모델의 `Company.onboarding_state` JSONB 대신 **두 개의 boolean**을 썼다:
> `company.onboarding_dismissed`(회사 단위) · `erp_user.tour_completed`(유저 단위). 저장하는 값이
> 두 개뿐이라 JSON 블롭을 파싱할 이유가 없고, 컬럼이면 인덱싱·쿼리가 자연스럽다.
> 체크리스트 항목은 스펙 권고대로 **저장하지 않고 실측 파생**한다:
> ```
> seat_placed   = 회사 좌석 수 > 0
> notice_posted = 회사의 **살아있는**(is_active) 공지 수 > 0   ← 공지 삭제는 soft-delete(D18)
> team_invited  = 활성 멤버 > 1  또는  발급된 초대 링크 존재(E4 auth_token)
> ```
> `notice`의 `is_active` 필터가 없으면 "지웠는데도 완료"로 남아 실측 파생의 의미가 사라진다
> (라이브 스모크에서 실제로 걸려 수정).

### 목표
새 admin의 첫 5분을 성공 경험으로. **3단계 셋업 체크리스트 위젯(좌석 배치 → 공지 작성 → 팀 초대)** + **최초 1회 제품 투어**. 완료 상태를 회사 단위로 저장.

### 데이터모델 변경
- **회사 단위 온보딩 상태**: `Company`에 `onboarding_state: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)` 추가(경량, 별도 테이블 불필요). 예: `{ "seat_placed": true, "notice_posted": false, "team_invited": false, "dismissed": false, "tour_done_users": [12,15] }`.
- **투어 완료(유저 단위)**: 유저별 "투어 봤음"은 회사 상태의 `tour_done_users` 배열 or `UserAvatar`/settings에 `tour_completed: bool`. 유저 단위가 자연스러우면 `ErpUser`에 `onboarding_flags: Mapped[Optional[dict]]` 경량 컬럼. **결정: 체크리스트=회사 단위(admin 공유), 투어=유저 단위.**

### API 계약 (`backend/app/api/onboarding.py` — 신규)
```python
GET  /api/onboarding                       # 첫실행 상태 (인증 유저)
  → { checklist: { seat_placed, notice_posted, team_invited }, dismissed, tour_done: bool }
  # checklist 항목은 실측 파생 권장: seat 배치수>0 / notice 존재 / invitation 발송 존재 →
  #   저장 플래그보다 실제 데이터 조회로 진위 판단(스테일 방지). dismissed·tour_done만 저장.
PATCH /api/onboarding                       # dismiss·tour 완료 마킹
  body: { dismissed?: bool, tour_done?: bool }  → 갱신 상태
```
- **checklist 진위 = 실측 파생** 권장: `seat_placed = (deployed layout에 좌석 배치 존재)`, `notice_posted = (company notice count > 0)`, `team_invited = (invitation or native user count > 1)`. 저장 플래그만 믿으면 스테일. `dismissed`·`tour_done`만 명시 저장.

### 프론트 화면
- **첫실행 체크리스트 위젯**: `/office` 진입 시(또는 대시보드) admin에게 3단계 카드. 각 항목 미완이면 CTA(→ `/admin/office-layout` / `/admin/notices` / `/admin/employees` 초대). 전부 완료 or dismiss 시 숨김. 상태: `GET /api/onboarding`.
  - 좌석 배치 = office-layout 편집기(이미 깊음, 23 E 판정 "present 깊음")로 유도.
  - 공지 = notices CRUD(present)로 유도.
  - 팀 초대 = Phase 3 초대 흐름으로 유도.
- **최초 1회 투어**: 셸 핵심 4~5 지점 스포트라이트(가상오피스·⌘K 팔레트·프레즌스 패널·admin 메뉴). `tour_done` 유저 단위 저장, 1회만. 라이브러리 최소(자체 오버레이 or 경량 tour lib), reduced-motion 존중(23 A9).
- 위치: `components/OnboardingChecklist.tsx`(신규), `OfficeShell` 마운트 시 조건부.

### 마이그레이션·롤아웃 주의
- **admin 전용 노출**: 체크리스트는 admin/super_admin만(일반 유저에겐 무의미). 투어는 전원 1회.
- **기존 회사(default)**: `onboarding_state` NULL → 이미 셋업된 회사는 "실측 파생"이 대부분 true → 체크리스트 자동 숨김(스테일 유도 없음).

### 완료 기준 (게이트)
- [ ] 새 admin 첫 진입 시 3단계 체크리스트 표시, 각 CTA가 올바른 화면으로.
- [ ] 항목 완료 시 실측 파생으로 자동 체크(예: 좌석 배치 후 재방문 → seat_placed=true).
- [ ] dismiss·tour 완료가 회사/유저 단위로 영속(재로그인 후에도 유지).
- [ ] 이미 셋업된 default 회사는 체크리스트 미노출(스테일 없음).

---

## Phase 6 — 비번 찾기/변경 + 계정 설정 〔23 E9 · E7 · C11 · 공수 M〕

### 목표
`forgot-password` 토큰 흐름 + 설정 "계정" 탭(비번 변경·이메일 확인). **Phase 3 초대와 토큰 인프라를 공유**(6.2). 분실 시 admin/DB 개입 제거.

### 데이터모델 변경 (6.2 — 토큰 서브시스템, Phase 3보다 먼저 착수)
- **`PasswordResetToken` 테이블**(or 통합 `AuthToken`으로 Invitation과 공유):
```python
class PasswordResetToken(Base):
    __tablename__ = "password_reset_token"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("erp_user.id", ondelete="CASCADE"), nullable=False, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("company.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)  # sha256, 평문 미저장
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)  # now + 1h
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
```
- **결정 권장**: `Invitation`·`PasswordResetToken` 를 공통 `token_hash`/`expires_at`/`used_at` 패턴으로 통일(같은 mailer·같은 검증 헬퍼 `app/services/tokens.py`). 초대(=최초 비번설정)와 리셋(=재설정)은 동일 "비번 설정" 화면을 공유.

### API 계약 (`backend/app/api/auth.py` 확장)
```python
POST /api/auth/forgot-password             # 공개. 이메일 → 리셋 토큰 발송
  body: { email }  → 200 항상 (유저 존재 여부 미노출 — 열거 방지, 22 T1-11 정신)
  # 유저 존재 시에만 실제 발송, 응답은 항상 동일. rate-limited.
POST /api/auth/reset-password              # 공개. 토큰 + 새 비번
  body: { token, password }  → 200 { ok }  |  410 만료/사용됨  |  422 약한 비번
GET  /api/auth/reset-password?token=...    # 토큰 유효성 사전 확인 → { valid }
POST /api/auth/change-password             # 인증. 현재 비번 + 새 비번
  body: { current_password, new_password }  → 200  |  401 현재 비번 불일치
```
- **비번 정책**: ≥10자(가입·초대·리셋·변경 공통 상수). bcrypt 재사용(`security.py:hash_password`).
- **열거 방지**: `forgot-password`는 유저 유무와 무관하게 200 + 동일 지연(22 T1-11의 타이밍 열거 정신 준수).

### 프론트 화면
- **`app/forgot-password/page.tsx`**(공개): 이메일 입력 → "메일 발송됨" 안내(항상 동일 문구).
- **`app/reset-password/page.tsx`**(공개): 토큰(쿼리) 검증 → 새 비번 설정 → 로그인 유도. **초대 수락(Phase 3)과 동일 컴포넌트 재사용**.
- **`login/page.tsx`**: "비밀번호를 잊으셨나요?" 링크(현재 없음 — 23 C11) + "로그인 유지"(remember-me, 선택).
- **설정 "계정" 탭**: `app/(protected)/settings/page.tsx`(현재 아바타 전용 — 23 E7) 에 "계정" 탭 추가 → 비번 변경 폼(`change-password`)·이메일 표시·(선택) 세션/알림. Phase 4 브랜딩 탭과 admin 설정 구조 정합.

### 마이그레이션·롤아웃 주의
- **토큰 단회성·해시저장**(Phase 3와 동일 규율): 평문 미저장, 사용 시 `used_at`, 만료 1h(리셋)/7d(초대).
- **company_id 스코프**: 리셋 토큰은 유저의 company_id를 담아 발급 → 리셋 후 발급 토큰에 올바른 company_id(Phase 1).
- **레이트리밋**: `forgot-password`·`reset` 남용 방지(IP·이메일 기준).

### 완료 기준 (게이트)
- [ ] forgot → 메일(개발=콘솔) 토큰 → reset → 새 비번 로그인 성공(E2E).
- [ ] 로그인 화면 "비번 찾기" 링크 동작.
- [ ] 설정 "계정" 탭에서 현재 비번 확인 후 변경 성공, 오답 401.
- [ ] `forgot-password` 응답이 유저 유무를 노출하지 않음(항상 200 동일).
- [ ] 토큰 만료/재사용 410, 평문 토큰 DB 미저장.

---

## 부록 A — 신규/변경 파일 매니페스트 (빌더 착수용)

**백엔드**:
- `models/tables.py`: `Company`·`Invitation`·`PasswordResetToken` 추가, `company_id` FK 전수 부착, `ErpUser.source`·`Company.onboarding_state` 컬럼.
- `alembic/versions/*`: Phase 1 3-스텝 마이그레이션(A/B/C), 이후 페이즈별 additive.
- `core/deps.py`: `CurrentUser.company_id`, `get_current_user`, `company_scope()`, `assert_same_company()`.
- `api/auth.py`: `_build_token` company_id 클레임, forgot/reset/change-password.
- `api/signup.py`(신규)·`api/branding.py`(신규)·`api/onboarding.py`(신규)·`api/employees.py`(확장: CRUD)·`api/invitations.py`(신규).
- `services/mailer.py`(신규, 콘솔 폴백)·`services/tokens.py`(신규, sha256 토큰 헬퍼).
- `main.py`: 신규 라우터 등록, `AUTO_CREATE_TABLES` prod 가드.
- 라우터 전수(`work_logs`·`reports`·`kpi`·`meetings`·`seats`·`notices`·`chat`·`trips`·`presence`·`office_layouts`·`erp`): company 스코프 `.where` 삽입.

**프론트**:
- `app/page.tsx`(공개 진입)·`app/signup/`·`app/accept-invite/`·`app/forgot-password/`·`app/reset-password/`(신규 공개 라우트).
- `app/globals.css`(`:root --color-*`)·`tailwind.config.js`(`var()` 참조).
- `components/OnboardingChecklist.tsx`(신규)·브랜딩 컨텍스트/훅.
- `app/(protected)/admin/branding/page.tsx`(신규)·`admin/employees/page.tsx`(CRUD·초대)·`settings/page.tsx`("계정" 탭).
- `app/login/page.tsx`(브랜딩 주입·가입/비번찾기 링크)·`components/OfficeShell.tsx`(브랜드명 주입점).

## 부록 B — 22/23 doc 매핑 표

| 이 문서 페이즈 | 해소하는 22-doc ID | 해소하는 23-doc ID | 남는 것(별도 워크스트림) |
|---|---|---|---|
| **P1 company_id 정체성** | **T0-1**(멀티테넌시 전체) · **T1-3**(부분: fact 테이블 company_id·인덱스) · **T0-2**(마이그레이션 규율 확립) | (기반 — E2~E9 전부의 전제) | T0-3(실시간 스케일) · 실시간 room=company 토큰검증(T0-1·T1-10 잔여) |
| **P2 프로비저닝 + 셀프가입** | **T0-4**(셀프서브 온보딩 부분) | **E2**(셀프서브 가입/트라이얼) · E1(부분: 공개 진입) · E13(부분) | T0-4 과금/구독/미터링/Stripe · SSO/SAML/OIDC/SCIM · E1 마케팅 랜딩 풀버전 |
| **P3 유저 CRUD + 초대** | T0-4(테넌트 셀프 관리 부분) | **E3**(admin 유저 CRUD) · **E4**(팀 초대) · E12(ERP有/無 모드 명시) | SCIM 자동 프로비저닝 · E10(사용량 대시보드) |
| **P4 화이트라벨** | T0-4(테넌트 브랜딩) | **E5**(브랜딩 UI) · **A7**(CSS 변수 화이트라벨) · **A1**(부분: 토큰 변수화) · A13(부분: SVG 색) | A1 전량 hex 치환·A8 셸 분해(부채) · i18n(C1) |
| **P5 첫실행 온보딩** | — | **E6**(체크리스트+투어) | E14(인앱 헬프) · E8(리치 데모 시드) |
| **P6 비번찾기 + 계정** | — | **E9**(비번찾기/변경) · **E7**(계정 설정 탭) · C11(부분: forgot·remember-me) | E11(동의/약관 게이트 — 22 C1 컴플라이언스 팩) |

> **다음 단계**: 본 SPEC을 `/tasks-generator`에 투입 → Phase 1을 단독 임계경로로 두고 06-tasks.md 생성. Phase 1의 교차 테넌트 IDOR 테스트를 08-derived-gates.md의 최우선 게이트로 승격 권장.
