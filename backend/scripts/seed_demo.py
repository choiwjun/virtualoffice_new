#!/usr/bin/env python
"""
데모용 시드 스크립트 — 영업/데모 시연을 위한 "북적이는 가상 회사"를 채운다 (감사 23 E8).

seed_dev.py(계정 3명)만으로는 "빈 사무실 + 3명"이라 데모가 초라하다.
이 스크립트는 직원 ~20명 + 좌석/회의실 + 공지 + KPI + 회의/회의록/액션아이템
+ 업무로그 + 보고서 + 출장 + 채팅 + 프레즌스를 한 번에 적재한다.

사용:
    cd backend
    DATABASE_URL="sqlite+aiosqlite:///./dev_qa.db" ./.venv/Scripts/python.exe scripts/seed_demo.py

특징:
- 멱등: 센티넬 데모 계정(id=DEMO_SENTINEL_ID)이 이미 있으면 print 후 exit 0 (중복 방지).
- 트랜잭션: 단일 세션에서 전부 add 후 한 번 commit.
- 비밀번호: 전원 password123 (seed_dev와 동일 해시 헬퍼 hash_password 사용 — 하드코딩 금지).
- 존재가 검증된 테이블/컬럼만 사용 (tables.py 확인). 모델이 없으면 생략.

주의: 운영 DB에 실행 금지. seed_dev.py / seed_seats.py 와 id 대역이 겹치지 않게 2000번대 사용.
"""

import asyncio
import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

# backend/ 를 sys.path에 추가 (스크립트 직접 실행 지원)
_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./dev.db")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.models.tables import (  # noqa: E402
    ActionItem,
    ActionItemPriority,
    ActionItemStatus,
    Base,
    BusinessTrip,
    ChatMessage,
    ErpRole,
    ErpUser,
    Floor,
    InviteStatus,
    KpiPeriodType,
    KpiSource,
    KpiResult,
    Meeting,
    MeetingMinute,
    MeetingMinuteStatus,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingStatus,
    Notice,
    NoticeCategory,
    Office,
    Presence,
    PresenceStatus,
    Report,
    ReportStatus,
    ReportType,
    Room,
    RoomStatus,
    RoomType,
    Seat,
    SeatStatus,
    SeatType,
    TripStatus,
    UserAvatar,
    WorkLog,
    WorkLogStatus,
)

DATABASE_URL = os.environ["DATABASE_URL"]

COMPANY_ID = 1

# 데모 존재 여부를 판별하는 센티넬 계정 id — 있으면 재적재 스킵.
DEMO_SENTINEL_ID = 2001

# ── 팀(ERP teams.id 임의값 — dev 전용) ──────────────────────
TEAM_PLATFORM = 10   # 플랫폼개발팀
TEAM_PRODUCT = 11    # 프로덕트팀
TEAM_DESIGN = 12     # 디자인팀
TEAM_SALES = 13      # 세일즈팀
TEAM_PEOPLE = 14     # 피플팀(HR)

_now = datetime.now(timezone.utc)
_today = _now.date()


def _dt(days_ago: int = 0, hour: int = 9, minute: int = 0) -> datetime:
    """오늘 기준 상대 UTC datetime."""
    base = _now - timedelta(days=days_ago)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0)


