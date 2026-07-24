# Handoff — 상용화 고도화 세션 (2026-07-24)

> **한 줄 상태**: 감사(22/23/24) → F2 상용 UX 품질 + F1 멀티테넌시(정체성→IDOR 스코핑→셀프 프로비저닝)를 **test-gated로 구현·라이브 검증·커밋·푸시** 완료. 다음은 **E3/E4 유저관리·초대 → E5 화이트라벨 UI**.
> 정본 감사: [22 백엔드/SaaS](22-commercialization-gap-audit.md) · [23 프론트/에셋/UX](23-frontend-design-asset-commercialization-audit.md) · [24 온보딩·화이트라벨 스펙](24-onboarding-whitelabel-workstream-spec.md). 진행 요약 메모리=`commercialization-audit-roadmap`.

---

## 1. 이번 세션 완료 (푸시됨, origin/main)

| 커밋 | 내용 | 검증 |
|---|---|---|
| `56fc732` | 감사 문서 23(프론트/에셋/UX) + 24(온보딩 스펙) | — |
| `14cab2f` | F0: 아바타 모션 부활·Pretendard 로딩·로그인 placeholder | 브라우저 computed-style·document.fonts |
| `6ff5969` | F0: `seed_demo.py` 리치 데모(20명·KPI140·회의·공지…) | 직원명부 28명 렌더 |
| `25d5f77` | UX 프리미티브: `Modal`·`FeedbackProvider`(Toast/Confirm) | ConfirmDialog 실화면 |
| `7fcf7dd` | 8페이지 native alert/confirm/prompt → 토스트·확인 + a11y | tsc 0 |
| `ce743ac` | D1 실시간 `/office` 게이팅 + E1 공개 랜딩 | 상태칩·랜딩 실화면 |
| `5652907` | 디자인 토큰 CSS 변수화(화이트라벨 1-플립 기반) | 렌더 불변 + 플립 실측 |
| `205b861` | Button + Field 프리미티브(A5/C9) | tsc 0 |
| `979e4df` | 로그인 다크 재설계 + 프리미티브 채택 | 실화면 |
| `802e618` | **F1 1a** Company + company_id 정체성(JWT/CurrentUser·마이그 0002) | pytest 372 |
| `8031649` | **F1 1b** meetings·seats IDOR 스코핑(마이그 0003) | 격리 11 + full 383 |
| `fe159d6` | **F1 1c** work_log·kpi·report·notice·chat·presence 스코핑(마이그 0004) | 격리 20 + full 403 |
| `4558729` | **E2** `POST /api/auth/register` 셀프 프로비저닝 | register 11 + full 414 |
| `7bfc111` | **E2 프론트** `/signup` 회사 개설 화면 + 동선 | 라이브 E2E(company 2·3 생성) |

**누적**: 격리 테스트 42개(11+20+11), full suite **414 passed / 0 failed**, 마이그레이션 체인 `0001→0002→0003→0004`. 주요 사용자 데이터(meetings·seats·work_log·kpi·report·notice·chat·presence) 테넌트 격리 + 공개 회사개설 라이브.

---

## 2. 다음 작업 스케줄 (우선순위·의존성·규모)

### 🔴 P0 — SaaS 온보딩 완성 (E2 위에 얹힘, 신규 회사가 "쓸 수 있게")
| ID | 작업 | 규모 | 의존 | 게이트 |
|---|---|---|---|---|
| **E3** | admin 유저 CRUD — 자사 유저 생성·비활성·역할변경 API+UI. `employees` 페이지가 지금 읽기전용 ERP sync뿐(생성 API 0). **ERP 없는 신규 회사는 사람을 못 채움** | L | E2✓ | 격리 테스트(타사 유저 생성/수정 404) + pytest |
| **E4** | 이메일 초대 — 토큰 링크 초대→최초 비번설정 온보딩. 유저/테넌트 초대 UI·API 0(회의초대만 존재) | M | E3 | 초대 토큰 만료·재사용 방지 테스트 |
| **E5** | 화이트라벨 UI — Company 브랜딩 필드(logo_url·primary_color 이미 스키마에 있음) read/write API + admin 브랜딩 탭 → `:root` CSS변수 런타임 주입. **프론트 토큰 기반 이미 준비됨(5652907)** | M | E2✓ | 테넌트별 색 반영 육안 |

### 🟠 P1 — 멀티테넌시 잔여 스코핑 (Phase 1d)
| ID | 작업 | 규모 | 비고 |
|---|---|---|---|
| **1d-1** | `rooms` 스코핑 — Room은 company_id 없음(office 소유). floor→office→company로 스코프 or company_id denormalize | M | 1b에서 이월 |
| **1d-2** | `consent`(녹화 동의)·`erp directory` read 스코핑 | S | erp는 이미 company1 하드스코프 — 동적화 |
| **1d-3** | office_layouts·notices 배포·audit_log 등 나머지 admin 라우터 스코핑 감사 | M | company_scope 누락 라우터 전수 확인 |

### 🟡 P2 — 컴플라이언스·운영 (22-doc Tier 1/2)
- 실시간 서버 수평확장(22 T0-3: Redis driver/presence) · 관측성(구조화 로깅·Sentry·/ready) · graceful shutdown(T1-7) · 프레즌스 쓰기 배치(T1-1).
- 개인정보 팩(22 §3): 동의 게이트·보존기간·열람/삭제·읽기 감사.

