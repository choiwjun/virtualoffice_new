extends Node3D

## 웹 임베드 오피스 — 플레이어블(직원 본인 아바타 조작).
## 구조/가구/조명은 office_layout_loader + office_visuals 재사용(데이터기반, 배치 반영).
##
## 조작:
##  - 이동: WASD / 방향키(카메라 상대) 또는 바닥 좌클릭(A* 길찾기 자동 이동)
##  - 시점: 우클릭 드래그로 오빗, 휠로 줌
## 싱글플레이(멀티는 net_client.gd로 추후 연결). avatar.gd의 이동/충돌/길찾기 엔진을 그대로 구동.

const SAMPLE := "res://scenes/sample_office_layout.json"
const PLAYER_MODEL := "res://assets/models/people/p09.glb"
const ANIM_WALK := "CharacterArmature|Walk"
const ANIM_IDLE := "CharacterArmature|Idle_Neutral"
const CAM_HEIGHT := 13.0
const CAM_BACK := 16.0
const ARRIVE_EPS := 0.25

var _pivot: Node3D
var _cam: Camera3D
var _yaw := 0.0
var _zoom := 1.0
var _orbiting := false

var _avatar: Avatar
var _anim: AnimationPlayer
var _cur_anim := ""
var _path: Array = []
var _floor_h := 0.0
var _bmin := Vector2.ZERO
var _bmax := Vector2(30.0, 20.0)


func _ready() -> void:
	var LoaderScript := load("res://scenes/office_layout_loader.gd")
	var loader = LoaderScript.new()
	loader.primitive_furniture = false
	add_child(loader)
	var layout: Dictionary = LoaderScript.load_file(SAMPLE)
	loader.build(layout)
	_floor_h = loader.floor_height
	var dim: Dictionary = layout.get("dimensions", {})
	_bmin = Vector2(float(dim.get("min_x", 0.0)), float(dim.get("min_y", 0.0)))
	_bmax = Vector2(float(dim.get("max_x", 30.0)), float(dim.get("max_y", 20.0)))

	var VisualsScript := load("res://scenes/office_visuals.gd")
	VisualsScript.setup_environment(self)
	VisualsScript.populate(layout, self, _floor_h)

	_spawn_player(loader, layout)
	_setup_camera()


## 직원 본인 아바타(가시 모델 + 셀렉션 링) 스폰 + nav 데이터 주입.
func _spawn_player(loader, layout: Dictionary) -> void:
	_avatar = Avatar.new()
	_avatar.name = "PlayerAvatar"
	add_child(_avatar)
	_avatar.seats = loader.seats
	_avatar.obstacle_cells = loader.obstacle_cells

	var sp := _pick_spawn(loader.spawn_points_out, layout.get("spawn_default", {}))
	var pos := Vector2((_bmin.x + _bmax.x) * 0.5, (_bmin.y + _bmax.y) * 0.5)
	if not sp.is_empty():
		var p: Vector3 = sp["pos"]
		pos = Vector2(p.x, p.z)
		_avatar.facing = float(sp.get("facing", 0.0))
	# 캡슐 중심이 원점 → 발이 바닥에 오도록 y=floor+0.9, 비주얼은 자식에서 -0.9 보정.
	_avatar.position = Vector3(pos.x, _floor_h + 0.9, pos.y)

	if ResourceLoader.exists(PLAYER_MODEL):
		var vis = load(PLAYER_MODEL).instantiate()
		vis.position = Vector3(0.0, -0.9, 0.0)
		_avatar.add_child(vis)
		_anim = vis.find_child("AnimationPlayer", true, false)
		_play(ANIM_IDLE)

	# 셀렉션 링(브랜드 발광) — '내 아바타' 식별
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.38
	tm.outer_radius = 0.52
	ring.mesh = tm
	var rm := StandardMaterial3D.new()
	rm.albedo_color = Color(0.24, 0.52, 1.0)
	rm.emission_enabled = true
	rm.emission = Color(0.30, 0.60, 1.0)
	rm.emission_energy_multiplier = 2.4
	ring.material_override = rm
	ring.position = Vector3(0.0, -0.86, 0.0)
	_avatar.add_child(ring)


func _pick_spawn(spawns: Array, spawn_default: Dictionary) -> Dictionary:
	if spawns.is_empty():
		return {}
	var want := str(spawn_default.get("spawn_id", ""))
	if want != "":
		for s in spawns:
			if str(s.get("id", "")) == want:
				return s
	return spawns[0]


