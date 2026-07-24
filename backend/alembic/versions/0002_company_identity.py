"""company 테넌트 정체성 — Phase 1a (24-spec Phase 1 · 22 T0-1)

Revision ID: 0002_company
Revises: 0001_initial

정체성에 company_id를 심는 비파괴 토대:
  Step A (additive) : company 테이블 보장 + 기본 회사(id=1, 'default') 시드.
  Step B (backfill) : erp_user.company_id NULL/누락분을 1로 채움.
  Step C (constrain): erp_user.company_id → company.id FK (SQLite는 create_all이
                      이미 부여 — Postgres 신규 배포는 create_all 경로가 정본).

## 규약
0001_initial이 Base.metadata.create_all로 전체 스키마(company 포함)를 생성하므로,
이 리비전은 주로 **데이터**(기본 회사 시드 + 백필)를 담당한다. company 테이블이 아직
없는 (수동 부분배포) 상황에서도 안전하도록 존재 검사로 테이블 생성을 가드한다.
운영 첫 배포 후에는 이 리비전을 불변으로 간주하고 이후 변경은 신규 리비전으로.
"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_company"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    bind = op.get_bind()

    # ── Step A: company 테이블 보장 (0001 create_all이 이미 만든 경우 스킵) ──
    if not _has_table(bind, "company"):
        op.create_table(
            "company",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("slug", sa.String(length=63), nullable=False),
            sa.Column("logo_url", sa.String(length=1000), nullable=True),
            sa.Column("primary_color", sa.String(length=7), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("slug", name="uq_company_slug"),
        )

    # ── Step A(cont.): 기본 회사(id=1) 시드 (멱등 — 이미 있으면 스킵) ──
    company = sa.table(
        "company",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    existing = bind.execute(
        sa.select(company.c.id).where(company.c.id == 1)
    ).first()
    if existing is None:
        _now = datetime.now(timezone.utc)
        op.bulk_insert(
            company,
            [
                {
                    "id": 1,
                    "name": "기본 회사",
                    "slug": "default",
                    "created_at": _now,
                    "updated_at": _now,
                }
            ],
        )

    # ── Step B: erp_user.company_id 백필 (NULL 또는 누락 → 1) ──
    if _has_table(bind, "erp_user"):
        erp_user = sa.table(
            "erp_user",
            sa.column("company_id", sa.Integer),
        )
        op.execute(
            erp_user.update()
            .where(erp_user.c.company_id.is_(None))
            .values(company_id=1)
        )

    # Step C(FK/NOT NULL 제약)는 create_all 경로(모델 정의)가 정본이며,
    # SQLite는 ALTER로 FK 추가가 제약적이라 여기서는 데이터 정합만 보장한다.
    # (신규 배포는 0001 create_all이 FK를 이미 부여함.)


def downgrade() -> None:
    bind = op.get_bind()
    # 백필/시드 되돌리기: 기본 회사 row 제거. (company 테이블 자체는 0001 downgrade가 정리.)
    if _has_table(bind, "company"):
        company = sa.table("company", sa.column("id", sa.Integer))
        op.execute(company.delete().where(company.c.id == 1))
