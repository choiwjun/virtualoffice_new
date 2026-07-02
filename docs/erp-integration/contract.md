# ERP 연동 계약서

**문서명**: ERP 연동 인터페이스 설계  
**버전**: 1.0  
**작성일**: 2026-07-02  
**상태**: 확정(Phase 0, P0-T0.4)  
**참조 정본**: 
- 00-decisions.md (D15·D16·D17·D18·D19·D20·D21)
- 03-erp-integration.md (§2~§7)
- 04-data-model.md §2.5 (kpi_result 정본 스키마)

> **원칙**: ERP(DailyLog)는 직원·조직·근태 Source of Truth. 우리는 read-only 동기화 + 협업결과·KPI 역방향 전송(확정값만).

---

## 1. 읽기 설계 (Read-Only 동기화)

### 1.1 동기화 대상 5개 테이블

| # | ERP 테이블 | 우리 테이블 | 동기화 주기 | 목적 |
|---|-----------|----------|-----------|------|
| 1 | **users** | erp_user | 매시간 증분 + 매일 00:00 KST 전체 대사 | 직원 정보, 삭제 감지(soft-delete) |
| 2 | **teams** | team_zone(매핑용) | 매시간 증분 + 매일 00:00 KST 전체 대사 | 팀 구조, 삭제 감지(soft-delete) |
| 3 | **job_positions** | (erp_user.position_id 참조) | 일 1회(새벽) | 직급/직책명 |
| 4 | **attendances** | (근태 검증용) | 일일 자정(KST) | 출퇴근 기록, 근무형태 |
| 5 | **leaves** | (휴가 판정) | 매시간 증분 | 휴가/병가 예정/이력 |

### 1.2 필드 매핑 (화이트리스트 VIEW 명시)

ERP 원본 읽기는 **컬럼 화이트리스트 VIEW(D20-f)** 경유:
- `erp_users_public` VIEW: **제외 컬럼**: slack_user_id, github_username, jira_email, lat, lng, radius
- `erp_teams_public` VIEW: 기본 필드만

#### users → erp_user

```sql
-- ERP VIEW: erp_users_public (화이트리스트 컬럼만 노출)
CREATE VIEW erp_users_public AS
SELECT
    id, company_id, email, name, team_id, role, position, position_id,
    manager_id, work_type, work_hours, updated_at
FROM users
WHERE company_id = <COMPANY_ID>
  AND (slack_user_id IS EXCLUDED) -- 논리적 제외(VIEW에서 컬럼 자체 미포함)
  AND (github_username IS EXCLUDED)
  AND (jira_email IS EXCLUDED)
  AND (lat IS EXCLUDED)  -- GPS 수집 금지(D20-c)
  AND (lng IS EXCLUDED)
  AND (radius IS EXCLUDED);
```

| ERP users | 우리 erp_user | 비고 |
|-----------|--------------|------|
| id | id | **조인 키**, BIGINT |
| company_id | company_id | 멀티테넌트 스코프 |
| email | email | UNIQUE(company_id, email) |
| name | name | 직원명 |
| team_id | erp_team_id | ERP teams.id 참조 |
| role | role | employee \| leader \| admin \| super_admin |
| position | position | 자유텍스트 |
| position_id | position_id | FK job_positions.id |
| manager_id | manager_id | FK erp_user(id) self |
| work_type | work_type | office \| remote |
| work_hours | work_hours | 분 단위 환산 |
| updated_at | last_synced_at | UTC 저장 |
| (생략) | is_active | soft-delete 플래그(전체 대사에서 갱신) |
| (생략) | created_at | 우리 DB 생성 시각 |

**미러링 최소수집(D20-f)**: `slack_user_id, github_username, jira_email`은 우리 KPI/공간 기능에 불필요하므로 **미러링하지 않음**. ERP 원본 읽기는 반드시 화이트리스트 VIEW 경유.

#### teams → team_zone (매핑용)

| ERP teams | 우리 team_zone | 용도 |
|-----------|----------------|------|
| id | erp_team_id | FK 참조 |
| company_id | (검증) | 스코프 |
| name | zone_label | 팀 이름 |
| leader_name | (참고용) | 팀장명 |

#### attendances & leaves

직접 DB 읽기(API 미존재, D18 근거).

### 1.3 동기화 알고리즘 (D18)

#### 매시간 증분 (updated_at 기반)

