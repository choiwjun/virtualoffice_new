"""scripts/check_schema_drift.py 회귀 — 하루에 두 번 통과시켰던 드리프트를 실제로 잡는가.

`fix_sqlite_drift.py`는 누락 테이블·컬럼만 봐서 아래 둘을 모두 통과시켰다:

  - `presence.office_id`   DB=NOT NULL / 모델=nullable → 프레즌스 삽입이 IntegrityError로 죽음
  - `org_group.company_id` DB=CHAR(32) / 모델=INTEGER  → 값이 str '1'이라 단건 검사가 404
                           (목록 필터는 SQLite 느슨한 비교로 통과 → **조용한** 고장)

이 스위트는 "이름만 비교했으면 놓쳤을 모양"을 손으로 만들어 검사기가 잡는지 확인한다.
체인으로는 재현할 수 없는 모양이므로 sqlite_master 선언을 직접 고친다(0010 회귀 테스트와 동일 수법).
"""

import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.models.tables import Base

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from check_schema_drift import check  # noqa: E402


def _fresh_db(tmp_path) -> Path:
    """모델 정본 그대로 만든 DB — 여기서는 드리프트가 0이어야 한다."""
    db = tmp_path / "drift.db"
    engine = create_engine(f"sqlite:///{db}")
    Base.metadata.create_all(engine)
    engine.dispose()
    return db


def _rewrite_declaration(db: Path, table: str, old: str, new: str) -> None:
    """CREATE TABLE 선언만 바꿔치기 — 인덱스·FK·데이터를 건드리지 않는다."""
    with sqlite3.connect(db) as conn:
        version = conn.execute("PRAGMA schema_version").fetchone()[0]
        conn.execute("PRAGMA writable_schema=ON")
        conn.execute(
            "UPDATE sqlite_master SET sql = replace(sql, ?, ?) WHERE type='table' AND name=?",
            (old, new, table),
        )
        conn.execute(f"PRAGMA schema_version={version + 1}")
        conn.execute("PRAGMA writable_schema=OFF")


def test_clean_db_has_no_drift(tmp_path):
    assert check(str(_fresh_db(tmp_path))) == []


def test_catches_type_drift(tmp_path):
    """org_group.company_id INTEGER → CHAR(32) (2026-07-27, 조직도 계층 생성 불가의 원인)."""
    db = _fresh_db(tmp_path)
    _rewrite_declaration(db, "org_group", "company_id INTEGER", "company_id CHAR(32)")

    problems = check(str(db))
    assert any("org_group.company_id" in p and "타입" in p for p in problems), problems


def test_catches_nullability_drift(tmp_path):
    """presence.office_id nullable → NOT NULL (2026-07-27, 실시간 프레즌스 삽입 실패의 원인)."""
    db = _fresh_db(tmp_path)
    _rewrite_declaration(db, "presence", "office_id CHAR(32)", "office_id CHAR(32) NOT NULL")

    problems = check(str(db))
    assert any("presence.office_id" in p and "NOT NULL" in p for p in problems), problems


def test_catches_missing_column(tmp_path):
    """기존 검사기가 유일하게 잡던 것도 계속 잡아야 한다(회귀)."""
    db = _fresh_db(tmp_path)
    with sqlite3.connect(db) as conn:
        # 인덱스·제약이 참조하는 컬럼은 SQLite가 DROP을 거부한다(scene_key는 유니크 제약 안에
        # 있다) → 아무 제약에도 안 걸린 capacity를 쓴다.
        conn.execute("ALTER TABLE room DROP COLUMN capacity")

    assert any("room.capacity" in p for p in check(str(db)))


@pytest.mark.parametrize("declared,model,same", [
    ("INTEGER", "INTEGER", True),
    ("BIGINT", "INTEGER", True),      # 둘 다 INTEGER 친화도 — 무해한 차이는 소음으로 만들지 않는다
    ("VARCHAR(255)", "VARCHAR(64)", True),  # 길이 차이도 마찬가지
    ("CHAR(32)", "INTEGER", False),   # 의미가 다른 드리프트는 확실히 잡는다
])
def test_affinity_comparison(declared, model, same):
    from check_schema_drift import _affinity

    assert (_affinity(declared) == _affinity(model)) is same
