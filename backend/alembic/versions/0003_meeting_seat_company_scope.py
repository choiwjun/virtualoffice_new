"""meeting·seat 테넌트 스코프 비정규화 — Phase 1b (24-spec Phase 1 · 22 T0-1 IDOR + T1-3 인덱싱)

Revision ID: 0003_meeting_seat_scope
Revises: 0002_company

meeting·seat에 company_id를 비정규화해서 쿼리 스코프(IDOR 차단)의 단일 필터 컬럼을 심는다.
  Step A (additive) : meeting·seat.company_id 컬럼 보장 (server_default 1). SQLite ALTER ADD
                      COLUMN은 NOT NULL + 상수 default면 안전.
  Step B (backfill) : meeting.company_id ← room→floor→office.company_id
                      (폴백: host_user의 erp_user.company_id → 1)
                      seat.company_id    ← floor→office.company_id (폴백: 1)
  Step C (index)    : idx_meeting_company / idx_seat_company (스코프 필터 가속).

## 규약
0001_initial이 Base.metadata.create_all로 최신 모델(company_id 포함)을 생성하므로, 신규 배포는
create_all 경로가 정본이다. 이 리비전은 **기존(0002까지 배포된)** DB에 컬럼·백필·인덱스를 멱등적으로
적용한다. 모든 단계는 테이블/컬럼 존재 검사로 가드하며 재실행해도 안전(idempotent).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_meeting_seat_scope"
down_revision: Union[str, None] = "0002_company"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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

    # ── Step A: 컬럼 보장 (create_all이 이미 만든 경우 스킵) ──
    # NOT NULL + server_default('1') → SQLite/PG 모두 ADD COLUMN 안전.
    if _has_table(bind, "meeting") and not _has_column(bind, "meeting", "company_id"):
        op.add_column(
            "meeting",
            sa.Column(
                "company_id",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )
    if _has_table(bind, "seat") and not _has_column(bind, "seat", "company_id"):
        op.add_column(
            "seat",
            sa.Column(
                "company_id",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )

    # ── Step B: 백필 (관계 그래프에서 실제 테넌트 도출) ──
    # meeting.company_id ← room→floor→office.company_id (폴백: host erp_user, 최종 1)
    if _has_column(bind, "meeting", "company_id"):
        if (
            _has_table(bind, "room")
            and _has_table(bind, "floor")
            and _has_table(bind, "office")
        ):
            op.execute(
                """
                UPDATE meeting
                SET company_id = (
                    SELECT o.company_id
                    FROM room r
                    JOIN floor f ON f.id = r.floor_id
                    JOIN office o ON o.id = f.office_id
                    WHERE r.id = meeting.room_id
                )
                WHERE EXISTS (
                    SELECT 1
                    FROM room r
                    JOIN floor f ON f.id = r.floor_id
                    JOIN office o ON o.id = f.office_id
                    WHERE r.id = meeting.room_id
                )
                """
            )
        # 폴백: room 그래프로 못 채운 회의(그래프 미존재)는 host_user의 회사로.
        # (server_default가 1을 심으므로 IS NULL 대신 '그래프 미존재'로 판정한다.)
        if _has_table(bind, "erp_user") and _has_table(bind, "room"):
            op.execute(
                """
                UPDATE meeting
                SET company_id = (
                    SELECT u.company_id FROM erp_user u WHERE u.id = meeting.host_user_id
                )
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM room r
                    JOIN floor f ON f.id = r.floor_id
                    JOIN office o ON o.id = f.office_id
                    WHERE r.id = meeting.room_id
                  )
                  AND EXISTS (
                    SELECT 1 FROM erp_user u WHERE u.id = meeting.host_user_id
                  )
                """
            )
        # 최종 폴백: 남은 NULL(server_default 없는 경로) → 1
        op.execute("UPDATE meeting SET company_id = 1 WHERE company_id IS NULL")

    # seat.company_id ← floor→office.company_id (폴백: 1)
    if _has_column(bind, "seat", "company_id"):
        if _has_table(bind, "floor") and _has_table(bind, "office"):
            op.execute(
                """
                UPDATE seat
                SET company_id = (
                    SELECT o.company_id
                    FROM floor f
                    JOIN office o ON o.id = f.office_id
                    WHERE f.id = seat.floor_id
                )
                WHERE EXISTS (
                    SELECT 1
                    FROM floor f
                    JOIN office o ON o.id = f.office_id
                    WHERE f.id = seat.floor_id
                )
                """
            )
        op.execute("UPDATE seat SET company_id = 1 WHERE company_id IS NULL")

    # ── Step C: 인덱스 (스코프 필터 가속, T1-3) ──
    # create_all 경로는 모델 index=True가 이미 ix_{table}_company_id를 만든다 →
    # 그 경우 중복 인덱스를 만들지 않는다. ALTER 경로(자동 인덱스 없음)에서만 생성.
    if (
        _has_column(bind, "meeting", "company_id")
        and not _has_index(bind, "meeting", "idx_meeting_company")
        and not _has_index(bind, "meeting", "ix_meeting_company_id")
    ):
        op.create_index("idx_meeting_company", "meeting", ["company_id"])
    if (
        _has_column(bind, "seat", "company_id")
        and not _has_index(bind, "seat", "idx_seat_company")
        and not _has_index(bind, "seat", "ix_seat_company_id")
    ):
        op.create_index("idx_seat_company", "seat", ["company_id"])


def downgrade() -> None:
    bind = op.get_bind()

    # company_id에 걸린 모든 인덱스를 먼저 제거한다:
    #   - 마이그레이션 명시 인덱스: idx_{table}_company (0002-state ALTER 경로)
    #   - 모델 index=True 자동 인덱스: ix_{table}_company_id (create_all 경로)
    # (남겨두면 batch 재작성 시 삭제된 컬럼을 참조해 실패한다.)
    for table in ("seat", "meeting"):
        for ix in (f"idx_{table}_company", f"ix_{table}_company_id"):
            if _has_index(bind, table, ix):
                op.drop_index(ix, table_name=table)

    # company_id는 company.id FK 컬럼 — SQLite는 FK 참여 컬럼의 네이티브 DROP COLUMN을
    # 거부하므로 batch_alter_table(테이블 재작성)로 제거한다. (PG는 일반 DROP으로 재작성됨.)
    if _has_column(bind, "seat", "company_id"):
        with op.batch_alter_table("seat") as batch:
            batch.drop_column("company_id")
    if _has_column(bind, "meeting", "company_id"):
        with op.batch_alter_table("meeting") as batch:
            batch.drop_column("company_id")
