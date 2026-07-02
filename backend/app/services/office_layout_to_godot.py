# @TASK P0-T0.6 - office_layout → Godot 중간 표현 변환
# @SPEC docs/planning/05-office-layout-schema.md#5-3-좌표계--godot-월드-매핑-d25
# @SPEC docs/planning/00-decisions.md#D8 #D9 #D25
# @TEST backend/tests/services/test_office_layout_to_godot.py

"""
office_layout JSON → Godot 클라이언트/헤드리스 서버가 소비하는 중간 표현(IR) 변환.

정본 문서: docs/planning/05-office-layout-schema.md (v1.1)
좌표 규약(D25):
  - layout 좌표: 원점 top_left, 미터, x=동(+), y=남(+)
  - Godot 월드: Vector3(x, floor_height, y) — 월드 X=동, 월드 Y=층 높이, 월드 Z=남
  - 회전/facing: 도(degree), 시계방향, 기준축 +X(동=0도)
  - Godot 쪽 적용: basis = Basis(Vector3.UP, deg_to_rad(-angle_cw))
    (Godot rotate_y는 반시계·라디안이므로 부호 반전 — 이 모듈은 각도를 변환하지 않고
     `rotation_cw_deg` 그대로 전달하며, 부호 변환은 Godot의 layout_to_world()가 담당한다)

출력 포맷 (room_builder.gd / scene_builder.gd가 소비 — docs/3d-design/scene-structure.md 정합):
{
  "meta": {"schema_version", "floor_id", "floor_height_m", "layout_version"},
  "furniture_groups": [            # 동일 asset_id → MultiMesh 1드로우콜 (D8/D7)
    {"asset_id": str, "instances": [{"position": [x, floor_h, y], "rotation_cw_deg": float}, ...]}
  ],
  "rooms": [                       # 파라메트릭 벽 + 문 개구부 (D9)
    {"room_id": str, "wall_segments": [{"start": [x, floor_h, y], "end": [...], "wall": "n|s|e|w",
                                        "glass": bool}, ...],
     "entrance_trigger": {...} | None, "capacity": int}
  ],
  "colliders": [{"collider_id", "shape": "box|polygon", "points": [...], "block_avatar": bool}],
  "seats": [{"seat_id", "position": [x, floor_h, y], "facing_cw_deg": float, "furniture_id": str}],
  "spawn_points": [{"spawn_id", "position": [...], "facing_cw_deg": float, "default": bool}],
  "zones": [...(원본 통과 — 헤드리스 서버 근접 감지용)],
  "minimap": {...(원본 통과)}
}
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

WALL_KEYS = ("north", "south", "east", "west")   # doors[].wall 값(05 §1.2.5)
_WALL_ALIASES = {"n": "north", "s": "south", "e": "east", "w": "west"}


def _norm_wall(value: str) -> str:
    """벽 이름 정규화 — 05 정본은 전체 이름(north/south/east/west), 축약형도 수용."""
    return _WALL_ALIASES.get(value, value)
WALL_THICKNESS_M = 0.12            # 파라메트릭 벽 두께 기본값(room_builder.gd 기본과 일치)
MIN_SEGMENT_LEN_M = 0.01           # 부동소수 오차로 생기는 미세 세그먼트 제거 임계


# ---------------------------------------------------------------------------
# D25 좌표 변환 (단일 규약 — 05 §5.3)
# ---------------------------------------------------------------------------

def layout_to_world(x: float, y: float, floor_height: float) -> list[float]:
    """layout 2D 좌표(top_left, 미터) → Godot 월드 [X, Y, Z].

    +X=동, 월드 Y=floor_height(층 바닥 오프셋), +Z=남(layout y가 아래로 증가하므로).
    회전은 여기서 다루지 않는다(rotation_cw_deg 그대로 전달, Godot에서 부호 반전).
    """
    return [float(x), float(floor_height), float(y)]


# ---------------------------------------------------------------------------
# D9 파라메트릭 벽 + 문 개구부
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WallSegment:
    """벽 1개 구간(개구부 제외 후 남는 실선 구간). 좌표는 layout 2D 기준."""
    wall: str                      # north | south | east | west
    start: tuple[float, float]     # (x, y)
    end: tuple[float, float]
    glass: bool = False

    def to_world(self, floor_height: float) -> dict[str, Any]:
        return {
            "wall": self.wall,
            "start": layout_to_world(*self.start, floor_height),
            "end": layout_to_world(*self.end, floor_height),
            "glass": self.glass,
            "thickness_m": WALL_THICKNESS_M,
        }


def _wall_length(room: dict[str, Any], wall: str) -> float:
    """해당 벽의 길이(m). north/south = width, east/west = height."""
    coords = room["coords"]
    return float(coords["width"]) if wall in ("north", "south") else float(coords["height"])


def _wall_intervals(room: dict[str, Any], wall: str) -> list[tuple[float, float]]:
    """벽 위 문 개구부(offset, offset+width) 구간 목록 — offset 오름차순.

    offset 기준점(05 §1.2.5): north/south 벽은 room 좌상단 x에서 동쪽으로,
    east/west 벽은 room 좌상단 y에서 남쪽으로 잰 거리.
    """
    doors = [d for d in room.get("doors", []) if _norm_wall(d.get("wall", "")) == wall]
    intervals = sorted(
        (float(d["offset"]), float(d["offset"]) + float(d["width"])) for d in doors
    )
    return intervals


def _segment_wall(room: dict[str, Any], wall: str) -> list[WallSegment]:
    """벽 1면을 문 개구부를 제외한 실선 세그먼트 목록으로 분할한다(D9).

    room.coords = {x, y, width, height} (top_left 기준, 미터).
    glass_walls 목록에 포함된 벽이면 glass=True로 표시(재질만 다르고 콜리전 동일 —
    단, 유리벽도 doors 개구부는 동일하게 뚫린다).
    """
    cx, cy = float(room["coords"]["x"]), float(room["coords"]["y"])
    w, h = float(room["coords"]["width"]), float(room["coords"]["height"])
    # glass_walls: [{wall_id, edge: "south", start, end, transparency, ...}] (05 §1.2.5)
    glass = wall in {_norm_wall(g.get("edge", "")) for g in room.get("glass_walls", [])}
    length = _wall_length(room, wall)

    # 개구부를 제외한 [start, end) 1D 구간 계산
    cursor = 0.0
    spans: list[tuple[float, float]] = []
    for open_start, open_end in _wall_intervals(room, wall):
        if open_start - cursor > MIN_SEGMENT_LEN_M:
            spans.append((cursor, min(open_start, length)))
        cursor = max(cursor, open_end)
    if length - cursor > MIN_SEGMENT_LEN_M:
        spans.append((cursor, length))

    # 1D 구간 → 2D 좌표 (벽별 기준점/진행 방향)
    def _point(t: float) -> tuple[float, float]:
        if wall == "north":
            return (cx + t, cy)              # 북벽: 좌→우(동)
        if wall == "south":
            return (cx + t, cy + h)          # 남벽: 좌→우(동)
        if wall == "west":
            return (cx, cy + t)              # 서벽: 상→하(남)
        return (cx + w, cy + t)              # 동벽: 상→하(남)

    return [WallSegment(wall, _point(a), _point(b), glass) for a, b in spans]


def build_room_walls(room: dict[str, Any], floor_height: float) -> dict[str, Any]:
    """room 1개 → 벽 세그먼트 IR. solid box로 방 전체를 덮지 않는다(D9).

    검증(office_layout_validator)이 이미 통과한 layout을 전제한다:
    doors offset+width ≤ 벽 길이, entrance trigger는 room 경계 내부 등.
    """
    segments: list[WallSegment] = []
    for wall in WALL_KEYS:
        segments.extend(_segment_wall(room, wall))

    entrance = room.get("entrance")
    return {
        "room_id": room["room_id"],
        "wall_segments": [s.to_world(floor_height) for s in segments],
        "entrance_trigger": entrance,   # 원본 통과(트리거 박스는 Godot이 Area3D로 생성)
        "capacity": room.get("capacity"),
        "room_type": room.get("room_type"),
    }


# ---------------------------------------------------------------------------
# D8 MultiMesh 그룹핑 (동일 asset_id → 1드로우콜)
# ---------------------------------------------------------------------------

def group_furniture(furniture: list[dict[str, Any]], floor_height: float) -> list[dict[str, Any]]:
    """furniture 목록을 asset_id별로 그룹핑한다.

    Godot scene_builder.gd는 instances가 2개 이상인 그룹을 MultiMeshInstance3D로,
    1개짜리는 단일 instantiate로 배치한다(05 §5.1). 그룹 순서는 asset_id 사전순(결정론).
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in furniture:
        groups.setdefault(item["asset_id"], []).append(item)

    result = []
    for asset_id in sorted(groups):
        instances = [
            {
                "furniture_id": f.get("furniture_id"),
                "position": layout_to_world(
                    f["coords"]["x"], f["coords"]["y"], floor_height
                ),
                "rotation_cw_deg": float(f["coords"].get("rotation", 0.0)),
            }
            for f in groups[asset_id]
        ]
        result.append({"asset_id": asset_id, "instances": instances})
    return result


