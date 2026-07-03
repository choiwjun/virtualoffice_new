"""initial schema — 22개 테이블 (04-data-model.md + auth_credential/G001 + erp_sync_log/G009)

Revision ID: 0001_initial
Revises: None

## 규약 (pre-prod 단계)
운영 첫 배포 **전**까지는 이 리비전이 Base.metadata를 참조하므로
모델 변경이 자동 반영된다(스키마 리셋 = downgrade base → upgrade head).
운영 첫 배포 **후**에는 이 리비전을 불변으로 간주하고,
이후 모든 스키마 변경은 `alembic revision --autogenerate`로 신규 리비전 생성.
"""
from typing import Sequence, Union

from alembic import op

from app.models.tables import Base

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
