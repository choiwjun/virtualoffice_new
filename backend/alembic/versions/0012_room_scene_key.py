"""room.scene_key — 씬의 방과 DB 방을 잇는 정본

Revision ID: 0012_room_scene
Revises: 0011_org_team

가상오피스 씬에서 방을 누르면 오늘 일정 카드가 뜬다. 그때 "이 방이 어느 DB 방인가"를
화면이 **이름 문자열 일치**로 때우고 있었다:

    room.name.toLowerCase() === 씬 라벨.toLowerCase()

씬 라벨(`Board Room`·`Meeting Room`)과 시드 방 이름을 같게 맞춰 둬서 데모에서만 우연히
동작했다. 실제로는 ① 방 이름을 바꾸면 조용히 끊기고 ② 씬 라벨이 영어라 한국어로 이름을
붙인 회사는 **한 번도 맞지 않는다** — 모든 방이 "이 방의 회의실 정보가 없습니다"가 된다.
팀 이름에 정본이 없어 화면마다 표를 지어내던 D39와 같은 병이라 같은 처방을 쓴다.

값은 `frontend/lib/officeV3.ts`의 `V3_ROOMS[].id`. NULL은 "씬에 대응 없음"(다른 층의 방,
예약 전용 공간)이라 NOT NULL로 둘 수 없다. 유니크는 (company_id, scene_key) —
두 방이 같은 씬 방을 주장하면 어느 일정이 뜰지가 조회 순서로 갈린다.

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 신규 배포는 이미 컬럼이 있고, 이 리비전은
기존 DB에만 멱등 ALTER를 적용한다. SQLite에 ALTER ADD CONSTRAINT가 없어 유니크는
인덱스로 만든다(존재 검사는 인덱스+제약 양쪽, DROP은 인덱스인 것만 — 0011과 동일 이유).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012_room_scene"
down_revision: Union[str, None] = "0011_org_team"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UNIQUE = "uq_room_company_scene_key"


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def _real_indexes(bind, table: str) -> set[str]:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return set()
    return {i["name"] for i in insp.get_indexes(table) if i.get("name")}


def _unique_names(bind, table: str) -> set[str]:
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return set()
    names = _real_indexes(bind, table)
    names |= {u["name"] for u in insp.get_unique_constraints(table) if u.get("name")}
    return names


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, "room", "scene_key"):
        op.add_column("room", sa.Column("scene_key", sa.String(length=64), nullable=True))
    if _UNIQUE not in _unique_names(bind, "room"):
        op.create_index(_UNIQUE, "room", ["company_id", "scene_key"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    if _UNIQUE in _real_indexes(bind, "room"):
        op.drop_index(_UNIQUE, table_name="room")
    if _has_column(bind, "room", "scene_key"):
        with op.batch_alter_table("room") as batch:
            batch.drop_column("scene_key")
