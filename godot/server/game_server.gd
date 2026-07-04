class_name GameServer
extends Node

## G008: 헤드리스 권위 서버 (WSS JSON 메시지, G001 계약).
##
## ✅ 런타임 검증 완료(godot 4.7 headless GUT): tests/test_game_server.gd(18 단위) +
## tests/test_net_integration.gd(3 실소켓) — 핸드셰이크/JWT/권위 이동 클램프(D3)/장애물
## 거부/좌표 경계(D25)/근접(D9)/resume 버퍼/회의 정원/presence 브로드캐스트 검증.
## 기동: `godot --headless --script res://server/server_main.gd`. GPU 60fps 성능
## 프로파일(40아바타)만 windowed GPU 세션 필요(G010-e).
##
## WebSocket API 선택: TCPServer + WebSocketPeer(서버 모드, accept_stream) 수동 accept 루프.
## 이유: WebSocketMultiplayerPeer/godot 고수준 MultiplayerAPI는 ENet 스타일 피어ID·RPC
## 프레이밍을 강제해 "임의 JSON 텍스트 프레임"인 G001 계약과 맞지 않는다. TCPServer로
## raw TCP 연결을 받아 WebSocketPeer.accept_stream()으로 서버측 핸드셰이크를 수행하면
## G001 JSON 텍스트 메시지를 그대로 송수신할 수 있다.
##
## 참조:
## - backend/app/api/realtime.py (G001 WSS 계약, 이 서버가 반드시 동일 형식을 따른다)
## - server/jwt_verify.gd (HS256 JWT 검증, D4)
## - scenes/avatar.gd (MAX_SPEED=5.0, MAP_MIN/MAX 0..100, D25)
## - 00-decisions.md: D3(서버 권위), D4(JWT), D9(근접), D25(좌표계)
##
## 세션/상태는 전부 인메모리(Dictionary)이며 프로세스 재시작 시 소실된다(Phase 1 범위).

# ============================================================================
# 상수 (G001 계약 상수)
# ============================================================================

const PROTOCOL_VERSION := 3
const MAP_MIN := 0.0             ## D25
const MAP_MAX := 100.0           ## D25
const MAX_SPEED := 5.0           ## avatar.gd와 동일 상한 (m/s)
const SPEED_SLACK := 1.25        ## 네트워크 지터 허용 배율(권위 검증이 지나치게 빡빡하지 않도록)
const TICK_HZ := 20.0
const TICK_INTERVAL := 1.0 / TICK_HZ
const REPLAY_BUFFER_SIZE := 500
const HANDSHAKE_TIMEOUT_SEC := 5.0

## D9: 근접 상호작용 임계값(m). avatar.gd get_proximity_interaction_type()과 동일 기준.
const PROXIMITY_DIRECT_TALK := 1.0
const PROXIMITY_MENU := 2.0
const PROXIMITY_CHAT := 5.0

const CLOSE_NORMAL := 1000
const CLOSE_AUTH := 4001
const CLOSE_PROTOCOL := 4002
const CLOSE_CAPACITY := 4003

# 연결 상태 머신
enum ConnState { AWAIT_HELLO, READY, CLOSED }

# ============================================================================
# 설정(export)
# ============================================================================

@export var listen_port: int = 9080
@export var max_connections: int = 100
## 비워두면 OS 환경변수 JWT_SECRET_KEY, 그마저 없으면 개발용 기본값을 사용한다.
@export var jwt_secret_override: String = ""
## A* 차단 셀(OfficeLayoutLoader.derive_obstacle_cells 결과를 주입). 비어있으면 검사 생략.
@export var obstacle_cells: Array[Vector2i] = []
## room_id -> 최대 동시 입장 인원. 미등록 room_id는 무제한으로 취급.
@export var room_capacities: Dictionary = {}

# ============================================================================
# 내부 상태
# ============================================================================

var _tcp_server := TCPServer.new()
var _listening := false

