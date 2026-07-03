class_name Avatar
extends CharacterBody3D

## 아바타 클라이언트 로직 (Phase 1)
##
## 참조:
## - 00-decisions.md: D2(GDScript), D3(서버 권위), D9(방 개구부), D10(좌석), D22(성능), D25(좌표계)
## - 09-realtime-collaboration.md: 아바타 동기화, 충돌, 좌석 점유, 근접 상호작용
## - 05-office-layout-schema.md: 좌표계 top_left 고정, 0<=x,y<100
##
## 좌표계(D25): 도(degree) 단위, 시계방향, 기준축 +X=동, +Z=남.
## 오피스 평면은 XZ 평면(단층 top-down), 아바타는 y≈0 평면에서 이동한다.

signal moved
signal seat_warning(message: String)
signal proximity_menu_show
signal proximity_menu_hide

const MAX_SPEED := 5.0            ## D22: 이동 속도 상한 (m/s)
const MAP_MIN := 0.0              ## D25: 좌표 하한
const MAP_MAX := 100.0           ## D25: 좌표 상한 (0<=x,z<100)
const SEAT_RANGE := 1.5          ## D10: 좌석 감지 반경 (m)
const PROXIMITY_RANGE := 2.0     ## 근접 메뉴 표시 반경 (m)
const COLLISION_RADIUS := 0.3    ## 캡슐 충돌체 반경 (어깨 너비 0.6m)

@export var user_id: int = 1
var facing: float = 0.0                  ## 바라보는 각도(도, 시계방향)
var current_seat_id: String = ""         ## 현재 점유(감지)한 좌석 id, 없으면 ""
var move_direction: Vector3 = Vector3.ZERO

## 월드 참조(씬/서버가 주입)
var seats: Array = []            ## [{ "id": String, "pos": Vector3, "assigned": bool }]
var others: Array = []           ## 근접 대상 아바타(Node3D) 목록
var obstacle_cells: Array = []   ## A* 격자 차단 셀 Array[Vector2i] (가구 등)

var _proximity_active := false


func _ready() -> void:
	# .tscn로 인스턴스되지 않고 코드로 생성돼도 충돌체를 보장한다.
	if not _has_collision_shape():
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = COLLISION_RADIUS
		cap.height = 1.8
		cs.shape = cap
		add_child(cs)


func _has_collision_shape() -> bool:
	for c in get_children():
		if c is CollisionShape3D:
			return true
	return false


## 이동 방향 설정(지속). Vector3.ZERO로 정지.
func set_move_direction(dir: Vector3) -> void:
	move_direction = dir


## facing(도) → 노드 y축 회전(라디안) 적용.
func update_rotation() -> void:
	rotation.y = deg_to_rad(facing)


func _physics_process(_delta: float) -> void:
	if move_direction != Vector3.ZERO:
		_apply_movement()


## 물리 한 스텝 이동 + 경계 클램프 + 좌석/근접 갱신 후 moved 방출.
func _apply_movement() -> void:
	var dir := move_direction
	var throttle := minf(dir.length(), 1.0)      # 입력 크기=스로틀(0~1), 초과분 무시
	velocity = dir.normalized() * (throttle * MAX_SPEED)  # D22: 속도 상한 MAX_SPEED(5.0)
	velocity.y = 0.0
	move_and_slide()
	_clamp_bounds()
	update_seat()
	update_proximity()
	moved.emit()


## D25: 맵 경계 0<=x,z<100 로 클램프.
func _clamp_bounds() -> void:
	var eps := 0.0001
	position.x = clampf(position.x, MAP_MIN, MAP_MAX - eps)
	position.z = clampf(position.z, MAP_MIN, MAP_MAX - eps)


## D10: 반경 1.5m 내 가장 가까운 좌석 감지. 미배정 좌석이면 경고.
func update_seat() -> void:
	var nearest_id := ""
	var nearest_d := INF
	var nearest_assigned := true
	for s in seats:
		var d: float = position.distance_to(s["pos"])
		if d <= SEAT_RANGE and d < nearest_d:
			nearest_d = d
			nearest_id = s["id"]
			nearest_assigned = bool(s.get("assigned", true))
	current_seat_id = nearest_id
	if nearest_id != "" and not nearest_assigned:
		seat_warning.emit("Unassigned seat: %s" % nearest_id)


## 근접 대상과의 최소 거리로 메뉴 표시/숨김 전이 방출.
func update_proximity() -> void:
	var nd := _nearest_other_distance()
	if nd <= PROXIMITY_RANGE:
		if not _proximity_active:
			_proximity_active = true
			proximity_menu_show.emit()
	else:
		if _proximity_active:
			_proximity_active = false
			proximity_menu_hide.emit()


## 거리 계층별 상호작용 유형(D9 근접): <1m 직접대화, <2m 메뉴, <5m 채팅, 그외 없음.
func get_proximity_interaction_type() -> String:
	var nd := _nearest_other_distance()
	if nd < 1.0:
		return "direct_talk"
	elif nd < 2.0:
		return "menu"
	elif nd < 5.0:
		return "chat"
	return "none"


func _nearest_other_distance() -> float:
	var nd := INF
	for o in others:
		nd = minf(nd, position.distance_to(o.position))
	return nd


## D3: 클라이언트측 A* 경로(격자 1m). obstacle_cells를 회피. 서버가 최종 권위.
## 반환: 시작 셀 다음부터 목표까지의 웨이포인트 Array[Vector3](y=0).
func calculate_path(target: Vector3) -> Array:
	var start := Vector2i(int(round(position.x)), int(round(position.z)))
	var goal := Vector2i(int(round(target.x)), int(round(target.z)))
	var blocked := {}
	for c in obstacle_cells:
		blocked[c] = true
	if blocked.has(goal):
		return []

	var open := [start]
	var came := {}
	var g := { start: 0 }
	var neighbors := [
		Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
		Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1),
	]
	while not open.is_empty():
		# 최소 f 셀 선택
		var best := 0
		var best_f: float = INF
		for i in open.size():
			var n: Vector2i = open[i]
			var f: float = float(g[n]) + _heuristic(n, goal)
			if f < best_f:
				best_f = f
				best = i
		var cur: Vector2i = open[best]
		open.remove_at(best)
		if cur == goal:
			return _reconstruct(came, cur, start)
		for d in neighbors:
			var nb: Vector2i = cur + d
			if nb.x < 0 or nb.y < 0 or nb.x >= int(MAP_MAX) or nb.y >= int(MAP_MAX):
				continue
			if blocked.has(nb):
				continue
			var step_cost := 1.4142 if (d.x != 0 and d.y != 0) else 1.0
			var tentative: float = float(g[cur]) + step_cost
			if not g.has(nb) or tentative < float(g[nb]):
				g[nb] = tentative
				came[nb] = cur
				if not open.has(nb):
					open.append(nb)
	return []


func _heuristic(a: Vector2i, b: Vector2i) -> float:
	return Vector2(a.x, a.y).distance_to(Vector2(b.x, b.y))


func _reconstruct(came: Dictionary, cur: Vector2i, start: Vector2i) -> Array:
	var cells := [cur]
	while came.has(cur):
		cur = came[cur]
		cells.push_front(cur)
	# start 제외한 웨이포인트만 반환
	var out: Array = []
	for i in range(1, cells.size()):
		var c: Vector2i = cells[i]
		out.append(Vector3(c.x, 0.0, c.y))
	return out
