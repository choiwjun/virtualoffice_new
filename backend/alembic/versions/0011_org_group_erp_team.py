"""org_group.erp_team_id — 팀 이름의 정본을 조직도에 둔다

Revision ID: 0011_org_team
Revises: 0010_cid_type

erp_user는 팀을 숫자(`erp_team_id`)로만 들고 있고 팀 이름을 가진 테이블이 없었다.
그 결과 화면마다 이름을 따로 지어냈다 — 직원명부는 프론트에 하드코딩한 숫자↔이름 표를
들었고(실제 조직과 어긋나면 "데이터팀장인데 소속은 디자인팀"으로 읽혔다), 조직도 그래프는
포기하고 "팀 #1"을 찍었다. 같은 조직도 화면 안에서 좌측 트리는 "플랫폼개발팀", 우측
그래프는 "팀 #1"로 갈렸다.

org_group은 이미 회사별 조직 계층을 들고 있으므로 여기에 팀 번호를 이으면 이름의 정본이
생긴다. 새 테이블을 만들지 않은 이유: ERP가 없는 회사(E3 native)에서도 조직도는 관리자가
직접 만들고, 별도 team 테이블을 두면 그 회사에서는 빈 채로 남아 org_group과 이중 관리가 된다.

NULL 허용이 핵심이다 — 본부·파트처럼 사람이 직접 소속되지 않는 계층은 팀이 아니다.
NOT NULL로 두면 조직 계층이 곧 팀 목록이 돼 본부를 만들 수 없다.

유니크는 (company_id, erp_team_id)다. 두 그룹이 같은 팀을 주장하면 이름이 조회 순서에
좌우된다. NULL은 SQL 표준상 서로 구별되므로 팀 없는 계층은 얼마든지 공존한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011_org_team"
down_revision: Union[str, None] = "0010_cid_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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
    """인덱스 + 테이블 제약을 모두 본다.

    같은 유니크가 경로에 따라 다른 물건으로 존재한다 — create_all(0001)은 CREATE TABLE
    안에 CONSTRAINT로 넣고, 이 리비전은 CREATE UNIQUE INDEX로 만든다(SQLite에 ALTER ADD
    CONSTRAINT가 없다). 존재 검사는 둘 다 봐야 하고, DROP은 인덱스인 것만 해야 한다.
    """
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return set()
    names = _real_indexes(bind, table)
    names |= {u["name"] for u in insp.get_unique_constraints(table) if u.get("name")}
    return names


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, "org_group", "erp_team_id"):
        # 0001이 create_all이라 신규 배포에는 이미 있다 — 기존 DB에만 붙인다.
        op.add_column("org_group", sa.Column("erp_team_id", sa.BigInteger(), nullable=True))

    if "uq_org_group_company_team" not in _unique_names(bind, "org_group"):
        # SQLite는 ALTER ADD CONSTRAINT가 없다. 유니크 인덱스가 제약과 같은 효력을 갖고
        # (company_id, erp_team_id) 조회도 함께 태우므로 batch 재작성 없이 이걸 쓴다.
        # 선행 컬럼이 company_id라 스코프 조회(회사 안에서 팀 찾기)도 이 인덱스를 탄다
        # — erp_team_id 단독 인덱스를 따로 두지 않는 이유다(회사를 가로지르는 조회는 없다).
        op.create_index(
            "uq_org_group_company_team",
            "org_group",
            ["company_id", "erp_team_id"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    # CONSTRAINT로 존재하는 경우(create_all 경로)는 DROP INDEX가 아니라 아래 테이블
    # 재작성이 걷어낸다 — 여기서 지우려 들면 "no such index"로 터진다.
    if "uq_org_group_company_team" in _real_indexes(bind, "org_group"):
        op.drop_index("uq_org_group_company_team", table_name="org_group")
    if _has_column(bind, "org_group", "erp_team_id"):
        with op.batch_alter_table("org_group") as batch:
            batch.drop_column("erp_team_id")