## conn_id(int, 접속 순번) -> Dictionary 연결 상태
## { ws: WebSocketPeer, state: ConnState, user_id, hello_deadline: float,
##   x, y, facing, last_move_time: float, room_id: String, status: String }
var _connections: Dictionary = {}
var _next_conn_id := 1

## user_id -> conn_id (READY 상태만 등록)
var _sessions_by_user: Dictionary = {}

## room_id -> Array[user_id] (meeting_enter로 입장한 인원)
var _room_occupants: Dictionary = {}

## 근접 상호작용 마지막 판정: user_id -> (other_user_id -> type String)
var _last_proximity: Dictionary = {}

var _server_seq := 0
## 순환 재생 버퍼: [{ "server_seq": int, "message": Dictionary }, ...]
var _replay_buffer: Array = []

var _tick_accum := 0.0
var _tick_count := 0


# ============================================================================
# 수명주기
# ============================================================================

func _ready() -> void:
	set_process(false)


## 리스닝 시작. 성공 시 true.
func start(port: int = -1) -> bool:
	var p := listen_port if port < 0 else port
	var err := _tcp_server.listen(p)
	if err != OK:
		push_error("GameServer: listen(%d) failed: %d" % [p, err])
		return false
	listen_port = p
	_listening = true
	set_process(true)
	print("GameServer: listening on port %d" % p)
	return true


func stop() -> void:
	for conn_id in _connections.keys():
		_close_connection(conn_id, CLOSE_NORMAL, "server_shutdown")
	_tcp_server.stop()
	_listening = false
	set_process(false)


func _resolve_secret() -> String:
	if jwt_secret_override != "":
		return jwt_secret_override
	var env := OS.get_environment("JWT_SECRET_KEY")
	if env != "":
		return env
	return "dev-only-secret-CHANGE-IN-PRODUCTION"


# ============================================================================
# 메인 루프
# ============================================================================

func _process(delta: float) -> void:
	if not _listening:
		return
	_accept_new_connections()
	_poll_connections(delta)
	_tick_accum += delta
	while _tick_accum >= TICK_INTERVAL:
		_tick_accum -= TICK_INTERVAL
		_run_tick()


func _accept_new_connections() -> void:
	while _tcp_server.is_connection_available():
		var tcp := _tcp_server.take_connection()
		if tcp == null:
			continue
		if _connections.size() >= max_connections:
			# 용량 초과: WS 핸드셰이크까지 갈 필요 없이 즉시 소켓을 닫는다.
			tcp.disconnect_from_host()
			continue
		var ws := WebSocketPeer.new()
		var err := ws.accept_stream(tcp)
		if err != OK:
			continue
		var conn_id := _next_conn_id
		_next_conn_id += 1
		_connections[conn_id] = {
			"ws": ws,
			"state": ConnState.AWAIT_HELLO,
			"user_id": 0,
			"hello_deadline": Time.get_unix_time_from_system() + HANDSHAKE_TIMEOUT_SEC,
			"x": 0.0,
			"y": 0.0,
			"facing": 0.0,
			"last_move_time": Time.get_unix_time_from_system(),
			"room_id": "",
			"status": "online",
		}


func _poll_connections(_delta: float) -> void:
	var now := Time.get_unix_time_from_system()
	for conn_id in _connections.keys().duplicate():
		var conn: Dictionary = _connections.get(conn_id, {})
		if conn.is_empty():
			continue
		var ws: WebSocketPeer = conn["ws"]
		ws.poll()
		var ready_state := ws.get_ready_state()
		if ready_state == WebSocketPeer.STATE_CLOSED:
			_forget_connection(conn_id)
			continue
		if ready_state != WebSocketPeer.STATE_OPEN:
			continue

		if conn["state"] == ConnState.AWAIT_HELLO and now > float(conn["hello_deadline"]):
			_reject(conn_id, "unsupported_protocol_version", CLOSE_PROTOCOL)
			continue

		while ws.get_available_packet_count() > 0:
			var packet := ws.get_packet()
			var text := packet.get_string_from_utf8()
			var parsed = JSON.parse_string(text)
			if typeof(parsed) != TYPE_DICTIONARY:
				continue
			_handle_message(conn_id, parsed)
			# 메시지 처리 중 연결이 닫혔을 수 있으므로 재확인.
			if not _connections.has(conn_id):
				break


