extends GutTest

## 아바타 이동/충돌/좌석/근접 테스트 (Phase 1 실구현 검증)
##
## 참조:
## - 00-decisions.md: D2(GDScript), D3(서버 권위), D9(개구부), D10(좌석), D22(성능), D25(좌표)
## - 09-realtime-collaboration.md: 아바타 동기화/충돌/좌석/근접
## - 11-tech-stack.md: Godot 4.x, GUT
##
## 실행: godot --headless --path godot -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit
##
## 좌표계(D25): +X=동, +Z=남, y≈0 평면(단층 오피스). Vector3.FORWARD=-Z, RIGHT=+X.


# ============================================================================
# 테스트: 아바타 기본 이동
# ============================================================================

class TestAvatarMovement:
	extends GutTest

	var avatar: Avatar

	func _frames(n: int) -> void:
		for i in n:
			await get_tree().physics_frame

	func before_each() -> void:
		avatar = Avatar.new()
		add_child_autofree(avatar)
		avatar.position = Vector3(10, 0, 10)
		await get_tree().physics_frame

	# @TEST T3.1.1 - 아바타 앞쪽 이동 → z 감소
	func test_avatar_move_direction_forward() -> void:
		avatar.set_move_direction(Vector3.FORWARD)
		await _frames(10)
		avatar.set_move_direction(Vector3.ZERO)
		assert_lt(avatar.position.z, 10.0, "FORWARD(-Z) 이동 시 z 감소")

	# @TEST T3.1.2 - 아바타 우측 이동 → x 증가
	func test_avatar_move_direction_right() -> void:
		avatar.set_move_direction(Vector3.RIGHT)
		await _frames(10)
		avatar.set_move_direction(Vector3.ZERO)
		assert_gt(avatar.position.x, 10.0, "RIGHT(+X) 이동 시 x 증가")

	# @TEST T3.1.3 - 최대 속도 제한 (max_speed = 5.0)
	func test_avatar_max_speed() -> void:
		avatar.set_move_direction(Vector3.FORWARD * 10.0)  # 과도한 입력
		await _frames(3)
		# 속도 벡터 크기는 상한(5.0)으로 클램프되어야 한다.
		assert_almost_eq(avatar.velocity.length(), Avatar.MAX_SPEED, 0.001, "속도 상한 적용")
		avatar.set_move_direction(Vector3.ZERO)

	# @TEST T3.1.4 - 회전(facing 각도, 도/시계방향, D25)
	func test_avatar_rotate_facing() -> void:
		avatar.facing = 90.0  # 90도 시계방향 = 동
		avatar.update_rotation()
		assert_almost_eq(avatar.rotation.y, deg_to_rad(90.0), 0.01, "facing→회전 반영")

	# @TEST T3.1.5 - 이동 범위 경계 (0<=x,z<100, D25)
	func test_avatar_boundary_limits() -> void:
		# 하한: 코너에서 맵 밖으로 밀어도 0 미만 불가
		avatar.position = Vector3(0.2, 0, 0.2)
		avatar.set_move_direction(Vector3.FORWARD + Vector3.LEFT)  # -Z, -X
		await _frames(10)
		assert_true(avatar.position.x >= 0.0, "x 하한")
		assert_true(avatar.position.z >= 0.0, "z 하한")
		# 상한: 반대 코너
		avatar.position = Vector3(99.8, 0, 99.8)
		avatar.set_move_direction(Vector3.BACK + Vector3.RIGHT)  # +Z, +X
		await _frames(10)
		avatar.set_move_direction(Vector3.ZERO)
		assert_lt(avatar.position.x, 100.0, "x 상한")
		assert_lt(avatar.position.z, 100.0, "z 상한")


# ============================================================================
# 테스트: 아바타 충돌 감지
# ============================================================================

