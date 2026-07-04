class_name OfficeClient
extends Node3D

## Phase 1 클라이언트 오케스트레이터.
##
## office_layout(05 스키마) 로드 → OfficeLayoutLoader로 3D 씬 구성 → 아바타 스폰 →
## 로더 파생(obstacle_cells/seats)을 아바타에 주입. 백엔드 GET /layouts/current
## (응답 layout_json) 페치 배선 포함.
##
## G009: NetClient(선택) 연동. connect_to_server()를 명시 호출해야 네트워킹이
## 켜진다 — 미호출 시 기존 오프라인 로드 흐름(테스트 포함)은 그대로 동작한다.
## 로컬 아바타 이동은 throttle되어 avatar_move로 송신되고, 원격 유저는 서버
## server_tick/avatar_move를 받아 Avatar 씬을 재사용한 원격 인스턴스를 보간 이동시킨다.
##
## ✅ 런타임 검증(godot 4.7 headless): 네트워킹 계약은 test_net_integration.gd에서
## 실소켓으로 검증됨(net_client.gd 상단 주석 참고). 오프라인 로드 흐름은 GUT 스위트 통과.
##
## 참조:
## - scenes/office_layout_loader.gd, scenes/avatar.gd, scenes/net_client.gd
## - backend/app/api/layouts.py: GET /layouts/current → { ..., "layout_json": {office_layout} }
## - 00-decisions.md: D3(서버 권위), D4(JWT HS256), D25(좌표계), D12(클라 신뢰)
##
## D12: 클라는 검증하지 않고 신뢰 — 서버가 배포 전 정밀 검증한 layout만 받는다.
## 원격 유저 위치는 서버가 유일한 권위이므로 로컬 예측 없이 보간만 한다.

signal office_loaded                     ## load_office 성공
signal office_load_failed(reason: String)  ## 로드 실패(사유 코드)

const MOVE_SEND_INTERVAL := 0.1   ## 10Hz로 avatar_move 송신(서버 20Hz 틱보다 낮게 throttle)
const REMOTE_LERP_SPEED := 10.0   ## 원격 아바타 위치 보간 계수(1/s)

@export var avatar_user_id: int = 1
## 지정 시 _ready에서 해당 파일을 자동 로드(에디터 F5 미리보기용). 빈 문자열=수동 로드.
@export_file("*.json") var autoload_fixture: String = ""

var loader: OfficeLayoutLoader = null
var avatar: Avatar = null
var _http: HTTPRequest = null

var net: NetClient = null
var _move_send_accum := 0.0
var _move_sequence := 0
## user_id(로컬 avatar_user_id 제외) -> Avatar(원격, 입력 없이 서버값만 반영)
var _remote_avatars: Dictionary = {}
## user_id -> { "pos": Vector3, "facing": float } 보간 목표
var _remote_targets: Dictionary = {}


func _ready() -> void:
	if autoload_fixture != "":
		load_office_from_file(autoload_fixture)


func _process(delta: float) -> void:
	_send_pending_move(delta)
	_interpolate_remote_avatars(delta)

# ============================================================================
# 로드 (인메모리 / 파일)
# ============================================================================

## 파싱 완료 layout으로 오피스 씬 구성 + 아바타 스폰 + nav/좌석 주입.
func load_office(layout: Dictionary) -> void:
	if layout.is_empty():
		office_load_failed.emit("empty_layout")
		return

	_clear()

	loader = OfficeLayoutLoader.new()
	loader.name = "OfficeLayout"
	add_child(loader)
	loader.build(layout)

	avatar = Avatar.new()
	avatar.name = "Avatar"
	avatar.user_id = avatar_user_id
	add_child(avatar)
	avatar.seats = loader.seats
	avatar.obstacle_cells = loader.obstacle_cells

	var spawn := pick_spawn(loader.spawn_points_out, layout.get("spawn_default", {}))
	if not spawn.is_empty():
		var p: Vector3 = spawn["pos"]
		avatar.position = Vector3(p.x, loader.floor_height, p.z)
		avatar.facing = float(spawn.get("facing", 0.0))
		avatar.update_rotation()
	else:
		avatar.position = Vector3(0.0, loader.floor_height, 0.0)

	avatar.moved.connect(_on_local_avatar_moved)

	_frame_camera(layout)
	office_loaded.emit()


