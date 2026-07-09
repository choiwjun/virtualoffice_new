# migration-strategy.md: Alembic 마이그레이션 전략

> 🟡 **D27 부분 개정(2026-07-09) — company_id INTEGER 정정 반영.** 마이그레이션 정본은 `04-data-model.md` 스키마 기준. asset `tscn_path`→신스키마(3d-design/asset-registry §1.1) Alembic 마이그레이션 별도 필요.

**작성일**: 2026-07-02  
**상태**: 확정 (Phase 0, P0-T0.3)  
**정본 참조**: `04-data-model.md`, `00-decisions.md` (D18, D19)

> 이 문서는 Alembic 운영 원칙, ERP 동기화 마이그레이션, 초기 fixtures, enum 변경 절차, 롤백 정책을 정의합니다.

---

## 1. Alembic 운영 원칙

### 1.1 기본 구조

```
alembic/
├── env.py                    # Alembic 환경 설정
├── script.py.mako            # 마이그레이션 템플릿
├── versions/
│   ├── 001_create_core_tables.py
│   ├── 002_add_erp_sync.py
│   ├── 003_add_kpi_system.py
│   └── ...
└── README
```

### 1.2 마이그레이션 파일 명명 규칙

```
{순번}_{기능명}.py

예시:
- 001_create_core_tables.py       # 핵심 테이블(erp_user, office, floor 등)
- 002_add_erp_sync.py             # ERP 동기화 테이블(user_team_history, is_active)
- 003_add_kpi_system.py           # KPI 시스템(kpi_result, daily_status_push)
- 004_add_audit_log.py            # 감사 로그 계층
- 005_add_indexes.py              # 성능 인덱스
- 006_create_enums.py             # Enum 타입 (PostgreSQL)
```

### 1.3 autogenerate 검토 프로세스

**금지 사항**: 자동 마이그레이션 생성 후 무조건 적용 금지!

**필수 프로세스**:

```bash
# Step 1: 자동 생성 (초안)
alembic revision --autogenerate -m "Add users table"

# Step 2: 검토 (마이그레이션 파일 내용 확인)
# → Check: DROP TABLE, ALTER COLUMN 등 위험 작업 여부
# → Check: 인덱스, FK, 제약조건 올바른지 확인

# Step 3: 테스트 (개발 환경)
alembic upgrade head   # 적용
pytest tests/models/  # 테스트 실행
alembic downgrade -1  # 롤백 테스트
alembic upgrade head  # 재적용

# Step 4: 코드 리뷰 (팀원)
# 마이그레이션 파일 자체가 코드 리뷰 대상

# Step 5: 프로덕션 배포
# SQL 스크립트 export 후 DBA 검증
alembic upgrade head --sql > migration.sql
```

---

## 2. Phase 0 초기 마이그레이션 순서

### 2.1 Migration 001: 핵심 테이블 생성

**대상**: erp_user, org_group, team_zone, office, floor, room, seat 등 8개 테이블