# ============================================================================
# 메시지 라우팅
# ============================================================================

func _handle_message(conn_id: int, msg: Dictionary) -> void:
	if not _connections.has(conn_id):
		return
	var conn: Dictionary = _connections[conn_id]
	var msg_type := str(msg.get("type", ""))

	if conn["state"] == ConnState.AWAIT_HELLO:
		if msg_type == "hello":
			_handle_hello(conn_id, msg)
		# 핸드셰이크 전 다른 메시지는 무시(스펙 외 프레임).
		return

	match msg_type:
		"avatar_move":
			_handle_avatar_move(conn_id, msg)
		"presence_update":
			_handle_presence_update(conn_id, msg)
		"meeting_enter":
			_handle_meeting_enter(conn_id, msg)
		"meeting_exit":
			_handle_meeting_exit(conn_id, msg)
		"chat":
			_handle_chat(conn_id, msg)
		"action_notify":
			_handle_action_notify(conn_id, msg)
		"resume":
			_handle_resume(conn_id, msg)
		_:
			pass  # 알 수 없는 타입은 무시(전방 호환).


# ============================================================================
# 핸드셰이크
# ============================================================================

func _handle_hello(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]

	var protocol_version := int(msg.get("protocol_version", -1))
	if protocol_version != PROTOCOL_VERSION:
		_reject(conn_id, "unsupported_protocol_version", CLOSE_PROTOCOL)
		return

	if _connections.size() > max_connections:
		_reject(conn_id, "capacity_exceeded", CLOSE_CAPACITY)
		return

	var token := str(msg.get("jwt", ""))
	var verdict := JwtVerify.verify(token, _resolve_secret())
	if not bool(verdict.get("valid", false)):
		if str(verdict.get("reason", "")) == "expired":
			_reject(conn_id, "expired_jwt", CLOSE_AUTH)
		else:
			_reject(conn_id, "invalid_jwt", CLOSE_AUTH)
		return

	var claims: Dictionary = verdict.get("claims", {})
	var user_id := int(claims.get("sub", 0))
	if user_id == 0:
		_reject(conn_id, "invalid_jwt", CLOSE_AUTH)
		return

	# 동일 user_id 재접속: 기존 세션을 밀어낸다(단일 세션 정책).
	if _sessions_by_user.has(user_id):
		var old_conn_id: int = _sessions_by_user[user_id]
		if old_conn_id != conn_id:
			_close_connection(old_conn_id, CLOSE_NORMAL, "superseded_by_new_session")

	conn["state"] = ConnState.READY
	conn["user_id"] = user_id
	_connections[conn_id] = conn
	_sessions_by_user[user_id] = conn_id

	var seq := _next_server_seq()
	_send(conn_id, {
		"type": "ready",
		"user_id": user_id,
		"protocol_version": PROTOCOL_VERSION,
		"server_seq": seq,
		"snapshot": _build_snapshot(),
	})

	_broadcast({
		"type": "presence_update",
		"user_id": user_id,
		"status": "online",
	}, user_id)


func _reject(conn_id: int, reason: String, close_code: int) -> void:
	_send(conn_id, { "type": "reject", "reason": reason })
	_close_connection(conn_id, close_code, reason)


func _build_snapshot() -> Array:
	var out: Array = []
	for other_conn_id in _connections.keys():
		var c: Dictionary = _connections[other_conn_id]
		if c["state"] != ConnState.READY:
			continue
		out.append({
			"user_id": c["user_id"],
			"x": c["x"],
			"y": c["y"],
			"facing": c["facing"],
			"status": c["status"],
			"room_id": c["room_id"],
		})
	return out