## 아이소 카메라 리그(아바타를 따라가는 피벗). web/데스크톱 공통.
func _setup_camera() -> void:
	_pivot = Node3D.new()
	var c := Vector3((_bmin.x + _bmax.x) * 0.5, 0.5, (_bmin.y + _bmax.y) * 0.5)
	if _avatar:
		c = Vector3(_avatar.position.x, 0.5, _avatar.position.z)
	_pivot.position = c
	add_child(_pivot)
	_cam = Camera3D.new()
	_pivot.add_child(_cam)
	_cam.fov = 46.0
	_cam.position = Vector3(-CAM_BACK, CAM_HEIGHT, CAM_BACK)
	_cam.look_at(_pivot.global_position, Vector3.UP)
	_cam.current = true


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			_orbiting = event.pressed
		elif event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			_click_to_move(event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_zoom = clampf(_zoom - 0.08, 0.55, 1.6)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom = clampf(_zoom + 0.08, 0.55, 1.6)
	elif event is InputEventMouseMotion and _orbiting:
		_yaw -= event.relative.x * 0.01
		_pivot.rotation.y = _yaw


## 바닥 평면에 레이 투영 → A* 경로 계산(막히면 직선 폴백).
func _click_to_move(screen_pos: Vector2) -> void:
	if _cam == null or _avatar == null:
		return
	var from := _cam.project_ray_origin(screen_pos)
	var dir := _cam.project_ray_normal(screen_pos)
	var plane := Plane(Vector3.UP, _floor_h)
	var hit = plane.intersects_ray(from, dir)
	if hit == null:
		return
	var target := Vector3(
		clampf(hit.x, _bmin.x + 0.3, _bmax.x - 0.3),
		_floor_h,
		clampf(hit.z, _bmin.y + 0.3, _bmax.y - 0.3),
	)
	var wp: Array = _avatar.calculate_path(target)
	if wp.is_empty():
		wp = [target]  # 경로 실패 시 직선 이동
	_path = wp


func _process(delta: float) -> void:
	if _avatar == null:
		return
	var wasd := _read_wasd()
	if wasd != Vector3.ZERO:
		_path.clear()
		_avatar.set_move_direction(wasd)
	elif not _path.is_empty():
		_follow_path()
	else:
		_avatar.set_move_direction(Vector3.ZERO)

	_post_move()
	_update_camera(delta)


## 카메라 상대 WASD/방향키 → 월드 XZ 이동 벡터(정규화, 없으면 ZERO).
func _read_wasd() -> Vector3:
	var v := Vector2.ZERO
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		v.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		v.y += 1.0
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		v.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		v.x += 1.0
	if v == Vector2.ZERO or _cam == null:
		return Vector3.ZERO
	var b := _cam.global_transform.basis
	var fwd := Vector3(b.z.x, 0.0, b.z.z)  # 화면 위=카메라 전방(-z) → -fwd
	var right := Vector3(b.x.x, 0.0, b.x.z)
	if fwd.length() > 0.001:
		fwd = fwd.normalized()
	if right.length() > 0.001:
		right = right.normalized()
	var dir := right * v.x - fwd * v.y  # v.y<0(전방)일 때 -fwd*(-1)=+fwd(카메라 안쪽)
	if dir.length() > 0.001:
		return dir.normalized()
	return Vector3.ZERO


## A* 웨이포인트 추종(도착하면 pop, 다 소진하면 정지).
func _follow_path() -> void:
	var target: Vector3 = _path[0]
	var to := Vector3(target.x - _avatar.position.x, 0.0, target.z - _avatar.position.z)
	if to.length() <= ARRIVE_EPS:
		_path.pop_front()
		if _path.is_empty():
			_avatar.set_move_direction(Vector3.ZERO)
		return
	_avatar.set_move_direction(to.normalized())


## 이동 후: 경계 클램프 + 진행방향 페이싱 + 걷기/정지 애니메이션.
func _post_move() -> void:
	_avatar.position.x = clampf(_avatar.position.x, _bmin.x + 0.3, _bmax.x - 0.3)
	_avatar.position.z = clampf(_avatar.position.z, _bmin.y + 0.3, _bmax.y - 0.3)
	var vel := _avatar.velocity
	var speed := Vector2(vel.x, vel.z).length()
	if speed > 0.05 and _avatar.move_direction != Vector3.ZERO:
		var d := _avatar.move_direction
		_avatar.rotation.y = atan2(d.x, d.z)
		_play(ANIM_WALK)
	else:
		_play(ANIM_IDLE)


func _play(anim: String) -> void:
	if _anim == null or _cur_anim == anim:
		return
	if _anim.has_animation(anim):
		_anim.play(anim)
		_cur_anim = anim


## 피벗이 아바타를 부드럽게 따라가고, 줌을 반영.
func _update_camera(delta: float) -> void:
	if _pivot == null or _cam == null:
		return
	var goal := Vector3(_avatar.position.x, 0.5, _avatar.position.z)
	_pivot.position = _pivot.position.lerp(goal, clampf(delta * 4.0, 0.0, 1.0))
	_cam.position = Vector3(-CAM_BACK * _zoom, CAM_HEIGHT * _zoom, CAM_BACK * _zoom)
	_cam.look_at(_pivot.global_position, Vector3.UP)
