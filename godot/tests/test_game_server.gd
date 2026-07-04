extends GutTest

## G008 GameServer 권위 로직 단위 테스트.
##
## 소켓 없이 검증: fresh WebSocketPeer는 STATE_CLOSED라 GameServer._send()가 안전하게
## no-op → 연결 dict를 주입하고 메시지 핸들러를 직접 호출해 "서버 권위 상태"(위치 클램프,
## 장애물 거부, 좌표 경계, 회의 정원, resume 버퍼, 핸드셰이크 판정)를 결정론적으로 검증.
##
## 참조: server/game_server.gd, backend/app/api/realtime.py(G001 계약), 00-decisions.md D3/D9/D25.

const SECRET := "unit-secret"


func _server() -> GameServer:
	var s := GameServer.new()
	s.jwt_secret_override = SECRET
	add_child_autofree(s)
	return s


## 연결 dict 주입. dt_back초 전에 마지막 이동한 것으로 설정(속도 창 제어용).
func _inject(s: GameServer, conn_id: int, user_id: int, state: int,
		x: float = 0.0, y: float = 0.0, dt_back: float = 0.0) -> void:
	var now := Time.get_unix_time_from_system()
	s._connections[conn_id] = {
		"ws": WebSocketPeer.new(),
		"state": state,
		"user_id": user_id,
		"x": x, "y": y, "facing": 0.0,
		"last_move_time": now - dt_back,
		"room_id": "", "status": "online",
		"hello_deadline": now + 5.0,
	}
	if state == GameServer.ConnState.READY and user_id != 0:
		s._sessions_by_user[user_id] = conn_id


# ============================================================================
# 순수 함수: 근접(D9), 장애물(D25)
# ============================================================================

func test_proximity_type_tiers() -> void:
	var s := _server()
	assert_eq(s._proximity_type(0.5), "direct_talk", "<1m 직접대화")
	assert_eq(s._proximity_type(1.0), "menu", "1m 경계는 menu")
	assert_eq(s._proximity_type(1.9), "menu", "<2m 메뉴")
	assert_eq(s._proximity_type(2.0), "chat", "2m 경계는 chat")
	assert_eq(s._proximity_type(4.9), "chat", "<5m 채팅")
	assert_eq(s._proximity_type(5.0), "none", "5m 이상 없음")
	assert_eq(s._proximity_type(50.0), "none", "원거리 없음")


func test_is_blocked() -> void:
	var s := _server()
	assert_false(s._is_blocked(Vector2(5.0, 5.0)), "장애물 미설정시 통과")
	s.obstacle_cells = [Vector2i(5, 5), Vector2i(6, 7)]
	assert_true(s._is_blocked(Vector2(5.0, 5.0)), "정확 셀 차단")
	assert_true(s._is_blocked(Vector2(5.4, 4.6)), "반올림 셀 차단")
	assert_false(s._is_blocked(Vector2(0.0, 0.0)), "빈 셀 통과")


# ============================================================================
# avatar_move 서버 권위(D3)
# ============================================================================

func test_move_within_speed_accepted() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY, 0.0, 0.0, 10.0)  # dt≈10s 여유
	s._handle_avatar_move(1, { "x": 3.0, "y": 0.0, "facing": 45.0, "sequence_num": 1 })
	assert_almost_eq(s._connections[1]["x"], 3.0, 0.001, "정상 이동 반영 x")
	assert_almost_eq(s._connections[1]["facing"], 45.0, 0.001, "facing 반영")


func test_move_exceeds_speed_clamped() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY, 0.0, 0.0, 10.0)  # dt≈10 → max_dist≈62.5
	s._handle_avatar_move(1, { "x": 95.0, "y": 0.0, "facing": 0.0, "sequence_num": 1 })
	var nx: float = s._connections[1]["x"]
	assert_lt(nx, 95.0, "implausible 점프는 클램프됨")
	assert_between(nx, 55.0, 68.0, "max_dist(≈62.5) 근방으로 클램프")


func test_move_out_of_bounds_clamped() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY, 0.0, 0.0, 1000.0)  # 속도창 무제한
	s._handle_avatar_move(1, { "x": 150.0, "y": -20.0, "facing": 0.0, "sequence_num": 1 })
	assert_almost_eq(s._connections[1]["x"], 100.0, 0.001, "x 상한 100 클램프(D25)")
	assert_almost_eq(s._connections[1]["y"], 0.0, 0.001, "y 하한 0 클램프(D25)")


func test_move_into_obstacle_rejected() -> void:
	var s := _server()
	s.obstacle_cells = [Vector2i(3, 0)]
	_inject(s, 1, 10, GameServer.ConnState.READY, 0.0, 0.0, 1000.0)
	s._handle_avatar_move(1, { "x": 3.0, "y": 0.0, "facing": 0.0, "sequence_num": 1 })
	assert_almost_eq(s._connections[1]["x"], 0.0, 0.001, "장애물 이동 거부 → 위치 불변")


func test_facing_normalized() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY, 0.0, 0.0, 10.0)
	s._handle_avatar_move(1, { "x": 1.0, "y": 0.0, "facing": 450.0, "sequence_num": 1 })
	assert_almost_eq(s._connections[1]["facing"], 90.0, 0.001, "facing 0..360 정규화")


# ============================================================================
# resume 재생 버퍼
# ============================================================================

