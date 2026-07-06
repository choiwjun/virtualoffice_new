"""
office_layout 검증기 회귀 테스트 (REQ-003 / D12).

- _CollisionGrid.cell_of 리네임 회귀: 스키마-완전 layout이 reachability 단계에서
  크래시하지 않고 검증을 완주한다(과거 self.cell 속성/메서드 충돌 버그).
- 편집기(office-layout)가 생성하는 형태의 layout(빈 zones/rooms/colliders + seats+furniture
  + spawn)이 서버 validate에서 ERROR 0으로 통과한다(배포 가능 상태).
"""

import uuid
from datetime import datetime, timezone

from app.services.office_layout_validator import validate_office_layout, _CollisionGrid


def _u() -> str:
    return str(uuid.uuid4())


def _editor_shaped_layout(seat_px: list[tuple[float, float]], px_per_m: float = 50.0) -> dict:
    """officeLayout.ts buildOfficeLayout 과 동일한 규칙으로 layout 생성."""
    now = datetime.now(timezone.utc).isoformat()
    seats_m = [(round(x / px_per_m, 3), round(y / px_per_m, 3)) for x, y in seat_px]
    max_x = max((x for x, _ in seats_m), default=0.0)
    max_y = max((y for _, y in seats_m), default=0.0)
    w = round(max_x + 2, 3) or 10.0
    h = round(max_y + 2, 3) or 10.0
    furniture = [
        {"furniture_id": f"F_{i + 1:03d}", "asset_id": "desk_standard", "type": "desk",
         "coords": {"x": x, "y": y}}
        for i, (x, y) in enumerate(seats_m)
    ]
    seats = [
        {"seat_id": f"S_{i + 1:03d}", "seat_type": "free", "coords": {"x": x, "y": y},
         "facing": 180, "furniture_id": f"F_{i + 1:03d}"}
        for i, (x, y) in enumerate(seats_m)
    ]
    spawn = {"x": seats_m[0][0], "y": seats_m[0][1]} if seats_m else {"x": round(w / 2, 3), "y": round(h / 2, 3)}
    return {
        "metadata": {
            "version": "1.1", "schema_version": 1, "layout_id": _u(), "office_id": _u(),
            "floor_id": _u(), "floor_name": "1F", "created_at": now, "updated_at": now,
            "created_by": 1001, "updated_by": 1001, "language": "ko-KR",
        },
        "floor": {"id": _u(), "level": 1, "name": "1F", "coordinate_origin": "top_left",
                  "floor_height_m": 0, "unit_system": "metric"},
        "dimensions": {"width_m": w, "height_m": h, "min_x": 0, "max_x": w, "min_y": 0, "max_y": h, "unit": "meter"},
        "zones": [], "rooms": [], "seats": seats, "furniture": furniture, "colliders": [],
        "spawn_points": [{"spawn_id": "SP_DEFAULT", "type": "lobby", "coords": spawn, "facing": 90}],
        "spawn_default": {"spawn_id": "SP_DEFAULT"},
    }


def test_collision_grid_cell_of_is_callable():
    """cell_of는 좌표→셀 메서드로 호출 가능해야 한다(과거 self.cell 충돌로 크래시)."""
    layout = _editor_shaped_layout([(40, 40)])
    grid = _CollisionGrid.from_layout(layout, 0.25)
    assert grid is not None
    cell = grid.cell_of({"x": 0.8, "y": 0.8})
    assert cell is not None
    assert isinstance(grid.cell, float)  # 셀 크기 속성은 float 유지


def test_editor_layout_validates_without_errors():
    """편집기 형태 layout이 ERROR 0으로 통과(배포 가능) — reachability 완주 포함."""
    layout = _editor_shaped_layout([(40, 40), (170, 40), (300, 40), (40, 130)])
    result = validate_office_layout(layout)
    codes = [e.as_dict()["code"] for e in result.errors]
    assert result.errors == [], f"unexpected errors: {codes}"


def test_empty_seats_layout_validates():
    """좌석 0개(빈 배치)도 구조상 유효(ERROR 0)."""
    layout = _editor_shaped_layout([])
    result = validate_office_layout(layout)
    assert result.errors == [], [e.as_dict() for e in result.errors]


def test_seat_without_matching_furniture_errors():
    """seat.furniture_id가 없는 가구를 가리키면 ERROR(음성 케이스)."""
    layout = _editor_shaped_layout([(40, 40)])
    layout["furniture"] = []  # 매칭 가구 제거
    result = validate_office_layout(layout)
    assert any("SEAT" in e.as_dict()["code"] or "FURNITURE" in e.as_dict()["code"]
               for e in result.errors), [e.as_dict() for e in result.errors]
