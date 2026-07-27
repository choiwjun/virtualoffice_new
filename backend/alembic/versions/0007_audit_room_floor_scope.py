"""audit_log·room·floor 테넌트 스코프 — Phase 1d (22 T0-1 잔여 · 24-spec Phase 1)

Revision ID: 0007_scope_1d
Revises: 0006_auth_token

Phase 1b/1c가 meeting·seat·fact 테이블을 스코프했지만 세 곳이 남아 있었다:

  - `audit_log` : 권한 변경·KPI 조정·배포 이력이 전 테넌트 공용으로 조회됐다.
  - `room`      : 회의실 피커와 예약 검증이 타사 방까지 보여주고 예약을 허용했다.
  - `floor`     : 좌석 편집기 층 선택이 타사 층을 노출했다.

room·floor는 office 소유로 조인 유도도 가능하지만, 둘 다 **직접 쿼리되는 표면**이고
(GET /api/rooms · /api/floors) 소유 체인이 끊긴 행에서도 스코프가 유지돼야 하므로
Phase 1b/1c와 같은 비정규화 규약을 따른다.

  Step A (additive) : 세 테이블에 company_id (NOT NULL, server_default 1).
  Step B (backfill) : audit_log ← erp_user.company_id(user_id 경유),
                      floor     ← office.company_id,
                      room      ← floor.company_id(위에서 채운 값). 남은 NULL → 1.
  Step C (index)    : 스코프 필터 가속.

## 규약
0001_initial이 create_all로 최신 모델을 만드므로 신규 배포는 create_all이 정본이고,
이 리비전은 기존 DB에 컬럼·백필·인덱스를 멱등적으로 적용한다(재실행 안전).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_scope_1d"
down_revision: Union[str, None] = "0006_auth_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("audit_log", "floor", "room")


def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def _has_index(bind, table: str, index: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return False
    return any(ix["name"] == index for ix in insp.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()

    # ── Step A: 컬럼 보장 ──
    for table in _TABLES:
        if _has_table(bind, table) and not _has_column(bind, table, "company_id"):
            op.add_column(
                table,
                sa.Column(
                    "company_id", sa.Integer(), nullable=False, server_default=sa.text("1")
                ),
            )

    # ── Step B: 백필 (소유 관계에서 실제 테넌트 도출) ──
    # audit_log ← 행위자의 회사. user_id가 NULL(시스템 기록)이면 default 1 유지.
    if _has_column(bind, "audit_log", "company_id") and _has_table(bind, "erp_user"):
        op.execute(
            """
            UPDATE audit_log
            SET company_id = (
                SELECT u.company_id FROM erp_user u WHERE u.id = audit_log.user_id
            )
            WHERE EXISTS (SELECT 1 FROM erp_user u WHERE u.id = audit_log.user_id)
            """
        )
    # floor ← office.company_id
    if _has_column(bind, "floor", "company_id") and _has_table(bind, "office"):
        op.execute(
            """
            UPDATE floor
            SET company_id = (
                SELECT o.company_id FROM office o WHERE o.id = floor.office_id
            )
            WHERE EXISTS (SELECT 1 FROM office o WHERE o.id = floor.office_id)
            """
        )
    # room ← floor.company_id (위에서 채워진 값 사용 — 순서 의존이므로 floor 뒤에 온다)
    if _has_column(bind, "room", "company_id") and _has_table(bind, "floor"):
        op.execute(
            """
            UPDATE room
            SET company_id = (
                SELECT f.company_id FROM floor f WHERE f.id = room.floor_id
            )
            WHERE EXISTS (SELECT 1 FROM floor f WHERE f.id = room.floor_id)
            """
        )
    # 소유 체인이 끊긴 고아 행 → 기본 테넌트
    for table in _TABLES:
        if _has_column(bind, table, "company_id"):
            op.execute(f"UPDATE {table} SET company_id = 1 WHERE company_id IS NULL")

    # ── Step C: 인덱스 (create_all 경로는 모델 index=True가 ix_* 를 이미 만든다) ──
    for table in _TABLES:
        if (
            _has_column(bind, table, "company_id")
            and not _has_index(bind, table, f"idx_{table}_company")
            and not _has_index(bind, table, f"ix_{table}_company_id")
        ):
            op.create_index(f"idx_{table}_company", table, ["company_id"])


def downgrade() -> None:
    bind = op.get_bind()

    # company_id에 걸린 인덱스를 먼저 제거한다(남으면 batch 재작성이 삭제된 컬럼을 참조해 실패).
    for table in _TABLES:
        for ix in (f"idx_{table}_company", f"ix_{table}_company_id"):
            if _has_index(bind, table, ix):
                op.drop_index(ix, table_name=table)

    # company.id FK 참여 컬럼 — SQLite는 네이티브 DROP COLUMN을 거부하므로 batch로 재작성.
    for table in _TABLES:
        if _has_column(bind, table, "company_id"):
            with op.batch_alter_table(table) as batch:
                batch.drop_column("company_id")
