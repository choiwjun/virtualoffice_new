# 서비스계정 정책 및 보안 설계

**문서명**: ERP 연동 서비스계정 정책  
**버전**: 1.0  
**작성일**: 2026-07-02  
**상태**: 확정(Phase 0, P0-T0.4)  
**참조**: 00-decisions.md(D21), 03-erp-integration.md §5.3·§7.1

---

## 1. 개요

가상오피스 플랫폼은 ERP(DailyLog)와 다음 두 가지 인증 방식으로 통신합니다:

1. **Read-Only DB 접근**: PostgreSQL 직접 커넥션 (read-only 계정)
2. **API 쓰기 인증**: JWT 서비스계정 (24h 갱신, safe pattern)

본 정책은 이 두 채널의 보안 요구사항을 명시합니다.

---

## 2. Read-Only DB 계정 정책

### 2.1 계정 설정

**ERP DB**: PostgreSQL `dailylog`  
**계정명**: `virtual_office_readonly`  
**권한**: **SELECT only** (INSERT/UPDATE/DELETE 전면 금지)  
**접근 범위**: 화이트리스트 VIEW 경유

### 2.2 권한 설계

```sql
-- ERP 주도로 설정(dev 브랜치)

-- (1) 신규 read-only 역할 생성
CREATE ROLE virtual_office_readonly WITH LOGIN PASSWORD '<STRONG_PASSWORD>';

-- (2) 기본 권한 취소
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM virtual_office_readonly;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM virtual_office_readonly;

-- (3) 화이트리스트 VIEW만 SELECT 허용
GRANT SELECT ON erp_users_public TO virtual_office_readonly;
GRANT SELECT ON erp_teams_public TO virtual_office_readonly;
GRANT SELECT ON job_positions TO virtual_office_readonly;  -- 공개 테이블
GRANT SELECT ON attendances TO virtual_office_readonly;     -- 공개 테이블(벌크 API 미존재)
GRANT SELECT ON leaves TO virtual_office_readonly;          -- 공개 테이블

-- (4) VIEW 정의(화이트리스트 컬럼만)
CREATE VIEW erp_users_public AS
SELECT
    id, company_id, email, name, team_id, role, position, position_id,
    manager_id, work_type, work_hours, updated_at, is_active, created_at
FROM users
WHERE is_deleted = FALSE  -- soft-delete 플래그 고려
ORDER BY updated_at;

CREATE VIEW erp_teams_public AS
SELECT
    id, company_id, name, leader_name, created_at, updated_at
FROM teams
WHERE is_deleted = FALSE
ORDER BY updated_at;

-- (5) 감시: 쿼리 로그 활성화 (vi log_statement = 'all')
ALTER ROLE virtual_office_readonly SET log_statement = 'all';
```

### 2.3 암호 관리

**암호 정책(D21)**:
- 최소 16자, 대소문자+숫자+특문 혼합
- 반기 로테이션(6개월마다 변경)
- 로테이션 일정: 1월/7월 (또는 조직 정책)

**환경변수 관리**:

```bash
# .env (권한 600, 소유자만 읽기)
ERP_DB_HOST=<IP/FQDN>
ERP_DB_PORT=5432
ERP_DB_NAME=dailylog
ERP_DB_USER=virtual_office_readonly
ERP_DB_PASSWORD=<16+ 자, 대소+숫자+특문>

# 파일 권한 설정(필수)
chmod 600 .env

# 소유자 확인
ls -l .env
# 출력: -rw------- 1 appuser appuser 200 2026-07-02 ...
```

**로테이션 절차**:

```
Step 1: 새 암호 생성
  $ openssl rand -base64 32 | head -c 24
  → 예: aB3cD9eF+gH2iJ4kL5m6n7oP

Step 2: ERP DB에서 암호 변경(DBA 또는 super_admin)
  ALTER USER virtual_office_readonly WITH PASSWORD '<NEW_PASSWORD>';

Step 3: 우리 플랫폼 .env 갱신 + 재배포
  ERP_DB_PASSWORD=<NEW_PASSWORD>

Step 4: 이전 암호 파기(1주일 보관 후 삭제)

Step 5: 감사 로그 기록
  WHEN: 2026-01-02 (DBA 기록)
  ACTION: password rotated
  ACCOUNT: virtual_office_readonly
```

### 2.4 접근 범위 및 감시

**접근 가능 테이블**:
- `erp_users_public` (VIEW, 컬럼 화이트리스트)
- `erp_teams_public` (VIEW)
- `job_positions`, `attendances`, `leaves` (읽기 전용 권한)

**접근 불가**:
- users, teams 원본 (VIEW 강제)
- 모든 쓰기 작업
- 시스템 테이블

**감사**:

```sql
-- 쿼리 로그: PostgreSQL 설정
log_statement = 'all'  -- 모든 SQL 기록
log_duration = on
log_min_duration_statement = 0  -- 모든 쿼리

-- 로그 위치: /var/log/postgresql/postgresql.log (또는 docker logs)

-- 확인 예시
SELECT * FROM pg_stat_statements WHERE user = 'virtual_office_readonly'
ORDER BY mean_time DESC LIMIT 10;
```

---

## 3. API 서비스계정 JWT 정책

### 3.1 토큰 갱신 주기

**갱신 주기(D21)**: **24시간**  
**발급 방식**: Safe Pattern (우리는 시크릿만 보유, ERP가 토큰 발급)  
**캐시 정책**: 1시간(TTL < 1시간, 최종 유효기간 23시간 보장)

### 3.2 Safe Token Pattern (권장)

**문제**: 우리가 ERP의 전역 JWT 시크릿을 보유하면 임의 user_id 토큰 위조 가능.

**해결**: ERP가 토큰 발급, 우리는 시크릿만 보유.

#### ERP 측 설정 (dev 브랜치)

```python
# ERP: app/models/tables.py (신설)

class ServiceAccount(SQLModel, table=True):
    __tablename__ = "service_accounts"
    
    id: int | None = Field(default=None, primary_key=True)
    company_id: int
    name: str = "virtual_office_integration"
    secret_hash: str  # bcrypt(secret_key) — ERP가 저장, 우리는 미보유
    role: str = "admin"  # KPI 쓰기 권한
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

```python
# ERP: app/api/routes/auth.py (신설 엔드포인트)

@router.post("/auth/service-token", response_model=dict)
async def issue_service_token(
    service_name: str,  # "virtual_office_integration"
    service_secret: str,  # 우리가 제공한 시크릿
    db: AsyncSession = Depends(get_db)
):
    """
    서비스계정 토큰 발급.
    우리는 service_secret을 제시하고, ERP가 JWT를 발급함.
    """
    
    # service_accounts 테이블 조회
    service = await db.execute(
        select(ServiceAccount).where(
            (ServiceAccount.name == service_name) &
            (ServiceAccount.is_active == True)
        )
    )
    service_account = service.scalars().first()
    
    if not service_account:
        raise HTTPException(status_code=404, detail="Service account not found")
    
    # secret 검증(bcrypt)
    if not bcrypt.verify(service_secret, service_account.secret_hash):
        raise HTTPException(status_code=401, detail="Invalid secret")
    
    # JWT 발급(ERP가 관리하는 시크릿으로 서명) — 우리는 미관여
    payload = {
        "sub": service_name,
        "company_id": service_account.company_id,
        "type": "service",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=24)  # 24h
    }
    token = jwt.encode(
        payload,
        os.getenv("SECRET_KEY"),  # ERP의 시크릿
        algorithm="HS256"
    )
    
    # 감사 로그
    await audit_log(
        action="service_token_issued",
        service_name=service_name,
        ip_address=request.client.host,
        timestamp=datetime.utcnow()
    )
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 86400,  # 24h (초 단위)
        "issued_at": datetime.utcnow().isoformat()
    }
```

#### 우리 측 구현

```python
# 우리 플랫폼: backend/app/services/erp_token_manager.py

import os
import httpx
from datetime import datetime, timedelta
from functools import lru_cache

ERP_BASE_URL = os.getenv("ERP_BASE_URL")  # 예: https://erp.internal:8443
ERP_SERVICE_SECRET = os.getenv("ERP_SERVICE_SECRET")  # 우리가 보유
SERVICE_TOKEN_CACHE_TTL = 3600  # 1시간(최종 토큰 유효기간 < 24h 보장)

# 간단 메모리 캐시(프로덕션: Redis 권장)
_token_cache = {
    "token": None,
    "expires_at": None
}

async def get_service_token() -> str:
    """
    ERP 토큰 엔드포인트에서 토큰 획득.
    우리는 service_secret을 제시하고, ERP가 JWT를 발급.
    """
    
    # 캐시 확인(TTL < 1시간)
    if _token_cache["token"] and _token_cache["expires_at"]:
        if datetime.utcnow() < _token_cache["expires_at"]:
            return _token_cache["token"]
    
    # ERP 토큰 엔드포인트 호출
    try:
        async with httpx.AsyncClient(verify=False) as client:  # 사내 PKI TLS
            resp = await client.post(
                f"{ERP_BASE_URL}/api/auth/service-token",
                json={
                    "service_name": "virtual_office_integration",
                    "service_secret": ERP_SERVICE_SECRET
                },
                timeout=10.0
            )
        
        if resp.status_code != 200:
            raise Exception(f"ERP token issuance failed: {resp.status_code} {resp.text}")
        
        data = resp.json()
        token = data["access_token"]
        expires_in = data["expires_in"]  # 초 단위(86400)
        
        # 캐시(TTL = expires_in - 1시간)
        # 예: expires_in=86400(24h) → TTL=82800(23h)
        cache_ttl = min(expires_in - 3600, SERVICE_TOKEN_CACHE_TTL)
        _token_cache["token"] = token
        _token_cache["expires_at"] = datetime.utcnow() + timedelta(seconds=cache_ttl)
        
        logger.info(f"Service token refreshed (TTL: {cache_ttl}s)")
        return token
        
    except Exception as e:
        logger.error(f"Failed to get service token: {e}")
        raise