class TestAvatarCollision:
	extends GutTest

	var avatar: Avatar

	func _frames(n: int) -> void:
		for i in n:
			await get_tree().physics_frame

	func before_each() -> void:
		avatar = Avatar.new()
		add_child_autofree(avatar)
		avatar.position = Vector3(10, 0, 10)
		await get_tree().physics_frame

	# @TEST T3.2.1 - 벽 충돌 → 이동 중단 (D3)
	func test_avatar_wall_collision() -> void:
		# 아바타 좌측(−X)에 벽 우측면이 캡슐(반경 0.3)에 접하도록 배치
		OfficeBuilder.wall(self, Vector3(9.5, 0, 10), Vector3(0.4, 3, 4))  # 우측면 x=9.7
		await _frames(2)
		var initial: Vector3 = avatar.position
		avatar.set_move_direction(Vector3.LEFT)  # 벽 방향(−X)
		await _frames(15)
		avatar.set_move_direction(Vector3.ZERO)
		assert_lt(initial.distance_to(avatar.position), 0.2, "벽에 막혀 사실상 정지")

	# @TEST T3.2.2 - 가구 충돌 회피 (A* 경로, D3/D9)
	func test_avatar_furniture_avoidance() -> void:
		avatar.position = Vector3(10, 0, 10)
		# 직선 경로(z=10)를 막는 책상 셀
		avatar.obstacle_cells = [Vector2i(15, 10), Vector2i(15, 9), Vector2i(15, 11)]
		var path: Array = avatar.calculate_path(Vector3(20, 0, 10))
		assert_gt(path.size(), 0, "회피 경로 산출")
		assert_ne(path[0], Vector3(15, 0, 10), "차단 셀 직진 불가 → 우회")

	# @TEST T3.2.3 - 타 아바타 충돌 (서버 권위, 둘 다 진행 불가, D3)
	func test_avatar_other_collision_authority() -> void:
		var a1 := Avatar.new()
		var a2 := Avatar.new()
		add_child_autofree(a1)
		add_child_autofree(a2)
		a1.position = Vector3(10, 0, 10)
		a2.position = Vector3(11, 0, 10)  # 1m 간격(캡슐 지름 0.6 → 여유 0.4)
		await _frames(2)
		var p1: Vector3 = a1.position
		var p2: Vector3 = a2.position
		a1.set_move_direction(Vector3.RIGHT)  # +X
		a2.set_move_direction(Vector3.LEFT)   # −X (서로 마주봄)
		await _frames(20)
		a1.set_move_direction(Vector3.ZERO)
		a2.set_move_direction(Vector3.ZERO)
		var total := p1.distance_to(a1.position) + p2.distance_to(a2.position)
		assert_lt(total, 2.0, "상호 충돌로 둘 다 자유 진행 불가")

	# @TEST T3.2.4 - 평면 이동 시 바닥 유지 (단층 오피스, D22)
	func test_avatar_slope_movement() -> void:
		avatar.set_move_direction(Vector3.FORWARD)
		await _frames(10)
		avatar.set_move_direction(Vector3.ZERO)
		assert_true(avatar.position.y >= -0.1, "y는 바닥(0) 근처 유지")
		assert_true(avatar.position.y <= 0.1, "평면 이동 — 높이 이탈 없음")

	# @TEST T3.2.5 - 좁은 통로(1.5m) 통과
	func test_avatar_narrow_passage() -> void:
		# z=10을 중심으로 1.5m 간격의 두 벽 → +X 방향 통로
		OfficeBuilder.wall(self, Vector3(11, 0, 11.5), Vector3(6, 3, 2))  # 통로 위쪽 벽
		OfficeBuilder.wall(self, Vector3(11, 0, 8.5), Vector3(6, 3, 2))   # 통로 아래쪽 벽 (간격 1.5)
		await _frames(2)
		var start_x: float = avatar.position.x
		avatar.set_move_direction(Vector3.RIGHT)
		await _frames(20)
		avatar.set_move_direction(Vector3.ZERO)
		assert_gt(avatar.position.x, start_x + 0.5, "좁은 통로 통과 진행")

	# @TEST T3.2.6 - 문 개구부 통과 (D9)
	func test_avatar_door_opening() -> void:
		# x=12에 z축 벽, z=10 부근 1.5m 개구부(문)
		OfficeBuilder.wall(self, Vector3(12, 0, 12.75), Vector3(0.4, 3, 4.0))  # 문 위 벽
		OfficeBuilder.wall(self, Vector3(12, 0, 7.25), Vector3(0.4, 3, 4.0))   # 문 아래 벽 (개구부 z 9.25~10.75)
		await _frames(2)
		avatar.position = Vector3(10, 0, 10)  # 문 앞
		avatar.set_move_direction(Vector3.RIGHT)  # 문 통과(+X)
		await _frames(40)
		avatar.set_move_direction(Vector3.ZERO)
		assert_gt(avatar.position.x, 12.5, "개구부 통과로 벽 너머 진입")


# ============================================================================
# 테스트: 좌석 점유 관리 (D10)
# ============================================================================

