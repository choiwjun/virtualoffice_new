"""
ERP dev 브랜치용 마이그레이션(`migrations/alembic/versions/0001_kpi_results_table.py`) 회귀 가드.

이 마이그레이션은 우리 백엔드가 실행하지 않지만(별개 트리, env.py/alembic.ini 부재) ERP
`kpi_results` 스칼라 테이블(우리 KPI push 수신 대상, D15/D17, contract.md §2.2/§5.1)의 정본
산출물이므로, 우리 저장소에서 저작하는 이상 (a) 구문 유효성 (b) 계약 정합 스키마 생성 을 가드한다.
"""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "alembic"
    / "versions"
    / "0001_kpi_results_table.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("erp_kpi_results_migration", _MIGRATION_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # SyntaxError면 여기서 실패
    return mod


def test_erp_migration_file_exists():
    assert _MIGRATION_PATH.exists(), f"ERP 마이그레이션 부재: {_MIGRATION_PATH}"


def test_erp_migration_imports_without_syntax_error():
    mod = _load_migration()
    assert mod.revision == "0001_kpi_results"
    assert hasattr(mod, "upgrade") and hasattr(mod, "downgrade")


def test_erp_migration_upgrade_creates_contract_schema():
    """upgrade() 가 contract.md §2.2/§5.1 정합 kpi_results 스키마를 생성한다."""
    mod = _load_migration()
    eng = create_engine("sqlite://")
    with eng.connect() as conn:
        ctx = MigrationContext.configure(conn)
        mod.op = Operations(ctx)  # 모듈 레벨 op 프록시 바인딩
        mod.upgrade()

        insp = inspect(conn)
        assert "kpi_results" in insp.get_table_names()

        cols = {c["name"] for c in insp.get_columns("kpi_results")}
        # D16 롱포맷: period_type + period_key, metric/value 스칼라
        required = {
            "id", "company_id", "user_id", "period_type", "period_key",
            "metric", "value", "source", "created_at", "updated_at",
        }
        assert required <= cols, f"누락 컬럼: {required - cols}"

        # 계약 UNIQUE (company_id, user_id, period_type, period_key, metric)
        uniques = [tuple(u["column_names"]) for u in insp.get_unique_constraints("kpi_results")]
        assert ("company_id", "user_id", "period_type", "period_key", "metric") in uniques

        # user_id FK → users
        fks = insp.get_foreign_keys("kpi_results")
        assert any(fk["constrained_columns"] == ["user_id"] and fk["referred_table"] == "users" for fk in fks)


def test_erp_migration_downgrade_drops_table():
    mod = _load_migration()
    eng = create_engine("sqlite://")
    with eng.connect() as conn:
        ctx = MigrationContext.configure(conn)
        mod.op = Operations(ctx)
        mod.upgrade()
        assert "kpi_results" in inspect(conn).get_table_names()
        mod.downgrade()
        assert "kpi_results" not in inspect(conn).get_table_names()