```python
# alembic/versions/001_create_core_tables.py

def upgrade():
    # 1. PostgreSQL Enum 타입 생성
    op.execute("""
        CREATE TYPE presence_status AS ENUM (
            'offline', 'online', 'working', 'meeting', 'focus', 'away', 'external'
        );
        CREATE TYPE seat_type AS ENUM ('fixed', 'free', 'temp', 'partner');
        CREATE TYPE seat_status AS ENUM ('available', 'occupied', 'disabled', 'reserved');
        CREATE TYPE meeting_status AS ENUM (
            'scheduled', 'in_progress', 'completed', 'cancelled'
        );
        CREATE TYPE office_layout_status AS ENUM (
            'draft', 'validated', 'deployed', 'archived'
        );
        CREATE TYPE erp_role AS ENUM (
            'employee', 'leader', 'admin', 'super_admin'
        );
        CREATE TYPE org_group_type AS ENUM (
            'division', 'department', 'part'
        );
        CREATE TYPE room_type AS ENUM (
            'lobby', 'meeting', 'lounge', 'focus', 'phonebooth'
        );
    """)

    # 2. erp_user (ERP 동기화의 기초)
    op.create_table('erp_user',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('erp_team_id', sa.BigInteger(), nullable=False),
        sa.Column('role', Enum('employee', 'leader', 'admin', 'super_admin', name='erp_role'), nullable=False),
        sa.Column('position', sa.String(255), nullable=True),
        sa.Column('position_id', sa.BigInteger(), nullable=True),
        sa.Column('manager_id', sa.BigInteger(), nullable=True),
        sa.Column('work_type', sa.String(50), nullable=True),
        sa.Column('work_hours', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),  # soft-delete (D18)
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['manager_id'], ['erp_user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_erp_user_company_email', 'erp_user', ['company_id', 'email'], unique=True)
    op.create_index('idx_erp_user_team', 'erp_user', ['erp_team_id'])
    op.create_index('idx_erp_user_role', 'erp_user', ['role'])
    op.create_index('idx_erp_user_is_active', 'erp_user', ['is_active'])

    # 3. org_group (조직 계층)
    op.create_table('org_group',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),  # ERP company_id와 동일 값(04 §2.2 정본, FK 아님)
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('type', Enum('division', 'department', 'part', name='org_group_type'), nullable=False),
        sa.Column('parent_id', sa.UUID(), nullable=True),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['parent_id'], ['org_group.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_org_group_company_parent', 'org_group', ['company_id', 'parent_id'])

    # 4. office (사무실)
    op.create_table('office',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),  # ERP company_id와 동일 값(04 §2.2 정본, FK 아님)
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('address', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_office_company', 'office', ['company_id'])

    # 5. floor (층)
    op.create_table('floor',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('office_id', sa.UUID(), nullable=False),
        sa.Column('level', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('minimap_config', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['office_id'], ['office.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('office_id', 'level')
    )
    op.create_index('idx_floor_office', 'floor', ['office_id'])

    # 6. team_zone (팀↔구역)
    op.create_table('team_zone',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('erp_team_id', sa.BigInteger(), nullable=False),
        sa.Column('org_group_id', sa.UUID(), nullable=False),
        sa.Column('office_id', sa.UUID(), nullable=False),
        sa.Column('floor_id', sa.UUID(), nullable=False),
        sa.Column('zone_label', sa.String(255), nullable=False),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('polygon', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['org_group_id'], ['org_group.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['office_id'], ['office.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['floor_id'], ['floor.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('erp_team_id', 'office_id', 'floor_id')
    )
    # ... (나머지 테이블)

def downgrade():
    # 역순으로 테이블 삭제
    op.drop_table('team_zone')
    op.drop_table('floor')
    # ... 기타
    op.execute('DROP TYPE org_group_type')
    # ... enum 타입 삭제
```

### 2.2 Migration 002: ERP 동기화 테이블

**대상**: user_team_history, presence, audit_log

```python
# alembic/versions/002_add_erp_sync.py

def upgrade():
    # user_team_history (팀 이동 이력, D18)
    op.create_table('user_team_history',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('erp_team_id', sa.BigInteger(), nullable=False),
        sa.Column('valid_from', sa.DateTime(timezone=True), nullable=False),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['erp_user.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_user_team_history_user', 'user_team_history', ['user_id', 'valid_from'])
    op.create_index('idx_user_team_history_team', 'user_team_history', ['erp_team_id', 'valid_from'])

    # presence (실시간 상태, D13)
    op.create_table('presence',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('office_id', sa.UUID(), nullable=False),
        sa.Column('floor_id', sa.UUID(), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('z', sa.Float(), nullable=False),
        sa.Column('status', Enum('offline', 'online', 'working', 'meeting', 'focus', 'away', 'external', name='presence_status'), nullable=False),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['erp_user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['office_id'], ['office.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['floor_id'], ['floor.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('user_id')
    )
    # ... 인덱스

def downgrade():
    op.drop_table('presence')
    op.drop_table('user_team_history')
```

### 2.3 Migration 003: KPI & 협업 시스템

**대상**: work_log, kpi_result, daily_status_push, meeting, meeting_minute, action_item 등