## 자식 Camera3D("Camera3D")가 있으면 층 중심을 내려다보게 배치(look_at으로 정합 보장).
func _frame_camera(layout: Dictionary) -> void:
	var cam := get_node_or_null("Camera3D")
	if cam == null or not (cam is Camera3D):
		return
	var dim: Dictionary = layout.get("dimensions", {})
	var w := float(dim.get("width_m", 20.0))
	var h := float(dim.get("height_m", 20.0))
	var min_x := float(dim.get("min_x", 0.0))
	var min_y := float(dim.get("min_y", 0.0))
	var center := Vector3(min_x + w / 2.0, loader.floor_height, min_y + h / 2.0)
	var span := maxf(w, h)
	cam.position = center + Vector3(0.0, span * 0.9, span * 0.9)
	cam.look_at(center, Vector3.UP)


## 파일(res:// 등)에서 layout을 읽어 load_office.
func load_office_from_file(path: String) -> void:
	load_office(OfficeLayoutLoader.load_file(path))


## spawn_default.spawn_id와 매칭되는 스폰 우선, 없으면 첫 스폰. 스폰 없으면 {}.
static func pick_spawn(spawns: Array, spawn_default: Dictionary) -> Dictionary:
	if spawns.is_empty():
		return {}
	var want := str(spawn_default.get("spawn_id", ""))
	if want != "":
		for sp in spawns:
			if str(sp.get("id", "")) == want:
				return sp
	return spawns[0]


# ============================================================================
# 백엔드 페치 (GET /layouts/current)
# ============================================================================

## 배포된 현재 레이아웃을 백엔드에서 페치해 로드한다(D4 JWT Bearer).
## base_url 예: "http://192.168.0.10:8000". 완료 시 office_loaded/office_load_failed.
func request_layout(
	base_url: String, token: String, office_id: String = "", floor_id: String = ""
) -> void:
	if _http == null:
		_http = HTTPRequest.new()
		_http.name = "LayoutRequest"
		add_child(_http)
		_http.request_completed.connect(_on_layout_response)

	var url := base_url.rstrip("/") + "/layouts/current"
	var query := ""
	if office_id != "":
		query += ("&" if query != "" else "") + "office_id=" + office_id.uri_encode()
	if floor_id != "":
		query += ("&" if query != "" else "") + "floor_id=" + floor_id.uri_encode()
	if query != "":
		url += "?" + query

	var headers := PackedStringArray(["Authorization: Bearer " + token])
	var err := _http.request(url, headers)
	if err != OK:
		office_load_failed.emit("http_request_error_%d" % err)


## HTTPRequest.request_completed 처리(네트워크 없이도 단위 테스트 가능하도록 분리).
func _on_layout_response(
	result: int, code: int, _headers: PackedStringArray, body: PackedByteArray
) -> void:
	if result != HTTPRequest.RESULT_SUCCESS:
		office_load_failed.emit("http_result_%d" % result)
		return
	if code != 200:
		office_load_failed.emit("http_status_%d" % code)
		return
	var json := JSON.new()
	if json.parse(body.get_string_from_utf8()) != OK:
		office_load_failed.emit("bad_response_json")
		return
	var parsed = json.data
	if typeof(parsed) != TYPE_DICTIONARY:
		office_load_failed.emit("bad_response_json")
		return
	var layout = parsed.get("layout_json", {})
	if typeof(layout) != TYPE_DICTIONARY or layout.is_empty():
		office_load_failed.emit("missing_layout_json")
		return
	load_office(layout)


# ============================================================================
# 내부
# ============================================================================

func _clear() -> void:
	if avatar != null and is_instance_valid(avatar):
		if avatar.moved.is_connected(_on_local_avatar_moved):
			avatar.moved.disconnect(_on_local_avatar_moved)
		remove_child(avatar)
		avatar.queue_free()
	avatar = null
	if loader != null and is_instance_valid(loader):
		remove_child(loader)
		loader.queue_free()
	loader = null
	_clear_remote_avatars()


func _clear_remote_avatars() -> void:
	for uid in _remote_avatars.keys():
		var a: Avatar = _remote_avatars[uid]
		if a != null and is_instance_valid(a):
			remove_child(a)
			a.queue_free()
	_remote_avatars.clear()
	_remote_targets.clear()


# ============================================================================
# 네트워킹 (G009, 선택적)
# ============================================================================

## NetClient를 생성/연결한다. 호출 전까지는 완전 오프라인으로 동작(기존 흐름 유지).
func connect_to_server(wss_url: String, jwt: String) -> void:
	if net == null:
		net = NetClient.new()
		net.name = "NetClient"
		add_child(net)
		net.ready_received.connect(_on_net_ready_received)
		net.avatar_moved.connect(_on_net_avatar_moved)
		net.presence_updated.connect(_on_net_presence_updated)
		net.server_tick.connect(_on_net_server_tick)
		net.rejected.connect(_on_net_rejected)
	net.connect_to_server(wss_url, jwt)


