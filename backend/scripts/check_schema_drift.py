#!/usr/bin/env python
"""SQLite 스키마 드리프트 검사 — 모델 정의 대비 실제 DB를 **전수 대조**한다.

`fix_sqlite_drift.py`는 누락 테이블·컬럼만 본다. 그 검사를 통과하고도 하루에 두 번 터졌다:

  - `presence.office_id`  : DB=NOT NULL / 모델=nullable → 실시간 프레즌스 삽입이 500으로 죽음
  - `org_group.company_id`: DB=CHAR(32) / 모델=INTEGER → 값이 문자열 '1'이라 단건 검사가 404
                            (목록 필터는 SQLite의 느슨한 비교로 통과해 **조용했다**)

둘 다 컬럼 **이름**만 비교하면 안 잡힌다. 여기서는 타입·nullability까지 본다.

    python scripts/check_schema_drift.py                 # dev.db·dev_qa.db 둘 다
    python scripts/check_schema_drift.py path/to.db ...  # 지정 파일만

드리프트가 있으면 exit 1 — CI/pre-pull 게이트로 그대로 쓸 수 있다.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

import sqlalchemy as sa  # noqa: E402

from app.models.tables import Base  # noqa: E402

_DEFAULT_DBS = ("dev.db", "dev_qa.db")
_SQLITE = sa.dialects.sqlite.dialect()


def _model_type(col: sa.Column) -> str:
    """모델 컬럼의 SQLite 선언 타입(대문자). Enum은 VARCHAR(n)으로 컴파일된다."""
    try:
        return col.type.compile(_SQLITE).upper()
    except Exception:  # 방언이 모르는 타입(JSONB 등) — 비교에서 제외
        return ""


def _affinity(decl: str) -> str:
    """SQLite 타입 친화도(https://sqlite.org/datatype3.html §3.1).

    선언 문자열을 그대로 비교하면 `VARCHAR(255)` vs `VARCHAR` 같은 무해한 차이가 소음이 된다.
    반대로 친화도만 보면 CHAR(32) vs INTEGER처럼 **의미가 다른** 드리프트는 확실히 걸린다.
    """
    d = decl.upper()
    if "INT" in d:
        return "INTEGER"
    if any(k in d for k in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if "BLOB" in d or not d:
        return "BLOB"
    if any(k in d for k in ("REAL", "FLOA", "DOUB")):
        return "REAL"
    return "NUMERIC"


def check(db_path: str) -> list[str]:
    if not Path(db_path).exists():
        return [f"파일 없음: {db_path}"]
    problems: list[str] = []
    conn = sqlite3.connect(db_path)
    try:
        existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in Base.metadata.sorted_tables:
            if table.name not in existing:
                problems.append(f"{table.name}: 테이블 없음")
                continue
            rows = list(conn.execute(f'PRAGMA table_info("{table.name}")'))
            db_cols = {r[1]: {"type": r[2], "notnull": bool(r[3]), "pk": bool(r[5])} for r in rows}
            for col in table.columns:
                got = db_cols.get(col.name)
                if got is None:
                    problems.append(f"{table.name}.{col.name}: 컬럼 없음")
                    continue
                want_type = _model_type(col)
                if want_type and _affinity(got["type"]) != _affinity(want_type):
                    problems.append(
                        f"{table.name}.{col.name}: 타입 DB={got['type']} / 모델={want_type}"
                    )
                # PK는 SQLite가 암묵적으로 NOT NULL이라 PRAGMA notnull이 0으로 보고될 수 있다.
                if not col.primary_key and not got["pk"]:
                    if got["notnull"] != (not col.nullable):
                        problems.append(
                            f"{table.name}.{col.name}: "
                            f"DB={'NOT NULL' if got['notnull'] else 'nullable'} / "
                            f"모델={'NOT NULL' if not col.nullable else 'nullable'}"
                        )
    finally:
        conn.close()
    return problems


def main(argv: list[str]) -> int:
    targets = argv[1:] or [str(_ROOT / name) for name in _DEFAULT_DBS]
    total = 0
    for db in targets:
        problems = check(db)
        total += len(problems)
        label = Path(db).name
        if problems:
            print(f"\n[DRIFT] {label} — {len(problems)}건")
            for p in problems:
                print(f"  - {p}")
        else:
            print(f"[OK] {label} — 드리프트 없음")
    if total:
        print(f"\n총 {total}건. 모델이 정본이다 — DB를 맞추거나(마이그레이션) 모델을 고쳐라.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
