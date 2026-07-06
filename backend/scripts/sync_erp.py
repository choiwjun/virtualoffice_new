#!/usr/bin/env python3
"""
sync_erp.py — ERP → 우리 DB 수동 동기화 실행 스크립트 (G003).

실행:
    cd backend/
    ERP_DATABASE_URL=postgresql+asyncpg://... python scripts/sync_erp.py

ERP_DATABASE_URL 미설정 시: 설정 안내 후 종료(exit 1).
실 DB 연결 불가는 정상 — mock으로 테스트, 실 어댑터 자리만 확보.

동기화 범위(D18):
  - erp_user upsert (신규 삽입 / 변경 갱신 / soft-delete)
  - user_team_history: 팀 이동 감지 및 이력 기록
  - 컬럼 화이트리스트(D20-f): GPS/슬랙/깃허브 등 미수집

프로덕션 운영:
  - 매시간 증분: cron "0 * * * * python scripts/sync_erp.py"
  - 매일 00:00 KST 전체 대사: cron "0 15 * * * python scripts/sync_erp.py --full"
    (15:00 UTC = 00:00 KST)
"""

import asyncio
import logging
import os
import sys

# 스크립트가 backend/ 에서 실행된다고 가정하여 app 패키지를 찾을 수 있도록 경로 추가.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("sync_erp")

COMPANY_ID = 1  # 현재 단일 테넌트(사내). 멀티테넌트 이관 시 반복 처리.


async def run_sync() -> None:
    erp_url = os.environ.get("ERP_DATABASE_URL", "").strip()

    if not erp_url:
        log.error(
            "ERP_DATABASE_URL 환경변수가 설정되지 않았습니다.\n"
            "  실 ERP DB: ERP_DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<host>/<db> python scripts/sync_erp.py\n"
            "  개발/테스트: MockErpSource를 직접 사용하거나 backend/tests/test_erp_sync.py 실행.\n"
            "  (실 DB 연결 불가는 정상 — 코드는 준비됨, 접속정보만 없음)"
        )
        sys.exit(1)

    # ── 우리 DB 설정 ──────────────────────────────────────────────────────────
    our_db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/virtualoffice",
    )

    # 지연 임포트 — ERP_DATABASE_URL 있을 때만 실 어댑터 생성
    from app.erp.reader import get_erp_reader
    from app.erp.sync import ErpSyncService
    from app.models.tables import Base

    engine = create_async_engine(our_db_url, echo=False, future=True, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # 테이블 자동 생성(초기 실행 편의; 프로덕션은 Alembic 마이그레이션 사용)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    reader = get_erp_reader(erp_url)
    try:
        async with session_factory() as session:
            svc = ErpSyncService(session)
            log.info("ERP 동기화 시작: company_id=%d", COMPANY_ID)
            result = await svc.sync_users(reader, company_id=COMPANY_ID)
            await session.commit()
            log.info(
                "동기화 완료: 신규=%d 갱신=%d soft-delete=%d 팀이동=%d",
                result.created, result.updated, result.deactivated, result.team_moves,
            )
    finally:
        await reader.aclose()
        await engine.dispose()


def main() -> None:
    asyncio.run(run_sync())


if __name__ == "__main__":
    main()
