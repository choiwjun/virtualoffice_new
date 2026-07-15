#!/usr/bin/env python
"""dev SQLite 스키마 드리프트 보정 — 모델 기준 누락 테이블 생성/누락 컬럼 ALTER ADD (dev 전용)."""
import asyncio
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./dev_qa.db")

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from app.models.tables import Base  # noqa: E402


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    added = 0
    async with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            rows = (await conn.execute(text(f'PRAGMA table_info("{table.name}")'))).fetchall()
            have = {r[1] for r in rows}
            if not have:
                await conn.run_sync(lambda c, t=table: t.create(c))
                print(f"[CREATE] {table.name}")
                continue
            for col in table.columns:
                if col.name in have:
                    continue
                coltype = col.type.compile(engine.dialect)
                await conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}'))
                print(f"[ADD] {table.name}.{col.name} {coltype}")
                added += 1
    await engine.dispose()
    print(f"done: {added} columns added")


if __name__ == "__main__":
    asyncio.run(main())
