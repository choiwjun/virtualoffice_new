"""비밀번호 설정 토큰 — E4 (24-spec Phase 3 초대 + Phase 6 리셋 통합)

Revision ID: 0006_auth_token
Revises: 0005_native_users

초대(최초 비밀번호 설정)와 재설정은 "1회용 링크 → 본인이 설정 → 즉시 로그인"으로 동일한
흐름이라 한 테이블(`auth_token`)에 `purpose`로 구분해 담는다. 평문 토큰은 저장하지 않고
sha256만 남긴다.

  Step A : auth_token 테이블 생성 (없을 때만).
  Step B : 조회 인덱스 — token_hash(검증 경로) · (company_id, user_id)(관리 조회).

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 신규 배포는 create_all이 정본이고,
이 리비전은 기존 DB에 테이블·인덱스를 멱등적으로 추가한다(재실행 안전).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_auth_token"
down_revision: Union[str, None] = "0005_native_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "auth_token"


def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def _has_index(bind, table: str, index: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return False
    return any(ix["name"] == index for ix in insp.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()

    # ── Step A: 테이블 ──
    if not _has_table(bind, _TABLE):
        op.create_table(
            _TABLE,
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.BigInteger(), nullable=False),
            sa.Column("purpose", sa.String(length=20), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            # 회사/유저가 사라지면 토큰도 함께 소멸 — 살아남으면 유령 링크가 된다.
            sa.ForeignKeyConstraint(["company_id"], ["company.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["erp_user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["erp_user.id"], ondelete="SET NULL"),
        )

    # ── Step B: 인덱스 (create_all 경로는 모델 index=True가 ix_* 를 이미 만든다) ──
    for name, cols in (
        ("ix_auth_token_token_hash", ["token_hash"]),
        ("ix_auth_token_company_id", ["company_id"]),
        ("ix_auth_token_user_id", ["user_id"]),
    ):
        if not _has_index(bind, _TABLE, name):
            op.create_index(name, _TABLE, cols)
    if not _has_index(bind, _TABLE, "idx_auth_token_company_user"):
        op.create_index("idx_auth_token_company_user", _TABLE, ["company_id", "user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, _TABLE):
        op.drop_table(_TABLE)
