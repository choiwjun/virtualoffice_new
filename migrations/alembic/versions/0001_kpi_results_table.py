"""ERP dev 브랜치용: kpi_results 테이블 신설 (P0-T0.4)

Revision ID: 0001_kpi_results
Revises: (base 또는 마지막 revision)
Create Date: 2026-07-02 00:00:00.000000

참조:
  - 04-data-model.md §2.5 (정본 스키마)
  - 03-erp-integration.md §5 (ERP dev 브랜치 작업)
  - 00-decisions.md (D16: metric 롱포맷, UNIQUE 제약)

선행 조건:
  - companies 테이블 존재
  - users 테이블 존재 (FK 참조용)
  - Alembic 초기화 완료
"""

from alembic import op
import sqlalchemy as sa

# Revision identifiers
revision = '0001_kpi_results'
down_revision = None  # 첫 번째 마이그레이션. 기존 rev가 있으면 변경 필수.
branch_labels = None
depends_on = None


def upgrade() -> None:
    """kpi_results 테이블 생성."""

    # kpi_results 테이블
    op.create_table(
        'kpi_results',
        sa.Column('id', sa.Integer, primary_key=True, index=True),
        sa.Column(
            'company_id',
            sa.Integer,
            nullable=False,
            comment='ERP company_id (multi-tenant scope, 현재 단일)'
        ),
        sa.Column(
            'user_id',
            sa.Integer,
            sa.ForeignKey('users.id'),
            nullable=False,
            index=True,
            comment='ERP users.id (FK)'
        ),
        sa.Column(
            'period_type',
            sa.String(20),
            nullable=False,
            comment='daily | quarterly (D16)'
        ),
        sa.Column(
            'period_key',
            sa.String(20),
            nullable=False,
            comment='ISO 형식: 2026-07-01(daily) 또는 2026-Q3(quarterly, D16)'
        ),
        sa.Column(
            'metric',
            sa.String(100),
            nullable=False,
            comment='Metric 어휘 사전(04 §2.5): work_completed_count, work_quality_score, ...'
        ),
        sa.Column(
            'value',
            sa.Float,
            nullable=False,
            comment='확정 점수(final_score, D15), 상세 필드는 우리 plat form kpi_result에 인라인'
        ),
        sa.Column(
            'source',
            sa.String(50),
            nullable=False,
            server_default='virtual_office',
            comment='데이터 출처(현재 virtual_office)'
        ),
        sa.Column(
            'created_at',
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
            comment='생성 시각 (UTC, D19)'
        ),
        sa.Column(
            'updated_at',
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            comment='수정 시각 (UTC, D19)'
        ),

        # UNIQUE 제약(멱등 upsert): metric 단위
        sa.UniqueConstraint(
            'company_id',
            'user_id',
            'period_type',
            'period_key',
            'metric',
            name='uq_kpi_results_metric'
        ),

        # 복합 인덱스
        sa.Index('idx_kpi_results_company', 'company_id'),
        sa.Index('idx_kpi_results_user_period', 'user_id', 'period_key'),
        sa.Index('idx_kpi_results_period', 'period_type', 'period_key'),
    )


def downgrade() -> None:
    """kpi_results 테이블 삭제(롤백)."""
    op.drop_table('kpi_results')
