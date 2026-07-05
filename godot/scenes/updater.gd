# 클라이언트 자동 업데이트 (P7-R3-T2, D8)
#
# 백엔드 GET /api/client/version?current=X 로 최신 버전을 조회하고, required면 강제 업데이트를
# 유도한다. 실 다운로드/서명·체크섬 검증은 배포 채널(공인 도메인/Let's Encrypt, D21-r) 확보 후.
# 이 스크립트는 헤드리스/에디터 모두에서 HTTPRequest로 버전 체크 로직만 담당한다.
extends Node

signal update_available(latest: String, required: bool, url: String)
signal up_to_date()
signal check_failed(reason: String)

const CURRENT_VERSION := "0.1.0"

@export var api_base := "http://localhost:8000"
var _http: HTTPRequest


func _ready() -> void:
	_http = HTTPRequest.new()
	add_child(_http)
	_http.request_completed.connect(_on_completed)


func check_for_update() -> void:
	var url := "%s/api/client/version?current=%s" % [api_base, CURRENT_VERSION]
	var err := _http.request(url)
	if err != OK:
		check_failed.emit("request_error_%d" % err)


func _on_completed(_result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if code != 200:
		check_failed.emit("http_%d" % code)
		return
	var json = JSON.parse_string(body.get_string_from_utf8())
	if typeof(json) != TYPE_DICTIONARY:
		check_failed.emit("bad_json")
		return
	var latest: String = str(json.get("latest", CURRENT_VERSION))
	var required: bool = bool(json.get("required", false))
	var up: bool = bool(json.get("up_to_date", false))
	var dl_url: String = str(json.get("url", ""))
	if up:
		up_to_date.emit()
	else:
		update_available.emit(latest, required, dl_url)
