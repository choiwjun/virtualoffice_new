"""fact 테이블 테넌트 스코프 비정규화 — Phase 1c (24-spec Phase 1 · 22 T1-3 인덱싱 + T0-1 격리)

Revision ID: 0004_fact_scope
Revises: 0003_meeting_seat_scope

work_log·kpi_result·report·notice·chat_message·presence에 company_id를 비정규화해서 쿼리
스코프(IDOR 차단 + 인덱스)의 단일 필터 컬럼을 심는다.
  Step A (additive) : 6개 테이블 company_id 컬럼 보장 (server_default 1). SQLite ALTER ADD
                      COLUMN은 NOT NULL + 상수 default면 안전.
  Step B (backfill) : user_id 보유 테이블(work_log/kpi_result/report/chat_message/presence)은
                      erp_user.company_id에서 백필. notice(user_id 없음)는 → 1.
  Step C (index)    : idx_{table}_company (스코프 필터 가속, T1-3).

## 규약
0001_initial이 Base.metadata.create_all로 최신 모델(company_id 포함)을 생성하므로, 신규 배포는
create_all 경로가 정본이다. 이 리비전은 **기존(0003까지 배포된)** DB에 컬럼·백필·인덱스를 멱등적으로
적용한다. 모든 단계는 테이블/컬럼 존재 검사로 가드하며 재실행해도 안전(idempotent).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_fact_scope"
down_revision: Union[str, None] = "0003_meeting_seat_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# user_id로 erp_user.company_id를 백필하는 테이블 (notice는 제외 — user_id 없음)
_USER_FK_TABLES = ("work_log", "kpi_result", "report", "chat_message", "presence")
# company_id를 심는 전체 대상 테이블
_ALL_TABLES = _USER_FK_TABLES + ("notice",)


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
    for table in _ALL_TABLES:
        if _has_table(bind, table) and not _has_column(bind, table, "company_id"):
            op.add_column(
                table,
                sa.Column(
                    "company_id",
                    sa.Integer(),
                    nullable=False,
                    server_default=sa.text("1"),
                ),
            )

    # ── Step B: 백필 (user의 실제 테넌트 도출) ──
    # user_id 보유 테이블 ← erp_user.company_id (폴백: server_default 1)
    if _has_table(bind, "erp_user"):
        for table in _USER_FK_TABLES:
            if _has_column(bind, table, "company_id"):
                op.execute(
                    f"""
                    UPDATE {table}
                    SET company_id = (
                        SELECT u.company_id FROM erp_user u WHERE u.id = {table}.user_id
                    )
                    WHERE EXISTS (
                        SELECT 1 FROM erp_user u WHERE u.id = {table}.user_id
                    )
                    """
                )
    # notice(user_id 없음) 및 남은 NULL → 1
    for table in _ALL_TABLES:
        if _has_column(bind, table, "company_id"):
            op.execute(f"UPDATE {table} SET company_id = 1 WHERE company_id IS NULL")

    # ── Step C: 인덱스 (스코프 필터 가속, T1-3) ──
    # create_all 경로는 모델 index=True가 이미 ix_{table}_company_id를 만든다 →
    # 그 경우 중복 인덱스를 만들지 않는다. ALTER 경로(자동 인덱스 없음)에서만 생성.
    for table in _ALL_TABLES:
        if (
            _has_column(bind, table, "company_id")
            and not _has_index(bind, table, f"idx_{table}_company")
            and not _has_index(bind, table, f"ix_{table}_company_id")
        ):
            op.create_index(f"idx_{table}_company", table, ["company_id"])


def downgrade() -> None:
    bind = op.get_bind()

    # company_id에 걸린 모든 인덱스를 먼저 제거한다:
    #   - 마이그레이션 명시 인덱스: idx_{table}_company (0003-state ALTER 경로)
    #   - 모델 index=True 자동 인덱스: ix_{table}_company_id (create_all 경로)
    # (남겨두면 batch 재작성 시 삭제된 컬럼을 참조해 실패한다.)
    for table in _ALL_TABLES:
        for ix in (f"idx_{table}_company", f"ix_{table}_company_id"):
            if _has_index(bind, table, ix):
                op.drop_index(ix, table_name=table)

    # company_id는 company.id FK 컬럼 — SQLite는 FK 참여 컬럼의 네이티브 DROP COLUMN을
    # 거부하므로 batch_alter_table(테이블 재작성)로 제거한다. (PG는 일반 DROP으로 재작성됨.)
    for table in _ALL_TABLES:
        if _has_column(bind, table, "company_id"):
            with op.batch_alter_table(table) as batch:
                batch.drop_column("company_id")