func test_replay_buffer_cap() -> void:
	var s := _server()
	for i in range(GameServer.REPLAY_BUFFER_SIZE + 50):
		s._record_replay(s._next_server_seq(), { "type": "avatar_move", "n": i })
	assert_eq(s._replay_buffer.size(), GameServer.REPLAY_BUFFER_SIZE, "링버퍼 상한 유지")
	# 가장 오래된 것은 밀려남
	assert_gt(int(s._replay_buffer[0]["server_seq"]), 50, "오래된 항목 pop_front")


func test_next_server_seq_monotonic() -> void:
	var s := _server()
	var a := s._next_server_seq()
	var b := s._next_server_seq()
	assert_eq(b, a + 1, "server_seq 단조 증가")


# ============================================================================
# 회의실 정원
# ============================================================================

func test_meeting_capacity_enforced() -> void:
	var s := _server()
	s.room_capacities = { "R1": 1 }
	_inject(s, 1, 10, GameServer.ConnState.READY)
	_inject(s, 2, 20, GameServer.ConnState.READY)
	s._handle_meeting_enter(1, { "room_id": "R1", "meeting_id": "M1" })
	s._handle_meeting_enter(2, { "room_id": "R1", "meeting_id": "M1" })
	var occ: Array = s._room_occupants["R1"]
	assert_eq(occ.size(), 1, "정원 1 초과 입장 거부")
	assert_true(occ.has(10), "먼저 온 user 유지")
	assert_eq(s._connections[2]["room_id"], "", "거부된 user room 미설정")


func test_meeting_enter_exit_updates_state() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY)
	s._handle_meeting_enter(1, { "room_id": "R2", "meeting_id": "M2" })
	assert_eq(s._connections[1]["room_id"], "R2", "입장 시 room 설정")
	assert_true((s._room_occupants["R2"] as Array).has(10), "occupant 등록")
	s._handle_meeting_exit(1, { "room_id": "R2", "meeting_id": "M2" })
	assert_eq(s._connections[1]["room_id"], "", "퇴장 시 room 해제")
	assert_false((s._room_occupants["R2"] as Array).has(10), "occupant 제거")


# ============================================================================
# 연결 정리 + 스냅샷
# ============================================================================

func test_forget_connection_cleans_session() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY)
	s._room_occupants["R3"] = [10]
	s._forget_connection(1)
	assert_false(s._connections.has(1), "연결 제거")
	assert_false(s._sessions_by_user.has(10), "세션 제거")
	assert_false((s._room_occupants["R3"] as Array).has(10), "occupant 정리")


func test_build_snapshot_only_ready() -> void:
	var s := _server()
	_inject(s, 1, 10, GameServer.ConnState.READY, 4.0, 5.0)
	_inject(s, 2, 0, GameServer.ConnState.AWAIT_HELLO)
	var snap := s._build_snapshot()
	assert_eq(snap.size(), 1, "READY 연결만 스냅샷")
	assert_eq(int(snap[0]["user_id"]), 10, "스냅샷 user_id")
	assert_almost_eq(float(snap[0]["x"]), 4.0, 0.001, "스냅샷 좌표")


# ============================================================================
# 핸드셰이크(D4 JWT)
# ============================================================================

func test_handshake_valid_jwt_ready() -> void:
	var s := _server()
	_inject(s, 1, 0, GameServer.ConnState.AWAIT_HELLO)
	var token := JwtVerify.mint(
		{ "sub": 5, "exp": Time.get_unix_time_from_system() + 3600 }, SECRET
	)
	s._handle_hello(1, { "protocol_version": 3, "jwt": token })
	assert_true(s._connections.has(1), "연결 유지")
	assert_eq(s._connections[1]["state"], GameServer.ConnState.READY, "READY 전이")
	assert_eq(int(s._connections[1]["user_id"]), 5, "user_id=sub")
	assert_eq(int(s._sessions_by_user.get(5, -1)), 1, "세션 등록")


func test_handshake_bad_protocol_rejected() -> void:
	var s := _server()
	_inject(s, 1, 0, GameServer.ConnState.AWAIT_HELLO)
	s._handle_hello(1, { "protocol_version": 2, "jwt": "x" })
	assert_false(s._connections.has(1), "프로토콜 불일치 → 연결 종료")


func test_handshake_invalid_jwt_rejected() -> void:
	var s := _server()
	_inject(s, 1, 0, GameServer.ConnState.AWAIT_HELLO)
	s._handle_hello(1, { "protocol_version": 3, "jwt": "not.a.jwt" })
	assert_false(s._connections.has(1), "위조 JWT → 연결 종료")


func test_handshake_expired_jwt_rejected() -> void:
	var s := _server()
	_inject(s, 1, 0, GameServer.ConnState.AWAIT_HELLO)
	var token := JwtVerify.mint(
		{ "sub": 5, "exp": Time.get_unix_time_from_system() - 100 }, SECRET
	)
	s._handle_hello(1, { "protocol_version": 3, "jwt": token })
	assert_false(s._connections.has(1), "만료 JWT → 연결 종료")


func test_handshake_wrong_secret_rejected() -> void:
	var s := _server()
	_inject(s, 1, 0, GameServer.ConnState.AWAIT_HELLO)
	var token := JwtVerify.mint(
		{ "sub": 5, "exp": Time.get_unix_time_from_system() + 3600 }, "other-secret"
	)
	s._handle_hello(1, { "protocol_version": 3, "jwt": token })
	assert_false(s._connections.has(1), "서명 불일치 → 연결 종료")
