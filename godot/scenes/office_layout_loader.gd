class_name OfficeLayoutLoader
extends Node3D

## office_layout(05 스키마 v1.1) → 3D 씬 구성 + 아바타/서버 소비용 파생 데이터.
##
## 참조:
## - docs/data-model/office-layout-schema.json (정본 JSON Schema, Draft 2020-12)
## - 05-office-layout-schema.md: floor/dimensions/rooms/seats/furniture/colliders/spawn_points
## - 00-decisions.md: D9(방 벽=경계 자동생성 + doors[] 개구부), D10(좌석), D12(서버 단일 검증),
##                    D25(좌표계 top_left·미터·2D), D3(클라 A* + 서버 권위)
##
## D12: **클라이언트는 검증하지 않고 신뢰**한다. FastAPI가 이미 정밀 검증(ERROR 없음)한
##      layout만 배포되므로, 이 로더는 재검증 없이 기하만 생성한다.
##
## 좌표 매핑(D25): layout 2D (x, y) → Godot 월드 (x, floor_height, z=y).
##   +X=동, +Z(=layout y)=남. 아바타는 position.x / position.z 평면에서 이동한다.
##   A* 격자(avatar.gd)는 1m 셀 Vector2i(round(x), round(z))를 쓰므로 여기 파생도 1m 격자다.

const WALL_HEIGHT := 3.0        ## 방 벽/콜라이더 배치 높이(m)
const WALL_THICKNESS := 0.2     ## 방 벽 두께(m)
const FLOOR_THICKNESS := 0.2    ## 바닥 슬래브 두께(m)

## 골든 샘플 시각 팔레트(P1). GLB 에셋 투입 전까지 프리미티브+머티리얼로 렌더한다.
const COLOR_FLOOR := Color(0.10, 0.11, 0.13)
const COLOR_WALL := Color(0.20, 0.22, 0.27)
const COLOR_FURNITURE := Color(0.96, 0.62, 0.11)
const COLOR_ROOM := Color(0.39, 0.40, 0.95, 0.35)  ## 유리벽 반투명
const COLOR_SEAT := Color(0.13, 0.77, 0.37)
const COLOR_SPAWN := Color(0.94, 0.27, 0.27)

## build() 산출물 -----------------------------------------------------------
## build() 산출물. Vector3 pos는 y=floor_height 평면(D25: layout y → Godot z).
var seats: Array = []              ## [{ id, pos:Vector3, facing, assigned:bool, seat_db_id }]
var spawn_points_out: Array = []   ## [{ id, pos:Vector3, facing }]
var rooms_out: Array = []          ## [{ id, name, type, coords }]
var obstacle_cells: Array[Vector2i] = []  ## A* 1m 격자 차단 셀(콜라이더+가구+방벽−문)
var floor_height: float = 0.0

## true면 가구/좌석을 프리미티브 박스로 렌더(기본). false면 시각 메시 생략(충돌만) —
## 실 GLB 에셋(office_visuals.gd)이 대신 배치할 때 사용.
var primitive_furniture: bool = true


# ============================================================================
# 진입점
# ============================================================================

## layout(파싱 완료 Dictionary)로 3D 씬을 구성하고 파생 데이터를 채운다.
func build(layout: Dictionary) -> void:
	var floor_data: Dictionary = layout.get("floor", {})
	floor_height = float(floor_data.get("floor_height_m", 0.0))

	_build_floor(layout)
	_build_colliders(layout)
	_build_rooms(layout)
	_build_furniture(layout)
	_build_seats(layout)
	_build_spawns(layout)

	obstacle_cells = derive_obstacle_cells(layout)


## JSON 문자열 → layout Dictionary(파싱 실패 시 빈 Dictionary).
static func parse_json(text: String) -> Dictionary:
	var json := JSON.new()
	if json.parse(text) != OK:
		return {}
	var data = json.data
	if typeof(data) == TYPE_DICTIONARY:
		return data
	return {}