class TestSeatOccupancy:
	extends GutTest

	var avatar: Avatar

	func before_each() -> void:
		avatar = Avatar.new()
		add_child_autofree(avatar)
		await get_tree().physics_frame

	# @TEST T3.3.1 - 좌석 범위(1.5m) 진입 → seat_id 설정
	func test_avatar_enter_seat_range() -> void:
		avatar.seats = [{ "id": "1F-A01", "pos": Vector3(10, 0, 10), "assigned": true }]
		avatar.position = Vector3(11.4, 0, 10)  # 1.4m
		avatar.update_seat()
		assert_eq(avatar.current_seat_id, "1F-A01", "범위 내 좌석 감지")

	# @TEST T3.3.2 - 좌석 범위 퇴출(>1.5m) → 해제
	func test_avatar_exit_seat_range() -> void:
		avatar.seats = [{ "id": "1F-A01", "pos": Vector3(10, 0, 10), "assigned": true }]
		avatar.current_seat_id = "1F-A01"
		avatar.position = Vector3(11.6, 0, 10)  # 1.6m
		avatar.update_seat()
		assert_eq(avatar.current_seat_id, "", "범위 이탈 시 좌석 해제")

	# @TEST T3.3.3 - 겹치는 범위에서 가장 가까운 좌석 선택
	func test_avatar_multiple_seat_prevent() -> void:
		avatar.seats = [
			{ "id": "1F-A01", "pos": Vector3(10, 0, 10), "assigned": true },
			{ "id": "1F-A02", "pos": Vector3(11.5, 0, 10), "assigned": true },
		]
		avatar.position = Vector3(10.3, 0, 10)  # A01 0.3m, A02 1.2m (둘 다 범위 내)
		avatar.update_seat()
		assert_eq(avatar.current_seat_id, "1F-A01", "가장 가까운 좌석만 점유")

	# @TEST T3.3.4 - 미배정 좌석 진입 시 경고
	func test_avatar_seat_assignment_error() -> void:
		avatar.seats = [{ "id": "1F-A99", "pos": Vector3(50, 0, 50), "assigned": false }]
		avatar.position = Vector3(50.5, 0, 50)  # 범위 내
		var warned := [false]
		avatar.seat_warning.connect(func(_m): warned[0] = true)
		avatar.update_seat()
		assert_true(warned[0], "미배정 좌석 경고 방출")


# ============================================================================
# 테스트: 근접 상호작용 (Proximity)
# ============================================================================

class TestProximityInteraction:
	extends GutTest

	var avatar: Avatar
	var other: Avatar

	func before_each() -> void:
		avatar = Avatar.new()
		other = Avatar.new()
		add_child_autofree(avatar)
		add_child_autofree(other)
		avatar.position = Vector3(10, 0, 10)
		other.position = Vector3(10, 0, 10)
		avatar.others = [other]
		await get_tree().physics_frame

	# @TEST T3.4.1 - 근접(<=2m) 메뉴 표시
	func test_proximity_menu_display() -> void:
		var shown := [false]
		avatar.proximity_menu_show.connect(func(): shown[0] = true)
		other.position = Vector3(11.5, 0, 10)  # 1.5m
		avatar.update_proximity()
		assert_true(shown[0], "근접 메뉴 표시 신호")

	# @TEST T3.4.2 - 범위(2m) 벗어남 → 메뉴 숨김
	func test_proximity_menu_hide() -> void:
		var hidden := [false]
		avatar.proximity_menu_hide.connect(func(): hidden[0] = true)
		other.position = Vector3(11.5, 0, 10)  # 먼저 근접 → active
		avatar.update_proximity()
		other.position = Vector3(12.1, 0, 10)  # 2.1m → 이탈
		avatar.update_proximity()
		assert_true(hidden[0], "범위 이탈 시 메뉴 숨김 신호")

	# @TEST T3.4.3 - 거리 계층별 상호작용 유형 (D9)
	func test_proximity_distance_tiers() -> void:
		var cases := {
			0.5: "direct_talk",
			1.5: "menu",
			3.0: "chat",
			6.0: "none",
		}
		for dist in cases:
			other.position = avatar.position + Vector3(dist, 0, 0)
			assert_eq(avatar.get_proximity_interaction_type(), cases[dist],
				"거리 %.1fm → %s" % [dist, cases[dist]])


# ============================================================================
# 성능 테스트 (D22) — 렌더링 FPS는 창모드 GPU 필요 → Phase 2.
# 헤드리스 물리 처리량 스파이크는 B-04(별도 하네스)에서 측정.
# ============================================================================

class TestAvatarPerformance:
	extends GutTest

	# @TEST T3.5 - FPS 측정 (D22: GTX1650 60fps / 내장 30fps)
	func test_performance_fps() -> void:
		pending("렌더 FPS는 창모드 GPU 40아바타 프로파일 필요 — Phase 2. 헤드리스 물리 처리량은 B-04 하네스 참조.")

	# @TEST T3.6 - 로딩 시간 (<5초, D22)
	func test_performance_loading_time() -> void:
		pending("번들/로딩 시간은 최적화된 export 빌드 대상 — Phase 2.")