# ============================================================================
# avatar_move (D3: 서버 권위 검증)
# ============================================================================

func _handle_avatar_move(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]
	var user_id: int = conn["user_id"]

	var target_x := clampf(float(msg.get("x", conn["x"])), MAP_MIN, MAP_MAX)
	var target_y := clampf(float(msg.get("y", conn["y"])), MAP_MIN, MAP_MAX)
	var facing := fmod(float(msg.get("facing", conn["facing"])), 360.0)
	if facing < 0.0:
		facing += 360.0

	var now := Time.get_unix_time_from_system()
	var dt := maxf(now - float(conn["last_move_time"]), 1.0 / TICK_HZ)
	var from := Vector2(conn["x"], conn["y"])
	var requested := Vector2(target_x, target_y)
	var dist := from.distance_to(requested)
	var max_dist := MAX_SPEED * SPEED_SLACK * dt

	var resolved := requested
	if dist > max_dist and dist > 0.0:
		# D3/D22: 이동 속도 상한 초과 → implausible delta를 clamp.
		resolved = from + (requested - from).normalized() * max_dist

	if _is_blocked(resolved):
		# 장애물 셀로 이동 요청 → 거부, 마지막 유효 위치를 본인에게만 재통지.
		_send(conn_id, {
			"type": "avatar_move",
			"user_id": user_id,
			"x": conn["x"],
			"y": conn["y"],
			"facing": conn["facing"],
			"velocity": 0.0,
			"sequence_num": int(msg.get("sequence_num", 0)),
			"server_seq": _next_server_seq(),
		})
		return

	conn["x"] = resolved.x
	conn["y"] = resolved.y
	conn["facing"] = facing
	conn["last_move_time"] = now
	_connections[conn_id] = conn

	var seq := _next_server_seq()
	var out_msg := {
		"type": "avatar_move",
		"user_id": user_id,
		"x": resolved.x,
		"y": resolved.y,
		"facing": facing,
		"velocity": float(msg.get("velocity", 0.0)),
		"sequence_num": int(msg.get("sequence_num", 0)),
		"server_seq": seq,
	}
	_broadcast(out_msg, user_id)
	_record_replay(seq, out_msg)
	_update_proximity(user_id)


func _is_blocked(pos: Vector2) -> bool:
	if obstacle_cells.is_empty():
		return false
	var cell := Vector2i(int(round(pos.x)), int(round(pos.y)))
	return obstacle_cells.has(cell)


# ============================================================================
# 근접 감지 (D9, 서버 사이드)
# ============================================================================

func _update_proximity(moved_user_id: int) -> void:
	var moved_conn_id: int = _sessions_by_user.get(moved_user_id, -1)
	if moved_conn_id == -1:
		return
	var mover: Dictionary = _connections[moved_conn_id]
	var mover_pos := Vector2(mover["x"], mover["y"])

	if not _last_proximity.has(moved_user_id):
		_last_proximity[moved_user_id] = {}
	var mover_map: Dictionary = _last_proximity[moved_user_id]

	for other_conn_id in _connections.keys():
		var other: Dictionary = _connections[other_conn_id]
		if other["state"] != ConnState.READY:
			continue
		var other_user_id: int = other["user_id"]
		if other_user_id == moved_user_id:
			continue
		var d := mover_pos.distance_to(Vector2(other["x"], other["y"]))
		var interaction := _proximity_type(d)
		var prev := str(mover_map.get(other_user_id, "none"))
		if interaction != prev:
			mover_map[other_user_id] = interaction
			_broadcast_to([moved_user_id, other_user_id], {
				"type": "action_notify",
				"user_id": moved_user_id,
				"action": interaction,
				"target_type": "user",
				"target_id": other_user_id,
			})
	_last_proximity[moved_user_id] = mover_map


