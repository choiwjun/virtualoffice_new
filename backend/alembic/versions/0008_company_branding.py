"""회사 브랜딩 필드 — E5 화이트라벨 (24-spec Phase 4 · 23 E5/A7)

Revision ID: 0008_branding
Revises: 0007_scope_1d

Phase 1a에서 `logo_url`·`primary_color`는 플레이스홀더로 미리 심어 뒀다. 화이트라벨 UI를
붙이면서 실제로 필요한 두 개를 추가한다:

  - `brand_name`  : 셸·로그인 표시명. NULL이면 `company.name`을 쓴다(별도 표기가 필요할 때만).
  - `accent_color`: 링크·강조색. primary와 분리해야 버튼 색만 바꿔도 액센트가 따라 튀지 않는다.

둘 다 nullable — 기존 회사는 값이 없으면 기본 테마 그대로다(비파괴).

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 신규 배포는 create_all이 정본이고,
이 리비전은 기존 DB에 컬럼을 멱등적으로 추가한다(재실행 안전).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_branding"
down_revision: Union[str, None] = "0007_scope_1d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("brand_name", sa.String(length=255)),
    ("accent_color", sa.String(length=7)),
)


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    for name, coltype in _COLUMNS:
        if not _has_column(bind, "company", name):
            op.add_column("company", sa.Column(name, coltype, nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    for name, _ in _COLUMNS:
        if _has_column(bind, "company", name):
            with op.batch_alter_table("company") as batch:
                batch.drop_column(name)
