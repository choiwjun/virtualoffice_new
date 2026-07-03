# @TASK P0-T0.6 - office_layout 검증 로직 (서버 단일 정밀 검증)
# @SPEC docs/planning/05-office-layout-schema.md#3-검증-규칙-및-검증-아키텍처
# @SPEC docs/planning/00-decisions.md#D12
# @TEST backend/tests/services/test_office_layout_validator.py

"""
office_layout 정밀 검증 (FastAPI 서버 단일 — D12).

정본 문서: docs/planning/05-office-layout-schema.md (v1.1)
공식 JSON Schema: docs/data-model/office-layout-schema.json (Draft 2020-12)

검증 아키텍처(D12):
- 웹 편집기: 경량 체크(범위/겹침)만. 권위 없음.
- FastAPI 서버(이 모듈): 정밀 검증 전부(구조·공간·조직·설비·미니맵 + 도달성 A*).
- Godot 클라이언트: 검증하지 않고 신뢰.

검증 단계:
  (a) JSON Schema 검증          — jsonschema (구조·타입·enum·패턴·필수·범위)
  (b) 의미(semantic) 검증        — 좌표 범위·겹침·capacity·doors·좌석↔가구·asset 존재
  (c) 도달성(reachability) 검증  — spawn → seat/room 문 개구부 grid BFS(콜리전 맵 기반)
  (d) 성능 파생 계산            — asset 테이블에서 polygon/draw_call 합산(MultiMesh 규칙)

심각도 정책(D12): ERROR가 하나라도 있으면 배포 불가. WARNING만 무시 가능.
반환: ValidationResult(errors[], warnings[]).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Optional

try:
    # jsonschema는 D12 공식 스키마 검증에 사용
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover - 런타임 의존성 누락 방어
    Draft202012Validator = None  # type: ignore


# ---------------------------------------------------------------------------
# 상수 (07 §1.2 성능 예산 정합)
# ---------------------------------------------------------------------------

# 공식 JSON Schema 파일 경로 (docs 정본). 배포 패키지에서는
# backend/app/schemas/office_layout.schema.json 로 복사되어 참조될 수 있음(05 §3.0).
SCHEMA_PATH = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "data-model"
    / "office-layout-schema.json"
)

DRAW_CALL_BUDGET = 200          # §3.4 드로우콜 예산 초과 → ERROR
POLYGON_BUDGET = 1_500_000      # §3.4 폴리곤 예산 초과 → WARNING (07 §1.2 기준 상한)
MEMORY_BUDGET_MB = 512          # §3.4 메모리 예측 초과 → WARNING (D22 GTX1650급 VRAM)

GRID_CELL_M = 0.25              # 도달성 grid 셀 크기(m). grid_snap_unit_cm와 별개(내비 해상도)
SEAT_OVERLAP_MARGIN_M = 0.05    # 좌석↔가구 좌표 일치 허용 오차(m)


# ---------------------------------------------------------------------------
# 결과 자료구조
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    """검증 심각도(D12). ERROR=배포 차단, WARNING=무시 가능."""
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True)
class ValidationIssue:
    """검증 이슈 1건."""
    severity: Severity
    code: str            # 규칙 코드(예: 'COORD_OUT_OF_BOUNDS')
    message: str         # 한국어 사용자 메시지
    path: str = ""       # JSON 경로(예: 'seats[3].coords')

    def as_dict(self) -> dict[str, str]:
        return {
            "severity": self.severity.value,
            "code": self.code,
            "message": self.message,
            "path": self.path,
        }


@dataclass
class ValidationResult:
    """검증 결과 집계."""
    issues: list[ValidationIssue] = field(default_factory=list)
    # (d)에서 계산된 서버 파생 performance 블록(저장 시 편집기 값 대체)
    derived_performance: dict[str, Any] = field(default_factory=dict)

    def add(self, issue: ValidationIssue) -> None:
        self.issues.append(issue)

    def error(self, code: str, message: str, path: str = "") -> None:
        self.add(ValidationIssue(Severity.ERROR, code, message, path))

    def warn(self, code: str, message: str, path: str = "") -> None:
        self.add(ValidationIssue(Severity.WARNING, code, message, path))

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity is Severity.ERROR]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity is Severity.WARNING]

    @property
    def is_deployable(self) -> bool:
        """ERROR가 하나도 없어야 배포 가능(D12)."""
        return len(self.errors) == 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "deployable": self.is_deployable,
            "errors": [i.as_dict() for i in self.errors],
            "warnings": [i.as_dict() for i in self.warnings],
            "derived_performance": self.derived_performance,
        }


@dataclass
class ValidationContext:
    """
    검증에 필요한 외부 데이터(DB 조회 결과 주입).

    검증 로직을 순수 함수로 유지하기 위해 DB I/O는 caller가 수행해
    이 컨텍스트로 전달한다(테스트 용이성). build_context_from_db()가
    asset·ERP teams 조회 스켈레톤을 제공한다.
    """
    # asset_id(문자열 카탈로그 키) → polygon_count. 존재 확인 + 파생 계산에 사용.
    # tables.py Asset.asset_id는 07 §5.3 v1.1 정본에 따라 VARCHAR(64) 카탈로그 키
    # (예: 'reception-desk-v1.0')로, 05 layout asset_id와 직접 매칭된다.
    #       매핑이 필요(최종 보고 불일치 항목 참조).
    asset_polygons: dict[str, int] = field(default_factory=dict)
    asset_memory_mb: dict[str, float] = field(default_factory=dict)
    valid_erp_team_ids: set[int] = field(default_factory=set)
    draw_call_budget: int = DRAW_CALL_BUDGET
    polygon_budget: int = POLYGON_BUDGET
    memory_budget_mb: float = MEMORY_BUDGET_MB

    @property
    def known_asset_ids(self) -> set[str]:
        return set(self.asset_polygons.keys())


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def validate_office_layout(
    layout: dict[str, Any],
    context: Optional[ValidationContext] = None,
    schema: Optional[dict[str, Any]] = None,
) -> ValidationResult:
    """
    office_layout JSON을 정밀 검증한다(D12 서버 단일).

    Args:
        layout: 검증 대상 layout dict(JSON 파싱 완료본).
        context: DB 파생 데이터(asset·ERP teams·예산). None이면 조직/에셋 검증은
                 건너뛰고(정보 없음) 구조·공간·도달성만 수행.
        schema: 공식 JSON Schema dict. None이면 SCHEMA_PATH에서 로드.

    Returns:
        ValidationResult — errors/warnings/derived_performance.

    실행 순서: (a) 스키마 → (b) 의미 → (c) 도달성 → (d) 성능 파생.
    (a)에서 구조 ERROR가 나면 이후 단계는 KeyError를 피하기 위해 방어적으로 진행한다.
    """
    result = ValidationResult()
    ctx = context or ValidationContext()

    # (a) JSON Schema 검증 -----------------------------------------------------
    _validate_schema(layout, schema, result)

    # 스키마 치명 오류(루트 타입 불일치 등)면 의미 검증 불가 → 조기 반환
    if not isinstance(layout, dict) or "dimensions" not in layout:
        return result

    # (b) 의미 검증 ------------------------------------------------------------
    _validate_unique_ids(layout, result)
    _validate_coordinate_ranges(layout, result)
    _validate_seat_furniture_link(layout, result)
    _validate_object_overlaps(layout, result)
    _validate_room_entrances(layout, result)
    _validate_doors(layout, result)
    _validate_capacity(layout, result)
    _validate_facing(layout, result)
    _validate_assets(layout, ctx, result)
    _validate_org(layout, ctx, result)
    _validate_minimap(layout, result)

    # (c) 도달성(A*/BFS) 검증 --------------------------------------------------
    _validate_reachability(layout, result)

    # (d) 성능 파생 계산 -------------------------------------------------------
    _compute_derived_performance(layout, ctx, result)

    return result


# ---------------------------------------------------------------------------
# (a) JSON Schema 검증
# ---------------------------------------------------------------------------

def load_schema(path: Path = SCHEMA_PATH) -> dict[str, Any]:
    """공식 JSON Schema 파일 로드."""
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_schema(
    layout: dict[str, Any],
    schema: Optional[dict[str, Any]],
    result: ValidationResult,
) -> None:
    """공식 JSON Schema(Draft 2020-12)로 구조·타입·enum·패턴·필수·정적 범위 검증."""
    if Draft202012Validator is None:
        result.error(
            "SCHEMA_LIB_MISSING",
            "jsonschema 라이브러리가 설치되지 않아 스키마 검증을 수행할 수 없습니다.",
        )
        return
    schema = schema or load_schema()
    validator = Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(layout), key=lambda e: list(e.path)):
        path = "".join(_json_path_segments(err.absolute_path))
        result.error("SCHEMA", err.message, path or "$")


def _json_path_segments(path: Iterable[Any]) -> list[str]:
    segs: list[str] = []
    for p in path:
        segs.append(f"[{p}]" if isinstance(p, int) else f".{p}")
    return segs


# ---------------------------------------------------------------------------
# (b) 의미 검증
# ---------------------------------------------------------------------------

def _validate_unique_ids(layout: dict[str, Any], result: ValidationResult) -> None:
    """floor 내 zone/room/seat/furniture/collider ID 고유성(§3.1 — ERROR)."""
    specs = [
        ("zones", "zone_id"),
        ("rooms", "room_id"),
        ("seats", "seat_id"),
        ("furniture", "furniture_id"),
        ("colliders", "collider_id"),
    ]
    for coll, key in specs:
        seen: set[str] = set()
        for i, obj in enumerate(layout.get(coll, []) or []):
            oid = obj.get(key)
            if oid is None:
                continue
            if oid in seen:
                result.error(
                    "DUPLICATE_ID",
                    f"{coll}의 {key} '{oid}'가 중복됩니다.",
                    f"{coll}[{i}].{key}",
                )
            seen.add(oid)


def _validate_coordinate_ranges(layout: dict[str, Any], result: ValidationResult) -> None:
    """모든 좌표가 dimensions 범위 내에 있는지(§3.1 — ERROR)."""
    dim = layout.get("dimensions", {})
    min_x, max_x = dim.get("min_x", 0.0), dim.get("max_x", 0.0)
    min_y, max_y = dim.get("min_y", 0.0), dim.get("max_y", 0.0)

    def check(x: float, y: float, path: str) -> None:
        if not (min_x <= x <= max_x and min_y <= y <= max_y):
            result.error(
                "COORD_OUT_OF_BOUNDS",
                f"좌표({x}, {y})가 층 범위 [{min_x}~{max_x}, {min_y}~{max_y})를 벗어납니다.",
                path,
            )

    for i, s in enumerate(layout.get("seats", []) or []):
        c = s.get("coords", {})
        check(c.get("x", 0), c.get("y", 0), f"seats[{i}].coords")
    for i, f in enumerate(layout.get("furniture", []) or []):
        c = f.get("coords", {})
        check(c.get("x", 0), c.get("y", 0), f"furniture[{i}].coords")
    for i, r in enumerate(layout.get("rooms", []) or []):
        c = r.get("coords", {})
        check(c.get("x", 0), c.get("y", 0), f"rooms[{i}].coords(top_left)")
        # 방 우하단 모서리도 범위 내여야 함
        check(
            c.get("x", 0) + c.get("width", 0),
            c.get("y", 0) + c.get("height", 0),
            f"rooms[{i}].coords(bottom_right)",
        )
    for i, sp in enumerate(layout.get("spawn_points", []) or []):
        c = sp.get("coords", {})
        check(c.get("x", 0), c.get("y", 0), f"spawn_points[{i}].coords")


def _validate_seat_furniture_link(layout: dict[str, Any], result: ValidationResult) -> None:
    """
    좌석↔가구 상호 참조 정합(D10·§3.2 — ERROR).
    seat.furniture_id가 유효한 furniture를 가리키고 좌표가 일치해야 함.
    """
    furn_by_id = {f.get("furniture_id"): f for f in layout.get("furniture", []) or []}
    for i, s in enumerate(layout.get("seats", []) or []):
        fid = s.get("furniture_id")
        furn = furn_by_id.get(fid)
        if furn is None:
            result.error(
                "SEAT_FURNITURE_MISSING",
                f"좌석 '{s.get('seat_id')}'의 furniture_id '{fid}'에 해당하는 가구가 없습니다.",
                f"seats[{i}].furniture_id",
            )
            continue
        sc, fc = s.get("coords", {}), furn.get("coords", {})
        if (
            abs(sc.get("x", 0) - fc.get("x", 0)) > SEAT_OVERLAP_MARGIN_M
            or abs(sc.get("y", 0) - fc.get("y", 0)) > SEAT_OVERLAP_MARGIN_M
        ):
            result.error(
                "SEAT_FURNITURE_DESYNC",
                f"좌석 '{s.get('seat_id')}' 좌표와 가구 '{fid}' 좌표가 일치하지 않습니다(desync).",
                f"seats[{i}].coords",
            )


def _validate_object_overlaps(layout: dict[str, Any], result: ValidationResult) -> None:
    """
    오브젝트 충돌(§3.2 — ERROR): 가구/방이 정적 콜리전(외벽·기둥)과 겹치는지.
    AABB 근사(회전 미반영 — box rotation은 TODO). 좌석↔가구는 §3.2에서 좌표 일치가
    정상이므로 겹침 검사에서 제외한다.
    """
    collider_rects = _collider_aabbs(layout)
    # 가구 AABB
    for i, f in enumerate(layout.get("furniture", []) or []):
        if not f.get("collision", True):
            continue
        fr = _furniture_aabb(f)
        for cr in collider_rects:
            if _aabb_overlap(fr, cr):
                result.error(
                    "OBJECT_COLLISION",
                    f"가구 '{f.get('furniture_id')}'가 콜리전 영역과 겹칩니다.",
                    f"furniture[{i}]",
                )
                break


def _validate_room_entrances(layout: dict[str, Any], result: ValidationResult) -> None:
    """입장 트리거가 room coords 경계 내부에 있어야 함(§3.2 — ERROR)."""
    for i, r in enumerate(layout.get("rooms", []) or []):
        ent = r.get("entrance")
        c = r.get("coords", {})
        if not ent or not c:
            continue
        tx, ty = ent.get("trigger_x", 0), ent.get("trigger_y", 0)
        tw, th = ent.get("trigger_width", 0), ent.get("trigger_height", 0)
        rx, ry, rw, rh = c.get("x", 0), c.get("y", 0), c.get("width", 0), c.get("height", 0)
        inside = (
            rx <= tx and tx + tw <= rx + rw
            and ry <= ty and ty + th <= ry + rh
        )
        if not inside:
            result.error(
                "ENTRANCE_OUT_OF_ROOM",
                f"방 '{r.get('room_id')}'의 입장 트리거가 방 경계 내부에 있지 않습니다.",
                f"rooms[{i}].entrance",
            )
        # 입장 트리거↔문 근접(§3.2 — WARNING)
        if not _entrance_near_any_door(ent, r.get("doors", []) or [], c):
            result.warn(
                "ENTRANCE_NO_DOOR",
                f"방 '{r.get('room_id')}'의 입장 트리거 근처에 문 개구부가 없습니다.",
                f"rooms[{i}].entrance",
            )


def _validate_doors(layout: dict[str, Any], result: ValidationResult) -> None:
    """
    문 개구부 정합(D9·§3.2 — ERROR):
    각 room에 doors 최소 1개(스키마에서도 강제), 각 door의 offset±width/2가
    해당 벽 길이 [0, 벽길이] 범위 내에 완전히 들어가야 함.
    """
    for i, r in enumerate(layout.get("rooms", []) or []):
        c = r.get("coords", {})
        doors = r.get("doors", []) or []
        if not doors:
            result.error(
                "ROOM_NO_DOOR",
                f"방 '{r.get('room_id')}'에 문 개구부(doors)가 없어 진입할 수 없습니다.",
                f"rooms[{i}].doors",
            )
        for j, d in enumerate(doors):
            wall = d.get("wall")
            wall_len = _wall_length(c, wall)
            half = d.get("width", 0) / 2.0
            offset = d.get("offset", 0)
            if not (0 <= offset - half and offset + half <= wall_len):
                result.error(
                    "DOOR_OUT_OF_WALL",
                    f"방 '{r.get('room_id')}' 문 '{d.get('door_id')}'의 개구부가 "
                    f"'{wall}' 벽 길이({wall_len}m) 범위를 벗어납니다.",
                    f"rooms[{i}].doors[{j}]",
                )


def _validate_capacity(layout: dict[str, Any], result: ValidationResult) -> None:
    """
    회의실 수용인원(§3.2 — ERROR):
    capacity_mode=by_seats인 room은 경계 내부에 seats가 정확히 capacity개 있어야 함.
    by_room이면 좌석 수와 무관.
    """
    seats = layout.get("seats", []) or []
    for i, r in enumerate(layout.get("rooms", []) or []):
        if r.get("capacity_mode") != "by_seats":
            continue
        c = r.get("coords", {})
        inside = sum(1 for s in seats if _point_in_room(s.get("coords", {}), c))
        if inside != r.get("capacity"):
            result.error(
                "CAPACITY_MISMATCH",
                f"방 '{r.get('room_id')}'(by_seats)의 capacity={r.get('capacity')}이나 "
                f"경계 내 좌석은 {inside}개입니다.",
                f"rooms[{i}].capacity",
            )


def _validate_facing(layout: dict[str, Any], result: ValidationResult) -> None:
    """facing 범위 [0,360) 검사(§3.2 — WARNING). 스키마는 WARNING 유지 위해 미강제."""
    def check(val: Any, path: str) -> None:
        if isinstance(val, (int, float)) and not (0 <= val < 360):
            result.warn(
                "FACING_RANGE",
                f"facing 값 {val}이 [0, 360) 범위를 벗어납니다(도).",
                path,
            )
    for i, s in enumerate(layout.get("seats", []) or []):
        check(s.get("facing"), f"seats[{i}].facing")
    for i, sp in enumerate(layout.get("spawn_points", []) or []):
        check(sp.get("facing"), f"spawn_points[{i}].facing")


def _validate_assets(
    layout: dict[str, Any], ctx: ValidationContext, result: ValidationResult
) -> None:
    """furniture.asset_id가 asset 카탈로그에 존재하는지(D8·§3.4 — ERROR)."""
    if not ctx.known_asset_ids:
        # 카탈로그 정보 미주입 시 검증 스킵(정보 없음). caller가 context 제공 필요.
        return
    for i, f in enumerate(layout.get("furniture", []) or []):
        aid = f.get("asset_id")
        if aid not in ctx.known_asset_ids:
            result.error(
                "ASSET_NOT_FOUND",
                f"가구 '{f.get('furniture_id')}'의 asset_id '{aid}'가 에셋 카탈로그에 없습니다.",
                f"furniture[{i}].asset_id",
            )


def _validate_org(
    layout: dict[str, Any], ctx: ValidationContext, result: ValidationResult
) -> None:
    """조직/역할 검증(§3.3): erp_team_id 유효성(ERROR), org_group_id 누락(WARNING)."""
    for i, z in enumerate(layout.get("zones", []) or []):
        tid = z.get("erp_team_id")
        if ctx.valid_erp_team_ids and tid not in ctx.valid_erp_team_ids:
            result.error(
                "ZONE_TEAM_INVALID",
                f"구역 '{z.get('zone_id')}'의 erp_team_id {tid}가 ERP teams에 없습니다.",
                f"zones[{i}].erp_team_id",
            )
        if not z.get("org_group_id"):
            result.warn(
                "ZONE_ORG_GROUP_MISSING",
                f"구역 '{z.get('zone_id')}'에 org_group_id가 없어 권한 계층에 영향이 있습니다.",
                f"zones[{i}].org_group_id",
            )


def _validate_minimap(layout: dict[str, Any], result: ValidationResult) -> None:
    """미니맵 뷰포트 범위(§3.5 — ERROR), 픽셀 해상도(WARNING)."""
    mm = layout.get("minimap")
    if not mm:
        return
    dim = layout.get("dimensions", {})
    vx, vy = mm.get("viewport_x", 0), mm.get("viewport_y", 0)
    vw, vh = mm.get("viewport_width", 0), mm.get("viewport_height", 0)
    if not (
        dim.get("min_x", 0) <= vx and vx + vw <= dim.get("max_x", 0)
        and dim.get("min_y", 0) <= vy and vy + vh <= dim.get("max_y", 0)
    ):
        result.error(
            "MINIMAP_VIEWPORT_OOB",
            "미니맵 viewport가 dimensions 범위를 벗어납니다.",
            "minimap",
        )
    px = mm.get("pixel_width", 0) * mm.get("pixel_height", 0)
    if px and not (100_000 <= px <= 1_000_000):
        result.warn(
            "MINIMAP_RESOLUTION",
            f"미니맵 픽셀 해상도({px})가 권장 범위(100k~1M)를 벗어납니다.",
            "minimap",
        )


# ---------------------------------------------------------------------------
# (c) 도달성(reachability) 검증 — 콜리전 맵 기반 grid BFS (서버 전용, D12)
# ---------------------------------------------------------------------------

def _validate_reachability(layout: dict[str, Any], result: ValidationResult) -> None:
    """
    spawn_point → 모든 seat/room 문 개구부까지 도달 가능한지 grid BFS로 검증(§3.2 — WARNING).

    콜리전 맵 구성:
      - dimensions로 grid 생성(GRID_CELL_M 해상도)
      - colliders(box/polygon, block_avatar=True)를 blocked로 마킹
      - room 경계 벽을 blocked로 마킹하되 doors[] 개구부 구간은 통행 가능(D9)
    """
    grid = _CollisionGrid.from_layout(layout, GRID_CELL_M)
    if grid is None:
        return

    # 스폰 셀 집합에서 BFS
    spawns = layout.get("spawn_points", []) or []
    sources = [grid.coord_to_cell(sp.get("coords", {})) for sp in spawns]
    sources = [c for c in sources if c and grid.walkable(*c)]
    if not sources:
        result.warn(
            "REACH_NO_SPAWN",
            "통행 가능한 spawn_point가 없어 도달성 검증을 수행할 수 없습니다.",
            "spawn_points",
        )
        return

    reachable = grid.bfs(sources)

    # 좌석 도달성
    for i, s in enumerate(layout.get("seats", []) or []):
        cell = grid.nearest_walkable(s.get("coords", {}), reachable)
        if cell is None:
            result.warn(
                "SEAT_UNREACHABLE",
                f"좌석 '{s.get('seat_id')}'에 spawn에서 도달할 수 없습니다.",
                f"seats[{i}]",
            )

    # 방 문 개구부 도달성
    for i, r in enumerate(layout.get("rooms", []) or []):
        for j, d in enumerate(r.get("doors", []) or []):
            pt = _door_center_point(r.get("coords", {}), d)
            cell = grid.nearest_walkable(pt, reachable)
            if cell is None:
                result.warn(
                    "DOOR_UNREACHABLE",
                    f"방 '{r.get('room_id')}' 문 '{d.get('door_id')}' 개구부에 도달할 수 없습니다.",
                    f"rooms[{i}].doors[{j}]",
                )


# ---------------------------------------------------------------------------
# (d) 성능 파생 계산 (서버 파생·읽기전용 — D12/§1.2.13)
# ---------------------------------------------------------------------------

def _compute_derived_performance(
    layout: dict[str, Any], ctx: ValidationContext, result: ValidationResult
) -> None:
    """
    asset 테이블에서 폴리곤/드로우콜을 파생 계산(MultiMesh 그룹 규칙 반영).
    편집기가 보낸 performance는 무시하고 이 값으로 덮어쓴다.
    상한 초과 시 심각도별 이슈 추가.
    """
    furniture = layout.get("furniture", []) or []
    colliders = layout.get("colliders", []) or []

    # asset_id 그룹핑 (동일 asset_id = MultiMesh 1드로우콜)
    groups: dict[str, int] = {}
    for f in furniture:
        aid = f.get("asset_id")
        groups[aid] = groups.get(aid, 0) + 1

    # 폴리곤 = 인스턴스별 asset polygon_count 합산
    total_polygons = 0
    total_memory = 0.0
    for aid, count in groups.items():
        total_polygons += ctx.asset_polygons.get(aid, 0) * count
        total_memory += ctx.asset_memory_mb.get(aid, 0.0) * count

    # 드로우콜 = 서로 다른 asset_id 수(각 MultiMesh 1콜) + 개별 콜리전
    distinct_assets = len(groups)
    draw_calls = distinct_assets + len(colliders)

    derived = {
        "total_furniture_count": len(furniture),
        "total_colliders": len(colliders),
        "total_assets": distinct_assets,
        "estimated_polygon_count": total_polygons,
        "estimated_draw_calls": draw_calls,
        "estimated_memory_mb": round(total_memory, 1),
        "recommended_device_tier": _device_tier(total_polygons),
        "optimization_notes": "동일 asset_id 가구는 MultiMesh 1드로우콜로 계상됨(서버 파생값).",
    }
    result.derived_performance = derived

    # 예산 판정(§3.4)
    if draw_calls > ctx.draw_call_budget:
        result.error(
            "DRAW_CALL_BUDGET",
            f"드로우콜 {draw_calls}이 예산({ctx.draw_call_budget})을 초과합니다.",
            "performance.estimated_draw_calls",
        )
    if total_polygons > ctx.polygon_budget:
        result.warn(
            "POLYGON_BUDGET",
            f"폴리곤 {total_polygons}이 예산({ctx.polygon_budget})을 초과합니다.",
            "performance.estimated_polygon_count",
        )
    if total_memory > ctx.memory_budget_mb:
        result.warn(
            "MEMORY_BUDGET",
            f"예상 메모리 {round(total_memory, 1)}MB가 기준 VRAM({ctx.memory_budget_mb}MB)을 초과합니다.",
            "performance.estimated_memory_mb",
        )


def _device_tier(polygons: int) -> str:
    if polygons < 200_000:
        return "low"
    if polygons < 700_000:
        return "mid"
    return "high"


# ---------------------------------------------------------------------------
# 기하 헬퍼
# ---------------------------------------------------------------------------

Rect = tuple[float, float, float, float]  # (x, y, w, h) top_left AABB


def _aabb_overlap(a: Rect, b: Rect) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by


def _furniture_aabb(f: dict[str, Any]) -> Rect:
    c = f.get("coords", {})
    d = f.get("dimension", {})
    w = d.get("width", 0.0)
    h = d.get("depth", 0.0)  # 평면 y축은 깊이(depth)에 매핑
    # coords는 중심 좌표로 간주 → 좌상단 변환
    return (c.get("x", 0) - w / 2, c.get("y", 0) - h / 2, w, h)


def _collider_aabbs(layout: dict[str, Any]) -> list[Rect]:
    rects: list[Rect] = []
    for c in layout.get("colliders", []) or []:
        if not (c.get("physics", {}) or {}).get("block_avatar", True):
            continue
        if c.get("shape") == "box":
            b = c.get("box", {})
            rects.append((b.get("x", 0), b.get("y", 0), b.get("width", 0), b.get("height", 0)))
        elif c.get("shape") == "polygon":
            pts = c.get("polygon", []) or []
            if pts:
                xs = [p.get("x", 0) for p in pts]
                ys = [p.get("y", 0) for p in pts]
                rects.append((min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)))
    return rects


def _point_in_room(coords: dict[str, Any], room_coords: dict[str, Any]) -> bool:
    x, y = coords.get("x", 0), coords.get("y", 0)
    rx, ry = room_coords.get("x", 0), room_coords.get("y", 0)
    rw, rh = room_coords.get("width", 0), room_coords.get("height", 0)
    return rx <= x <= rx + rw and ry <= y <= ry + rh


def _wall_length(room_coords: dict[str, Any], wall: Optional[str]) -> float:
    """벽 길이: north/south는 width, east/west는 height."""
    if wall in ("north", "south"):
        return room_coords.get("width", 0.0)
    if wall in ("east", "west"):
        return room_coords.get("height", 0.0)
    return 0.0


def _door_center_point(room_coords: dict[str, Any], door: dict[str, Any]) -> dict[str, float]:
    """문 개구부 중심의 2D 좌표를 room coords + (wall, offset)로 계산."""
    rx, ry = room_coords.get("x", 0), room_coords.get("y", 0)
    rw, rh = room_coords.get("width", 0), room_coords.get("height", 0)
    wall, off = door.get("wall"), door.get("offset", 0)
    if wall == "north":
        return {"x": rx + off, "y": ry}
    if wall == "south":
        return {"x": rx + off, "y": ry + rh}
    if wall == "west":
        return {"x": rx, "y": ry + off}
    if wall == "east":
        return {"x": rx + rw, "y": ry + off}
    return {"x": rx, "y": ry}


def _entrance_near_any_door(
    entrance: dict[str, Any], doors: list[dict[str, Any]], room_coords: dict[str, Any]
) -> bool:
    """입장 트리거 박스가 어느 문 개구부 중심과 근접(같은 벽·1.5m 이내)한지."""
    tx = entrance.get("trigger_x", 0) + entrance.get("trigger_width", 0) / 2
    ty = entrance.get("trigger_y", 0) + entrance.get("trigger_height", 0) / 2
    for d in doors:
        dp = _door_center_point(room_coords, d)
        if math.hypot(dp["x"] - tx, dp["y"] - ty) <= 1.5:
            return True
    return False


# ---------------------------------------------------------------------------
# 도달성 grid (콜리전 맵)
# ---------------------------------------------------------------------------

class _CollisionGrid:
    """dimensions 기반 2D 점유 grid. blocked=벽/콜리전, walkable=통행 가능."""

    def __init__(self, min_x: float, min_y: float, cols: int, rows: int, cell: float):
        self.min_x = min_x
        self.min_y = min_y
        self.cols = cols
        self.rows = rows
        self.cell = cell
        # blocked[r][c] True = 통행 불가
        self.blocked = [[False] * cols for _ in range(rows)]

    @classmethod
    def from_layout(cls, layout: dict[str, Any], cell: float) -> Optional["_CollisionGrid"]:
        dim = layout.get("dimensions", {})
        w = dim.get("width_m") or (dim.get("max_x", 0) - dim.get("min_x", 0))
        h = dim.get("height_m") or (dim.get("max_y", 0) - dim.get("min_y", 0))
        if w <= 0 or h <= 0:
            return None
        cols = max(1, int(math.ceil(w / cell)))
        rows = max(1, int(math.ceil(h / cell)))
        grid = cls(dim.get("min_x", 0.0), dim.get("min_y", 0.0), cols, rows, cell)
        grid._mark_colliders(layout)
        grid._mark_room_walls(layout)
        return grid

    def coord_to_cell(self, coords: dict[str, Any]) -> Optional[tuple[int, int]]:
        if "x" not in coords or "y" not in coords:
            return None
        c = int((coords["x"] - self.min_x) / self.cell)
        r = int((coords["y"] - self.min_y) / self.cell)
        if 0 <= r < self.rows and 0 <= c < self.cols:
            return (r, c)
        return None

    def walkable(self, r: int, c: int) -> bool:
        return 0 <= r < self.rows and 0 <= c < self.cols and not self.blocked[r][c]

    def _mark_colliders(self, layout: dict[str, Any]) -> None:
        for rect in _collider_aabbs(layout):
            self._block_rect(*rect)

    def _mark_room_walls(self, layout: dict[str, Any]) -> None:
        """room 경계 4변을 blocked 처리하되 doors[] 개구부 구간은 통행 가능(D9)."""
        for room in layout.get("rooms", []) or []:
            c = room.get("coords", {})
            rx, ry = c.get("x", 0), c.get("y", 0)
            rw, rh = c.get("width", 0), c.get("height", 0)
            doors = room.get("doors", []) or []
            # 4변을 얇은 사각형으로 블록 후 개구부 구간 해제
            walls = {
                "north": (rx, ry, rw, self.cell),
                "south": (rx, ry + rh - self.cell, rw, self.cell),
                "west": (rx, ry, self.cell, rh),
                "east": (rx + rw - self.cell, ry, self.cell, rh),
            }
            for wall, rect in walls.items():
                self._block_rect(*rect)
            for d in doors:
                self._open_door(c, d)

    def _open_door(self, room_coords: dict[str, Any], door: dict[str, Any]) -> None:
        """문 개구부 구간(offset±width/2)을 walkable로 해제."""
        center = _door_center_point(room_coords, door)
        half = door.get("width", 0) / 2.0
        wall = door.get("wall")
        if wall in ("north", "south"):
            self._open_rect(center["x"] - half, center["y"] - self.cell, 2 * half, 2 * self.cell)
        else:  # east/west
            self._open_rect(center["x"] - self.cell, center["y"] - half, 2 * self.cell, 2 * half)

    def _block_rect(self, x: float, y: float, w: float, h: float) -> None:
        self._set_rect(x, y, w, h, True)

    def _open_rect(self, x: float, y: float, w: float, h: float) -> None:
        self._set_rect(x, y, w, h, False)

    def _set_rect(self, x: float, y: float, w: float, h: float, value: bool) -> None:
        c0 = max(0, int((x - self.min_x) / self.cell))
        c1 = min(self.cols - 1, int((x + w - self.min_x) / self.cell))
        r0 = max(0, int((y - self.min_y) / self.cell))
        r1 = min(self.rows - 1, int((y + h - self.min_y) / self.cell))
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                self.blocked[r][c] = value

    def bfs(self, sources: list[tuple[int, int]]) -> set[tuple[int, int]]:
        """4-방향 BFS로 도달 가능한 셀 집합 반환."""
        from collections import deque
        seen: set[tuple[int, int]] = set(s for s in sources if self.walkable(*s))
        q = deque(seen)
        while q:
            r, c = q.popleft()
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = r + dr, c + dc
                if (nr, nc) not in seen and self.walkable(nr, nc):
                    seen.add((nr, nc))
                    q.append((nr, nc))
        return seen

    def nearest_walkable(
        self, coords: dict[str, Any], reachable: set[tuple[int, int]]
    ) -> Optional[tuple[int, int]]:
        """
        목표 좌표 셀 또는 인접 8셀 중 reachable에 포함된 셀 반환(없으면 None).
        좌석/문 중심이 벽 셀 위에 놓일 수 있어 이웃까지 허용한다.
        """
        target = self.coord_to_cell(coords)
        if target is None:
            return None
        tr, tc = target
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if (tr + dr, tc + dc) in reachable:
                    return (tr + dr, tc + dc)
        return None


# ---------------------------------------------------------------------------
# DB 컨텍스트 빌더 (async 스켈레톤)
# ---------------------------------------------------------------------------

async def build_context_from_db(session: Any, layout: dict[str, Any]) -> ValidationContext:
    """
    검증에 필요한 DB 파생 데이터를 조회해 ValidationContext를 구성한다(D3 — FastAPI 경유).

    조회 대상:
      - asset 테이블: layout에서 사용된 asset_id의 polygon_count/메모리(존재 확인 + 파생 계산)
      - ERP teams(미러): zones의 erp_team_id 유효성

    Asset.asset_id는 07 §5.3 v1.1 정본에 따라 VARCHAR(64) 카탈로그 키
    (예: "reception-desk-v1.0")이므로 05 layout의 asset_id와 직접 조인한다.
    """
    from sqlalchemy import select
    from app.models.tables import Asset, ErpUser  # 지연 임포트(순환 방지)

    used_asset_ids = {
        f.get("asset_id") for f in (layout.get("furniture", []) or []) if f.get("asset_id")
    }
    used_team_ids = {
        z.get("erp_team_id") for z in (layout.get("zones", []) or []) if z.get("erp_team_id")
    }

    ctx = ValidationContext()

    # --- asset 조회 (asset_id = 카탈로그 키, 07 §5.3 v1.1) --------------------
    if used_asset_ids:
        rows = (
            await session.execute(select(Asset).where(Asset.asset_id.in_(used_asset_ids)))
        ).scalars().all()
        for a in rows:
            ctx.asset_polygons[a.asset_id] = a.polygon_count or 0
            ctx.asset_memory_mb[a.asset_id] = (a.file_size_bytes or 0) / (1024 * 1024)

    # --- ERP teams 유효성 ----------------------------------------------------
    if used_team_ids:
        rows = (
            await session.execute(
                select(ErpUser.erp_team_id).where(ErpUser.erp_team_id.in_(used_team_ids))
            )
        ).scalars().all()
        ctx.valid_erp_team_ids = set(rows)

    return ctx
