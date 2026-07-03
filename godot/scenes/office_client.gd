class_name OfficeClient
extends Node3D

## Phase 1 클라이언트 오케스트레이터.
##
## office_layout(05 스키마) 로드 → OfficeLayoutLoader로 3D 씬 구성 → 아바타 스폰 →
## 로더 파생(obstacle_cells/seats)을 아바타에 주입. 백엔드 GET /layouts/current
## (응답 layout_json) 페치 배선 포함.
##
## 참조:
## - scenes/office_layout_loader.gd, scenes/avatar.gd
## - backend/app/api/layouts.py: GET /layouts/current → { ..., "layout_json": {office_layout} }
## - 00-decisions.md: D3(서버 권위), D4(JWT HS256), D25(좌표계), D12(클라 신뢰)
##
## D12: 클라는 검증하지 않고 신뢰 — 서버가 배포 전 정밀 검증한 layout만 받는다.

signal office_loaded                     ## load_office 성공
signal office_load_failed(reason: String)  ## 로드 실패(사유 코드)

@export var avatar_user_id: int = 1
## 지정 시 _ready에서 해당 파일을 자동 로드(에디터 F5 미리보기용). 빈 문자열=수동 로드.
@export_file("*.json") var autoload_fixture: String = ""

var loader: OfficeLayoutLoader = null
var avatar: Avatar = null
var _http: HTTPRequest = null


func _ready() -> void:
	if autoload_fixture != "":
		load_office_from_file(autoload_fixture)


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
	var parsed = JSON.parse_string(body.get_string_from_utf8())
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
		avatar.queue_free()
	avatar = null
	if loader != null and is_instance_valid(loader):
		loader.queue_free()
	loader = null
