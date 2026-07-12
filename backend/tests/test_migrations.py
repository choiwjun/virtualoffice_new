"""
Alembic 마이그레이션 검증 (SQLite 파일 DB 대상).

- upgrade head → 전체 모델 테이블 + alembic_version 생성
- downgrade base → 전부 제거
운영(PostgreSQL)과 방언은 다르지만 리비전 체인·env.py 배선이 실제로
동작하는지를 보장한다. (env.py가 asyncio.run을 쓰므로 sync 테스트여야 함.)
"""

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.models.tables import Base

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _make_config(db_path: Path, monkeypatch) -> Config:
    monkeypatch.setenv("ALEMBIC_DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _table_names(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        return {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }


def test_upgrade_head_creates_all_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "mig.db"
    cfg = _make_config(db_path, monkeypatch)

    command.upgrade(cfg, "head")

    tables = _table_names(db_path)
    assert "alembic_version" in tables
    # 대표 테이블 표본 + 총수 (전체 모델 테이블 + alembic_version).
    # 매직넘버 대신 Base.metadata에 연동 → 모델 추가/삭제 시 자동 반영(스테일 방지).
    for expected in ("erp_user", "kpi_result", "office_layout", "presence", "meeting", "notice"):
        assert expected in tables, f"missing: {expected}"
    assert len(tables) == len(Base.metadata.tables) + 1  # + alembic_version


def test_downgrade_base_drops_all_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "mig.db"
    cfg = _make_config(db_path, monkeypatch)

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")

    tables = _table_names(db_path)
    # alembic_version만 남는다 (버전 추적 테이블은 alembic이 유지)
    assert tables == {"alembic_version"}