# ---------------------------------------------------------------------------
# 1) 직원 ~20명 (한국식 이름, 역할·팀·직책 다양)
# ---------------------------------------------------------------------------
# (id, name, team, role, position, presence)
_EMP = [
    (2001, "정하준", TEAM_PLATFORM, ErpRole.ADMIN, "대표이사", PresenceStatus.ONLINE),
    (2002, "김서연", TEAM_PLATFORM, ErpRole.LEADER, "플랫폼개발팀장", PresenceStatus.WORKING),
    (2003, "이도현", TEAM_PLATFORM, ErpRole.EMPLOYEE, "백엔드 개발자", PresenceStatus.WORKING),
    (2004, "박지우", TEAM_PLATFORM, ErpRole.EMPLOYEE, "프론트엔드 개발자", PresenceStatus.FOCUS),
    (2005, "최민준", TEAM_PLATFORM, ErpRole.EMPLOYEE, "데브옵스 엔지니어", PresenceStatus.MEETING),
    (2006, "한소율", TEAM_PRODUCT, ErpRole.LEADER, "프로덕트팀장", PresenceStatus.MEETING),
    (2007, "윤재원", TEAM_PRODUCT, ErpRole.EMPLOYEE, "프로덕트 매니저", PresenceStatus.WORKING),
    (2008, "장예은", TEAM_PRODUCT, ErpRole.EMPLOYEE, "데이터 분석가", PresenceStatus.AWAY),
    (2009, "임현우", TEAM_PRODUCT, ErpRole.EMPLOYEE, "QA 엔지니어", PresenceStatus.WORKING),
    (2010, "오지훈", TEAM_DESIGN, ErpRole.LEADER, "디자인팀장", PresenceStatus.ONLINE),
    (2011, "서다인", TEAM_DESIGN, ErpRole.EMPLOYEE, "프로덕트 디자이너", PresenceStatus.WORKING),
    (2012, "홍채원", TEAM_DESIGN, ErpRole.EMPLOYEE, "UX 라이터", PresenceStatus.FOCUS),
    (2013, "강태오", TEAM_SALES, ErpRole.LEADER, "세일즈팀장", PresenceStatus.EXTERNAL),
    (2014, "문가온", TEAM_SALES, ErpRole.EMPLOYEE, "영업 매니저", PresenceStatus.EXTERNAL),
    (2015, "신유나", TEAM_SALES, ErpRole.EMPLOYEE, "영업 담당", PresenceStatus.ONLINE),
    (2016, "권시우", TEAM_SALES, ErpRole.EMPLOYEE, "고객 성공 매니저", PresenceStatus.WORKING),
    (2017, "배수아", TEAM_PEOPLE, ErpRole.LEADER, "피플팀장", PresenceStatus.WORKING),
    (2018, "조은결", TEAM_PEOPLE, ErpRole.EMPLOYEE, "HR 매니저", PresenceStatus.ONLINE),
    (2019, "노아린", TEAM_PEOPLE, ErpRole.EMPLOYEE, "총무 담당", PresenceStatus.AWAY),
    (2020, "황도경", TEAM_PLATFORM, ErpRole.EMPLOYEE, "머신러닝 엔지니어", PresenceStatus.OFFLINE),
]

# 팀장 매핑(manager_id 보고라인) — 팀별 리더 id
_TEAM_LEADER = {
    TEAM_PLATFORM: 2002,
    TEAM_PRODUCT: 2006,
    TEAM_DESIGN: 2010,
    TEAM_SALES: 2013,
    TEAM_PEOPLE: 2017,
}

# 아바타 색상 팔레트(팀별)
_TEAM_COLOR = {
    TEAM_PLATFORM: "#3B5BFE",
    TEAM_PRODUCT: "#10B981",
    TEAM_DESIGN: "#F59E0B",
    TEAM_SALES: "#EF4444",
    TEAM_PEOPLE: "#8B5CF6",
}


def _email(uid: int) -> str:
    return f"demo{uid}@virtualoffice.local"


# ---------------------------------------------------------------------------
# 2) 데모 좌석/회의실 (seed_seats와 겹치지 않는 데모 벤치 — DEMO- 접두)
# ---------------------------------------------------------------------------
# 데모 직원 대다수를 좌석에 앉혀 "북적이는" 느낌. 좌표는 대략 그리드(미터).
_DEMO_SEATS: list[tuple[str, int, float, float]] = []
_seat_users = [u for u in _EMP if u[5] in (
    PresenceStatus.WORKING, PresenceStatus.FOCUS, PresenceStatus.ONLINE,
)]
for _i, _u in enumerate(_seat_users):
    _col = _i % 4
    _row = _i // 4
    _DEMO_SEATS.append((f"DEMO-{_i + 1:02d}", _u[0], 2.5 + _col * 1.8, 2.5 + _row * 2.4))

_DEMO_ROOMS = [
    {"name": "Demo Town Hall", "livekit_room": "demo-townhall", "capacity": 20,
     "coords": {"x": 12.0, "y": 1.0, "width": 6.0, "height": 4.0}},
    {"name": "Demo Huddle", "livekit_room": "demo-huddle", "capacity": 6,
     "coords": {"x": 12.0, "y": 6.0, "width": 3.5, "height": 3.0}},
]


