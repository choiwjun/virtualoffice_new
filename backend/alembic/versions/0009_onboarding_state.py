"""첫실행 온보딩 상태 — Phase 5 / E6 (24-spec Phase 5 · 23 E6)

Revision ID: 0009_onboarding
Revises: 0008_branding

체크리스트 **항목**은 저장하지 않는다(좌석·공지·초대 존재 여부를 조회 시점에 실측 파생 —
플래그로 저장하면 데이터가 지워져도 참이 남는다). 저장하는 건 사람의 의사표시 둘뿐:

  - `company.onboarding_dismissed` : 체크리스트 접기 (회사 단위 — admin이 공유)
  - `erp_user.tour_completed`      : 최초 투어 시청 (유저 단위 — 사람마다 처음이 다름)

둘 다 NOT NULL + server_default 0 → 기존 행은 "아직 안 함"으로 시작하고, 이미 셋업된
회사는 실측 파생이 전부 true라 체크리스트가 자동으로 숨는다(비파괴).

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 신규 배포는 create_all이 정본이고,
이 리비전은 기존 DB에 컬럼을 멱등적으로 추가한다(재실행 안전).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009_onboarding"
down_revision: Union[str, None] = "0008_branding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("company", "onboarding_dismissed"),
    ("erp_user", "tour_completed"),
)


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    for table, column in _COLUMNS:
        if not _has_column(bind, table, column):
            op.add_column(
                table,
                sa.Column(column, sa.Boolean(), nullable=False, server_default=sa.text("0")),
            )


def downgrade() -> None:
    bind = op.get_bind()
    for table, column in _COLUMNS:
        if _has_column(bind, table, column):
            with op.batch_alter_table(table) as batch:
                batch.drop_column(column)
