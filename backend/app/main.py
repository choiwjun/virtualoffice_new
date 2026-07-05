"""
FastAPI 앱 엔트리포인트.

정본: 02-trd-architecture.md, 11-tech-stack.md.
- 라우터는 app/api/ 하위에서 점진 등록 (Phase 2+: users/teams/seats/meetings/kpi 등)
- 헬스체크: 배포·모니터링용 (13-risks: 운영 관측)
"""

from contextlib import asynccontextmanager
from pathlib import Path
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from app import __version__
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # D4/C2: 운영이 기본 JWT 시크릿으로 뜨면 토큰 위조 가능 → 부팅 즉시 실패.
    if settings.is_production and settings.uses_default_jwt_secret:
        raise RuntimeError(
            "jwt_secret_key must be overridden in production (D4; set JWT_SECRET_KEY env)"
        )
    # dev/도그푸딩: 테이블 자동 생성 (운영은 Alembic). Docker 최초 기동 편의.
    if settings.auto_create_tables:
        from app.db import Base, engine

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    # D17: 배치 스케줄러(APScheduler) — 기본 미기동. 상시 실행/실 cron 발화 검증은
    # 환경차단(G011), 이 환경(단발성 pytest)에서는 기동하지 않는다.
    scheduler = None
    if settings.scheduler_enabled:
        from app.services.scheduler import build_scheduler

        scheduler = build_scheduler()
        scheduler.start()
        # B-16: 운영 관측 — 컨테이너 상시 구동 시 스케줄러 기동 확인용(uvicorn 로거로 가시화).
        logging.getLogger("uvicorn.error").info(
            "APScheduler started: %d jobs registered (scheduler_enabled=true)",
            len(scheduler.get_jobs()),
        )

    yield

    if scheduler is not None:
        scheduler.shutdown(wait=False)
        logging.getLogger("uvicorn.error").info("APScheduler shut down")


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


_CONSOLE_HTML = Path(__file__).resolve().parent / "static" / "console.html"


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    """루트 접속 → 웹 관리 콘솔(/console)로 유도."""
    return RedirectResponse(url="/console")


@app.get("/console", include_in_schema=False)
async def console() -> FileResponse:
    """웹 관리 콘솔 SPA(단일 파일) — 백엔드 API 동일 오리진 서빙."""
    return FileResponse(_CONSOLE_HTML, media_type="text/html")


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
from app.api import action_items, audit, auth, erp, feedback, kpi, layouts, meetings, notifications, org_groups, presence, realtime, seats, spaces, sync, team_zones, worklogs  # noqa: E402

app.include_router(auth.router)
app.include_router(erp.router)
app.include_router(org_groups.router)
app.include_router(team_zones.router)
app.include_router(kpi.router)
app.include_router(layouts.router)
app.include_router(meetings.router)
app.include_router(seats.router)
app.include_router(worklogs.router)
app.include_router(sync.router)
app.include_router(audit.router)
app.include_router(realtime.router)
app.include_router(presence.router)
app.include_router(action_items.router)
app.include_router(feedback.router)
app.include_router(spaces.router)
app.include_router(notifications.router)
