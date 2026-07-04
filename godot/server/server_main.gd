extends SceneTree

## G008: 헤드리스 서버 엔트리포인트.
##
## 실행: `godot --headless --script res://server/server_main.gd -- --port=9080 --layout=res://scenes/sample_office_layout.json`
## (Godot는 `--`뒤 인자를 OS.get_cmdline_user_args()로 넘긴다.)
##
## ✅ 런타임 검증(godot 4.7 headless): GameServer 권위 로직은 tests/test_game_server.gd(18) +
## tests/test_net_integration.gd(3 실소켓)로 검증됨. server_main 자체 기동은 이 스크립트가 배선하는
## obstacle_cells/room_capacities 주입 로직을 tests/test_server_main.gd(정적)로 검증한다.
##
## 포트/시크릿/레이아웃 우선순위: cmdline user arg > 환경변수 > 기본값.
## - 포트: --port=NNNN > GAME_SERVER_PORT > 9080
## - 레이아웃: --layout=PATH > GAME_SERVER_LAYOUT > res://scenes/sample_office_layout.json
## - JWT 시크릿: GameServer._resolve_secret() 참고(JWT_SECRET_KEY)


func _initialize() -> void:
	var port := _resolve_port()

	var server := GameServer.new()
	server.name = "GameServer"
	# SceneTree(헤드리스)에는 씬 트리 루트가 없으므로 직접 root에 매단다.
	root.add_child(server)

	# D3 필수: 배포 레이아웃에서 서버 권위용 obstacle_cells + 회의 정원을 주입.
	# (미주입 시 _is_blocked가 항상 false → 서버 장애물 권위 무력화, 모든 방 무제한.)
	wire_layout_authority(server, _resolve_layout_path())

	if not server.start(port):
		push_error("server_main: failed to start GameServer on port %d" % port)
		quit(1)
		return

	print("server_main: GameServer running on port %d (protocol_version=%d, obstacles=%d, rooms=%d)" % [
		port, GameServer.PROTOCOL_VERSION, server.obstacle_cells.size(), server.room_capacities.size(),
	])


## 레이아웃 파일을 로드해 obstacle_cells + room_capacities를 server에 주입.
## static: 부작용 없이 테스트에서 직접 검증 가능(server 인스턴스만 필요).
## 반환: true=주입 성공, false=레이아웃 로드 실패(개발 모드로 무제한 진행).
static func wire_layout_authority(server: GameServer, layout_path: String) -> bool:
	var layout := OfficeLayoutLoader.load_file(layout_path)
	if layout.is_empty():
		push_warning("server_main: layout '%s' 로드 실패 — obstacle/capacity 미주입(개발 모드)" % layout_path)
		return false
	server.obstacle_cells = OfficeLayoutLoader.derive_obstacle_cells(layout)
	var caps := {}
	for room in layout.get("rooms", []):
		var rid := str(room.get("room_id", ""))
		if rid == "":
			continue
		var cap := int(room.get("max_concurrent_users", room.get("capacity", -1)))
		if cap >= 0:
			caps[rid] = cap
	server.room_capacities = caps
	return true


func _resolve_port() -> int:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--port="):
			var v := int(arg.substr("--port=".length()))
			if v > 0:
				return v
	var env := OS.get_environment("GAME_SERVER_PORT")
	if env != "" and env.is_valid_int():
		return int(env)
	return 9080


func _resolve_layout_path() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--layout="):
			return arg.substr("--layout=".length())
	var env := OS.get_environment("GAME_SERVER_LAYOUT")
	if env != "":
		return env
	return "res://scenes/sample_office_layout.json"
