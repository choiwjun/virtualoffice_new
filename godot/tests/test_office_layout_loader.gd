extends GutTest

## OfficeLayoutLoader 테스트 — office_layout(05 스키마/D25) → 3D 씬 + 파생 데이터.
##
## 참조:
## - docs/data-model/office-layout-schema.json (정본)
## - 00-decisions.md: D9(방 벽+doors 개구부), D10(좌석), D12(클라 신뢰), D25(좌표계), D3(A*)
##
## 실행: godot --headless --path godot -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit
##
## 좌표 매핑: layout 2D (x,y) → Godot (x, floor_height, z=y).

const FIXTURE := "res://tests/fixtures/office_layout.json"


func _load_fixture() -> Dictionary:
	var layout := OfficeLayoutLoader.load_file(FIXTURE)
	assert_false(layout.is_empty(), "픽스처 로드: %s" % FIXTURE)
	return layout


# ============================================================================
# 순수 파생 로직 (트리 불필요, static)
# ============================================================================

class TestDerivation:
	extends GutTest

	const FIXTURE := "res://tests/fixtures/office_layout.json"

	var layout: Dictionary

	func before_each() -> void:
		layout = OfficeLayoutLoader.load_file(FIXTURE)
		assert_false(layout.is_empty(), "픽스처 로드")

	# 방 벽은 4변 → 문(south 1개)으로 south 벽이 2조각 → 총 5 세그먼트.
	func test_wall_segments_split_by_door() -> void:
		var room: Dictionary = layout["rooms"][0]
		var segs := OfficeLayoutLoader.wall_segments(room)
		assert_eq(segs.size(), 5, "north1 + south2(문 분할) + west1 + east1")

	# 개구부 없는 벽(문 0개)은 4변 그대로 4 세그먼트.
	func test_wall_segments_no_door() -> void:
		var room := {
			"coords": { "x": 0.0, "y": 0.0, "width": 4.0, "height": 4.0 },
			"doors": [],
		}
		assert_eq(OfficeLayoutLoader.wall_segments(room).size(), 4, "문 없음 → 4변")

	# 좌석 파생: 좌표 매핑(y→z), facing, assigned=false(D10 배정은 DB 소유).
	func test_derive_seats() -> void:
		var seats := OfficeLayoutLoader.derive_seats(layout)
		assert_eq(seats.size(), 2, "좌석 2개")
		var s0: Dictionary = seats[0]
		assert_eq(s0["id"], "S_001")
		assert_eq(s0["pos"], Vector3(2.0, 0.0, 2.0), "layout(2,2) → Godot(2,0,2)")
		assert_almost_eq(float(s0["facing"]), 180.0, 0.001, "facing 보존")
		assert_false(bool(s0["assigned"]), "layout에 배정 없음 → assigned=false(D10)")

	# 스폰 파생.
	func test_derive_spawns() -> void:
		var spawns := OfficeLayoutLoader.derive_spawns(layout)
		assert_eq(spawns.size(), 1, "스폰 1개")
		assert_eq(spawns[0]["id"], "SP_1")
		assert_eq(spawns[0]["pos"], Vector3(1.0, 0.0, 1.0))

	# 기둥 콜라이더(10,15 크기 1x1)는 중심 격자 규칙상 (10,15)(10,16)(11,15)(11,16) 차단.
	func test_pillar_obstacle_cells() -> void:
		var cells := OfficeLayoutLoader.derive_obstacle_cells(layout)
		for c in [Vector2i(10, 15), Vector2i(10, 16), Vector2i(11, 15), Vector2i(11, 16)]:
			assert_true(cells.has(c), "기둥 셀 차단: %s" % c)

	# D9: south 벽(y=11)은 차단되나, 문 개구부(offset4 → 중심 x=9) 셀은 통행 가능.
	func test_door_opening_walkable_wall_blocked() -> void:
		var cells := OfficeLayoutLoader.derive_obstacle_cells(layout)
		assert_true(cells.has(Vector2i(6, 11)), "문 밖 south 벽 셀은 차단")
		assert_true(cells.has(Vector2i(11, 11)), "문 밖 south 벽 셀은 차단")
		assert_false(cells.has(Vector2i(9, 11)), "문 개구부 셀은 통행 가능(D9)")

	# 충돌 가구(F_001 desk @2,2)도 obstacle_cells에 포함.
	func test_furniture_is_obstacle() -> void:
		var cells := OfficeLayoutLoader.derive_obstacle_cells(layout)
		assert_true(cells.has(Vector2i(2, 2)), "충돌 가구 셀 차단")

	# collision:false 가구는 차단하지 않음.
	func test_non_colliding_furniture_skipped() -> void:
		var l := {
			"furniture": [{
				"furniture_id": "F_X", "asset_id": "a", "type": "plant",
				"coords": { "x": 3.0, "y": 3.0 },
				"dimension": { "width": 1.0, "depth": 1.0 },
				"collision": false,
			}],
		}
		assert_eq(OfficeLayoutLoader.derive_obstacle_cells(l).size(), 0, "collision:false → 비차단")

	# block_avatar:false 콜라이더는 차단하지 않음.
	func test_non_blocking_collider_skipped() -> void:
		var l := {
			"colliders": [{
				"collider_id": "C_X", "shape": "box",
				"box": { "x": 5.0, "y": 5.0, "width": 2.0, "height": 2.0 },
				"physics": { "block_avatar": false },
			}],
		}
		assert_eq(OfficeLayoutLoader.collider_rects(l).size(), 0, "block_avatar:false → 제외")

	# polygon 콜라이더는 AABB로 근사.
	func test_polygon_collider_aabb() -> void:
		var l := {
			"colliders": [{
				"collider_id": "C_P", "shape": "polygon",
				"polygon": [
					{ "x": 2.0, "y": 2.0 }, { "x": 5.0, "y": 2.0 }, { "x": 5.0, "y": 4.0 },
				],
			}],
		}
		var rects := OfficeLayoutLoader.collider_rects(l)
		assert_eq(rects.size(), 1, "polygon → AABB 1개")
		assert_eq(rects[0], Rect2(2.0, 2.0, 3.0, 2.0), "AABB(2,2,3,2)")

	# 잘못된 JSON/누락은 빈 Dictionary(D12 신뢰 전제라 예외 대신 방어).
	func test_parse_bad_json_returns_empty() -> void:
		assert_true(OfficeLayoutLoader.parse_json("not-json").is_empty())
		assert_true(OfficeLayoutLoader.load_file("res://tests/fixtures/__nope__.json").is_empty())