```python
# alembic/versions/003_add_kpi_collaboration.py

def upgrade():
    # Enum 타입 확장
    op.execute("""
        CREATE TYPE kpi_period_type AS ENUM ('daily', 'quarterly');
        CREATE TYPE kpi_objection_status AS ENUM ('none', 'submitted', 'reviewing', 'resolved');
        CREATE TYPE work_log_status AS ENUM ('started', 'completed');
        CREATE TYPE meeting_minute_status AS ENUM ('draft', 'finalized');
        CREATE TYPE daily_status_push_target AS ENUM ('erp_daily_reports', 'erp_kpi_results');
        CREATE TYPE daily_status_push_status AS ENUM ('pending', 'sent', 'failed');
    """)

    # work_log
    op.create_table('work_log', ...)

    # kpi_result (정본 스키마, D16)
    op.create_table('kpi_result',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('period_type', Enum('daily', 'quarterly', name='kpi_period_type'), nullable=False),
        sa.Column('period_key', sa.String(20), nullable=False),  # NOT NULL (D16)
        sa.Column('metric', sa.String(100), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('unit', sa.String(50), nullable=True),
        sa.Column('source', Enum('virtual_office', name='kpi_source'), nullable=False, server_default='virtual_office'),
        sa.Column('ai_draft', sa.JSON(), nullable=True),
        sa.Column('ai_draft_generated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ai_model', sa.String(50), nullable=False, server_default='claude-opus'),
        sa.Column('admin_adjusted_score', sa.Float(), nullable=True),
        sa.Column('admin_note', sa.Text(), nullable=True),
        sa.Column('admin_user_id', sa.BigInteger(), nullable=True),
        sa.Column('admin_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('objection_status', Enum('none', 'submitted', 'reviewing', 'resolved', name='kpi_objection_status'), 
                 nullable=False, server_default='none'),
        sa.Column('objection_detail', sa.JSON(), nullable=True),
        sa.Column('objection_submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('objection_resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('final_score', sa.Float(), nullable=True),
        sa.Column('finalized_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('pushed_to_erp', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('pushed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['erp_user.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['admin_user_id'], ['erp_user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'period_type', 'period_key', 'metric', name='uq_kpi_result_metric')
    )
    # ... 인덱스

    # daily_status_push
    op.create_table('daily_status_push', ...)

    # meeting, meeting_participant, meeting_minute, action_item
    op.create_table('meeting', ...)
    # ... 기타

def downgrade():
    op.drop_table('daily_status_push')
    op.drop_table('kpi_result')
    op.drop_table('work_log')
    op.drop_table('action_item')
    op.drop_table('meeting_minute')
    op.drop_table('meeting_participant')
    op.drop_table('meeting')
    # ... enum 타입 삭제
```

---

## 3. 초기 Fixtures 생성 계획

### 3.1 Fixtures 데이터 범위

**필수 초기 데이터**:

```
1. office (1개): "본사"
2. floor (3개): 1층, 2층, 3층
3. room (10개): 회의실A~E, 라운지1~2, 집중실1~2, 폰부스
4. org_group (3개): 엔지니어링, 디자인, 마케팅 (계층)
5. team_zone (3개): 각 팀당 한 팀 구역 (예: B1 Floor 1)
6. erp_user (20명): 테스트 직원
   - 관리자 1명
   - 팀장 3명
   - 일반 직원 16명
7. seat (30개): 고정석 20개 + 자율석 10개
8. seat_assignment_history: 초기 배정 이력
9. office_layout: draft 상태 샘플 레이아웃

**선택 초기 데이터** (후속):
- meeting (샘플 회의 5개)
- work_log (테스트 데이터)
- kpi_result (샘플 평가 데이터)
```

### 3.2 Fixtures 생성 스크립트 (Seed)