# ---------------------------------------------------------------------------
# 3) 공지 (일부 고정/예약)
# ---------------------------------------------------------------------------
_NOTICES = [
    {"title": "[전사] 2분기 타운홀 미팅 안내", "author": "피플팀",
     "body": "6월 30일 15시 타운홀에서 2분기 성과 공유 및 하반기 로드맵을 발표합니다. 전 직원 필참.",
     "pinned": True, "category": NoticeCategory.NOTICE, "pub_days": 2, "exp_days": None},
    {"title": "[IT] 사내 VPN 점검 (야간)", "author": "IT팀",
     "body": "금요일 22:00~24:00 VPN 정기 점검이 진행됩니다. 해당 시간 원격 접속이 제한될 수 있습니다.",
     "pinned": True, "category": NoticeCategory.SYSTEM, "pub_days": 1, "exp_days": -5},
    {"title": "복지 포인트 상반기 소진 안내", "author": "총무팀",
     "body": "상반기 복지 포인트는 6월 말까지 소진해 주세요. 미사용분은 이월되지 않습니다.",
     "pinned": False, "category": NoticeCategory.INFO, "pub_days": 3, "exp_days": None},
    {"title": "신규 입사자 온보딩 세션", "author": "피플팀",
     "body": "이번 주 입사한 3명의 온보딩 세션이 목요일 오전에 진행됩니다.",
     "pinned": False, "category": NoticeCategory.NOTICE, "pub_days": 0, "exp_days": None},
    {"title": "[예약] 여름 워크샵 사전 안내", "author": "피플팀",
     "body": "8월 여름 워크샵 세부 일정은 추후 공지됩니다.",
     "pinned": False, "category": NoticeCategory.INFO, "pub_days": -3, "exp_days": None},
]


# KPI 메트릭 사전(kpi_engine._METRIC_UNITS 정합) — daily 산출 6종 + 분기 종합.
_DAILY_METRICS = [
    ("work_completed_count", "count"),
    ("work_quality_score", "score"),
    ("action_items_completed", "count"),
    ("action_items_ontime_rate", "%"),
    ("report_fidelity_score", "score"),
    ("collaboration_score", "score"),
]


def _current_quarter_key(d: date) -> str:
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