```python
# Pseudocode: 직원 증분 동기화(매시간)
async def sync_erp_users_incremental():
    OVERLAP = timedelta(minutes=5)  # 커밋 지연 누락 방지
    last_sync = await get_last_sync_timestamp("users")  # 우리 DB

    # ERP 쿼리: 화이트리스트 VIEW 경유, company_id 필터 필수
    erp_users = await erp_db.query("""
        SELECT id, company_id, email, name, team_id, role, position, position_id,
               manager_id, work_type, work_hours, updated_at
        FROM erp_users_public
        WHERE company_id = ? AND updated_at > ? - INTERVAL 5 MINUTES
        ORDER BY updated_at ASC
    """, (COMPANY_ID, last_sync))

    # Upsert(멱등): metric 단위 아님, 행 단위. team_change 이력 기록(D18).
    for eu in erp_users:
        await upsert_erp_user(
            id=eu.id, company_id=eu.company_id, email=eu.email, name=eu.name,
            erp_team_id=eu.team_id, role=eu.role, position=eu.position,
            position_id=eu.position_id, work_type=eu.work_type, work_hours=eu.work_hours,
            is_active=True,
            last_synced_at=eu.updated_at  # UTC
        )
        await record_team_change_if_moved(eu.id, eu.team_id)  # user_team_history

    if erp_users:
        await set_last_sync_timestamp("users", max(u.updated_at for u in erp_users))
```

#### 매일 00:00 KST 전체 대사 (하드 삭제 감지)

```python
# Pseudocode: 전체 대사(reconciliation) — 삭제 감지
async def reconcile_erp_users():
    """증분이 감지 못하는 하드 삭제를 전건 대사로 감지 → soft-delete."""
    
    # 1. ERP 현재 전체 id 집합(company 스코프)
    erp_ids = set(await erp_db.scalars(
        "SELECT id FROM erp_users_public WHERE company_id = ?", (COMPANY_ID,)
    ))

    # 2. 우리 DB의 활성 id 집합
    our_ids = set(await our_db.scalars(
        "SELECT id FROM erp_user WHERE company_id = ? AND is_active = TRUE", (COMPANY_ID,)
    ))

    # 3. ERP에서 사라진 id → soft-delete(물리 삭제 금지, 평가 기록 영구성)
    deleted = our_ids - erp_ids
    for uid in deleted:
        await our_db.execute(
            "UPDATE erp_user SET is_active = FALSE, updated_at = now() WHERE id = ?", (uid,)
        )
        await audit_log("erp_user_soft_deleted", entity_id=uid)

    # 4. ERP에 재등장한 비활성 id → 복원
    reappeared = erp_ids & (await inactive_ids(COMPANY_ID))
    for uid in reappeared:
        await our_db.execute("UPDATE erp_user SET is_active = TRUE WHERE id = ?", (uid,))

    # 5. 대사 불일치 시 관리자 알림
    await notify_admin_if_drift(len(deleted), len(reappeared))
```

### 1.4 안전 제약

- **company_id 필터 필수**: 모든 ERP 쿼리에 `WHERE company_id = ?` 포함
- **soft-delete만 사용**: CASCADE 금지 (평가 기록 영구성, D18)
- **화이트리스트 VIEW 경유**: GPS/slack/github/jira 컬럼 차단 (D20-f)
- **team_change 이력**: 분기 중 팀 이동자의 KPI 벤치마크 왜곡 방지 (user_team_history 기록)

---

## 2. 쓰기 설계 (우리 → ERP 역동기화)

### 2.1 채널 1: 일일 업무 상태 → daily_reports

**시각**: 매일 18:00 KST(주말·공휴일 스킵, D17)  
**대상**: ERP `POST /api/reports` (기존 엔드포인트)  
**인증**: 사용자 JWT 또는 배치 전용 토큰  
**내용**: work_log + meeting 요약

#### 요청 페이로드 예시

```json
POST /api/reports
Authorization: Bearer <JWT>
X-Company-Id: <company_id>

{
  "date": "2026-07-01",
  "today_work": "3D 회의실에서 아키텍처 검토(1.5h), 협업 노트 작성",
  "current_tasks": [
    {"title": "백엔드 KPI 엔드포인트 개발", "progress": 75},
    {"title": "프론트 KPI 리뷰 UI", "progress": 50}
  ],
  "blockers": "없음",
  "tomorrow_plan": "KPI 통합테스트 + ERP 양방향 검증",
  "status": "submitted"
}
```