async def push_kpi_to_erp(user_id: int, period_type: str, period_key: str, 
                         metrics: list[dict]) -> dict:
    """
    KPI 확정 결과를 ERP로 전송(POST /api/kpi-results).
    서비스 토큰 자동 갱신.
    """
    
    # 토큰 획득(캐시 포함)
    token = await get_service_token()
    
    # POST /api/kpi-results (정본 경로)
    try:
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.post(
                f"{ERP_BASE_URL}/api/kpi-results",
                json={
                    "user_id": user_id,
                    "period_type": period_type,
                    "period_key": period_key,
                    "metrics": metrics,
                    "source": "virtual_office"
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=30.0
            )
        
        if resp.status_code == 401:
            # 토큰 만료 → 캐시 무효화 후 재시도
            logger.warn("Service token expired, refreshing...")
            _token_cache["token"] = None
            _token_cache["expires_at"] = None
            token = await get_service_token()
            
            resp = await client.post(
                f"{ERP_BASE_URL}/api/kpi-results",
                json={...},
                headers={"Authorization": f"Bearer {token}"},
                timeout=30.0
            )
        
        if resp.status_code not in [200, 201]:
            raise Exception(f"KPI push failed: {resp.status_code} {resp.text}")
        
        return resp.json()
        
    except Exception as e:
        logger.error(f"Failed to push KPI to ERP: {e}")
        raise
```

### 3.3 환경변수 관리

**저장 위치**: `.env` (권한 600)  
**시크릿 주기**: 반기 로테이션(D21)

```bash
# .env

# ERP 연동 설정
ERP_BASE_URL=https://erp.internal:8443
ERP_SERVICE_SECRET=aB3cD9eF+gH2iJ4kL5m6n7oPqR8sT9uVwX0yZ  # 우리가 보유(bcrypt 등록용)
ERP_DB_HOST=erp-db.internal
ERP_DB_PORT=5432
ERP_DB_NAME=dailylog
ERP_DB_USER=virtual_office_readonly
ERP_DB_PASSWORD=<READ_ONLY_PASSWORD>

# 기능 플래그
FEATURE_ERP_KPI_ENABLED=false  # ERP dev 브랜치 배포 전: false

# 파일 권한 (필수)
# chmod 600 .env
```

**시크릿 로테이션**:

```
Step 1: ERP에서 새 시크릿 생성(bcrypt 등록)
  bcrypt("aB3cD9eF+gH2iJ4kL5m6n7oPqR8sT9uVwX0yZ1")
  → hash: $2b$12$...

Step 2: 새 service_account 레코드 삽입(ERP dev 브랜치)
  INSERT INTO service_accounts (name, secret_hash, is_active)
  VALUES ('virtual_office_integration', '$2b$12$...', TRUE);

Step 3: 우리 .env 갱신
  ERP_SERVICE_SECRET=aB3cD9eF+gH2iJ4kL5m6n7oPqR8sT9uVwX0yZ1

Step 4: 배포(1시간 내 완료 권장)

Step 5: 이전 service_account 비활성화
  UPDATE service_accounts SET is_active = FALSE WHERE secret_hash = '$2b$12$...(old)';

Step 6: 감사 로그(공동 기록)
  WHEN: 2026-07-02T15:00:00 KST
  ACTION: ERP_SERVICE_SECRET rotated
  OWNER: <담당자명>
```

---

## 4. 접근 감시 및 감사

### 4.1 ERP 쿼리 로그

**목적**: read-only DB 계정의 비정상 접근 감지.

```sql
-- PostgreSQL 설정 (ERP)

-- 쿼리 로그 활성화
log_statement = 'all'
log_duration = on
log_min_duration_statement = 0

-- 로그 위치 및 보관
log_directory = '/var/log/postgresql'
log_filename = 'postgresql-%Y-%m-%d.log'
log_file_size = 100MB
log_retention_days = 90  -- 3개월 보관

-- 쿼리 분석
SELECT user, query, mean_time, calls
FROM pg_stat_statements
WHERE user = 'virtual_office_readonly'
ORDER BY calls DESC
LIMIT 20;
```

**관찰 항목**:
- 비정상 대량 쿼리(초당 > 100)
- 예상 외 시간대 접근(배치 외)
- SELECT 이외 DML 시도(모두 거부됨)

### 4.2 JWT 토큰 감사

```python
# 우리 플랫폼: backend/app/services/audit.py

async def audit_kpi_push(
    user_id: int,
    period_type: str,
    period_key: str,
    metrics_count: int,
    status: str,  # "success" | "failed"
    error_msg: str = None
):
    """KPI 전송 감시."""
    await db.execute(
        insert(AuditLog).values(
            action="kpi_push_to_erp",
            entity_id=user_id,
            entity_type="kpi_result",
            details={
                "period_type": period_type,
                "period_key": period_key,
                "metrics_count": metrics_count,
                "status": status,
                "error": error_msg
            },
            created_by="batch_worker",
            created_at=datetime.utcnow()
        )
    )
    
    # 실패 시 알림
    if status == "failed":
        await notify_admin(f"KPI push failed: user={user_id}, period={period_key}, error={error_msg}")

# 공동 감사 로그(ERP + 우리 플랫폼)
# 일주일마다 검토: daily_reports/kpi_results 전송 성공률, 실패 원인 분류
```

---

## 5. 보안 체크리스트

### 우리 플랫폼

- [x] ERP_SERVICE_SECRET을 .env에 저장(권한 600)
- [x] ERP_SERVICE_SECRET을 코드에 하드코딩하지 않음
- [x] 토큰 캐시 TTL < 1시간(유효기간 23시간+ 보장)
- [x] 토큰 갱신 실패 시 재시도 로직 (최대 3회)
- [x] 토큰 만료(401) 감지 → 캐시 무효화 → 재발급
- [x] HTTPS/TLS 사용(사내 PKI)
- [x] 모든 ERP 통신에 Bearer 토큰 포함
- [x] KPI 전송 실패 시 관리자 알림
- [x] 감사 로그(kpi_push, error 기록)

### ERP 측 (dev 브랜치)

- [x] service_accounts 테이블 신설(secret_hash bcrypt)
- [x] service_token 엔드포인트 신설
- [x] service_secret 검증(bcrypt.verify)
- [x] JWT 발급(ERP의 SECRET_KEY 사용)
- [x] 토큰 만료(exp: 24h)
- [x] 토큰 발급 시 감사 로그
- [x] 쿼리 로그(read-only 계정)

---

## 6. 반기 로테이션 일정 (D21)

**기간**: 연 2회(1월, 7월)  
**항목**: ERP_SERVICE_SECRET + ERP_DB_PASSWORD

### 6.1 1월 로테이션

```
Date: 2026-01-02 (목업)

Timeline:
  14:00 - 새 시크릿 생성(우리 + ERP DBA)
  14:30 - ERP service_accounts 업데이트
  15:00 - 우리 .env 갱신 + 배포
  15:30 - 이전 service_account 비활성화
  16:00 - 검증(테스트 KPI push 성공 확인)
  16:30 - 감사 로그 기록

Owners:
  우리: 시스템 관리자
  ERP: 담당 DBA
```

### 6.2 7월 로테이션

동일 절차.

---

## 7. 긴급 대응 (토큰 누출 시)

만약 ERP_SERVICE_SECRET이 노출되었다면:

```
Step 1: 즉시 .env에서 SECRET 변경 + 배포 (1시간 내)
Step 2: ERP 관리자에게 알림 (즉시)
Step 3: ERP에서 이전 service_account 비활성화 (30분 내)
Step 4: 새 SECRET으로 재발급 및 배포
Step 5: 감사 로그 기록 (사건 상황서 작성)
Step 6: 사후 분석(임시 + 정기 검토)
```

---

## 완료 체크리스트

- [x] read-only DB 계정 정책 명시(SELECT only, VIEW 강제)
- [x] 권한 설계(erp_users_public, erp_teams_public)
- [x] 암호 관리(.env 권한 600, 반기 로테이션)
- [x] API 서비스계정 JWT 갱신 주기 24h 확정
- [x] Safe Token Pattern 설명(우리는 시크릿만 보유, ERP가 발급)
- [x] ERP 신설 필수항목(service_accounts 테이블, token 엔드포인트)
- [x] 환경변수 관리(ERP_SERVICE_SECRET, .env 600)
- [x] 토큰 캐시 정책(TTL < 1시간)
- [x] 접근 감시(쿼리 로그, 감사 로그)
- [x] 반기 로테이션 절차(1월/7월)
- [x] 긴급 대응(토큰 누출 시)