### 🟢 F2/F3 병행 (품질, 언제든)
- 프리미티브 페이지 채택 확산(기존 커스텀 모달 12개 → `Modal` 수렴 A4 완성; 손복사 버튼/인풋 → Button/Field).
- **i18n(C1)** — 한국어 1,695건 하드코딩, next-intl 카탈로그 추출(재판매 전 조기 착수).
- 접근성 잔여(C10 차트 role=img·A11 muted 대비 4.5:1).
- 에셋 절차++(B6 가구 레이어 캐시로 테마 재렌더 프리즈 제거·B9 룸 팔레트 데이터화).

---

## 3. 확립된 레시피 (다음 세션도 이 패턴으로)

**멀티테넌시/백엔드 보안 작업 = test-gated 서브에이전트 + 메인 검토**:
1. 라우터 그룹별로 서브에이전트에 위임(병렬 X — tables.py·마이그레이션 체인 충돌). 프롬프트에 **정확한 계약·백필 소스·caveat** 명시.
2. 스코핑 불변식: 목록=`.where(Model.company_id == cid)` via `Depends(company_scope)`; 단건/변조=로드 **직후·변조 전** `assert_same_company`(404 존재은닉); 생성=서버가 company_id 주입(**클라 불신**).
3. **격리 테스트 필수**: 회사2 리소스에 회사1 호출자 GET/PATCH/DELETE/action→404, 자사 200, 목록 필터. `tests/test_tenant_isolation*.py` 스타일.
4. 메인이 반드시 직접 검토: **assert-before-mutation 배치 확인** + **격리 테스트 재실행** + diff 리뷰(권한 escalation·클라 신뢰 여부).
5. deps 헬퍼 정본: `company_scope`(dependency)·`assert_same_company(user, obj_company_id)` (backend/app/core/deps.py).

**프론트/백 계약**: 계약을 프롬프트에 **고정**하고 프론트를 병행 구현(파일 무충돌). 예: `POST /api/auth/register` {company_name,admin_name,admin_email,admin_password} → login응답+company.

---

## 4. 라이브 스택 상태 + 재현

- 실행 중: 프론트 `:3000` · 백엔드 `:8000`(**새 스키마로 재기동 완료**) · 실시간 `:2567`(SCENE_FLOOR=v3).
- 로그인: `alice@virtualoffice.local`/`password123`(company 1, 데모) 또는 `demo2001@...`. `/signup`으로 새 회사 개설 가능(라이브).
- **DB 재생성(구 스키마→신 스키마)**: `dev_qa.db`는 create_all 경로라 company_id 컬럼 미반영이었음 → `dev_qa.db.oldschema.bak` 백업 후 `seed_dev.py`+`seed_seats.py`+`seed_demo.py`로 fresh 재생성(create_all이 신 스키마 빌드, 시드가 company_id=1 채움). **dev=create_all, prod=Alembic 마이그레이션(0002~0004).**
- 검증 명령: 백엔드 타겟 테스트 `cd backend && DATABASE_URL="sqlite+aiosqlite:///:memory:" ./.venv/Scripts/python.exe -m pytest tests/test_tenant_isolation*.py tests/test_auth_register.py -q` (full suite는 ~100s+).

---

## 5. 함정 / 주의 (gotchas)

- **_html 미러 훅**: `docs/*.md` 편집 시 전역 PostToolUse 훅이 _html 미러 47개를 일괄 열화 재생성. 복구=`git checkout -- docs/_html/` → 프로젝트 생성기(`tools/docs-html` `node generate.js`) 재생성 → 새 문서 미러만 스테이징 → 나머지 되돌림.
- **pytest full suite ~100s+**: 타겟(`test_tenant_isolation*`·`test_auth*`·`test_foundation`)으로 빠른 검증, full은 필요시만.
- **한글 curl 400**: Windows 셸 인코딩으로 한글 JSON body 깨짐 → `--data-binary @file`(UTF-8) 또는 브라우저로 테스트.
- **Pretendard CDN 경로**: `@v1.3.9/…/variable/…dynamic-subset`은 404. 동작=`npm/pretendard@1.3.9/dist/web/static/pretendard.min.css`.
- **meetings `toast` 충돌**: 기존 인라인 flash `toast` state와 `useToast()` 훅 충돌 → 훅을 `notify`로 alias.
- **native BigInteger PK id**: ErpUser.id는 자동시퀀스 아님 → 셀프가입 유저는 `max(id)+1`(10억 floor)로 명시 발급. team_id=0 센티널.
- **커밋 메시지 백틱 금지**: bash `-m "…`토큰`…"`은 명령치환. 백틱 회피.
- `backend/dev_qa.db`는 커밋 제외(재생성 가능한 산출물).

---

## 6. 진입점 (다음 세션 시작)
> "E3/E4(유저 CRUD·초대)부터 진행" → 24-스펙 Phase 3 참조 + 위 §3 레시피로 test-gated 서브에이전트 디스패치. 또는 "E5 화이트라벨 UI"(프론트 토큰 기반 준비됨) / "F1 Phase 1d 잔여 스코핑" / "i18n". 병행 품질은 §2 F2/F3.
