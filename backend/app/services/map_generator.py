"""
조직 데이터 → TMJ (Tiled Map JSON) 맵 생성기.

[설계 원칙 — D12 정신: 조직 구조가 공간 구조를 결정]

입력: 팀 목록 + 인원수 → 출력: WorkAdventure 호환 TMJ JSON

TMJ 구조 (Tiled Map JSON, WorkAdventure 기준):
  - 레이어 순서: floor → walls → zones → collision → start
  - 좌석(seat): 타일 레이어 위에 오브젝트 레이어로 배치
  - 팀 구역(zone): 직사각형 오브젝트, WorkAdventure 스크립팅 존 연동
  - spawn 포인트: "start" 오브젝트 레이어 내 startLayer 프로퍼티

WorkAdventure 특수 레이어:
  - "collision" 레이어: 통행 불가 타일 (isSolid 프로퍼티 또는 특수 타일셋)
  - "start" 오브젝트 레이어: 스폰 포인트 (startLayer=true 프로퍼티)
  - 존 오브젝트 프로퍼티: "jitsiRoom", "openWebsite", "zone" 등

슬롯 용량 검증 (D12 정신):
  - team.headcount > zone.max_seats 이면 MapGeneratorError 발생
  - 초과 인원은 자동 축소 금지 — 명시적 에러로 피드백

GPS 코드 금지 (D20-c).

참조:
  - 00-decisions.md: D12(좌석 배치 자동화), D26(WorkAdventure), D20-c(GPS 폐기)
  - Tiled Map JSON 포맷: https://doc.mapeditor.org/en/stable/reference/json-map-format/
  - WorkAdventure 지도 구조: https://docs.workadventu.re/map-building/tiled-editor/
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Optional


# ---------------------------------------------------------------------------
# 에러 타입
# ---------------------------------------------------------------------------

class MapGeneratorError(ValueError):
    """맵 생성 실패 — 슬롯 초과 또는 잘못된 입력."""


# ---------------------------------------------------------------------------
# 입력 데이터 타입
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TeamSpec:
    """팀 구역 생성 명세."""
    name: str           # 팀 이름 (라벨, 존 이름으로도 사용)
    headcount: int      # 인원수 (좌석 수 ≥ headcount 이어야 함)
    color: str = "#4A90E2"  # 팀 구역 색상 (hex, Tiled 객체 색상)

    def __post_init__(self) -> None:
        if self.headcount < 0:
            raise MapGeneratorError(f"팀 '{self.name}': headcount는 0 이상이어야 합니다.")


@dataclass
class MapConfig:
    """맵 생성 파라미터."""
    tile_size: int = 32          # 타일 픽셀 크기 (WA 기본: 32px)
    zone_width: int = 10         # 팀 구역 너비 (tiles)
    zone_height: int = 8         # 팀 구역 높이 (tiles)
    zones_per_row: int = 3       # 한 행에 배치할 구역 수
    seat_cols: int = 4           # 구역 내 좌석 열 수
    seat_rows: int = 2           # 구역 내 좌석 행 수
    margin_tiles: int = 2        # 구역 간 여백 (tiles)
    entry_area_height: int = 4   # 로비/입구 영역 높이 (tiles, 상단)

    @property
    def max_seats_per_zone(self) -> int:
        """구역 당 최대 좌석 수."""
        return self.seat_cols * self.seat_rows


# ---------------------------------------------------------------------------
# TMJ 생성 헬퍼
# ---------------------------------------------------------------------------

_NEXT_OBJECT_ID = 1

_TILE_SIZE: Final = 32
_OFFICE_TILESET_IMAGE: Final = "office_tileset.png"
_OFFICE_TILESET: Final = (
    ("floor", "#DDE2E8"),
    ("wall", "#4B5563"),
    ("desk", "#9A6A3A"),
    ("meeting", "#4F8DEB"),
    ("passage", "#A7D9B7"),
)


def _next_oid() -> int:
    global _NEXT_OBJECT_ID
    oid = _NEXT_OBJECT_ID
    _NEXT_OBJECT_ID += 1
    return oid


def _reset_oid(start: int = 1) -> None:
    """테스트에서 OID 시퀀스 리셋용."""
    global _NEXT_OBJECT_ID
    _NEXT_OBJECT_ID = start


def _make_tile_layer(
    layer_id: int,
    name: str,
    width: int,
    height: int,
    tile_gid: int = 1,
    fill: bool = True,
) -> dict[str, Any]:
    """
    타일 레이어 생성.
    fill=True: 모든 셀을 tile_gid로 채움.
    fill=False: 모든 셀 0 (빈 레이어).
    """
    data = [tile_gid if fill else 0] * (width * height)
    return {
        "id": layer_id,
        "name": name,
        "type": "tilelayer",
        "visible": True,
        "opacity": 1,
        "x": 0,
        "y": 0,
        "width": width,
        "height": height,
        "data": data,
    }


def _make_object_layer(layer_id: int, name: str) -> dict[str, Any]:
    """오브젝트 레이어 생성 (빈 상태)."""
    return {
        "id": layer_id,
        "name": name,
        "type": "objectgroup",
        "visible": True,
        "opacity": 1,
        "x": 0,
        "y": 0,
        "objects": [],
    }


def _make_rect_object(
    oid: int,
    name: str,
    x: int,
    y: int,
    width: int,
    height: int,
    obj_type: str = "",
    properties: Optional[list[dict]] = None,
    color: str = "#4A90E2",
) -> dict[str, Any]:
    """직사각형 오브젝트 생성 (존, 좌석 등)."""
    obj: dict[str, Any] = {
        "id": oid,
        "name": name,
        "type": obj_type,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "visible": True,
    }
    if properties:
        obj["properties"] = properties
    return obj


def _ensure_office_tileset_png() -> None:
    try:
        from PIL import Image
    except ImportError:
        return

    output_dir = Path(__file__).resolve().parents[2] / "wa_maps"
    output_dir.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (_TILE_SIZE * len(_OFFICE_TILESET), _TILE_SIZE))
    for idx, (_, color) in enumerate(_OFFICE_TILESET):
        tile = Image.new("RGBA", (_TILE_SIZE, _TILE_SIZE), color)
        image.paste(tile, (idx * _TILE_SIZE, 0))
    image.save(output_dir / _OFFICE_TILESET_IMAGE)


def _make_tileset_stub() -> dict[str, Any]:
    _ensure_office_tileset_png()
    tiles = [
        {
            "id": idx,
            "type": name,
            "properties": [
                {"name": "color", "type": "string", "value": color},
            ],
        }
        for idx, (name, color) in enumerate(_OFFICE_TILESET)
    ]
    return {
        "firstgid": 1,
        "name": "office",
        "tilewidth": _TILE_SIZE,
        "tileheight": _TILE_SIZE,
        "spacing": 0,
        "margin": 0,
        "tilecount": len(_OFFICE_TILESET),
        "columns": len(_OFFICE_TILESET),
        "imagewidth": _TILE_SIZE * len(_OFFICE_TILESET),
        "imageheight": _TILE_SIZE,
        "image": _OFFICE_TILESET_IMAGE,
        "tiles": tiles,
    }


# ---------------------------------------------------------------------------
# 핵심 생성 함수
# ---------------------------------------------------------------------------

def generate_office_map(
    teams: list[TeamSpec],
    config: Optional[MapConfig] = None,
    script_url: str = "scripts/presence.js",
) -> dict[str, Any]:
    """
    조직 데이터 → WorkAdventure 호환 TMJ 맵 생성.

    Args:
        teams: 팀 명세 목록 (name, headcount, color).
        config: 맵 생성 파라미터. None이면 기본값 사용.
        script_url: WA scripting 파일 URL (map 레벨 'script' 프로퍼티).
                    상대경로 사용 시 TMJ 파일 위치 기준으로 해석됨.
                    기본: "scripts/presence.js" (map-storage 업로드 시 scripts/ 서브디렉토리)

    Returns:
        TMJ JSON 딕셔너리 (json.dumps로 직렬화 가능).

    Raises:
        MapGeneratorError: 팀 인원이 구역 최대 좌석 수 초과 시.
        MapGeneratorError: teams가 빈 목록일 시.

    구조:
        - 상단: 로비 / 입구 영역 (entry_area_height 타일)
        - 구역: zones_per_row × ceil(N/zones_per_row) 격자
        - 각 구역: 팀 라벨 + 좌석 오브젝트
        - spawn: 로비 중앙 (startLayer=true)
    """
    if config is None:
        config = MapConfig()

    if not teams:
        raise MapGeneratorError("팀 목록이 비어 있습니다.")

    # 슬롯 용량 사전 검증 (D12 정신: 초과 시 명시 에러)
    _validate_capacity(teams, config)

    _reset_oid(start=1)

    n_teams = len(teams)
    n_rows = math.ceil(n_teams / config.zones_per_row)
    step_x = config.zone_width + config.margin_tiles
    step_y = config.zone_height + config.margin_tiles

    # 전체 맵 크기 계산 (tiles)
    map_width = config.zones_per_row * step_x + config.margin_tiles
    map_height = (
        config.entry_area_height
        + n_rows * step_y
        + config.margin_tiles
    )

    # 픽셀 단위 변환
    px = config.tile_size

    # 레이어 생성
    floor_layer = _make_tile_layer(1, "floor", map_width, map_height, tile_gid=5, fill=True)
    wall_layer = _make_tile_layer(2, "walls", map_width, map_height, tile_gid=0, fill=False)
    zones_layer = _make_object_layer(3, "zones")
    seats_layer = _make_object_layer(4, "seats")
    start_layer = _make_object_layer(5, "start")

    # spawn 포인트 (로비 중앙)
    spawn_x = (map_width // 2) * px
    spawn_y = (config.entry_area_height // 2) * px
    start_layer["objects"].append(
        _make_rect_object(
            oid=_next_oid(),
            name="spawn",
            x=spawn_x,
            y=spawn_y,
            width=px,
            height=px,
            properties=[{"name": "startLayer", "type": "bool", "value": True}],
        )
    )

    # 회의실 존 주입 (로비 영역, D24 명시 입장)
    _inject_meeting_zones(
        zones_layer=zones_layer,
        floor_layer=floor_layer,
        map_width=map_width,
        entry_area_height=config.entry_area_height,
        margin_tiles=config.margin_tiles,
        px=px,
        count=3,
    )

    # 팀 구역 주입
    for idx, team in enumerate(teams):
        col = idx % config.zones_per_row
        row = idx // config.zones_per_row

        zone_x_tile = config.margin_tiles + col * step_x
        zone_y_tile = config.entry_area_height + config.margin_tiles + row * step_y

        zone_x_px = zone_x_tile * px
        zone_y_px = zone_y_tile * px
        zone_w_px = config.zone_width * px
        zone_h_px = config.zone_height * px

        # 팀 구역 오브젝트 (WA area class → WA.room.area.onEnter() 연동)
        safe_zone_name = f"{_safe_zone_name(team.name)}_{idx}"
        zones_layer["objects"].append(
            _make_rect_object(
                oid=_next_oid(),
                name=safe_zone_name,
                x=zone_x_px,
                y=zone_y_px,
                width=zone_w_px,
                height=zone_h_px,
                obj_type="area",
                color=team.color,
                properties=[
                    {"name": "team_name", "type": "string", "value": team.name},
                    {"name": "headcount", "type": "int", "value": team.headcount},
                    # WA area API: presence.js에서 WA.room.area.onEnter(safe_zone_name) 사용
                    {"name": "zone", "type": "string", "value": safe_zone_name},
                    # presence.js가 zone_type을 읽어 desk/meeting_room/focus_room 구분
                    {"name": "zone_type", "type": "string", "value": "desk"},
                ],
            )
        )

        # 팀 구역 바닥 타일 색상 변경 (GID 3 = desk area)
        floor_data: list[int] = floor_layer["data"]
        for dy in range(config.zone_height):
            for dx in range(config.zone_width):
                tile_x = zone_x_tile + dx
                tile_y = zone_y_tile + dy
                if 0 <= tile_x < map_width and 0 <= tile_y < map_height:
                    idx = tile_y * map_width + tile_x
                    if idx < len(floor_data):
                        floor_data[idx] = 3  # GID 3 = desk area tile

        # 좌석 오브젝트 생성
        _inject_seats(
            seats_layer=seats_layer,
            team=team,
            zone_x_px=zone_x_px,
            zone_y_px=zone_y_px,
            config=config,
            px=px,
        )

    # 로비 벽 (북쪽 경계)
    _inject_border_walls(wall_layer, map_width, map_height)

    # collision 레이어 (벽 기반 통행 불가)
    collision_layer = _make_tile_layer(6, "collision", map_width, map_height, tile_gid=0, fill=False)

    # floorLayer — WorkAdventure 필수 오브젝트 레이어 (MapValidator 검증 항목, error 레벨)
    # 빈 objectgroup: 레이어 이름·타입 규약만 충족하면 됨
    floor_obj_layer = _make_object_layer(7, "floorLayer")


    tmj: dict[str, Any] = {
        "version": "1.6",
        "tiledversion": "1.10.1",
        "type": "map",
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "width": map_width,
        "height": map_height,
        "tilewidth": px,
        "tileheight": px,
        "infinite": False,
        "nextlayerid": 11,
        "nextobjectid": _NEXT_OBJECT_ID + 1,
        "tilesets": [_make_tileset_stub()],
        "layers": [
            floor_layer,
            wall_layer,
            collision_layer,
            floor_obj_layer,
            zones_layer,
            seats_layer,
            start_layer,
        ],
        "properties": [
            {"name": "generator", "type": "string", "value": "virtualoffice-map-generator"},
            {"name": "team_count", "type": "int", "value": len(teams)},
            # WA scripting: 맵 로드 시 자동 실행할 JS 파일 URL (presence.js).
            # 상대 URL: TMJ 위치(map-storage/org-map.tmj) 기준 → map-storage/scripts/presence.js
            {"name": "script", "type": "string", "value": script_url},
        ],
    }
    return tmj


def _validate_capacity(teams: list[TeamSpec], config: MapConfig) -> None:
    """
    슬롯 용량 검증 — D12 정신: 초과 시 명시 에러.

    headcount > max_seats_per_zone 이면 MapGeneratorError 발생.
    """
    errors = []
    for team in teams:
        if team.headcount > config.max_seats_per_zone:
            errors.append(
                f"팀 '{team.name}': 인원 {team.headcount}명 > "
                f"구역 최대 좌석 {config.max_seats_per_zone}개"
            )
    if errors:
        raise MapGeneratorError(
            "슬롯 용량 초과 — 구역 크기 조정 또는 팀 분할 필요:\n"
            + "\n".join(f"  - {e}" for e in errors)
        )


def _safe_zone_name(team_name: str) -> str:
    """팀 이름 → WorkAdventure scripting API 안전 존 이름 (ASCII + 언더스코어)."""
    import unicodedata
    normalized = unicodedata.normalize("NFKC", team_name)
    # 공백/특수문자 → 언더스코어, 소문자화
    result = []
    for ch in normalized:
        if ch.isascii() and ch.isalnum():
            result.append(ch.lower())
        elif ch in (" ", "-", "_"):
            result.append("_")
    name = "".join(result) or "team"
    return f"team_{name}"


def _inject_seats(
    seats_layer: dict[str, Any],
    team: TeamSpec,
    zone_x_px: int,
    zone_y_px: int,
    config: MapConfig,
    px: int,
) -> None:
    """
    팀 구역 내 좌석 오브젝트 주입.

    좌석 배치: 구역 좌상단에서 seat_cols × seat_rows 격자.
    headcount만큼만 생성 (빈 슬롯은 오브젝트 없음).
    """
    seat_padding = px  # 구역 경계에서 1타일 안쪽
    seat_spacing = px  # 좌석 간격

    for i in range(team.headcount):
        col = i % config.seat_cols
        row = i // config.seat_cols

        seat_x = zone_x_px + seat_padding + col * (px + seat_spacing // 2)
        seat_y = zone_y_px + seat_padding + row * (px + seat_spacing // 2)

        seats_layer["objects"].append(
            _make_rect_object(
                oid=_next_oid(),
                name=f"{_safe_zone_name(team.name)}_seat_{i + 1}",
                x=seat_x,
                y=seat_y,
                width=px,
                height=px,
                obj_type="seat",
                properties=[
                    {"name": "team_name", "type": "string", "value": team.name},
                    {"name": "seat_index", "type": "int", "value": i + 1},
                    {"name": "desk", "type": "bool", "value": True},
                ],
            )
        )


def _inject_border_walls(wall_layer: dict[str, Any], width: int, height: int) -> None:
    """경계 벽 타일 주입 (상하좌우 1줄 테두리)."""
    data: list[int] = wall_layer["data"]
    wall_gid = 2  # GID 2 = 벽 타일

    for x in range(width):
        data[x] = wall_gid                        # 상단
        data[(height - 1) * width + x] = wall_gid  # 하단

    for y in range(height):
        data[y * width] = wall_gid               # 좌측
        data[y * width + (width - 1)] = wall_gid  # 우측


def _inject_meeting_zones(
    zones_layer: dict[str, Any],
    floor_layer: dict[str, Any],
    map_width: int,
    entry_area_height: int,
    margin_tiles: int,
    px: int,
    count: int = 3,
) -> None:
    """
    로비 영역에 회의실 존 주입 (D24 명시 입장 지원).
    
    Args:
        zones_layer: zones 오브젝트 레이어
        floor_layer: floor 타일 레이어 (회의실 바닥 타일 GID 4 적용)
        map_width: 맵 너비 (tiles)
        entry_area_height: 로비 영역 높이 (tiles)
        margin_tiles: 여백 (tiles)
        px: 타일 픽셀 크기
        count: 생성할 회의실 수 (기본 3개)
    """
    # 회의실 크기 (tiles)
    meeting_w = 4
    meeting_h = 3
    
    # 로비 영역 내 균등 배치
    total_w = map_width - 2 * margin_tiles
    spacing = total_w // (count + 1)
    
    meeting_names = ["meeting_room_1", "meeting_room_2", "meeting_room_3"]
    meeting_colors = ["#90EE90", "#98D8C8", "#87CEEB"]  # 녹색, 청록, 하늘색
    
    for i in range(count):
        # 위치 계산 (픽셀 단위)
        zone_x_tile = margin_tiles + (i + 1) * spacing - meeting_w // 2
        zone_y_tile = margin_tiles
        
        zone_x_px = zone_x_tile * px
        zone_y_px = zone_y_tile * px
        zone_w_px = meeting_w * px
        zone_h_px = meeting_h * px
        
        # 회의실 바닥 타일 색상 변경 (GID 4 = 회의실 타일)
        floor_data: list[int] = floor_layer["data"]
        for dy in range(meeting_h):
            for dx in range(meeting_w):
                tile_x = zone_x_tile + dx
                tile_y = zone_y_tile + dy
                if 0 <= tile_x < map_width and 0 <= tile_y < entry_area_height:
                    idx = tile_y * map_width + tile_x
                    if idx < len(floor_data):
                        floor_data[idx] = 4  # GID 4 = meeting room floor
        
        # 회의실 존 오브젝트 생성
        room_name = meeting_names[i] if i < len(meeting_names) else f"meeting_room_{i+1}"
        zones_layer["objects"].append(
            _make_rect_object(
                oid=_next_oid(),
                name=room_name,
                x=zone_x_px,
                y=zone_y_px,
                width=zone_w_px,
                height=zone_h_px,
                obj_type="area",
                color=meeting_colors[i] if i < len(meeting_colors) else "#90EE90",
                properties=[
                    {"name": "zone_type", "type": "string", "value": "meeting_room"},
                    {"name": "capacity", "type": "int", "value": 8},
                    {"name": "room_name", "type": "string", "value": room_name},
                ],
            )
        )


# ---------------------------------------------------------------------------
# WorkAdventure WAM 생성 (회의존 → 인터랙티브 area, D24 명시 입장 배선)
# ---------------------------------------------------------------------------

def generate_wam(tmj: dict[str, Any], map_url: str = "./org-map.tmj") -> dict[str, Any]:
    """TMJ의 zones objectgroup을 WorkAdventure .wam areas로 변환.

    각 존을 focusable area로 등록해 WA 클라이언트가 이름있는 상호작용 영역으로 인식하게 한다
    (회의존 D24 명시 입장은 presence.js가 TMJ zones objectgroup의 zone_type/room_name을 읽어 트리거).
    WA MapValidator 준수: mapUrl 필수, area 프로퍼티는 허용 discriminator(focusable)만 사용.
    빈 zones면 areas=[] (구조상 유효한 WAM).
    """
    import uuid as _uuid

    areas: list[dict[str, Any]] = []
    for layer in tmj.get("layers", []):
        if layer.get("type") != "objectgroup" or layer.get("name") != "zones":
            continue
        for obj in layer.get("objects", []):
            areas.append({
                "id": str(_uuid.uuid4()),
                "name": obj.get("name", "zone"),
                "visible": True,
                "x": float(obj.get("x", 0)),
                "y": float(obj.get("y", 0)),
                "width": float(obj.get("width", 0)),
                "height": float(obj.get("height", 0)),
                "properties": [
                    {"id": str(_uuid.uuid4()), "type": "focusable", "zoomMargin": 0.35},
                ],
            })
    return {
        "version": "1.0.0",
        "mapUrl": map_url,
        "areas": areas,
        "entities": {},
        "entityCollections": [],
    }
