"""
FastAPI 앱 엔트리포인트.

정본: 02-trd-architecture.md, 11-tech-stack.md.
- 라우터는 app/api/ 하위에서 점진 등록 (Phase 2+: users/teams/seats/meetings/kpi 등)
- 헬스체크: 배포·모니터링용 (13-risks: 운영 관측)
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import __version__
from app.config import settings
from app.db import engine

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 운영 기동 가드(P1-3, 2026-07-17): production + dev 기본 시크릿 조합은 fail-fast.
    settings.assert_production_safe()
    # dev/도그푸딩: 테이블 자동 생성 (운영은 Alembic). Docker 최초 기동 편의.
    if settings.auto_create_tables:
        from app.db import engine
        from app.models.tables import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    
    # D17/D18: APScheduler 배치 시작 (KPI 18:00/21:00, ERP 매시간)
    from app.services.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    
    yield
    
    # 종료 시 스케줄러 정리
    stop_scheduler()


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

# 로그인 IP rate-limit (P1-2) — email 잠금(auth.py)에 더한 IP 기준 2차 방어.
from app.core.ratelimit import LoginRateLimitMiddleware  # noqa: E402

app.add_middleware(LoginRateLimitMiddleware)

# 미디어 정적 서빙(프로필 사진, D35 배지 아바타) — media_root/avatars/* → /media/avatars/*
from pathlib import Path  # noqa: E402

from fastapi.staticfiles import StaticFiles  # noqa: E402

_media_dir = Path(settings.media_root)
_media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_media_dir)), name="media")


@app.get("/health", tags=["system"])
async def health() -> dict:
    """**liveness** — 프로세스가 살아 있는가. 의존성은 보지 않는다.

    DB를 여기서 확인하면 DB가 잠깐 끊겼을 때 오케스트레이터가 멀쩡한 프로세스를 **재시작**한다.
    재시작해도 DB는 그대로라 재시작 루프만 돈다. 의존성 확인은 `/ready`가 한다.
    """
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": __version__,
        "environment": settings.environment,
    }


@app.get("/ready", tags=["system"])
async def ready(response: Response) -> dict:
    """**readiness** — 지금 트래픽을 받아도 되는가(22 Tier 1 관측성).

    DB에 실제로 질의해 본다. 연결 풀이 죽었거나 마이그레이션 중이면 여기서 걸러야 하고,
    그동안 로드밸런서는 이 인스턴스로 요청을 보내지 않는다. 실패는 **503**이다 —
    200에 `{"ready": false}`를 실으면 프로브가 통과해 버려 아무 소용이 없다.
    """
    checks: dict[str, str] = {}
    ok = True
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 — 이유를 담아 돌려주는 게 목적
        ok = False
        checks["database"] = f"error: {type(exc).__name__}"
        logger.warning("[ready] database check failed", exc_info=True)

    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"ready": ok, "checks": checks, "version": __version__}


# ── 라우터 등록 (점진적) ─────────────────────────────────
from app.api import erp  # noqa: E402
from app.api import auth  # noqa: E402
from app.api import seats  # noqa: E402
from app.api import meetings  # noqa: E402
from app.api import meeting_minutes  # noqa: E402

app.include_router(erp.router)
app.include_router(auth.router)               # /api/auth/* — 웹콘솔 인증 (D4)
app.include_router(seats.router)              # /api/seats, /api/seat-assignments (D10, §3.11)
from app.api import work_logs  # noqa: E402  Lane A G001
from app.api import kpi  # noqa: E402  Lane C G003
app.include_router(work_logs.router)          # /api/work-logs (G001, Lane A)
app.include_router(meetings.router)           # /api/meetings* — 회의 예약·조회·참석 (G002, Lane B)
app.include_router(meeting_minutes.router)    # /api/meeting-minutes* — 회의록·액션아이템 (G002, Lane B)
app.include_router(kpi.router)                # /api/kpi-results/* — KPI 계산·검토·이의신청 (G003, Lane C)
from app.api import directory  # noqa: E402  Gaps: teams/org-groups
from app.api import audit  # noqa: E402  Gaps: audit-logs
app.include_router(directory.router)          # /api/teams, /api/org-groups (management-api)
app.include_router(audit.router)              # /api/audit-logs (D20-e, admin)
from app.api import office_layouts  # noqa: E402  Gaps: office-layouts (D12)
app.include_router(office_layouts.router)     # /api/office-layouts/* (D12 검증·배포·롤백)
from app.api import consent  # noqa: E402
app.include_router(consent.router)
from app.api import notices  # noqa: E402  공지사항 (14-spec §2.8)
app.include_router(notices.router)            # /api/notices — 사내 공지 (조회 전직원 / 작성·삭제 admin)
from app.api import avatar  # noqa: E402  아바타 커스터마이징 (C4, 06-screens §3.9)
app.include_router(avatar.router)             # /api/avatar — 내 아바타 조회/설정 (본인 전용)
from app.api import presence  # noqa: E402  실시간 프레즌스 batch (D3, Colyseus→FastAPI)
app.include_router(presence.router)           # /api/presence/batch — 이동서버 presence write (내부 토큰)
from app.api import realtime_layout  # noqa: E402  이동서버용 층 레이아웃 (05→FloorLayout 매핑)
app.include_router(realtime_layout.router)    # /api/realtime/floor-layout — deployed 레이아웃 조회 (내부 토큰)
from app.api import trips  # noqa: E402  출장 신청·승인 (06-screens '출장관리')
app.include_router(trips.router)              # /api/trips — 신청/승인/반려/완료 워크플로우
from app.api import reports  # noqa: E402  업무 보고서 (06-screens '보고서')
app.include_router(reports.router)            # /api/reports — 일일/주간/월간 draft→submitted
from app.api import chat  # noqa: E402  커뮤니케이션 채널 메시지 (06-screens '커뮤니케이션')
app.include_router(chat.router)               # /api/chat/* — general/team 채널, 폴링 조회
from app.api import integrations  # noqa: E402  본인 외부 계정 연동 (D31 opt-in, KPI 화면)
app.include_router(integrations.router)       # /api/integrations — github/figma 연동·활동 동기화
from app.api import employees  # noqa: E402  직원 디렉터리 + admin 직접 관리 (E3, 24-spec Phase 3)
app.include_router(employees.router)          # /api/employees* — 조회(전 역할) / 생성·수정·비활성(admin)
from app.api import branding  # noqa: E402  테넌트 화이트라벨 (E5, 24-spec Phase 4)
app.include_router(branding.router)           # /api/branding* — 브랜드명·색·로고 (조회 인증 / 수정 admin / public 미인증)
from app.api import onboarding  # noqa: E402  첫실행 체크리스트 + 투어 (E6, 24-spec Phase 5)
app.include_router(onboarding.router)         # /api/onboarding — 실측 파생 체크리스트 / dismiss·tour 저장
from app.api import calls  # noqa: E402  1:1 즉석 화상 호출 (09 §3.3 상호작용 · D24)
app.include_router(calls.router)              # /api/calls/token — 근접 벨(realtime)이 수락되면 이 룸으로 입장
