class_name NetClient
extends Node

## G009: 클라이언트 WSS 네트워킹 래퍼 (WebSocketPeer, G001 JSON 메시지 계약).
##
## ✅ 런타임 검증 완료(godot 4.7 headless): tests/test_net_integration.gd에서 실제
## WSS 소켓으로 game_server.gd와 핸드셰이크→ready→avatar_move 권위 클램프→presence
## 왕복을 검증했다. 필드명/타입은 G001(realtime.py) 계약 그대로 사용한다.
##
## 사용법: OfficeClient 등 소유자가 인스턴스를 만들고 connect_to_server()를 호출해야
## 네트워킹이 활성화된다(office_client.gd 기존 오프라인 로드 흐름을 깨지 않기 위한 가드).
##
## 참조:
## - backend/app/api/realtime.py (G001 WSS 계약)
## - server/game_server.gd (이 클라이언트가 접속할 헤드리스 서버 구현)
## - 00-decisions.md: D3(서버 권위), D4(JWT), D12(클라 신뢰 — 서버 echo를 그대로 반영)

signal ready_received(user_id: int, snapshot: Array)
signal avatar_moved(user_id: int, x: float, y: float, facing: float)
signal presence_updated(user_id: int, status: String, room_id: String)
signal meeting_entered(user_id: int, meeting_id: String, room_id: String, livekit_room_name: String, livekit_token: String)
signal meeting_exited(user_id: int, meeting_id: String, room_id: String)
signal chat_received(user_id: int, message: String, range: String)
signal action_notified(user_id: int, action: String, target_type: String, target_id)
signal server_tick(entities: Array)
signal rejected(reason: String)
signal connection_closed(code: int, reason: String)

const PROTOCOL_VERSION := 3

enum State { DISCONNECTED, CONNECTING, AWAIT_READY, READY }

var state: int = State.DISCONNECTED
var user_id: int = 0
var last_server_seq: int = 0

var _ws: WebSocketPeer = null
var _pending_jwt: String = ""
var _was_open := false


func _process(_delta: float) -> void:
	if _ws == null:
		return
	_ws.poll()
	var rs := _ws.get_ready_state()

	if rs == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			_send_hello()
		while _ws.get_available_packet_count() > 0:
			var packet := _ws.get_packet()
			var parsed = JSON.parse_string(packet.get_string_from_utf8())
			if typeof(parsed) == TYPE_DICTIONARY:
				_handle_message(parsed)
	elif rs == WebSocketPeer.STATE_CLOSED:
		if state != State.DISCONNECTED:
			var code := _ws.get_close_code()
			var reason := _ws.get_close_reason()
			state = State.DISCONNECTED
			_ws = null
			set_process(false)
			connection_closed.emit(code, reason)


# ============================================================================
# 연결
# ============================================================================

## wss_url 접속 + hello 핸드셰이크(protocol_version 3 + jwt). D4: JWT는 접속 시 1회 전달.
func connect_to_server(wss_url: String, jwt: String) -> int:
	if _ws != null:
		disconnect_from_server()
	_ws = WebSocketPeer.new()
	_pending_jwt = jwt
	var err := _ws.connect_to_url(wss_url)
	if err != OK:
		_ws = null
		return err
	state = State.CONNECTING
	_was_open = false
	set_process(true)
	return OK


func disconnect_from_server() -> void:
	if _ws != null:
		_ws.close()
	_ws = null
	state = State.DISCONNECTED
	set_process(false)


func is_ready() -> bool:
	return state == State.READY


func _send_hello() -> void:
	state = State.AWAIT_READY
	_send({
		"type": "hello",
		"protocol_version": PROTOCOL_VERSION,
		"jwt": _pending_jwt,
	})


# ============================================================================
# 수신 처리
# ============================================================================

func _handle_message(msg: Dictionary) -> void:
	var msg_type := str(msg.get("type", ""))
	match msg_type:
		"ready":
			state = State.READY
			user_id = int(msg.get("user_id", 0))
			last_server_seq = int(msg.get("server_seq", 0))
			ready_received.emit(user_id, msg.get("snapshot", []))
		"reject":
			rejected.emit(str(msg.get("reason", "")))
		"avatar_move":
			_track_seq(msg)
			avatar_moved.emit(
				int(msg.get("user_id", 0)),
				float(msg.get("x", 0.0)),
				float(msg.get("y", 0.0)),
				float(msg.get("facing", 0.0)),
			)
		"presence_update":
			presence_updated.emit(
				int(msg.get("user_id", 0)),
				str(msg.get("status", "")),
				str(msg.get("room_id", "")),
			)
		"meeting_enter":
			_track_seq(msg)
			meeting_entered.emit(
				int(msg.get("user_id", 0)),
				str(msg.get("meeting_id", "")),
				str(msg.get("room_id", "")),
				str(msg.get("livekit_room_name", "")),
				str(msg.get("livekit_token", "")),
			)
		"meeting_exit":
			meeting_exited.emit(
				int(msg.get("user_id", 0)),
				str(msg.get("meeting_id", "")),
				str(msg.get("room_id", "")),
			)
		"chat":
			chat_received.emit(
				int(msg.get("user_id", 0)),
				str(msg.get("message", "")),
				str(msg.get("range", "")),
			)
		"action_notify":
			action_notified.emit(
				int(msg.get("user_id", 0)),
				str(msg.get("action", "")),
				str(msg.get("target_type", "")),
				msg.get("target_id", null),
			)
		"server_tick":
			server_tick.emit(msg.get("entities", []))
		_:
			pass  # 알 수 없는 타입은 무시(전방 호환).


func _track_seq(msg: Dictionary) -> void:
	if msg.has("server_seq"):
		last_server_seq = maxi(last_server_seq, int(msg["server_seq"]))


# ============================================================================
# 송신 API (G001 메시지 형태 그대로)
# ============================================================================

func send_avatar_move(x: float, y: float, facing: float, velocity: float, sequence_num: int) -> void:
	_send({
		"type": "avatar_move",
		"user_id": user_id,
		"x": x,
		"y": y,
		"facing": facing,
		"velocity": velocity,
		"sequence_num": sequence_num,
	})


func send_presence(status: String, room_id: String = "") -> void:
	var msg := { "type": "presence_update", "user_id": user_id, "status": status }
	if room_id != "":
		msg["room_id"] = room_id
	_send(msg)


func send_meeting_enter(meeting_id: String, room_id: String) -> void:
	_send({
		"type": "meeting_enter",
		"user_id": user_id,
		"meeting_id": meeting_id,
		"room_id": room_id,
	})


func send_meeting_exit(meeting_id: String, room_id: String) -> void:
	_send({
		"type": "meeting_exit",
		"user_id": user_id,
		"meeting_id": meeting_id,
		"room_id": room_id,
	})


func send_chat(message: String, range: String) -> void:
	_send({
		"type": "chat",
		"user_id": user_id,
		"message": message,
		"range": range,
	})


func send_action_notify(action: String, target_type: String, target_id) -> void:
	_send({
		"type": "action_notify",
		"user_id": user_id,
		"action": action,
		"target_type": target_type,
		"target_id": target_id,
	})


## 재연결 재생 요청. jwt는 새 접속의 hello와 별개로, 기존 세션 문맥을 재검증하기 위함.
func send_resume(last_seq: int, jwt: String) -> void:
	_send({
		"type": "resume",
		"last_server_seq": last_seq,
		"jwt": jwt,
	})


func _send(message: Dictionary) -> void:
	if _ws == null:
		return
	if _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	_ws.send_text(JSON.stringify(message))
