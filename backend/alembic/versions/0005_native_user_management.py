"""native 유저 관리 토대 — Phase 3 / E3 (24-spec Phase 3 · 23 E3·E12)

Revision ID: 0005_native_users
Revises: 0004_fact_scope

admin이 콘솔에서 직접 유저를 만들 수 있게 하려면 "ERP가 정본인 유저"와 "우리가 만든
유저"를 데이터에서 구분해야 한다. 구분이 없으면 ERP 전체 대사(sync_users)가 native
유저를 "ERP에서 사라진 사용자"로 오탐해 비활성화한다.

  Step A (additive) : erp_user.source 컬럼 (NOT NULL, server_default 'erp').
                      company.seat_limit 컬럼 (NULL=무제한).
  Step B (backfill) : id >= 1_000_000_000(auth._NATIVE_ID_FLOOR)인 기존 행 → 'native'.
                      E2 셀프가입(POST /api/auth/register)이 만든 첫 admin이 이 대역에
                      있다. 그 외 기존 데이터는 ERP 미러/시드 → 'erp' 유지(현행 sync
                      동작 보존, 비파괴).
  Step C (index)    : idx_erp_user_source (sync 대사 필터).

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 신규 배포는 create_all이 정본이고,
이 리비전은 기존 DB에 컬럼·백필·인덱스를 멱등적으로 적용한다(재실행 안전).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_native_users"
down_revision: Union[str, None] = "0004_fact_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# app.api.auth._NATIVE_ID_FLOOR 와 동일 상수 (마이그레이션은 앱 코드를 import 하지 않는다).
_NATIVE_ID_FLOOR = 1_000_000_000


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
    if _has_table(bind, "erp_user") and not _has_column(bind, "erp_user", "source"):
        op.add_column(
            "erp_user",
            sa.Column(
                "source",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'erp'"),
            ),
        )
    if _has_table(bind, "company") and not _has_column(bind, "company", "seat_limit"):
        # NULL 허용 = 기존 회사는 무제한 (게이트 미적용) → 비파괴.
        op.add_column("company", sa.Column("seat_limit", sa.Integer(), nullable=True))

    # ── Step B: 백필 (셀프가입 대역 = native) ──
    if _has_column(bind, "erp_user", "source"):
        op.execute("UPDATE erp_user SET source = 'erp' WHERE source IS NULL")
        op.execute(
            f"UPDATE erp_user SET source = 'native' WHERE id >= {_NATIVE_ID_FLOOR}"
        )

    # ── Step C: 인덱스 (sync 대사 필터 가속) ──
    # create_all 경로는 모델 index=True가 ix_erp_user_source를 이미 만든다 → 중복 생성 금지.
    if (
        _has_column(bind, "erp_user", "source")
        and not _has_index(bind, "erp_user", "idx_erp_user_source")
        and not _has_index(bind, "erp_user", "ix_erp_user_source")
    ):
        op.create_index("idx_erp_user_source", "erp_user", ["source"])


def downgrade() -> None:
    bind = op.get_bind()

    for ix in ("idx_erp_user_source", "ix_erp_user_source"):
        if _has_index(bind, "erp_user", ix):
            op.drop_index(ix, table_name="erp_user")

    if _has_column(bind, "erp_user", "source"):
        with op.batch_alter_table("erp_user") as batch:
            batch.drop_column("source")
    if _has_column(bind, "company", "seat_limit"):
        with op.batch_alter_table("company") as batch:
            batch.drop_column("seat_limit")
