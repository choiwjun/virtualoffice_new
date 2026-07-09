#!/usr/bin/env python
"""
개발용 시드 스크립트 — SQLite dev.db에 테스트 ERP 사용자 3명 + 팀 2개 생성.

사용:
    cd backend
    DATABASE_URL=sqlite+aiosqlite:///./dev.db .venv/bin/python scripts/seed_dev.py

주의: 운영 DB에 실행 금지. 이미 존재하는 email은 업데이트(upsert) 처리.
"""

import asyncio
import os
import sys
from pathlib import Path

# backend/ 를 sys.path에 추가 (스크립트 직접 실행 지원)
_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./dev.db")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.models.tables import Base, ErpRole, ErpUser

DATABASE_URL = os.environ["DATABASE_URL"]

# ---------------------------------------------------------------------------
# 시드 데이터
# ---------------------------------------------------------------------------

# 팀 ID (ERP teams.id에 해당하는 임의 값 — dev 전용)
TEAM_DEV = 1
TEAM_DESIGN = 2

SEED_USERS = [
    {
        "id": 1001,
        "company_id": 1,
        "email": "alice@virtualoffice.local",
        "name": "김앨리스",
        "password": "password123",
        "erp_team_id": TEAM_DEV,
        "role": ErpRole.ADMIN,
        "position": "CTO",
    },
    {
        "id": 1002,
        "company_id": 1,
        "email": "bob@virtualoffice.local",
        "name": "이밥",
        "password": "password123",
        "erp_team_id": TEAM_DEV,
        "role": ErpRole.LEADER,
        "position": "개발팀장",
    },
    {
        "id": 1003,
        "company_id": 1,
        "email": "charlie@virtualoffice.local",
        "name": "박찰리",
        "password": "password123",
        "erp_team_id": TEAM_DESIGN,
        "role": ErpRole.EMPLOYEE,
        "position": "디자이너",
    },
]


async def seed(session: AsyncSession) -> None:
    created = 0
    updated = 0

    for data in SEED_USERS:
        password = data.pop("password")
        pw_hash = hash_password(password)
        # 로그인은 is_active==True인 계정만 통과(app/api/auth.py). 재시드 시에도 활성 보장.
        data.setdefault("is_active", True)

        result = await session.execute(
            select(ErpUser).where(ErpUser.id == data["id"])
        )
        existing = result.scalar_one_or_none()

        if existing is None:
            user = ErpUser(**data, password_hash=pw_hash)
            session.add(user)
            created += 1
            print(f"  [NEW]  {data['email']} (id={data['id']}, role={data['role'].value})")
        else:
            for k, v in data.items():
                setattr(existing, k, v)
            existing.password_hash = pw_hash
            updated += 1
            print(f"  [UPD]  {data['email']} (id={data['id']}, role={data['role'].value})")

    await session.commit()
    print(f"\n완료: {created}명 생성, {updated}명 갱신")
    print("테스트 자격증명: email=<위 이메일>, password=password123")


async def main() -> None:
    print(f"DB: {DATABASE_URL}")

    # SQLite는 pool 설정 추가
    kwargs: dict = {}
    if "sqlite" in DATABASE_URL:
        kwargs["connect_args"] = {"check_same_thread": False}
        kwargs["poolclass"] = StaticPool

    engine = create_async_engine(DATABASE_URL, echo=False, **kwargs)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        print("테이블 자동 생성 완료")

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        await seed(session)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
