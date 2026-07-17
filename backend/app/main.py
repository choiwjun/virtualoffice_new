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
