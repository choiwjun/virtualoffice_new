"""org_group·office의 company_id 타입 드리프트 교정 (CHAR(32) → INTEGER)

Revision ID: 0010_cid_type
Revises: 0009_onboarding

모델은 두 테이블 모두 `company_id: Mapped[int] = mapped_column(Integer, ...)`인데
레거시 DB에는 `CHAR(32)`로 만들어져 값이 문자열 '1'로 들어 있다. SQLite는 타입을
느슨하게 다루므로 `WHERE company_id == 1` 같은 **목록 필터는 우연히 통과**하지만,
파이썬으로 올라온 값은 str이라 단건 검사에서 깨진다:

    assert_same_company(user, g.company_id)   # '1' != 1 → 404

실측 영향(2026-07-27):
  - `org_group` — 부모를 지정한 그룹 생성이 전부 404. `_load_scoped_group`이 부모를
    로드하는 순간 걸린다. **조직도 편집기에서 계층을 만들 수 없었다**(본부 아래
    부서를 넣지 못하고 전부 최상위로만 생성됨). PUT/DELETE도 같은 이유로 404.
  - `office` — 단건 로드 경로가 아직 없어 잠복 상태.

Postgres에서는 `character varying = integer` 비교가 타입 에러라 조용히 넘어가지도
않는다. 이관 전에 반드시 정리돼야 한다.

## 규약
0001_initial이 create_all로 최신 모델을 만들므로 **신규 배포는 이미 INTEGER**이고
이 리비전은 무영향이다(타입 검사 후 건너뜀). 기존 DB에만 재작성이 적용된다.

SQLite는 ALTER COLUMN TYPE이 없어 batch_alter_table(테이블 재작성)로 바꾼다.
office는 floor·office_layout이 office.id를 FK로 참조하지만 참조 대상이 PK(id)이지
company_id가 아니므로 재작성해도 참조는 유지된다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010_cid_type"
down_revision: Union[str, None] = "0009_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("org_group", "office")


def _column(bind, table: str, column: str):
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return None
    return next((c for c in insp.get_columns(table) if c["name"] == column), None)


def _is_integer(col) -> bool:
    return isinstance(col["type"], sa.Integer)


def upgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        col = _column(bind, table, "company_id")
        if col is None or _is_integer(col):
            continue  # 신규 배포(create_all) 경로 — 이미 INTEGER
        # 값이 '1' 같은 문자열이므로 먼저 정수로 정규화한다. 숫자가 아닌 값(과거 UUID
        # 흔적 등)은 기본 테넌트로 떨군다 — 남겨두면 재작성에서 NOT NULL을 깬다.
        op.execute(
            f"UPDATE {table} SET company_id = CAST(company_id AS INTEGER) "
            f"WHERE company_id IS NOT NULL AND CAST(company_id AS INTEGER) > 0"
        )
        op.execute(
            f"UPDATE {table} SET company_id = 1 "
            f"WHERE company_id IS NULL OR CAST(company_id AS INTEGER) <= 0"
        )
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "company_id",
                existing_type=sa.CHAR(32),
                type_=sa.Integer(),
                existing_nullable=False,
                postgresql_using="company_id::integer",
            )


def downgrade() -> None:
    # 되돌릴 이유가 없는 교정이다(드리프트 복원은 버그 복원). 명시적으로 no-op.
    pass
