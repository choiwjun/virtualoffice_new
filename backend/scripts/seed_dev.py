"""
개발용 시드 스크립트 (SQLite) — 웹 콘솔/프론트엔드 라이브 E2E 검증용.

실행:
    cd backend
    DATABASE_URL="sqlite+aiosqlite:///./dev.db" .venv/Scripts/python.exe scripts/seed_dev.py

시드 내용:
  - 관리자(admin@spacecl.com / admin1234) + 직원(emp@spacecl.com / emp12345)
  - office/floor 1개
  - 배포된 office_layout 1개 (godot/scenes/sample_office_layout.json + 메타데이터 패치 → 검증 통과분)
  - KpiResult daily 몇 건 (조정/확정/이의신청 대상)
  - DB seat 몇 개

주의: 이 개발 시드는 SQLite 파일(dev.db)에만 쓴다. 운영/Postgres 아님.
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

# app 임포트 전에 DB URL 확정(설정 캐시 전).
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./dev.db")
os.environ.setdefault("ENVIRONMENT", "development")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.security import hash_password  # noqa: E402
from app.db import Base, engine, SessionLocal  # noqa: E402
from app.models.tables import (  # noqa: E402
    AuthCredential,
    ErpRole,
    ErpUser,
    Feedback,
    Floor,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    Meeting,
    MeetingStatus,
    Office,
    OfficeLayout,
    OfficeLayoutStatus,
    Room,
    RoomStatus,
    RoomType,
    Seat,
    SeatStatus,
    SeatType,
)
from app.services.office_layout_validator import validate_office_layout  # noqa: E402

SAMPLE = Path(__file__).resolve().parents[2] / "godot" / "scenes" / "sample_office_layout.json"


def build_layout(office_id, floor_id, layout_id) -> dict:
    layout = json.loads(SAMPLE.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat()
    md = layout.setdefault("metadata", {})
    md.update(
        {
            "layout_id": str(layout_id),
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "created_at": now,
            "updated_at": now,
            "created_by": 1,
            "updated_by": 1,
            "version": md.get("version", "1.0"),
            "schema_version": md.get("schema_version", 1),
            "language": md.get("language", "ko"),
        }
    )
    fl = layout.setdefault("floor", {})
    fl["id"] = str(floor_id)
    return layout


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    office_id, floor_id, layout_id = uuid4(), uuid4(), uuid4()
    layout = build_layout(office_id, floor_id, layout_id)

    # 삽입 전 self-check: ERROR 0건이어야 배포 가능(D12).
    result = validate_office_layout(layout)
    if not result.is_deployable:
        print("[seed] layout 검증 실패 — 삽입 중단:")
        for e in result.errors:
            print("   ERROR", e.code, e.path, e.message[:100])
        raise SystemExit(1)
    print(f"[seed] layout 검증 통과 (errors=0, warnings={len(result.warnings)})")

    async with SessionLocal() as db:
        db.add(Office(id=office_id, company_id=uuid4(), name="본사"))
        db.add(Floor(id=floor_id, office_id=office_id, level=1, name="1F"))

        db.add(ErpUser(id=1, company_id=1, email="admin@spacecl.com", name="관리자", erp_team_id=1, role=ErpRole.ADMIN))
        db.add(ErpUser(id=2, company_id=1, email="emp@spacecl.com", name="김직원", erp_team_id=1, role=ErpRole.EMPLOYEE))
        await db.flush()
        db.add(AuthCredential(user_id=1, password_hash=hash_password("admin1234")))
        db.add(AuthCredential(user_id=2, password_hash=hash_password("emp12345")))

        db.add(
            OfficeLayout(
                id=layout_id,
                office_id=office_id,
                floor_id=floor_id,
                version=1,
                status=OfficeLayoutStatus.DEPLOYED,
                json=layout,
                created_by=1,
                validated_by=1,
                deployed_at=datetime.now(timezone.utc),
            )
        )

        today = datetime.now(timezone.utc).date().isoformat()
        kpi_rows = [
            (2, "work_completed_count", Decimal("12"), "count"),
            (2, "collaboration_score", Decimal("78.5"), "score"),
            (2, "action_items_ontime_rate", Decimal("91.0"), "%"),
            (1, "collaboration_score", Decimal("85.0"), "score"),
        ]
        for uid, metric, value, unit in kpi_rows:
            db.add(
                KpiResult(
                    user_id=uid,
                    period_type=KpiPeriodType.DAILY,
                    period_key=today,
                    metric=metric,
                    value=value,
                    unit=unit,
                    source=KpiSource.VIRTUAL_OFFICE,
                    ai_draft={
                        "강점": "회의 액션아이템 이행률이 높음",
                        "개선": "업무기록 결과 링크 보강 필요",
                        "근거": f"{metric}={value}",
                    },
                    ai_model="claude-opus",
                )
            )

        for i, seat in enumerate((layout.get("seats") or [])[:6]):
            c = seat.get("coords", {})
            db.add(
                Seat(
                    floor_id=floor_id,
                    type=SeatType(seat.get("seat_type", "fixed")),
                    coords={"x": c.get("x", 0), "y": c.get("y", 0), "facing": seat.get("facing", 0)},
                    status=SeatStatus.AVAILABLE,
                    seat_number=seat.get("seat_id", f"S{i+1:03d}"),
                )
            )

        # 회의실 + 회의 (회의/회의록 화면용) — layout rooms[0] 좌표 사용
        room_id = uuid4()
        lr = (layout.get("rooms") or [{}])[0]
        lc = lr.get("coords", {"x": 2, "y": 2, "width": 5, "height": 4})
        db.add(
            Room(
                id=room_id,
                floor_id=floor_id,
                type=RoomType(lr.get("type", "meeting")) if lr.get("type") in ("meeting", "lobby", "lounge", "focus", "phonebooth") else RoomType.MEETING,
                name=lr.get("name", "회의실 A"),
                capacity=lr.get("capacity", 8),
                coords=lc,
                status=RoomStatus.ACTIVE,
            )
        )
        now = datetime.now(timezone.utc)
        db.add(
            Meeting(
                room_id=room_id,
                host_user_id=1,
                title="주간 스탠드업",
                description="E2E 시드 회의",
                scheduled_at=now + timedelta(hours=1),
                scheduled_end=now + timedelta(hours=2),
                status=MeetingStatus.SCHEDULED,
            )
        )

        # 피드백 2건 (피드백 화면용)
        db.add(Feedback(user_id=2, type="bug", title="좌석 배정 후 새로고침 필요", description="배정 즉시 반영 안 됨", status="open"))
        db.add(Feedback(user_id=2, type="feature", title="KPI 카드에 전분기 비교", description="추이 보고 싶음", status="reviewing"))

        await db.commit()

    print("[seed] 완료: admin@spacecl.com/admin1234, emp@spacecl.com/emp12345")
    print(f"[seed] office={office_id} floor={floor_id} layout={layout_id} (deployed v1)")
    print(f"[seed] KpiResult {len(kpi_rows)}건, seat 6개")


if __name__ == "__main__":
    asyncio.run(main())