## 로컬 아바타 이동 → throttle 후 avatar_move 송신(로컬 예측은 avatar.gd가 이미 처리).
func _on_local_avatar_moved() -> void:
	pass  # 실제 송신은 _process의 _send_pending_move()에서 throttle해 처리한다.


func _send_pending_move(delta: float) -> void:
	if net == null or not net.is_ready() or avatar == null or not is_instance_valid(avatar):
		return
	_move_send_accum += delta
	if _move_send_accum < MOVE_SEND_INTERVAL:
		return
	_move_send_accum = 0.0
	_move_sequence += 1
	net.send_avatar_move(
		avatar.position.x, avatar.position.z, avatar.facing,
		avatar.velocity.length(), _move_sequence,
	)


## 서버 ready: 스냅샷에 담긴 기존 접속자를 원격 아바타로 스폰(D12: 서버값 그대로 신뢰).
func _on_net_ready_received(_user_id: int, snapshot: Array) -> void:
	for entry in snapshot:
		var uid := int(entry.get("user_id", 0))
		if uid == avatar_user_id or uid == 0:
			continue
		var remote := _get_or_create_remote_avatar(uid)
		var pos := Vector3(float(entry.get("x", 0.0)), _floor_y(), float(entry.get("y", 0.0)))
		remote.position = pos
		remote.facing = float(entry.get("facing", 0.0))
		remote.update_rotation()
		_remote_targets[uid] = { "pos": pos, "facing": remote.facing }


## D12: 본인 user_id의 echo는 무시(로컬 예측이 이미 적용됨). 타인만 보간 목표 갱신.
func _on_net_avatar_moved(user_id: int, x: float, y: float, facing: float) -> void:
	if user_id == avatar_user_id:
		return
	_get_or_create_remote_avatar(user_id)
	_remote_targets[user_id] = { "pos": Vector3(x, _floor_y(), y), "facing": facing }


func _on_net_server_tick(entities: Array) -> void:
	for entry in entities:
		var uid := int(entry.get("user_id", 0))
		if uid == avatar_user_id or uid == 0:
			continue
		_get_or_create_remote_avatar(uid)
		_remote_targets[uid] = {
			"pos": Vector3(float(entry.get("x", 0.0)), _floor_y(), float(entry.get("y", 0.0))),
			"facing": float(entry.get("facing", 0.0)),
		}


func _on_net_presence_updated(user_id: int, status: String, _room_id: String) -> void:
	if user_id == avatar_user_id:
		return
	if status == "offline":
		_remove_remote_avatar(user_id)
		return
	var remote := _get_or_create_remote_avatar(user_id)
	remote.set_meta("presence_status", status)


func _on_net_rejected(_reason: String) -> void:
	# 접속 거부(D4 handshake 실패 등)는 office_load_failed와 별개 채널이므로
	# 상위(호출자)가 net.rejected 시그널을 직접 구독해도 된다; 여기서는 로그만 남긴다.
	pass


func _interpolate_remote_avatars(delta: float) -> void:
	if _remote_targets.is_empty():
		return
	var t := clampf(REMOTE_LERP_SPEED * delta, 0.0, 1.0)
	for uid in _remote_targets.keys():
		var remote: Avatar = _remote_avatars.get(uid)
		if remote == null or not is_instance_valid(remote):
			continue
		var target: Dictionary = _remote_targets[uid]
		remote.position = remote.position.lerp(target["pos"], t)
		remote.facing = lerp_angle(deg_to_rad(remote.facing), deg_to_rad(target["facing"]), t)
		remote.facing = rad_to_deg(remote.facing)
		remote.update_rotation()


func _get_or_create_remote_avatar(user_id: int) -> Avatar:
	if _remote_avatars.has(user_id):
		return _remote_avatars[user_id]
	var remote := Avatar.new()
	remote.name = "RemoteAvatar_%d" % user_id
	remote.user_id = user_id
	add_child(remote)
	# 원격 아바타는 입력을 받지 않는다(서버 값만 반영) — 이동은 target lerp로만 갱신.
	remote.set_move_direction(Vector3.ZERO)
	remote.set_physics_process(false)
	_remote_avatars[user_id] = remote
	if avatar != null and is_instance_valid(avatar):
		if not avatar.others.has(remote):
			avatar.others.append(remote)
	return remote


func _remove_remote_avatar(user_id: int) -> void:
	if not _remote_avatars.has(user_id):
		return
	var remote: Avatar = _remote_avatars[user_id]
	if avatar != null and is_instance_valid(avatar):
		avatar.others.erase(remote)
	if remote != null and is_instance_valid(remote):
		remove_child(remote)
		remote.queue_free()
	_remote_avatars.erase(user_id)
	_remote_targets.erase(user_id)


func _floor_y() -> float:
	return loader.floor_height if loader != null else 0.0