## D9 임계값: <1m direct_talk, <2m menu, <5m chat, 그외 none. avatar.gd와 동일 기준.
func _proximity_type(d: float) -> String:
	if d < PROXIMITY_DIRECT_TALK:
		return "direct_talk"
	elif d < PROXIMITY_MENU:
		return "menu"
	elif d < PROXIMITY_CHAT:
		return "chat"
	return "none"


# ============================================================================
# presence_update / chat / action_notify (클라이언트 발신 브로드캐스트)
# ============================================================================

func _handle_presence_update(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]
	var user_id: int = conn["user_id"]
	var status := str(msg.get("status", "online"))
	conn["status"] = status
	_connections[conn_id] = conn
	_broadcast({
		"type": "presence_update",
		"user_id": user_id,
		"status": status,
		"room_id": str(msg.get("room_id", "")),
	}, user_id)


## chat/action_notify: D9 단순화 — 서버는 근접도를 재검증하지 않고 발신자가 보낸
## range/페이로드를 그대로 전원(본인 제외) 브로드캐스트한다. 정밀 근접 필터링은
## 클라이언트가 자신의 nearest-other 거리로 표시 여부를 판단한다(Phase 1 범위).
func _handle_chat(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]
	var user_id: int = conn["user_id"]
	_broadcast({
		"type": "chat",
		"user_id": user_id,
		"message": str(msg.get("message", "")),
		"range": str(msg.get("range", "chat")),
	}, user_id)


func _handle_action_notify(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]
	var user_id: int = conn["user_id"]
	_broadcast({
		"type": "action_notify",
		"user_id": user_id,
		"action": str(msg.get("action", "")),
		"target_type": str(msg.get("target_type", "")),
		"target_id": msg.get("target_id", null),
	}, user_id)


# ============================================================================
# 회의실 입장/퇴장 + 정원 관리
# ============================================================================

func _handle_meeting_enter(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]
	var user_id: int = conn["user_id"]
	var room_id := str(msg.get("room_id", ""))
	var meeting_id := str(msg.get("meeting_id", ""))

	var occupants: Array = _room_occupants.get(room_id, [])
	var capacity := int(room_capacities.get(room_id, -1))
	if capacity >= 0 and occupants.size() >= capacity and not occupants.has(user_id):
		# 정원 초과: 회의 계열 close 코드는 없으므로 reject 메시지만 통지(연결 유지).
		_send(conn_id, { "type": "reject", "reason": "capacity_exceeded" })
		return

	if not occupants.has(user_id):
		occupants.append(user_id)
	_room_occupants[room_id] = occupants
	conn["room_id"] = room_id
	_connections[conn_id] = conn

	var seq := _next_server_seq()
	var out_msg := {
		"type": "meeting_enter",
		"user_id": user_id,
		"meeting_id": meeting_id,
		"room_id": room_id,
		# LiveKit 발급은 백엔드(D24) 소관 — 클라가 이미 받아온 값을 그대로 중계한다.
		"livekit_room_name": str(msg.get("livekit_room_name", "")),
		"livekit_token": str(msg.get("livekit_token", "")),
		"server_seq": seq,
	}
	_broadcast(out_msg, user_id)
	_send(conn_id, out_msg)
	_record_replay(seq, out_msg)

	_broadcast({
		"type": "presence_update",
		"user_id": user_id,
		"status": "meeting",
		"room_id": room_id,
	})


func _handle_meeting_exit(conn_id: int, msg: Dictionary) -> void:
	var conn: Dictionary = _connections[conn_id]
	var user_id: int = conn["user_id"]
	var room_id := str(msg.get("room_id", conn["room_id"]))
	var meeting_id := str(msg.get("meeting_id", ""))

	var occupants: Array = _room_occupants.get(room_id, [])
	occupants.erase(user_id)
	_room_occupants[room_id] = occupants
	conn["room_id"] = ""
	_connections[conn_id] = conn

	_broadcast({
		"type": "meeting_exit",
		"user_id": user_id,
		"meeting_id": meeting_id,
		"room_id": room_id,
	})
	_broadcast({
		"type": "presence_update",
		"user_id": user_id,
		"status": "online",
	})