async def seed(session: AsyncSession) -> dict[str, int]:
    counts: dict[str, int] = {}

    # ── 직원 ──────────────────────────────────────────────
    pw_hash = hash_password("password123")
    for uid, name, team, role, position, _presence in _EMP:
        session.add(ErpUser(
            id=uid,
            company_id=COMPANY_ID,
            email=_email(uid),
            name=name,
            erp_team_id=team,
            role=role,
            position=position,
            manager_id=(None if role == ErpRole.ADMIN else _TEAM_LEADER.get(team)),
            work_type="office",
            work_hours=480,
            is_active=True,
            last_synced_at=_now,
            password_hash=pw_hash,
        ))
    await session.flush()
    counts["erp_user"] = len(_EMP)

    # ── 아바타 (팀 컬러) ──────────────────────────────────
    for uid, _name, team, _role, _pos, _pr in _EMP:
        session.add(UserAvatar(
            user_id=uid,
            preset_id="humanoid_a" if uid % 2 == 0 else "humanoid_b",
            top_color=_TEAM_COLOR.get(team, "#3B5BFE"),
            bottom_color="#1E293B",
            show_nameplate=True,
        ))
    counts["user_avatar"] = len(_EMP)

    # ── Office / Floor get-or-create (seed_seats와 동일 규약: name='본사', level=1) ──
    office = (
        await session.execute(select(Office).where(Office.name == "본사"))
    ).scalar_one_or_none()
    if office is None:
        office = Office(company_id=COMPANY_ID, name="본사", description="demo seed")
        session.add(office)
        await session.flush()

    floor = (
        await session.execute(
            select(Floor).where(Floor.office_id == office.id, Floor.level == 1)
        )
    ).scalar_one_or_none()
    if floor is None:
        floor = Floor(office_id=office.id, level=1, name="1층")
        session.add(floor)
        await session.flush()

    # ── 좌석 (DEMO- 접두, (floor, seat_number) 멱등) ─────────
    seats_new = 0
    for num, uid, x, y in _DEMO_SEATS:
        exists = (
            await session.execute(
                select(Seat).where(Seat.floor_id == floor.id, Seat.seat_number == num)
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(Seat(
                floor_id=floor.id,
                type=SeatType.FIXED,
                assigned_user_id=uid,
                coords={"x": round(x, 3), "y": round(y, 3), "facing": 0},
                status=SeatStatus.OCCUPIED,
                seat_number=num,
            ))
            seats_new += 1
    counts["seat"] = seats_new

    # ── 회의실 (DEMO- 이름, (floor, name) 멱등) ─────────────
    demo_rooms: list[Room] = []
    rooms_new = 0
    for spec in _DEMO_ROOMS:
        room = (
            await session.execute(
                select(Room).where(Room.floor_id == floor.id, Room.name == spec["name"])
            )
        ).scalar_one_or_none()
        if room is None:
            room = Room(
                floor_id=floor.id,
                type=RoomType.MEETING,
                name=spec["name"],
                capacity=spec["capacity"],
                coords=spec["coords"],
                livekit_room=spec["livekit_room"],
                status=RoomStatus.ACTIVE,
            )
            session.add(room)
            await session.flush()
            rooms_new += 1
        demo_rooms.append(room)
    counts["room"] = rooms_new

    # ── 프레즌스 (직원별 상태·위치) ─────────────────────────
    seat_xy = {uid: (x, y) for _n, uid, x, y in _DEMO_SEATS}
    for uid, _name, _team, _role, _pos, presence in _EMP:
        x, y = seat_xy.get(uid, (5.0, 5.0))
        session.add(Presence(
            user_id=uid,
            office_id=office.id,
            floor_id=floor.id,
            x=x, y=y, z=0.0,
            status=presence,
            last_activity_at=_now,
        ))
    counts["presence"] = len(_EMP)

    # ── 공지 ──────────────────────────────────────────────
    for n in _NOTICES:
        exp = None if n["exp_days"] is None else _dt(n["exp_days"], hour=23, minute=59)
        session.add(Notice(
            title=n["title"],
            body=n["body"],
            author=n["author"],
            pinned=n["pinned"],
            category=n["category"],
            published_at=_dt(n["pub_days"], hour=9),
            expires_at=exp,
            created_by=2001,
            is_active=True,
        ))
    counts["notice"] = len(_NOTICES)

    # ── 업무로그 (최근 5일, 개발/프로덕트/디자인 직원) ─────────
    log_authors = [2003, 2004, 2005, 2007, 2009, 2011, 2020]
    categories = ["개발", "리뷰", "설계", "회의", "QA"]
    wl_count = 0
    for uid in log_authors:
        for d in range(5):
            completed = d > 0  # 오늘 것 일부는 진행 중
            session.add(WorkLog(
                user_id=uid,
                work_date=_today - timedelta(days=d),
                category=categories[(uid + d) % len(categories)],
                title=f"작업 항목 #{uid}-{d}",
                goal="스프린트 목표 항목 처리",
                related_project="Virtual Office",
                est_minutes=120,
                actual_minutes=100 + (uid + d) % 60,
                status=WorkLogStatus.COMPLETED if completed else WorkLogStatus.STARTED,
                result_description="완료 및 리뷰 반영" if completed else None,
                completed_at=(_dt(d, hour=18) if completed else None),
            ))
            wl_count += 1
    counts["work_log"] = wl_count

    # ── 보고서 (일부 제출/작성중) ───────────────────────────
    rp_count = 0
    for i, uid in enumerate([2002, 2003, 2006, 2007, 2010, 2013, 2017]):
        submitted = i % 2 == 0
        session.add(Report(
            user_id=uid,
            report_type=ReportType.DAILY if i % 2 == 0 else ReportType.WEEKLY,
            report_date=_today - timedelta(days=i % 3),
            title=f"업무 보고서 #{uid}",
            content="금일 주요 업무 및 진행 상황 요약. 특이사항 없음.",
            status=ReportStatus.SUBMITTED if submitted else ReportStatus.DRAFT,
            submitted_at=(_dt(i % 3, hour=18) if submitted else None),
        ))
        rp_count += 1
    counts["report"] = rp_count

    # ── 출장 (신청/승인/완료 다양) ──────────────────────────
    trips = [
        (2014, "부산 고객사", "신규 계약 미팅", TripStatus.APPROVED, 2013, 3, 4),
        (2015, "대전 파트너사", "제휴 논의", TripStatus.REQUESTED, None, 6, 7),
        (2013, "서울 코엑스", "산업 컨퍼런스 참가", TripStatus.COMPLETED, 2001, -2, -1),
        (2016, "광주 고객사", "온보딩 지원", TripStatus.APPROVED, 2013, 5, 6),
    ]
    for uid, dest, purpose, status, approver, start_off, end_off in trips:
        decided = None if status == TripStatus.REQUESTED else _dt(max(start_off, 0) + 1, hour=10)
        session.add(BusinessTrip(
            user_id=uid,
            destination=dest,
            purpose=purpose,
            start_date=_today + timedelta(days=start_off),
            end_date=_today + timedelta(days=end_off),
            status=status,
            approver_id=approver,
            decided_at=decided,
            report=("출장 결과: 계약 성사, 후속 미팅 예정." if status == TripStatus.COMPLETED else None),
        ))
    counts["business_trip"] = len(trips)

    # ── 채팅 (general + 팀 채널) ────────────────────────────
    chat_msgs = [
        ("general", 2001, "모두 이번 분기 고생 많으셨습니다! 타운홀에서 뵙겠습니다."),
        ("general", 2018, "신규 입사자 온보딩 자료 공유 드립니다. 확인 부탁드려요."),
        ("general", 2007, "이번 릴리즈 노트 정리했습니다. 리뷰 부탁드립니다."),
        (f"team:{TEAM_PLATFORM}", 2002, "오늘 배포 파이프라인 점검 있습니다. PR 머지 전 확인해주세요."),
        (f"team:{TEAM_PLATFORM}", 2003, "백엔드 API 스펙 업데이트 완료했습니다."),
        (f"team:{TEAM_PLATFORM}", 2004, "프론트 반영하고 있습니다. 30분 내 완료 예정."),
        (f"team:{TEAM_DESIGN}", 2010, "새 디자인 시스템 토큰 반영본 공유합니다."),
        (f"team:{TEAM_SALES}", 2013, "이번 주 파이프라인 리뷰 목요일 오후로 잡았습니다."),
    ]
    for i, (channel, uid, content) in enumerate(chat_msgs):
        m = ChatMessage(channel=channel, user_id=uid, content=content)
        m.created_at = _now - timedelta(hours=len(chat_msgs) - i)
        session.add(m)
    counts["chat_message"] = len(chat_msgs)

    # ── 회의 (과거 완료 2건 + 진행 중 1건 + 예정 1건) ─────────
    townhall, huddle = demo_rooms[0], demo_rooms[1]
    meetings_spec = [
        # (room, host, title, status, sched_days_ago, hour, started, ended, with_minute)
        (townhall, 2001, "2분기 전사 리뷰", MeetingStatus.COMPLETED, 3, 15, True, True, True),
        (huddle, 2002, "플랫폼 스프린트 회고", MeetingStatus.COMPLETED, 1, 11, True, True, True),
        (huddle, 2006, "프로덕트 데일리 스탠드업", MeetingStatus.IN_PROGRESS, 0, 9, True, False, False),
        (townhall, 2001, "하반기 로드맵 킥오프", MeetingStatus.SCHEDULED, -1, 14, False, False, False),
    ]
    meetings: list[Meeting] = []
    mp_count = 0
    for room, host, title, status, days_ago, hour, started, ended, with_min in meetings_spec:
        sched = _dt(days_ago, hour=hour)
        m = Meeting(
            room_id=room.id,
            host_user_id=host,
            title=title,
            description=f"{title} 회의",
            scheduled_at=sched,
            duration_minutes=60,
            started_at=(sched if started else None),
            ended_at=(sched + timedelta(minutes=55) if ended else None),
            status=status,
            livekit_room=room.livekit_room,
        )
        session.add(m)
        await session.flush()
        meetings.append(m)

        # 참석자 (host + 팀원 몇 명)
        attendees = [host] + [u[0] for u in _EMP if u[1] == host and u[0] != host][:4]
        if not attendees[1:]:
            attendees = [host, 2003, 2004]
        for j, aid in enumerate(dict.fromkeys(attendees)):
            joined = (sched if started else None)
            session.add(MeetingParticipant(
                meeting_id=m.id,
                user_id=aid,
                invited_at=sched - timedelta(days=1),
                joined_at=joined,
                left_at=(sched + timedelta(minutes=55) if (ended and j > 0) else None),
                role=MeetingParticipantRole.ORGANIZER if aid == host else MeetingParticipantRole.PARTICIPANT,
                invite_status=InviteStatus.ACCEPTED,
            ))
            mp_count += 1
    counts["meeting"] = len(meetings)
    counts["meeting_participant"] = mp_count

    # ── 회의록 + 액션아이템 (완료된 회의에) ───────────────────
    mm_count = 0
    ai_count = 0
    for m, spec in zip(meetings, meetings_spec):
        if not spec[8]:  # with_minute
            continue
        session.add(MeetingMinute(
            meeting_id=m.id,
            title=f"{m.title} 회의록",
            summary="주요 논의 사항 및 결정 요약.",
            decisions="- 다음 스프린트 우선순위 확정\n- 릴리즈 일정 조정 승인",
            action_items_summary="후속 액션아이템 2건 등록.",
            notes="추가 논의는 다음 회의에서 진행.",
            created_by=m.host_user_id,
            status=MeetingMinuteStatus.FINALIZED,
        ))
        mm_count += 1
        for k, (assignee, prio, st) in enumerate([
            (m.host_user_id, ActionItemPriority.HIGH, ActionItemStatus.IN_PROGRESS),
            (2003, ActionItemPriority.MEDIUM, ActionItemStatus.OPEN),
        ]):
            session.add(ActionItem(
                meeting_id=m.id,
                title=f"{m.title} 후속 작업 {k + 1}",
                description="회의 결정에 따른 후속 처리.",
                assignee_user_id=assignee,
                due_date=_today + timedelta(days=5 + k),
                priority=prio,
                status=st,
            ))
            ai_count += 1
    counts["meeting_minute"] = mm_count
    counts["action_item"] = ai_count

    # ── KPI (직원별 daily 6종 + 분기 종합 quarterly_total) ────
    quarter_key = _current_quarter_key(_today)
    day_key = (_today - timedelta(days=1)).isoformat()
    kpi_count = 0
    for idx, (uid, _name, _team, _role, _pos, _pr) in enumerate(_EMP):
        # 일일 메트릭
        base = 70 + (idx * 7) % 25  # 70~94 대역으로 분산
        metric_values = {
            "work_completed_count": Decimal(str(3 + idx % 5)),
            "work_quality_score": Decimal(str(base)),
            "action_items_completed": Decimal(str(1 + idx % 4)),
            "action_items_ontime_rate": Decimal(str(min(100, base + 5))),
            "report_fidelity_score": Decimal(str(max(50, base - 3))),
            "collaboration_score": Decimal(str(base + 2)),
        }
        for metric, unit in _DAILY_METRICS:
            session.add(KpiResult(
                user_id=uid,
                period_type=KpiPeriodType.DAILY,
                period_key=day_key,
                metric=metric,
                value=metric_values[metric],
                unit=unit,
                source=KpiSource.VIRTUAL_OFFICE,
                ai_model="mock",
            ))
            kpi_count += 1
        # 분기 종합
        session.add(KpiResult(
            user_id=uid,
            period_type=KpiPeriodType.QUARTERLY,
            period_key=quarter_key,
            metric="quarterly_total",
            value=Decimal(str(base + 2)),
            unit="score",
            source=KpiSource.VIRTUAL_OFFICE,
            ai_model="mock",
            final_score=Decimal(str(base + 2)),
            finalized_at=_now,
        ))
        kpi_count += 1
    counts["kpi_result"] = kpi_count

    await session.commit()
    return counts


async def main() -> None:
    print(f"DB: {DATABASE_URL}")

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
        # 멱등 가드: 센티넬 데모 계정이 이미 있으면 스킵.
        sentinel = (
            await session.execute(select(ErpUser).where(ErpUser.id == DEMO_SENTINEL_ID))
        ).scalar_one_or_none()
        if sentinel is not None:
            print(f"데모 데이터가 이미 존재합니다 (sentinel id={DEMO_SENTINEL_ID}). 스킵.")
            await engine.dispose()
            return

        counts = await seed(session)

    await engine.dispose()

    print("\n=== 데모 시드 완료 (엔티티별 신규 건수) ===")
    for k, v in counts.items():
        print(f"  {k:<20} {v}")
    print("\n데모 로그인: email=demo2001@virtualoffice.local ~ demo2020@virtualoffice.local")
    print("            (관리자=demo2001, 비밀번호=password123)")


if __name__ == "__main__":
    asyncio.run(main())
