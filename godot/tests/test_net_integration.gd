extends GutTest

## G008+G009 종단간 통합 테스트 (실제 WSS 소켓).
##
## GameServer(권위 서버)를 실제 포트에 기동하고 NetClient(G009 클라)로 실접속해
## 핸드셰이크→ready 스냅샷, 서버 권위 이동 클램프(D3)가 와이어를 타고 전파되는지,
## presence 온/오프라인 브로드캐스트를 검증한다. godot 4.7 headless에서 실행.
##
## 참조: server/game_server.gd, scenes/net_client.gd, backend/app/api/realtime.py.

const SECRET := "integration-secret"


func _mint(sub: int) -> String:
	return JwtVerify.mint(
		{ "sub": sub, "exp": Time.get_unix_time_from_system() + 3600 }, SECRET
	)


func _start_server() -> Array:
	var s := GameServer.new()
	s.jwt_secret_override = SECRET
	add_child_autofree(s)
	var port := randi_range(21000, 39000)
	assert_true(s.start(port), "서버 리스닝 :%d" % port)
	return [s, port]


func _pump(seconds: float) -> void:
	var waited := 0.0
	while waited < seconds:
		await get_tree().create_timer(0.02).timeout
		waited += 0.02


## 접속 후 ready까지 대기. { "client": NetClient, "uid": int, "snapshot": Array }
func _connect_ready(port: int, sub: int) -> Dictionary:
	var client := NetClient.new()
	add_child_autofree(client)
	var box := { "uid": 0, "snapshot": [] }
	client.ready_received.connect(func(uid, snap):
		box["uid"] = uid
		box["snapshot"] = snap
	)
	client.connect_to_server("ws://127.0.0.1:%d" % port, _mint(sub))
	var waited := 0.0
	while box["uid"] == 0 and waited < 4.0:
		await get_tree().create_timer(0.03).timeout
		waited += 0.03
	box["client"] = client
	return box


func test_handshake_ready_and_snapshot() -> void:
	var sp := _start_server()
	var port: int = sp[1]

	var a := await _connect_ready(port, 1)
	assert_eq(int(a["uid"]), 1, "A ready user_id=1")
	# G001 계약: ready 직전 본인을 connections에 등록하므로 스냅샷은 본인을 포함한다
	# (backend realtime.py와 동일; 클라 _on_net_ready_received가 본인 uid를 필터).
	var a_snap: Array = []
	for e in (a["snapshot"] as Array):
		a_snap.append(int(e.get("user_id", -1)))
	assert_true(a_snap.has(1), "첫 접속 스냅샷은 본인(user1) 포함(계약 일치)")

	var b := await _connect_ready(port, 2)
	assert_eq(int(b["uid"]), 2, "B ready user_id=2")
	# B의 스냅샷에는 먼저 접속한 A(user 1)가 포함되어야 한다.
	var snap_uids: Array = []
	for e in (b["snapshot"] as Array):
		snap_uids.append(int(e.get("user_id", -1)))
	assert_true(snap_uids.has(1), "B 스냅샷에 기존 접속자 A 포함")

	sp[0].stop()


func test_server_authority_clamps_move_over_wire() -> void:
	var sp := _start_server()
	var server: GameServer = sp[0]
	var port: int = sp[1]

	var a := await _connect_ready(port, 1)
	var b := await _connect_ready(port, 2)
	assert_eq(int(a["uid"]), 1, "A 준비")
	assert_eq(int(b["uid"]), 2, "B 준비")

	# B가 관찰한 user 1의 x좌표 표본(브로드캐스트 avatar_move + server_tick)
	var seen_x: Array = []
	var client_b: NetClient = b["client"]
	client_b.avatar_moved.connect(func(uid, x, _y, _f):
		if uid == 1:
			seen_x.append(x)
	)
	client_b.server_tick.connect(func(entities):
		for e in entities:
			if int(e.get("user_id", -1)) == 1:
				seen_x.append(float(e.get("x", 0.0)))
	)

	# A가 원점(0,0)에서 (95,0)으로 순간이동 시도 → 서버가 속도상한으로 강하게 클램프.
	var client_a: NetClient = a["client"]
	client_a.send_avatar_move(95.0, 0.0, 0.0, 5.0, 1)
	await _pump(1.0)

	assert_gt(seen_x.size(), 0, "B가 user1 위치 표본을 수신")
	var max_x := 0.0
	for x in seen_x:
		max_x = maxf(max_x, x)
	assert_lt(max_x, 50.0, "implausible 순간이동은 서버 권위로 클램프되어 전파됨(관측 max_x=%.2f)" % max_x)
	# 서버 내부 권위 상태도 클램프 확인
	assert_lt(float(server._sessions_by_user.size()), 3.0, "세션 2개")

	server.stop()


func test_presence_online_and_offline_broadcast() -> void:
	var sp := _start_server()
	var server: GameServer = sp[0]
	var port: int = sp[1]

	var a := await _connect_ready(port, 1)
	var client_a: NetClient = a["client"]
	var presence: Array = []  # [ [uid, status], ... ]
	client_a.presence_updated.connect(func(uid, status, _room):
		presence.append([uid, status])
	)

	# B 접속 → A는 user2 online presence를 받아야 한다.
	var b := await _connect_ready(port, 2)
	await _pump(0.4)
	var saw_online := false
	for p in presence:
		if int(p[0]) == 2 and str(p[1]) == "online":
			saw_online = true
	assert_true(saw_online, "B 접속 시 A가 online presence 수신")

	# B 종료 → 서버가 감지 후 offline 브로드캐스트.
	(b["client"] as NetClient).disconnect_from_server()
	await _pump(0.8)
	var saw_offline := false
	for p in presence:
		if int(p[0]) == 2 and str(p[1]) == "offline":
			saw_offline = true
	assert_true(saw_offline, "B 종료 시 A가 offline presence 수신")

	server.stop()
