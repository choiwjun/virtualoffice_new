extends SceneTree

## G008: 헤드리스 서버 엔트리포인트.
##
## 실행: `godot --headless --script res://server/server_main.gd -- --port=9080`
## (Godot는 `--`뒤 인자를 OS.get_cmdline_user_args()로 넘긴다.)
##
## ⚠️ 런타임 검증 보류(godot 바이너리 미제공 환경): 기동/접속은 직접 실행하지 못했다.
## 코드 리뷰로만 작성됨 — game_server.gd 상단 주석 참고.
##
## 포트/시크릿 우선순위: cmdline user arg > 환경변수 > 기본값.
## - 포트: --port=NNNN > GAME_SERVER_PORT > 9080
## - JWT 시크릿: game_server.gd의 GameServer._resolve_secret() 참고(JWT_SECRET_KEY)


func _initialize() -> void:
	var port := _resolve_port()

	var server := GameServer.new()
	server.name = "GameServer"
	# SceneTree(헤드리스)에는 씬 트리 루트가 없으므로 직접 root에 매단다.
	root.add_child(server)

	if not server.start(port):
		push_error("server_main: failed to start GameServer on port %d" % port)
		quit(1)
		return

	print("server_main: GameServer running on port %d (protocol_version=%d)" % [
		port, GameServer.PROTOCOL_VERSION,
	])


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