# ============================================================================
# resume (재연결 재생)
# ============================================================================

func _handle_resume(conn_id: int, msg: Dictionary) -> void:
	# resume은 hello 이후에만 유효(연결 상태는 이미 READY 여야 여기 도달).
	var last_seq := int(msg.get("last_server_seq", 0))
	for entry in _replay_buffer:
		if int(entry["server_seq"]) > last_seq:
			_send(conn_id, entry["message"])


func _record_replay(seq: int, message: Dictionary) -> void:
	_replay_buffer.append({ "server_seq": seq, "message": message })
	while _replay_buffer.size() > REPLAY_BUFFER_SIZE:
		_replay_buffer.pop_front()


# ============================================================================
# 20Hz 틱
# ============================================================================

func _run_tick() -> void:
	_tick_count += 1
	var entities: Array = []
	for conn_id in _connections.keys():
		var c: Dictionary = _connections[conn_id]
		if c["state"] != ConnState.READY:
			continue
		entities.append({
			"user_id": c["user_id"],
			"x": c["x"],
			"y": c["y"],
			"facing": c["facing"],
		})
	if entities.is_empty():
		return
	_broadcast({
		"type": "server_tick",
		"tick": _tick_count,
		"server_time": Time.get_unix_time_from_system(),
		"entities": entities,
	})


# ============================================================================
# 송신/연결 관리 헬퍼
# ============================================================================

func _next_server_seq() -> int:
	_server_seq += 1
	return _server_seq


func _send(conn_id: int, message: Dictionary) -> void:
	var conn: Dictionary = _connections.get(conn_id, {})
	if conn.is_empty():
		return
	var ws: WebSocketPeer = conn["ws"]
	if ws.get_ready_state() != WebSocketPeer.STATE_OPEN and ws.get_ready_state() != WebSocketPeer.STATE_CONNECTING:
		return
	ws.send_text(JSON.stringify(message))


func _broadcast(message: Dictionary, exclude_user_id: int = -1) -> void:
	for conn_id in _connections.keys():
		var conn: Dictionary = _connections[conn_id]
		if conn["state"] != ConnState.READY:
			continue
		if conn["user_id"] == exclude_user_id:
			continue
		_send(conn_id, message)


## exclude_user_id 없이 특정 user_id 집합에게만 송신(근접 알림처럼 당사자만 필요한 경우).
func _broadcast_to(user_ids, message: Dictionary) -> void:
	for conn_id in _connections.keys():
		var conn: Dictionary = _connections[conn_id]
		if conn["state"] != ConnState.READY:
			continue
		if user_ids.has(conn["user_id"]):
			_send(conn_id, message)


func _close_connection(conn_id: int, code: int, reason: String) -> void:
	var conn: Dictionary = _connections.get(conn_id, {})
	if conn.is_empty():
		return
	var ws: WebSocketPeer = conn["ws"]
	ws.close(code, reason)
	_forget_connection(conn_id)


func _forget_connection(conn_id: int) -> void:
	var conn: Dictionary = _connections.get(conn_id, {})
	if conn.is_empty():
		return
	var user_id: int = conn.get("user_id", 0)
	_connections.erase(conn_id)
	if user_id != 0 and _sessions_by_user.get(user_id, -1) == conn_id:
		_sessions_by_user.erase(user_id)
		_last_proximity.erase(user_id)
		for room_id in _room_occupants.keys():
			var occupants: Array = _room_occupants[room_id]
			if occupants.has(user_id):
				occupants.erase(user_id)
				_room_occupants[room_id] = occupants
		_broadcast({
			"type": "presence_update",
			"user_id": user_id,
			"status": "offline",
		})
