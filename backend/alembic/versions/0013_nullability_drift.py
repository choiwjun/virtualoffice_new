"""nullability 드리프트 교정 — DB=nullable / 모델=NOT NULL 4건

Revision ID: 0013_nullability
Revises: 0012_room_scene

레거시 dev DB에 모델과 nullable 방향이 어긋난 컬럼이 남아 있다:

  meeting.duration_minutes            meeting_participant.invite_status
  notice.category                     notice.published_at

전부 **DB=nullable / 모델=NOT NULL** 방향이라 삽입은 통과한다 — 그래서 조용했다. 대신 조회
쪽이 "절대 NULL이 아니다"를 전제로 짜여 있어(응답 스키마가 Optional이 아니다) NULL이 한 행만
들어가도 직렬화가 500으로 터진다. 반대 방향(DB=NOT NULL/모델=nullable)이었던 `presence`는
2026-07-27에 실제로 실시간 프레즌스를 죽였다.

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 신규 배포는 이미 NOT NULL이고 이 리비전은
건너뛴다. 기존 DB만 조인다. SQLite는 ALTER COLUMN이 없어 batch_alter_table(테이블 재작성)을
쓰고, 재작성이 NOT NULL을 깨지 않도록 **먼저 기존 NULL을 모델 기본값으로 백필**한다
(실측: dev_qa.db는 네 컬럼 모두 NULL 0행이라 백필이 무영향이다).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013_nullability"
down_revision: Union[str, None] = "0012_room_scene"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (테이블, 컬럼, 타입, NULL 백필값) — 백필값은 모델의 default와 같은 뜻이어야 한다.
_COLUMNS = (
    ("meeting", "duration_minutes", sa.Integer(), "60"),
    ("meeting_participant", "invite_status", sa.String(length=20), "'invited'"),
    ("notice", "category", sa.String(length=20), "'notice'"),
    ("notice", "published_at", sa.DateTime(timezone=True), "CURRENT_TIMESTAMP"),
)


def _column(bind, table: str, column: str):
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return None
    return next((c for c in insp.get_columns(table) if c["name"] == column), None)


def upgrade() -> None:
    bind = op.get_bind()
    for table, column, coltype, backfill in _COLUMNS:
        col = _column(bind, table, column)
        if col is None or not col["nullable"]:
            continue  # 신규 배포(create_all) — 이미 NOT NULL
        op.execute(f'UPDATE "{table}" SET "{column}" = {backfill} WHERE "{column}" IS NULL')
        with op.batch_alter_table(table) as batch:
            batch.alter_column(column, existing_type=coltype, nullable=False)


def downgrade() -> None:
    # 되돌릴 이유가 없는 교정이다(드리프트 복원은 버그 복원). 0010과 같은 판단으로 no-op.
    pass
