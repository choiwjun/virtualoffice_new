"""
office_layout 검증기 회귀 테스트 (REQ-003 / D12).

- _CollisionGrid.cell_of 리네임 회귀: 스키마-완전 layout이 reachability 단계에서
  크래시하지 않고 검증을 완주한다(과거 self.cell 속성/메서드 충돌 버그).
- 편집기(office-layout)가 생성하는 형태의 layout(빈 zones/rooms/colliders + seats+furniture
  + spawn)이 서버 validate에서 ERROR 0으로 통과한다(배포 가능 상태).
"""

import uuid
from datetime import datetime, timezone

from app.services.office_layout_validator import (
    validate_office_layout,
    _CollisionGrid,
    _convex_overlap,
    _rot_box_corners,
)


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


def _room_zone_wall_layout() -> dict:
    """officeLayout.ts 확장 빌더(rooms/zones/walls)와 동일 형태."""
    base = _editor_shaped_layout([(40, 300), (170, 300), (300, 300)])
    # 방 1개 (남측 문 + entrance 내부)
    rx, ry, rw, rh = 12.0, 2.0, 6.0, 5.0
    base["rooms"] = [{
        "room_id": "R_001", "name": "회의실 1", "type": "meeting", "capacity": 6,
        "capacity_mode": "by_room", "max_concurrent_users": 6,
        "coords": {"x": rx, "y": ry, "width": rw, "height": rh},
        "entrance": {"trigger_x": rx + rw / 2 - 0.5, "trigger_y": ry + rh - 1.0, "trigger_width": 1.0, "trigger_height": 0.5, "entry_direction": "south"},
        "doors": [{"door_id": "D_001", "wall": "south", "offset": rw / 2, "width": 1.2, "door_type": "glass_single"}],
    }]
    base["zones"] = [{"zone_id": "Z_001", "label": "구역 1", "type": "team", "color": "#3498db",
        "polygon": [{"x": 2.0, "y": 2.0}, {"x": 9.0, "y": 2.0}, {"x": 9.0, "y": 5.0}, {"x": 2.0, "y": 5.0}]}]
    base["colliders"] = [{"collider_id": "C_001", "shape": "box", "box": {"x": 0.4, "y": 0.4, "width": 0.4, "height": 4.0}, "physics": {"block_avatar": True}, "description": "벽 1"}]
    # dimensions 확장
    base["dimensions"] = {"width_m": 20.0, "height_m": 10.0, "min_x": 0, "max_x": 20.0, "min_y": 0, "max_y": 10.0, "unit": "meter"}
    return base


def test_room_zone_wall_layout_validates():
    """편집기 방/구역/벽 포함 layout이 ERROR 0으로 통과(배포 가능)."""
    result = validate_office_layout(_room_zone_wall_layout())
    codes = [e.as_dict()["code"] for e in result.errors]
    assert result.errors == [], f"unexpected errors: {codes}"


def test_room_missing_door_errors():
    """방에 문(door)이 없으면 ERROR (음성 케이스)."""
    layout = _room_zone_wall_layout()
    layout["rooms"][0]["doors"] = []
    result = validate_office_layout(layout)
    assert len(result.errors) > 0

# ── #10 회전 인식 충돌(OBB/SAT) ──────────────────────────────────────────────

def test_convex_overlap_axis_aligned():
    a = _rot_box_corners(0, 0, 1, 1, 0)      # [-1,1]x[-1,1]
    hit = _rot_box_corners(0.5, 0.5, 1, 1, 0)  # 겹침
    miss = _rot_box_corners(3, 0, 1, 1, 0)     # 분리
    assert _convex_overlap(a, hit) is True
    assert _convex_overlap(a, miss) is False


def test_convex_overlap_touching_edge_is_not_overlap():
    """변끼리 맞닿기만 하면 겹침 아님(AABB `<` 정합)."""
    a = _rot_box_corners(0, 0, 1, 1, 0)   # x[-1,1]
    b = _rot_box_corners(2, 0, 1, 1, 0)   # x[1,3] — x=1에서 접촉
    assert _convex_overlap(a, b) is False


def test_convex_overlap_rotation_changes_result():
    """0°에선 분리, 회전(90°) 시 겹치는 케이스 — 회전이 실제 반영되는지."""
    # 가로로 긴 얇은 박스(반크기 2 x 0.2)
    flat0 = _rot_box_corners(0, 0, 2, 0.2, 0)    # y[-0.2,0.2]
    flat90 = _rot_box_corners(0, 0, 2, 0.2, 90)  # 회전 후 y[-2,2]
    target = _rot_box_corners(0, 1.0, 0.1, 0.1, 0)  # y[0.9,1.1]
    assert _convex_overlap(flat0, target) is False   # 0°: y로 분리
    assert _convex_overlap(flat90, target) is True   # 90°: 회전으로 겹침
