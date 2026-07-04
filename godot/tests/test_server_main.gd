extends GutTest

## G008 server_main 엔트리포인트 배선 검증(architect HIGH-2 회귀 가드).
##
## server_main.wire_layout_authority()가 배포 레이아웃에서 obstacle_cells + room_capacities를
## 실제로 주입하는지 확인 — 미주입 시 _is_blocked가 항상 false가 되어 서버 장애물 권위가
## 무력화되고 모든 회의실이 무제한이 되는 결함을 방지한다.

const SAMPLE := "res://scenes/sample_office_layout.json"

var ServerMain = load("res://server/server_main.gd")


func _server() -> GameServer:
	var s := GameServer.new()
	add_child_autofree(s)
	return s


func test_wire_injects_obstacle_cells() -> void:
	var s := _server()
	var ok: bool = ServerMain.wire_layout_authority(s, SAMPLE)
	assert_true(ok, "샘플 레이아웃 주입 성공")
	assert_gt(s.obstacle_cells.size(), 0, "obstacle_cells 주입됨(장애물 권위 활성)")


func test_wire_injects_room_capacities() -> void:
	var s := _server()
	ServerMain.wire_layout_authority(s, SAMPLE)
	assert_true(s.room_capacities.has("R_MEETING_A"), "회의실 정원 매핑 주입")
	assert_eq(int(s.room_capacities["R_MEETING_A"]), 6, "max_concurrent_users=6 반영")


func test_wire_missing_layout_returns_false() -> void:
	var s := _server()
	var ok: bool = ServerMain.wire_layout_authority(s, "res://scenes/__does_not_exist__.json")
	assert_false(ok, "레이아웃 부재 시 false(개발 모드)")
	assert_eq(s.obstacle_cells.size(), 0, "부재 시 obstacle 미주입")


func test_injected_obstacle_actually_blocks_move() -> void:
	# 통합: 주입된 obstacle_cells가 실제 avatar_move 권위 거부로 이어지는지.
	var s := _server()
	ServerMain.wire_layout_authority(s, SAMPLE)
	var cell: Vector2i = s.obstacle_cells[0]
	var now := Time.get_unix_time_from_system()
	s._connections[1] = {
		"ws": WebSocketPeer.new(), "state": GameServer.ConnState.READY, "user_id": 10,
		"x": float(cell.x) + 8.0, "y": float(cell.y), "facing": 0.0,
		"last_move_time": now - 1000.0, "room_id": "", "status": "online",
		"hello_deadline": now + 5.0,
	}
	s._sessions_by_user[10] = 1
	var start_x: float = s._connections[1]["x"]
	# 장애물 셀 중심으로 이동 시도 → 거부되어 위치 불변.
	s._handle_avatar_move(1, {
		"x": float(cell.x), "y": float(cell.y), "facing": 0.0, "sequence_num": 1,
	})
	assert_almost_eq(s._connections[1]["x"], start_x, 0.001, "장애물 셀 이동 거부(위치 불변)")