#### 응답 예시

```json
{
  "id": 123,
  "user_id": 5,
  "date": "2026-07-01",
  "status": "submitted",
  "created_at": "2026-07-01T17:00:00Z"
}
```

### 2.2 채널 2: KPI 확정 결과 → kpi_results (신설)

**시각**: 관리자 확정 이벤트 + 분기 마감 배치(D15·D17)  
**대상**: ERP `POST /api/kpi-results` (신규 엔드포인트, 단건/배치 동일 경로)  
**인증**: 서비스계정 JWT(24h, safe pattern — 우리는 시크릿만 보유)  
**내용**: 확정 점수(final_score)만 전송, ai_draft 미포함(D15)

#### 요청 페이로드 예시 (롱포맷, metric 단위)

```json
POST /api/kpi-results
Authorization: Bearer <ServiceAccount JWT>
X-Company-Id: <company_id>

{
  "user_id": 5,
  "period_type": "quarterly",
  "period_key": "2026-Q3",
  "metrics": [
    {"metric": "work_completed_count",     "value": 42},
    {"metric": "work_quality_score",       "value": 78.0},
    {"metric": "minutes_authored_count",   "value": 11},
    {"metric": "action_items_completed",   "value": 18},
    {"metric": "action_items_ontime_rate", "value": 83.0},
    {"metric": "report_fidelity_score",    "value": 74.0},
    {"metric": "collaboration_score",      "value": 81.0},
    {"metric": "quarterly_total",          "value": 504.0}
  ],
  "source": "virtual_office"
}
```

#### 응답 예시

```json
{
  "user_id": 5,
  "period_type": "quarterly",
  "period_key": "2026-Q3",
  "metrics_count": 8,
  "saved_ids": [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008],
  "status": "success",
  "created_at": "2026-07-01T17:00:00Z"
}
```

**주의**:
- ERP kpi_results는 **스칼라 테이블**(metric VARCHAR + value FLOAT) — metric 단위 행 저장
- **확정 점수(final_score)만** 저장 (D15) — ai_draft는 우리 플랫폼 DB에만 인라인
- **metric 어휘 사전**: 04-data-model.md §2.5 정본 참조
- **UNIQUE 제약**: (company_id, user_id, period_type, period_key, metric)
- 정정 발생 시 재push(upsert로 덮어씀, 멱등성)

---

## 3. 배치 스케줄 (D17)

### 3.1 일정표

| 배치 | 시각(KST) | 대상 | 멱등성 | 비고 |
|------|----------|------|-------|------|
| **daily_reports push** | 18:00 | 당일 work_log·meeting 요약 → ERP | metric 단위 아님, 행 단위 upsert | 주말·공휴일 스킵, D17 |
| **KPI AI 초안 생성** | 21:00 | 정량 metric 계산(결정론적 코드) + AI 서술 | metric 단위 upsert | ERP 전송 없음(검토 대기) |
| **kpi_results ERP push** | 이벤트/분기 마감 | 관리자 확정(finalized_at 설정) → ERP | metric 단위 upsert + feature flag | D15·D17 |

### 3.2 멱등성 설계

#### daily_reports: 행 단위 upsert

```python
# 배치 실행 식별자 + advisory lock
async def daily_reports_push_batch():
    if is_weekend_or_holiday(today_kst()):
        logger.info("daily_reports batch skipped (weekend/holiday)")
        return

    async with pg_advisory_lock(LOCK_DAILY_REPORTS):
        run_id = uuid4()
        for user in active_users:
            try:
                daily_status = summarize_daily_activity(user)
                resp = await push_daily_report_to_erp(user_id=user.id, data=daily_status)
                await log_daily_status_push(user.id, run_id, "erp_daily_reports", 
                                           payload=daily_status, resp=resp)
            except Exception as e:
                await log_daily_status_push(user.id, run_id, "erp_daily_reports",
                                           status="failed", error=str(e))
                await enqueue_retry(user.id, today_kst(), target="erp_daily_reports")
```

#### kpi_results: metric 단위 upsert + feature flag

