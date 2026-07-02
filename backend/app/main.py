"""
FastAPI 앱 엔트리포인트.

정본: 02-trd-architecture.md, 11-tech-stack.md.
- 라우터는 app/api/ 하위에서 점진 등록 (Phase 2+: users/teams/seats/meetings/kpi 등)
- 헬스체크: 배포·모니터링용 (13-risks: 운영 관측)
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작/종료 훅 (Phase 2+: ERP 커넥션 풀 워밍업, 스케줄러 기동 등)
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    debug=settings.debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
async def health() -> dict:
    """헬스체크 — 배포/로드밸런서 프로브용."""
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": __version__,
        "environment": settings.environment,
    }


# ── 라우터 등록 (점진적) ─────────────────────────────────
# from app.api import users, teams, seats, meetings, kpi
# app.include_router(users.router, prefix="/api")