```python
# scripts/seed_initial_data.py

import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from core.config import settings
from models.tables import *
from datetime import datetime, timezone, timedelta
import uuid

async def seed_data():
    engine = create_async_engine(settings.DATABASE_URL, echo=True)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # 1. Office (1개)
        office = Office(
            id=uuid.uuid4(),
            company_id=1,  # ERP company_id(INTEGER, 사내 단일값) — 04 §2.2 정본
            name="본사",
            address="서울시 강남구",
        )
        session.add(office)
        await session.flush()

        # 2. Floor (3개)
        floors = []
        for level in [1, 2, 3]:
            floor = Floor(
                id=uuid.uuid4(),
                office_id=office.id,
                level=level,
                name=f"{level}층 오픈좌석",
            )
            session.add(floor)
            floors.append(floor)
        await session.flush()

        # 3. Room (10개)
        rooms = []
        room_types = [
            (RoomType.MEETING, "컨퍼런스룸A", 8),
            (RoomType.MEETING, "컨퍼런스룸B", 6),
            (RoomType.MEETING, "컨퍼런스룸C", 4),
            (RoomType.LOUNGE, "라운지1", 12),
            (RoomType.LOUNGE, "라운지2", 10),
            (RoomType.FOCUS, "집중실1", 2),
            (RoomType.FOCUS, "집중실2", 2),
            (RoomType.PHONEBOOTH, "폰부스1", 1),
            (RoomType.PHONEBOOTH, "폰부스2", 1),
        ]
        for rtype, name, capacity in room_types:
            room = Room(
                id=uuid.uuid4(),
                floor_id=floors[0].id,
                type=rtype,
                name=name,
                capacity=capacity,
                coords={"x": 0, "y": 0, "z": 0},
            )
            session.add(room)
            rooms.append(room)
        await session.flush()

        # 4. OrgGroup (3개)
        org_groups = []
        for dept in ["엔지니어링", "디자인", "마케팅"]:
            og = OrgGroup(
                id=uuid.uuid4(),
                company_id=office.company_id,
                name=dept,
                type=OrgGroupType.DEPARTMENT,
            )
            session.add(og)
            org_groups.append(og)
        await session.flush()

        # 5. ErpUser (20명)
        users = []
        user_data = [
            ("admin@company.com", "관리자", ErpRole.ADMIN),
            ("leader1@company.com", "팀장1", ErpRole.LEADER),
            ("leader2@company.com", "팀장2", ErpRole.LEADER),
            ("leader3@company.com", "팀장3", ErpRole.LEADER),
        ]
        for i in range(16):
            user_data.append((f"user{i+1}@company.com", f"직원{i+1}", ErpRole.EMPLOYEE))

        for email, name, role in user_data:
            user = ErpUser(
                id=1000 + users.__len__(),
                company_id=office.company_id,
                email=email,
                name=name,
                erp_team_id=1,
                role=role,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(user)
            users.append(user)
        await session.flush()

        # 6. TeamZone (3개)
        for idx, og in enumerate(org_groups):
            tz = TeamZone(
                id=uuid.uuid4(),
                erp_team_id=1 + idx,
                org_group_id=og.id,
                office_id=office.id,
                floor_id=floors[0].id,
                zone_label=f"{og.name} 구역",
            )
            session.add(tz)
        await session.flush()

        # 7. Seat (30개)
        for i in range(30):
            seat_type = SeatType.FIXED if i < 20 else SeatType.FREE
            assigned_user = users[i % len(users)] if i < 20 else None
            seat = Seat(
                id=uuid.uuid4(),
                floor_id=floors[0].id,
                team_zone_id=None,
                type=seat_type,
                assigned_user_id=assigned_user.id if assigned_user else None,
                coords={"x": i * 1.0, "y": 0, "z": 0},
                status=SeatStatus.OCCUPIED if assigned_user else SeatStatus.AVAILABLE,
                seat_number=f"1-A-{i+1:02d}",
            )
            session.add(seat)
        await session.flush()

        # 8. Presence (모든 활성 직원)
        for user in users:
            presence = Presence(
                user_id=user.id,
                office_id=office.id,
                floor_id=floors[0].id,
                x=0, y=0, z=0,
                status=PresenceStatus.ONLINE,
                updated_at=datetime.now(timezone.utc),
            )
            session.add(presence)

        await session.commit()
        print("✅ Initial fixtures created successfully!")

# 실행
# asyncio.run(seed_data())
```

### 3.3 Fixtures 실행 방법

```bash
# 1. 마이그레이션 적용
alembic upgrade head

# 2. Seed 스크립트 실행
python scripts/seed_initial_data.py

# 3. 검증
pytest tests/fixtures/  # 초기 데이터 검증 테스트
```

---

## 4. Enum 변경 절차

### 4.1 Enum 값 추가

**금지**: 기존 값 변경 / 값 순서 변경

**필수 절차**:

```python
# Migration 파일: XXX_add_enum_value.py

def upgrade():
    # PostgreSQL Enum 타입에 값 추가 (가상 enum 예시 — sample_status)
    op.execute("ALTER TYPE sample_status ADD VALUE 'archived'")  # BEFORE 'x'로 위치 지정 가능
    # ⚠️ 실제 presence_status는 D13 7종(offline/online/working/meeting/focus/away/external) 고정 — 값 추가 금지

def downgrade():
    # PostgreSQL Enum은 값 삭제 불가 (대신 deprecated 처리)
    raise Exception("PostgreSQL Enum values cannot be removed. Mark as deprecated instead.")
```

### 4.2 Enum 값 제거 (대체 방법)

```python
# 방법: deprecated 플래그 추가

def upgrade():
    # 컬럼 추가: deprecated
    op.add_column('presence', 
        sa.Column('_deprecated_status', sa.String(50), nullable=True)
    )
    
    # 애플리케이션 로직에서 deprecated 값 거부
    # if status in ['old_status']:
    #     raise ValueError("Status no longer supported")

def downgrade():
    op.drop_column('presence', '_deprecated_status')
```

---

## 5. 롤백 정책

### 5.1 개발 환경 (로컬)

```bash
# 가장 최근 마이그레이션 1개 롤백
alembic downgrade -1

# 특정 버전까지 롤백
alembic downgrade 001_create_core_tables

# 모든 마이그레이션 롤백
alembic downgrade base
```

### 5.2 스테이징 환경

**조건**:
1. 마이그레이션 자동 테스트 통과 (pytest)
2. 데이터 손실 없음 (soft-delete만 사용)
3. FK 제약 위반 없음

```bash
# 안전 롤백
alembic downgrade -1  # 마이그레이션 1개 롤백

# 검증
SELECT COUNT(*) FROM erp_user;  # 데이터 확인
```

### 5.3 프로덕션 환경 (금지)

**원칙**: 프로덕션 롤백 금지 (대신 Forward 마이그레이션만 사용)

**예외 상황 절차**:
1. DBA 협의 필수
2. 데이터 백업 완료 후
3. 마이그레이션 Downgrade SQL 수동 검토
4. 서비스 중단 시간 공지
5. 롤백 후 원인 분석 및 Fix 마이그레이션 준비

---

## 6. ERP 동기화 마이그레이션

### 6.1 ERP users 동기화 초기화

**절차**:
1. ERP users 전체 조회 (화이트리스트 VIEW 경유)
2. erp_user 테이블 bulk insert
3. user_team_history 초기 레코드 생성 (valid_from = migration 실행 시각)

```python
# Migration 또는 사후 스크립트

async def init_erp_user_sync():
    """ERP users 최초 동기화"""
    
    # 1. ERP 원본에서 조회 (화이트리스트 VIEW)
    erp_users = await erp_db.query("""
        SELECT id, company_id, email, name, team_id, role, position, position_id,
               manager_id, work_type, work_hours, updated_at
        FROM erp_users_public
        WHERE company_id = ?
    """, (COMPANY_ID,))

    # 2. bulk insert
    now = datetime.now(timezone.utc)
    for eu in erp_users:
        await our_db.execute("""
            INSERT INTO erp_user 
            (id, company_id, email, name, erp_team_id, role, ...)
            VALUES (?, ?, ?, ?, ?, ?, ...)
            ON CONFLICT DO NOTHING
        """, (...))

        # 3. user_team_history 초기 레코드
        await our_db.execute("""
            INSERT INTO user_team_history (user_id, erp_team_id, valid_from, valid_to)
            VALUES (?, ?, ?, NULL)
            ON CONFLICT DO NOTHING
        """, (eu.id, eu.team_id, now))
```

### 6.2 ERP soft-delete 감지 마이그레이션

```python
# Migration: 002_add_erp_sync.py

def upgrade():
    # is_active 컬럼 추가 (기존 데이터는 TRUE로 설정)
    op.add_column('erp_user', 
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true')
    )
    
    # 동기화 시간 컬럼
    op.add_column('erp_user',
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True)
    )
```

---

## 7. 테스트 전략

### 7.1 마이그레이션 테스트