```python
# metric 단위 멱등 upsert
async def push_finalized_kpi_to_erp(user_id, period_type, period_key):
    # 관리자 확정분만 전송(finalized_at not null)
    rows = await db.execute(select(KpiResult).where(
        (KpiResult.user_id == user_id) &
        (KpiResult.period_type == period_type) &
        (KpiResult.period_key == period_key) &
        (KpiResult.finalized_at.isnot(None))
    ))
    metrics = [{"metric": r.metric, "value": r.final_score} for r in rows.scalars()]
    
    if not metrics:
        return  # 미확정분은 전송 안 함
    
    # Feature flag 확인(ERP 준비 전 로컬 적재)
    if not FEATURE_ERP_KPI_ENABLED:
        await stage_for_backfill(user_id, period_type, period_key, metrics)
        return
    
    # 멱등 upsert: metric 차원
    await push_kpi_to_erp(user_id=user_id, period_type=period_type,
                          period_key=period_key, metrics=metrics)
```

### 3.3 재시도 정책

**지수 백오프, 최대 3회, target별 분리**:

```python
async def retry_failed_pushes():
    """실패 항목을 target별로 지수 백오프 재시도(최대 3회)."""
    for item in await get_retry_items(max_retries=3):
        try:
            if item.target == "erp_daily_reports":
                await push_daily_report_to_erp(item.user_id, item.payload)
            elif item.target == "erp_kpi_results":
                await push_kpi_to_erp(**item.payload)
            await mark_retry_resolved(item.id)
        except Exception as e:
            await bump_retry(item.id, backoff=2 ** item.retry_count)  # 2^n초
            if item.retry_count + 1 >= 3:
                await notify_admin_retry_exhausted(item)
```

**규칙**:
- 한 사용자 실패 → 다음 사용자 계속(배치 중단 X)
- 한 target 실패, 다른 target 성공 → 독립 재시도
- 정규 배치와 재시도 겹침 → 정규 배치 upsert가 우선(최신 계산)

---

## 4. Feature Flag & Backfill (§3 미준비 시 폴백)

### 4.1 ERP kpi_results 미배포 시 폴백

ERP `feature/virtual-office-integration` 브랜치의 kpi_results 테이블·엔드포인트 미배포 상황에 대응:

```python
# 환경변수: FEATURE_ERP_KPI_ENABLED (기본값: false)
if not FEATURE_ERP_KPI_ENABLED:
    # 확정 점수를 로컬 스테이징 테이블에 적재
    await stage_for_backfill(user_id, period_type, period_key, metrics)
    logger.info(f"KPI results staged for backfill (ERP not ready)")
    return
```

### 4.2 ERP 준비 완료 후 backfill

```python
async def backfill_kpi_to_erp():
    """ERP 준비 완료 후 미전송 확정분을 순차 전송(멱등 upsert)."""
    if not FEATURE_ERP_KPI_ENABLED:
        return  # 준비 전
    
    for batch in await get_staged_finalized_unpushed():  # pushed_to_erp=false & finalized
        try:
            await push_kpi_to_erp(**batch)
            await mark_pushed(batch.ids)
        except Exception as e:
            logger.error(f"Backfill failed: {e}")
            await notify_admin_backfill_failed(batch)
```

---

## 5. 스키마 드리프트 검증 (§2 시작 전 필수)

배치 시작 전 ERP 스키마 버전 및 필드 가용성 확인:

```python
async def validate_erp_schema():
    """ERP 스키마 준비 상태 확인. kpi_results 테이블 존재 검사 포함(D17)."""
    
    inspector = inspect(erp_engine)
    
    # 필수 테이블 확인
    required_tables = ['users', 'teams', 'job_positions', 'attendances', 'leaves']
    for table in required_tables:
        if not inspector.has_table(table):
            raise MissingTableError(f"ERP table missing: {table}")
    
    # users 필수 컬럼 확인
    users_cols = {c['name'] for c in inspector.get_columns('users')}
    required_cols = {'id', 'company_id', 'email', 'name', 'team_id', 'updated_at'}
    if not required_cols.issubset(users_cols):
        raise MissingColumnError(f"users missing: {required_cols - users_cols}")
    
    # kpi_results 테이블 존재 검사(D17, §4 feature flag와 연동)
    if FEATURE_ERP_KPI_ENABLED:
        if not inspector.has_table('kpi_results'):
            raise MissingTableError("ERP kpi_results table not deployed (set FEATURE_ERP_KPI_ENABLED=false)")
        kpi_cols = {c['name'] for c in inspector.get_columns('kpi_results')}
        kpi_required = {'company_id', 'user_id', 'period_type', 'period_key', 'metric', 'value', 'source'}
        if not kpi_required.issubset(kpi_cols):
            raise MissingColumnError(f"kpi_results missing: {kpi_required - kpi_cols}")
    
    logger.info("ERP schema validation passed")

# 배치 시작 시
async def kpi_quarterly_push_batch():
    try:
        await validate_erp_schema()
        # ... 배치 실행
    except (MissingTableError, MissingColumnError) as e:
        logger.error(f"ERP schema mismatch: {e}")
        await notify_admin(f"ERP schema mismatch: {e}")
        # 스테이징으로 폴백
        FEATURE_ERP_KPI_ENABLED = False
```

