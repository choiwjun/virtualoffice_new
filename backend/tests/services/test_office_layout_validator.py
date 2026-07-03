"""
office_layout_validator 회귀 테스트 (@TEST 정본 경로).

포커스: _CollisionGrid.coord_to_cell 가 float 속성 self.cell 에 섀도잉되던 버그
(spawn_points ≥ 1 → _validate_reachability 가 grid.cell(coords) 호출 시
TypeError('float' object is not callable)로 크래시) 수정 검증. 이 버그는 스폰포인트가
필수인 실제 운영 레이아웃의 배포 검증을 불가능하게 만들었다(G004).
"""

from app.services.office_layout_validator import (
    ValidationResult,
    _CollisionGrid,
    _validate_reachability,
    validate_office_layout,
)

_OPEN_FLOOR = {
    "dimensions": {"min_x": 0.0, "min_y": 0.0, "width_m": 5.0, "height_m": 5.0},
    "spawn_points": [{"coords": {"x": 1.0, "y": 1.0}}],
    "seats": [{"coords": {"x": 2.0, "y": 2.0}}],
    "rooms": [],
}


def test_collision_grid_cell_size_and_coord_to_cell_coexist():
    """float 셀 크기(self.cell)와 좌표→셀 변환 메서드(coord_to_cell)가 공존해야 한다."""
    grid = _CollisionGrid.from_layout(_OPEN_FLOOR, 0.25)
    assert grid is not None
    assert grid.cell == 0.25  # 속성은 float 크기
    rc = grid.coord_to_cell({"x": 1.0, "y": 1.0})  # 메서드 호출 (섀도잉 시 TypeError)
    assert rc is not None and isinstance(rc, tuple)


def test_reachability_with_spawn_points_does_not_crash():
    """스폰포인트가 있는 레이아웃의 도달성 검증이 예외 없이 실행돼야 한다(버그 재현 경로)."""
    result = ValidationResult()
    _validate_reachability(_OPEN_FLOOR, result)  # 수정 전: TypeError
    codes = {i.code for i in result.issues}
    # 개방 평면 → 스폰에서 좌석 도달 가능: 미도달/스폰없음 이슈 없음
    assert "SEAT_UNREACHABLE" not in codes
    assert "REACH_NO_SPAWN" not in codes


def test_validate_office_layout_returns_result_for_spawned_layout():
    """전체 파이프라인도 스폰 레이아웃에서 크래시 없이 ValidationResult를 반환한다."""
    result = validate_office_layout(_OPEN_FLOOR)
    assert isinstance(result, ValidationResult)