```python
# tests/test_migrations.py

async def test_migration_001_up():
    """Migration 001 적용 검증"""
    # 1. alembic upgrade 001
    # 2. 테이블 존재 확인
    # 3. 컬럼, 인덱스, FK 검증
    result = await db.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'erp_user'")
    assert result.scalar() == 1

async def test_migration_001_down():
    """Migration 001 롤백 검증"""
    # 1. alembic downgrade base
    # 2. 테이블 삭제 확인
    result = await db.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'erp_user'")
    assert result.scalar() == 0

async def test_erp_user_unique_constraint():
    """ERP user unique 제약 검증"""
    # duplicate 시도 → 에러 발생 확인
    with pytest.raises(IntegrityError):
        await db.execute("""
            INSERT INTO erp_user (id, company_id, email, name, erp_team_id, role)
            VALUES (1, 1, 'test@company.com', 'Test', 1, 'employee'),
                   (2, 1, 'test@company.com', 'Test2', 1, 'employee')
        """)
```

### 7.2 모델 테스트

```python
# tests/test_models.py

async def test_erp_user_soft_delete():
    """soft-delete 동작 검증"""
    user = ErpUser(id=1, company_id=1, email='test@company.com', ...)
    session.add(user)
    await session.commit()

    # soft-delete
    user.is_active = False
    await session.commit()

    # 물리 삭제 아님
    result = await session.get(ErpUser, 1)
    assert result is not None
    assert result.is_active is False

async def test_kpi_result_unique_metric():
    """KPI metric unique 제약"""
    kpi1 = KpiResult(
        user_id=1, period_type='daily', period_key='2026-07-01',
        metric='work_completed_count', value=5
    )
    session.add(kpi1)
    await session.commit()

    # 중복 시도 → 에러
    kpi2 = KpiResult(
        user_id=1, period_type='daily', period_key='2026-07-01',
        metric='work_completed_count', value=10
    )
    session.add(kpi2)
    with pytest.raises(IntegrityError):
        await session.commit()
```

---

## 8. 마이그레이션 실행 체크리스트

### Phase 0 배포 전

- [ ] Migration 001: 핵심 테이블 생성 (alembic upgrade head 성공)
- [ ] Migration 테스트 통과 (pytest tests/test_migrations.py -v)
- [ ] 모델 테스트 통과 (pytest tests/models/ -v)
- [ ] Fixtures 생성 완료 (python scripts/seed_initial_data.py)
- [ ] Rollback 테스트 성공 (alembic downgrade -1 + 재적용)
- [ ] FK 제약 검증 (no dangling references)
- [ ] 인덱스 생성 확인 (EXPLAIN ANALYZE)
- [ ] DBA 리뷰 완료

### Phase 1+ 배포 전

- [ ] 새 Migration 자동 생성 검토 (alembic revision --autogenerate)
- [ ] 위험 작업 제거 (DROP TABLE, ALTER COLUMN 검토)
- [ ] 마이그레이션 테스트 추가 (해당 마이그레이션용)
- [ ] 성능 테스트 (대용량 데이터 환경)
- [ ] 롤백 경로 검증 (downgrade 테스트)

---

## 9. 참고: 마이그레이션 파일 템플릿

```python
# alembic/versions/XXX_migration_name.py

"""
마이그레이션 제목

Revision ID: {id}
Revises: {parent_id}
Create Date: {timestamp}

정본 참조: 04-data-model.md, 00-decisions.md
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '{id}'
down_revision = '{parent_id}'
branch_labels = None
depends_on = None


def upgrade():
    # 작업 1
    op.create_table(...)
    # 작업 2
    op.create_index(...)
    # 작업 3
    op.execute("...")


def downgrade():
    # 역순 수행
    op.execute("...")
    op.drop_index(...)
    op.drop_table(...)
```

---

## 다음 단계 (12-tasks v3.0 정합)

- [x] Alembic 초기 마이그레이션·핵심 스키마 — **[구현됨]** (백엔드 도메인, pytest 417+ · HG-DATA 게이트)
- [x] ERPUser 동기화 배치 — **[구현됨]** (`erp_sync.py` — 실패 알림 훅 연결은 12-tasks P7-T5)
- [x] FastAPI 모델 serializer·기존 CRUD 엔드포인트 — **[구현됨]** (KPI·좌석·회의·work-log 등)
- [ ] announcement 모델·API 신설 — 12-tasks **P1-T5** (04-data-model §2.7 정본)
- [ ] asset `tscn_path`→신스키마(asset-registry §1.1) Alembic 마이그레이션 — 별도 필요(상단 배너)