# ============================================================================
# 3D 씬 빌드 (트리 필요)
# ============================================================================

class TestSceneBuild:
	extends GutTest

	const FIXTURE := "res://tests/fixtures/office_layout.json"

	var loader: OfficeLayoutLoader

	func before_each() -> void:
		var layout := OfficeLayoutLoader.load_file(FIXTURE)
		loader = OfficeLayoutLoader.new()
		loader.build(layout)
		add_child_autofree(loader)

	func test_floor_node_built() -> void:
		var floor_node := loader.get_node_or_null("Floor")
		assert_not_null(floor_node, "Floor 노드 생성")
		assert_true(floor_node is StaticBody3D, "Floor는 StaticBody3D")

	func test_room_walls_built() -> void:
		var count := 0
		for child in loader.get_children():
			if String(child.name).begins_with("Wall_R_001_"):
				count += 1
		assert_eq(count, 5, "R_001 벽 세그먼트 5개 노드")

	func test_collider_node_built() -> void:
		assert_not_null(loader.get_node_or_null("Collider_0"), "기둥 콜라이더 노드")

	func test_furniture_nodes_built() -> void:
		assert_not_null(loader.get_node_or_null("Furniture_F_001"), "가구 F_001 노드")
		assert_not_null(loader.get_node_or_null("Furniture_F_002"), "가구 F_002 노드")

	func test_seat_and_spawn_markers_built() -> void:
		assert_not_null(loader.get_node_or_null("Seat_S_001"), "좌석 마커")
		assert_not_null(loader.get_node_or_null("Spawn_SP_1"), "스폰 마커")

	func test_derived_arrays_populated() -> void:
		assert_eq(loader.seats.size(), 2, "seats 파생")
		assert_eq(loader.spawn_points_out.size(), 1, "spawn 파생")
		assert_eq(loader.rooms_out.size(), 1, "rooms 파생")
		assert_gt(loader.obstacle_cells.size(), 0, "obstacle_cells 파생")

	func test_floor_height_offset() -> void:
		var l := {
			"floor": { "floor_height_m": 6.0 },
			"dimensions": { "width_m": 10.0, "height_m": 10.0, "min_x": 0.0, "min_y": 0.0 },
		}
		var ldr := OfficeLayoutLoader.new()
		ldr.build(l)
		add_child_autofree(ldr)
		# 바닥 슬래브는 floor_height 바로 아래(두께/2)
		assert_almost_eq(ldr.get_node("Floor").position.y, 6.0 - 0.1, 0.001, "층 Y 오프셋 반영")


# ============================================================================
# 아바타 통합 (로더 파생 → 아바타 소비)
# ============================================================================

class TestAvatarIntegration:
	extends GutTest

	const FIXTURE := "res://tests/fixtures/office_layout.json"

	var loader: OfficeLayoutLoader
	var avatar: Avatar

	func before_each() -> void:
		var layout := OfficeLayoutLoader.load_file(FIXTURE)
		loader = OfficeLayoutLoader.new()
		loader.build(layout)
		add_child_autofree(loader)
		avatar = Avatar.new()
		add_child_autofree(avatar)
		await get_tree().physics_frame

	# 로더 obstacle_cells를 아바타 A*에 주입 → 기둥을 우회.
	func test_avatar_routes_around_layout_pillar() -> void:
		avatar.obstacle_cells = loader.obstacle_cells
		avatar.position = Vector3(9, 0, 15)
		var path: Array = avatar.calculate_path(Vector3(13, 0, 15))
		assert_gt(path.size(), 0, "기둥 우회 경로 산출")
		for wp in path:
			var cell := Vector2i(int(round(wp.x)), int(round(wp.z)))
			assert_false(loader.obstacle_cells.has(cell), "웨이포인트가 차단 셀을 밟지 않음: %s" % cell)

	# 로더 seats를 아바타에 주입 → 좌석 감지(D10). 배정 정보 없어 미배정 경고.
	func test_avatar_detects_layout_seat() -> void:
		avatar.seats = loader.seats
		watch_signals(avatar)
		avatar.position = Vector3(2, 0, 2)  # S_001 좌표
		avatar.update_seat()
		assert_eq(avatar.current_seat_id, "S_001", "좌석 S_001 감지")
		assert_signal_emitted(avatar, "seat_warning")

	# 좌석 범위 밖이면 감지 없음.
	func test_avatar_no_seat_out_of_range() -> void:
		avatar.seats = loader.seats
		avatar.position = Vector3(9, 0, 9)  # 어느 좌석과도 1.5m 밖
		avatar.update_seat()
		assert_eq(avatar.current_seat_id, "", "범위 밖 → 미감지")