# ---------------------------------------------------------------------------
# 최상위 변환
# ---------------------------------------------------------------------------

def convert_layout(layout: dict[str, Any]) -> dict[str, Any]:
    """검증 통과한 office_layout JSON → Godot 소비용 중간 표현(IR).

    호출 시점: office_layout 배포(deploy) 시 서버가 IR을 생성·저장하고,
    클라이언트/헤드리스 서버는 layout_reload 메시지 수신 후 이 IR을 fetch한다.
    (원본 JSON을 클라이언트가 직접 파싱하지 않게 하여 파서 3중 구현을 방지 — D12 정신)
    """
    floor = layout["floor"]
    metadata = layout.get("metadata", {})
    floor_h = float(floor.get("floor_height_m", 0.0))

    return {
        "meta": {
            "schema_version": metadata.get("schema_version"),
            "floor_id": metadata.get("floor_id") or floor.get("id"),
            "floor_height_m": floor_h,
            "layout_version": metadata.get("version"),
        },
        "furniture_groups": group_furniture(layout.get("furniture", []), floor_h),
        "rooms": [build_room_walls(r, floor_h) for r in layout.get("rooms", [])],
        "colliders": [
            {
                "collider_id": c.get("collider_id"),
                "shape": c.get("shape"),          # box | polygon (05 v1.1 shape 필드)
                "coords": c.get("coords"),        # box: {x,y,width,height} / polygon: [[x,y],...]
                "block_avatar": c.get("block_avatar", True),
            }
            for c in layout.get("colliders", [])
        ],
        "seats": [
            {
                "seat_id": s["seat_id"],
                "position": layout_to_world(s["coords"]["x"], s["coords"]["y"], floor_h),
                "facing_cw_deg": float(s.get("facing", 0.0)),   # D10 착석 방향
                "furniture_id": s.get("furniture_id"),          # D10 seat↔furniture 상호 참조
                "seat_type": s.get("seat_type"),
            }
            for s in layout.get("seats", [])
        ],
        "spawn_points": [
            {
                "spawn_id": p.get("spawn_id"),
                "position": layout_to_world(p["coords"]["x"], p["coords"]["y"], floor_h),
                "facing_cw_deg": float(p.get("facing", 0.0)),
                "default": p.get("default", False),
            }
            for p in layout.get("spawn_points", [])
        ],
        # 헤드리스 서버 근접 감지·구역 권한용 — 가공 없이 통과
        "zones": layout.get("zones", []),
        "minimap": layout.get("minimap", {}),
        "entrances": layout.get("entrances", []),
        "connections": layout.get("connections", {}),
    }