---

## 6. ERP Dev 브랜치 작업

### 6.1 브랜치 명명

**브랜치명**: `feature/virtual-office-integration`  
**베이스**: ERP main  
**담당**: 사용자(ERP git 접근권한 보유) 또는 협력사  
**병합**: 외부 담당자 승인 후(우리는 수신만)

### 6.2 신설 필수 항목

1. **테이블**: `kpi_results` (Alembic 마이그레이션 — 우리 산출물 §3 참고)
2. **엔드포인트**: `POST /api/kpi-results` (단건/배치 동일 경로)
3. **서비스계정**: `service_accounts` 테이블 + 토큰 발급 엔드포인트(§2.3 service-account-policy.md 참고)
4. **VIEW**: `erp_users_public` (화이트리스트 컬럼만 노출, §1.2)

### 6.3 API 문서

**POST /api/kpi-results** 상세:

```
경로: POST /api/kpi-results
인증: Bearer <ServiceAccount JWT>
헤더: X-Company-Id: <company_id>

Request Schema:
{
  "user_id": int (required),
  "period_type": "daily" | "quarterly" (required),
  "period_key": "2026-07-01" | "2026-Q3" (required, ISO 형식),
  "metrics": [
    {
      "metric": string (required, 04-data-model.md §2.5 어휘 사전),
      "value": float (required)
    }
  ],
  "source": string = "virtual_office"
}

Response:
{
  "user_id": int,
  "period_type": string,
  "period_key": string,
  "metrics_count": int,
  "saved_ids": [int, ...],
  "status": "success" | "partial_failure",
  "created_at": ISO8601
}

Error Codes:
- 400: 잘못된 metric/value(metric 어휘 사전 외) 또는 스키마 위반
- 401: JWT 만료 또는 미인증
- 403: 권한 부족(서비스계정/admin 아님)
- 409: user_id가 존재하지 않음
- 500: 서버 오류(upsert 실패 등)
```

---

## 7. 타임존 규칙 (D19)

모든 시각 저장은 **UTC**, 배치 경계는 **KST**로 계산:

| 항목 | 저장 | 계산 | 표시 |
|------|------|------|------|
| 동기화 시각(last_synced_at) | UTC | - | KST |
| 배치 경계(18:00) | - | **KST 기준** | KST |
| DB created_at/updated_at | **UTC** | - | KST |
| 분석 기준일(work_date) | **UTC 00:00** | - | KST |

```python
# 예시
now_utc = datetime.utcnow()
now_kst = now_utc.replace(tzinfo=UTC).astimezone(KST)

# 배치: 18:00 KST는 09:00 UTC
scheduler.add_job(
    daily_reports_push_batch,
    trigger="cron",
    hour=18, minute=0, timezone="Asia/Seoul"  # KST
)
```

---

## 완료 체크리스트

- [x] read-only 동기화 대상 5개 정의 (users, teams, job_positions, attendances, leaves)
- [x] 화이트리스트 VIEW 명시 (erp_users_public — GPS/slack/github/jira 제외, D20-f)
- [x] 쓰기 스펙 확정 (daily_reports 18:00 KST + kpi_results 이벤트/분기)
- [x] 멱등성 설계 (행 단위 + metric 단위 upsert)
- [x] 재시도 정책 (지수 백오프, 최대 3회, target별 분리)
- [x] feature flag/backfill 절차 (FEATURE_ERP_KPI_ENABLED)
- [x] ERP dev 브랜치명 명시 (feature/virtual-office-integration)
- [x] 스키마 드리프트 검증 (kpi_results 존재 검사 포함)
- [x] 페이로드 JSON 예시 (daily_reports + kpi_results)
- [x] 타임존 규칙 (UTC 저장, KST 표시, D19)