## 파일(res:// 등) → layout Dictionary(없거나 실패 시 빈 Dictionary).
static func load_file(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var text := f.get_as_text()
	f.close()
	return parse_json(text)


# ============================================================================
# 순수 기하 파생 (Godot 없이도 검증되도록 static·부작용 없음)
# ============================================================================

## 콜라이더(block_avatar) + 충돌 가구 + 방 벽(문 개구부 제외)에서 A* 차단 셀 파생.
static func derive_obstacle_cells(layout: Dictionary) -> Array[Vector2i]:
	var seen := {}
	var out: Array[Vector2i] = []
	var rects: Array[Rect2] = []
	rects.append_array(collider_rects(layout))
	rects.append_array(furniture_rects(layout))
	rects.append_array(room_wall_rects(layout))
	for r in rects:
		for cell in cells_for_rect(r):
			if not seen.has(cell):
				seen[cell] = true
				out.append(cell)
	return out


## 아바타 소비용 좌석 목록. assigned는 항상 false(D10: 배정은 seat_assignment DB 소유,
## layout에 없음 — 런타임에 seat_db_id로 조회).
static func derive_seats(layout: Dictionary) -> Array:
	var out: Array = []
	for s in layout.get("seats", []):
		var c: Dictionary = s.get("coords", {})
		out.append({
			"id": s.get("seat_id", ""),
			"pos": Vector3(float(c.get("x", 0.0)), 0.0, float(c.get("y", 0.0))),
			"facing": float(s.get("facing", 0.0)),
			"assigned": false,
			"seat_db_id": s.get("seat_db_id", ""),
		})
	return out


## 스폰 지점 목록.
static func derive_spawns(layout: Dictionary) -> Array:
	var out: Array = []
	for sp in layout.get("spawn_points", []):
		var c: Dictionary = sp.get("coords", {})
		out.append({
			"id": sp.get("spawn_id", ""),
			"pos": Vector3(float(c.get("x", 0.0)), 0.0, float(c.get("y", 0.0))),
			"facing": float(sp.get("facing", 0.0)),
		})
	return out


## block_avatar 콜라이더의 AABB Rect2 목록(box는 직접, polygon은 AABB 근사).
static func collider_rects(layout: Dictionary) -> Array[Rect2]:
	var out: Array[Rect2] = []
	for c in layout.get("colliders", []):
		var physics: Dictionary = c.get("physics", {})
		if physics.get("block_avatar", true) == false:
			continue
		var shape: String = c.get("shape", "")
		if shape == "box":
			var b: Dictionary = c.get("box", {})
			out.append(Rect2(
				float(b.get("x", 0.0)), float(b.get("y", 0.0)),
				float(b.get("width", 0.0)), float(b.get("height", 0.0)),
			))
		elif shape == "polygon":
			var pts: Array = c.get("polygon", [])
			var aabb := _polygon_aabb(pts)
			if aabb.size.x > 0.0 and aabb.size.y > 0.0:
				out.append(aabb)
	return out


## 충돌(collision != false) 가구의 AABB Rect2 목록. coords는 중심, dimension은 폭/깊이.
static func furniture_rects(layout: Dictionary) -> Array[Rect2]:
	var out: Array[Rect2] = []
	for f in layout.get("furniture", []):
		if f.get("collision", true) == false:
			continue
		var c: Dictionary = f.get("coords", {})
		var d: Dictionary = f.get("dimension", {})
		var w := float(d.get("width", 1.0))
		var depth := float(d.get("depth", 1.0))
		out.append(Rect2(
			float(c.get("x", 0.0)) - w / 2.0,
			float(c.get("y", 0.0)) - depth / 2.0,
			w, depth,
		))
	return out


## 모든 방의 벽 세그먼트 Rect2 목록(문 개구부 구간은 제외됨, D9).
static func room_wall_rects(layout: Dictionary) -> Array[Rect2]:
	var out: Array[Rect2] = []
	for room in layout.get("rooms", []):
		out.append_array(wall_segments(room))
	return out


## 방 하나의 벽 세그먼트 Rect2 목록. 4변을 두께 WALL_THICKNESS 박스로 만들되,
## 각 변의 doors[] 개구부(offset ± width/2) 구간을 빼서 통로를 만든다(D9).
static func wall_segments(room: Dictionary) -> Array[Rect2]:
	var out: Array[Rect2] = []
	var c: Dictionary = room.get("coords", {})
	var rx := float(c.get("x", 0.0))
	var ry := float(c.get("y", 0.0))
	var rw := float(c.get("width", 0.0))
	var rh := float(c.get("height", 0.0))
	var doors: Array = room.get("doors", [])
	var t := WALL_THICKNESS

	# north(y=ry) / south(y=ry+rh): 수평 벽, x∈[0, rw] 구간을 문으로 분할.
	for pair in [["north", ry], ["south", ry + rh]]:
		var wall := str(pair[0])
		var yline := float(pair[1])
		for seg in _subtract_gaps(0.0, rw, _door_gaps(doors, wall)):
			out.append(Rect2(rx + seg.x, yline - t / 2.0, seg.y - seg.x, t))

	# west(x=rx) / east(x=rx+rw): 수직 벽, y∈[0, rh] 구간을 문으로 분할.
	for pair in [["west", rx], ["east", rx + rw]]:
		var wall := str(pair[0])
		var xline := float(pair[1])
		for seg in _subtract_gaps(0.0, rh, _door_gaps(doors, wall)):
			out.append(Rect2(xline - t / 2.0, ry + seg.x, t, seg.y - seg.x))

	return out


## Rect2가 덮는 1m 격자 셀 목록. 셀 i는 정수 중심 ±0.5로 간주(avatar.gd의 round() 매핑 정합).
static func cells_for_rect(r: Rect2) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var x := r.position.x
	var y := r.position.y
	var w := r.size.x
	var h := r.size.y
	var lo_i := int(floor(x - 0.5))
	var hi_i := int(ceil(x + w + 0.5))
	var lo_j := int(floor(y - 0.5))
	var hi_j := int(ceil(y + h + 0.5))
	for i in range(lo_i, hi_i + 1):
		if not ((i + 0.5) > x and (i - 0.5) < x + w):
			continue
		for j in range(lo_j, hi_j + 1):
			if (j + 0.5) > y and (j - 0.5) < y + h:
				out.append(Vector2i(i, j))
	return out


# --- 순수 헬퍼 -------------------------------------------------------------

## 특정 벽의 문 개구부 [start,end] 구간(벽 시작 모서리 기준) 목록.
static func _door_gaps(doors: Array, wall: String) -> Array:
	var gaps: Array = []
	for d in doors:
		if d.get("wall", "") == wall:
			var off := float(d.get("offset", 0.0))
			var hw := float(d.get("width", 0.0)) / 2.0
			gaps.append(Vector2(off - hw, off + hw))
	return gaps


## [a,b] 구간에서 gaps(각 Vector2(start,end))를 뺀 나머지 구간(Vector2(start,end)) 목록.
static func _subtract_gaps(a: float, b: float, gaps: Array) -> Array:
	var segs: Array = [Vector2(a, b)]
	for g in gaps:
		var next: Array = []
		for s in segs:
			var s0: float = s.x
			var s1: float = s.y
			if g.y <= s0 or g.x >= s1:
				next.append(s)
				continue
			if g.x > s0:
				next.append(Vector2(s0, min(g.x, s1)))
			if g.y < s1:
				next.append(Vector2(max(g.y, s0), s1))
		segs = next
	var out: Array = []
	for s in segs:
		if s.y - s.x > 0.000001:
			out.append(s)
	return out


static func _polygon_aabb(pts: Array) -> Rect2:
	if pts.is_empty():
		return Rect2(0, 0, 0, 0)
	var min_x := INF
	var min_y := INF
	var max_x := -INF
	var max_y := -INF
	for p in pts:
		var px := float(p.get("x", 0.0))
		var py := float(p.get("y", 0.0))
		min_x = minf(min_x, px)
		min_y = minf(min_y, py)
		max_x = maxf(max_x, px)
		max_y = maxf(max_y, py)
	return Rect2(min_x, min_y, max_x - min_x, max_y - min_y)


# ============================================================================
# 3D 노드 생성 (부작용: self의 자식으로 추가)
# ============================================================================

func _build_floor(layout: Dictionary) -> void:
	var dim: Dictionary = layout.get("dimensions", {})
	var w := float(dim.get("width_m", float(dim.get("max_x", 0.0)) - float(dim.get("min_x", 0.0))))
	var h := float(dim.get("height_m", float(dim.get("max_y", 0.0)) - float(dim.get("min_y", 0.0))))
	var min_x := float(dim.get("min_x", 0.0))
	var min_y := float(dim.get("min_y", 0.0))
	if w <= 0.0 or h <= 0.0:
		return
	var body := StaticBody3D.new()
	body.name = "Floor"
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(w, FLOOR_THICKNESS, h)
	cs.shape = box
	body.add_child(cs)
	add_child(body)
	body.position = Vector3(min_x + w / 2.0, floor_height - FLOOR_THICKNESS / 2.0, min_y + h / 2.0)
	_attach_box_mesh(body, Vector3(w, FLOOR_THICKNESS, h), COLOR_FLOOR)


func _build_colliders(layout: Dictionary) -> void:
	var i := 0
	for r in collider_rects(layout):
		_add_solid("Collider_%d" % i, r, WALL_HEIGHT)
		i += 1


func _build_rooms(layout: Dictionary) -> void:
	for room in layout.get("rooms", []):
		var rid: String = room.get("room_id", "")
		rooms_out.append({
			"id": rid,
			"name": room.get("name", ""),
			"type": room.get("type", ""),
			"coords": room.get("coords", {}),
		})
		var seg := 0
		for r in wall_segments(room):
			_add_solid("Wall_%s_%d" % [rid, seg], r, WALL_HEIGHT, "room")
			seg += 1


func _build_furniture(layout: Dictionary) -> void:
	for f in layout.get("furniture", []):
		if f.get("collision", true) == false:
			continue
		var c: Dictionary = f.get("coords", {})
		var d: Dictionary = f.get("dimension", {})
		var w := float(d.get("width", 1.0))
		var depth := float(d.get("depth", 1.0))
		var height := float(d.get("height", WALL_HEIGHT))
		var rect := Rect2(
			float(c.get("x", 0.0)) - w / 2.0,
			float(c.get("y", 0.0)) - depth / 2.0,
			w, depth,
		)
		_add_solid("Furniture_%s" % str(f.get("furniture_id", "")), rect, height, "furniture", primitive_furniture)


func _build_seats(layout: Dictionary) -> void:
	seats = derive_seats(layout)
	for s in seats:
		var m := Marker3D.new()
		m.name = "Seat_%s" % str(s["id"])
		add_child(m)
		m.position = Vector3(s["pos"].x, floor_height, s["pos"].z)
		if primitive_furniture:
			_attach_box_mesh(m, Vector3(0.5, 0.1, 0.5), COLOR_SEAT)


func _build_spawns(layout: Dictionary) -> void:
	spawn_points_out = derive_spawns(layout)
	for sp in spawn_points_out:
		var m := Marker3D.new()
		m.name = "Spawn_%s" % str(sp["id"])
		add_child(m)
		m.position = Vector3(sp["pos"].x, floor_height, sp["pos"].z)
		_attach_box_mesh(m, Vector3(0.3, 0.1, 0.3), COLOR_SPAWN)


## Rect2(2D) + 높이로 정적 충돌체를 만들어 self에 부착. kind로 시각 머티리얼 색을 지정.
func _add_solid(node_name: String, rect: Rect2, height: float, kind := "wall", visual := true) -> StaticBody3D:
	var center := Vector3(
		rect.position.x + rect.size.x / 2.0,
		floor_height + height / 2.0,
		rect.position.y + rect.size.y / 2.0,
	)
	var size := Vector3(maxf(rect.size.x, 0.01), height, maxf(rect.size.y, 0.01))
	var body := OfficeBuilder.wall(self, center, size)
	body.name = node_name
	if visual:
		_attach_box_mesh(body, size, _color_for(kind))
	return body


## 정적 팔레트에서 kind별 색 반환.
static func _color_for(kind: String) -> Color:
	match kind:
		"furniture": return COLOR_FURNITURE
		"room": return COLOR_ROOM
		"floor": return COLOR_FLOOR
		"seat": return COLOR_SEAT
		"spawn": return COLOR_SPAWN
		_: return COLOR_WALL


## body에 BoxMesh MeshInstance3D + StandardMaterial3D(색)를 부착(골든 샘플 렌더).
static func _attach_box_mesh(body: Node3D, size: Vector3, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	var mesh := BoxMesh.new()
	mesh.size = size
	mi.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	if color.a < 1.0:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mi.material_override = mat
	body.add_child(mi)
	return mi
