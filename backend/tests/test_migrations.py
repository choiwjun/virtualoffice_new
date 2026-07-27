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


def _drift_company_id_to_char32(db_path: Path, table: str) -> None:
    """레거시 DB의 company_id 드리프트(CHAR(32))를 그대로 재현한다.

    체인으로는 만들 수 없는 모양이다 — 0001이 create_all이라 어느 리비전을 밟아도
    INTEGER로 나온다. 드리프트는 **과거 create_all이 만든 기존 DB에만** 남아 있으므로
    sqlite_master를 직접 고쳐 그 상태를 만든다(테이블 재작성이 아니라 선언만 바꿔
    인덱스·FK를 그대로 둔다 — 실제 드리프트 DB와 같은 모양이어야 한다).
    """
    with sqlite3.connect(db_path) as conn:
        version = conn.execute("PRAGMA schema_version").fetchone()[0]
        conn.execute("PRAGMA writable_schema=ON")
        conn.execute(
            "UPDATE sqlite_master SET sql = replace(sql, 'company_id INTEGER', "
            "'company_id CHAR(32)') WHERE type='table' AND name=?",
            (table,),
        )
        conn.execute(f"PRAGMA schema_version={version + 1}")
        conn.execute("PRAGMA writable_schema=OFF")
    # 스키마 변경은 연결을 다시 열어야 반영된다.


def _company_id_type(db_path: Path, table: str) -> str:
    with sqlite3.connect(db_path) as conn:
        for row in conn.execute(f"PRAGMA table_info({table})"):
            if row[1] == "company_id":
                return row[2]
    raise AssertionError(f"{table}.company_id 없음")


def test_0010_rewrites_drifted_company_id(tmp_path, monkeypatch):
    """0010 ALTER 경로 — 드리프트된 기존 DB만 재작성되고 값도 정수로 정규화된다.

    체인 경로(create_all)는 이미 INTEGER라 리비전이 건너뛴다. 그래서 이 테스트가
    없으면 0010은 **어떤 테스트에서도 실제로 실행되지 않는다.** 드리프트가 남기던
    버그는 조용하다 — SQLite는 '1' == 1 비교를 통과시켜 목록은 멀쩡해 보이지만
    파이썬으로 올라온 str이 assert_same_company에서 404가 됐다(부모 지정 그룹 생성 불가).
    """
    db_path = tmp_path / "legacy.db"
    cfg = _make_config(db_path, monkeypatch)

    command.upgrade(cfg, "0009_onboarding")
    _drift_company_id_to_char32(db_path, "org_group")
    assert _company_id_type(db_path, "org_group") == "CHAR(32)"

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO org_group (id, company_id, name, type, parent_id, color, "
            "sort_order, created_at, updated_at) VALUES "
            "('g1', '1', '인사팀', 'department', NULL, '#A68A64', 0, "
            "'2026-07-27 00:00:00', '2026-07-27 00:00:00')"
        )
        assert conn.execute(
            "SELECT typeof(company_id) FROM org_group WHERE id='g1'"
        ).fetchone()[0] == "text"

    command.upgrade(cfg, "head")

    assert _company_id_type(db_path, "org_group") == "INTEGER"
    # office는 드리프트시키지 않았다 → 이미 INTEGER인 테이블은 건너뛴다(무영향).
    assert _company_id_type(db_path, "office") == "INTEGER"

    with sqlite3.connect(db_path) as conn:
        value, kind = conn.execute(
            "SELECT company_id, typeof(company_id) FROM org_group WHERE id='g1'"
        ).fetchone()
        assert (value, kind) == (1, "integer")
        # 인덱스는 재작성 후에도 남아야 한다 — 스코프 조회가 전부 company_id를 탄다.
        names = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='org_group'"
            )
        }
        assert {"ix_org_group_company_id", "idx_org_group_company_parent"} <= names
