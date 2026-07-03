extends GutTest

## OfficeClient 테스트 — 오케스트레이터: layout 로드 → 씬 구성 → 아바타 스폰 →
## nav/좌석 주입 + 백엔드 /layouts/current 응답 파싱 배선.
##
## 참조:
## - scenes/office_client.gd, scenes/office_layout_loader.gd, scenes/avatar.gd
## - backend/app/api/layouts.py: GET /layouts/current → { ..., "layout_json": {...} }
##
## 실행: godot --headless --path godot -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit

const FIXTURE := "res://tests/fixtures/office_layout.json"
const SAMPLE := "res://scenes/sample_office_layout.json"


# ============================================================================
# 로드 + 스폰 + 주입
# ============================================================================

class TestLoadOffice:
	extends GutTest

	const FIXTURE := "res://tests/fixtures/office_layout.json"

	var client: OfficeClient

	func before_each() -> void:
		client = OfficeClient.new()
		add_child_autofree(client)
		await get_tree().physics_frame

	func test_load_office_spawns_avatar_at_spawn() -> void:
		watch_signals(client)
		client.load_office_from_file(FIXTURE)
		assert_not_null(client.loader, "로더 생성")
		assert_not_null(client.avatar, "아바타 생성")
		assert_signal_emitted(client, "office_loaded")
		# 픽스처는 SP_1(1,1,facing90) 단일 스폰(spawn_default 없음) → 첫 스폰.
		assert_eq(client.avatar.position, Vector3(1.0, 0.0, 1.0), "스폰 좌표에 배치")
		assert_almost_eq(client.avatar.facing, 90.0, 0.001, "스폰 facing 적용")

	func test_nav_and_seats_injected() -> void:
		client.load_office_from_file(FIXTURE)
		assert_eq(client.avatar.seats.size(), client.loader.seats.size(), "좌석 주입")
		assert_eq(
			client.avatar.obstacle_cells.size(), client.loader.obstacle_cells.size(),
			"obstacle_cells 주입",
		)
		assert_gt(client.avatar.obstacle_cells.size(), 0, "nav 셀 존재")

	func test_empty_layout_fails_gracefully() -> void:
		watch_signals(client)
		client.load_office({})
		assert_signal_emitted(client, "office_load_failed")
		assert_null(client.avatar, "실패 시 아바타 없음")

	func test_reload_replaces_previous() -> void:
		client.load_office_from_file(FIXTURE)
		var first_avatar := client.avatar
		client.load_office_from_file(FIXTURE)
		assert_ne(client.avatar, first_avatar, "재로드 시 아바타 교체")
		# 아바타 노드는 정확히 1개(이전 것은 queue_free)
		var avatars := 0
		for c in client.get_children():
			if c is Avatar:
				avatars += 1
		assert_lte(avatars, 1, "이전 아바타 정리(≤1)")

	# 번들 샘플: spawn_default=SP_LOBBY → 로비 스폰 선택.
	func test_sample_uses_spawn_default() -> void:
		client.load_office_from_file(SAMPLE)
		assert_not_null(client.avatar, "샘플 로드")
		assert_eq(client.avatar.position, Vector3(15.0, 0.0, 18.0), "spawn_default=SP_LOBBY(15,18)")


# ============================================================================
# 스폰 선택 로직 (static)
# ============================================================================

class TestSpawnSelection:
	extends GutTest

	func _sp(id: String, x: float, z: float) -> Dictionary:
		return { "id": id, "pos": Vector3(x, 0.0, z), "facing": 0.0 }

	func test_pick_spawn_matches_default() -> void:
		var spawns := [_sp("A", 1, 1), _sp("B", 2, 2)]
		var got := OfficeClient.pick_spawn(spawns, { "spawn_id": "B" })
		assert_eq(got["id"], "B", "spawn_default 매칭 스폰 선택")

	func test_pick_spawn_first_when_no_default() -> void:
		var spawns := [_sp("A", 1, 1), _sp("B", 2, 2)]
		assert_eq(OfficeClient.pick_spawn(spawns, {})["id"], "A", "기본 없으면 첫 스폰")

	func test_pick_spawn_first_when_default_unknown() -> void:
		var spawns := [_sp("A", 1, 1)]
		assert_eq(OfficeClient.pick_spawn(spawns, { "spawn_id": "ZZZ" })["id"], "A", "매칭 실패→첫 스폰")

	func test_pick_spawn_empty() -> void:
		assert_true(OfficeClient.pick_spawn([], {}).is_empty(), "스폰 없음→빈 Dictionary")


# ============================================================================
# 백엔드 응답 파싱 (GET /layouts/current) — 네트워크 없이 핸들러 직접 검증
# ============================================================================

class TestLayoutResponse:
	extends GutTest

	const FIXTURE := "res://tests/fixtures/office_layout.json"

	var client: OfficeClient

	func before_each() -> void:
		client = OfficeClient.new()
		add_child_autofree(client)
		await get_tree().physics_frame

	func _body(d: Dictionary) -> PackedByteArray:
		return JSON.stringify(d).to_utf8_buffer()

	func test_success_response_loads_office() -> void:
		watch_signals(client)
		var resp := { "layout_json": OfficeLayoutLoader.load_file(FIXTURE) }
		client._on_layout_response(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), _body(resp))
		assert_signal_emitted(client, "office_loaded")
		assert_not_null(client.avatar, "응답에서 오피스 로드")

	func test_non_200_fails() -> void:
		watch_signals(client)
		client._on_layout_response(HTTPRequest.RESULT_SUCCESS, 404, PackedStringArray(), _body({}))
		assert_signal_emitted_with_parameters(client, "office_load_failed", ["http_status_404"])

	func test_bad_json_fails() -> void:
		watch_signals(client)
		client._on_layout_response(
			HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), "not-json".to_utf8_buffer(),
		)
		assert_signal_emitted_with_parameters(client, "office_load_failed", ["bad_response_json"])

	func test_missing_layout_json_fails() -> void:
		watch_signals(client)
		var b := _body({ "foo": 1 })
		client._on_layout_response(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), b)
		assert_signal_emitted_with_parameters(client, "office_load_failed", ["missing_layout_json"])

	func test_transport_failure_fails() -> void:
		watch_signals(client)
		# RESULT_SUCCESS(0)가 아닌 임의 실패 코드
		client._on_layout_response(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedStringArray(), _body({}))
		assert_signal_emitted(client, "office_load_failed")
		assert_null(client.avatar, "전송 실패 시 미로드")


# ============================================================================
# 카메라 프레이밍
# ============================================================================

class TestCameraFraming:
	extends GutTest

	const SAMPLE := "res://scenes/sample_office_layout.json"

	func test_camera_repositioned_above_office() -> void:
		var client := OfficeClient.new()
		var cam := Camera3D.new()
		cam.name = "Camera3D"
		client.add_child(cam)
		add_child_autofree(client)
		await get_tree().physics_frame
		client.load_office_from_file(SAMPLE)
		var placed: Camera3D = client.get_node("Camera3D")
		assert_gt(placed.position.y, 0.0, "카메라 상공 배치")
		# 30x20 층 중심(15,10) 위 span*0.9 높이 근방
		assert_almost_eq(placed.position.x, 15.0, 0.001, "중심 X 정렬")
