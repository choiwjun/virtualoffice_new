"""
FastAPI 앱 엔트리포인트.

정본: 02-trd-architecture.md, 11-tech-stack.md.
- 라우터는 app/api/ 하위에서 점진 등록 (Phase 2+: users/teams/seats/meetings/kpi 등)
- 헬스체크: 배포·모니터링용 (13-risks: 운영 관측)
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # dev/도그푸딩: 테이블 자동 생성 (운영은 Alembic). Docker 최초 기동 편의.
    if settings.auto_create_tables:
        from app.db import Base, engine

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
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


# ── OIDC Discovery 루트 별칭 ──────────────────────────────────────────────
# WA가 OPENID_CLIENT_ISSUER(= http://auth.localhost:8090) + /.well-known/openid-configuration
# 를 조회하므로 루트 경로에도 마운트한다.
# 실제 로직은 /oidc/.well-known/openid-configuration 핸들러에 위임.
@app.get("/.well-known/openid-configuration", tags=["oidc"], include_in_schema=False)
async def root_openid_configuration(request: Request) -> JSONResponse:
    """루트 OIDC Discovery 별칭 — WA OPENID_CLIENT_ISSUER 호환."""
    from app.integrations.workadventure.oidc import openid_configuration
    return await openid_configuration(request)


# ── 라우터 등록 (점진적) ─────────────────────────────────
from app.api import erp  # noqa: E402
from app.api import auth  # noqa: E402
from app.api import presence_stream  # noqa: E402
from app.api import seats  # noqa: E402
from app.api import wa_livekit  # noqa: E402
from app.api import wa_presence  # noqa: E402
from app.integrations.workadventure import oidc as wa_oidc  # noqa: E402

app.include_router(erp.router)
app.include_router(wa_oidc.router)           # /oidc/* — OIDC Provider (D26, D4 공존)
app.include_router(wa_presence.router)        # /api/wa/presence — presence 수집·저장
app.include_router(presence_stream.router)    # /api/wa/presence/stream — SSE 브로드캐스트
app.include_router(wa_livekit.router)         # /api/wa/livekit-token — LiveKit 토큰 (D24, G004)
app.include_router(auth.router)               # /api/auth/* — 웹콘솔 인증 (D4)
app.include_router(seats.router)              # /api/seats, /api/seat-assignments (D10, §3.11)
from app.api import work_logs  # noqa: E402  Lane A G001
app.include_router(work_logs.router)          # /api/work-logs (G001, Lane A)
# TODO(Phase 2+): meetings, meeting-minutes, kpi 라우터 (Lane B worker-2, Lane C worker-3)
