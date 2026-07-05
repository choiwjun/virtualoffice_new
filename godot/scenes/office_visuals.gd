class_name OfficeVisuals
extends RefCounted

## 데이터 기반 실사 GLB 배치 (2번 방향). office_layout의 furniture/seat/dimensions를 읽어
## Poly Haven CC0 모델을 인스턴싱한다. 배치가 바뀌면(좌석/방 편집→배포) 그대로 반영된다.
## 조명은 스튜디오 HDRI로 이미지기반(IBL) — 실사급 앰비언트/반사.

const MODELS := {
	"desk": "res://assets/models/WoodenTable_01/WoodenTable_01.gltf",
	"chair": "res://assets/models/ArmChair_01/ArmChair_01.gltf",
	"sofa": "res://assets/models/Sofa_01/Sofa_01.gltf",
	"coffee_table": "res://assets/models/CoffeeTable_01/CoffeeTable_01.gltf",
	"plant_a": "res://assets/models/potted_plant_01/potted_plant_01.gltf",
	"plant_b": "res://assets/models/potted_plant_02/potted_plant_02.gltf",
	"shelf": "res://assets/models/Shelf_01/Shelf_01.gltf",
	"lamp": "res://assets/models/desk_lamp_arm_01/desk_lamp_arm_01.gltf",
}
const HDRI := "res://assets/hdri/brown_photostudio_02.hdr"
const FLOOR_TEX := "res://assets/textures/diagonal_parquet/"


## 로더가 만든 "Floor"에 실사 목재 마루 재질을 입힌다(타일링).
static func apply_floor_material(parent: Node3D) -> void:
	var floor_body := parent.find_child("Floor", true, false)
	if floor_body == null:
		return
	var mesh := floor_body.find_child("Mesh", true, false)
	if mesh == null or not (mesh is MeshInstance3D):
		return
	var mat := StandardMaterial3D.new()
	var diff := FLOOR_TEX + "diffuse.jpg"
	if ResourceLoader.exists(diff):
		mat.albedo_texture = load(diff)
	var nrm := FLOOR_TEX + "normal.jpg"
	if ResourceLoader.exists(nrm):
		mat.normal_enabled = true
		mat.normal_texture = load(nrm)
	var rgh := FLOOR_TEX + "rough.jpg"
	if ResourceLoader.exists(rgh):
		mat.roughness_texture = load(rgh)
	# 30x20m 바닥에 ~2m 간격 타일링
	mat.uv1_scale = Vector3(15.0, 10.0, 1.0)
	mat.metallic = 0.0
	mat.roughness = 0.85
	(mesh as MeshInstance3D).material_override = mat


static func _instance(id: String) -> Node3D:
	var path: String = MODELS.get(id, "")
	if path == "" or not ResourceLoader.exists(path):
		return null
	var packed := load(path)
	if packed == null:
		return null
	return packed.instantiate()


## 회색 벽 재질(외곽 벽/리셉션 카운터 공용).
static func _wall_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.82, 0.82, 0.86)
	m.roughness = 0.9
	m.metallic = 0.0
	return m


## 축 정렬 박스(위치=바닥에 놓이는 하단 기준). 시각 전용(충돌은 로더가 담당).
static func _box(parent: Node3D, center: Vector3, size: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = center
	parent.add_child(mi)


## dimensions에서 외곽 벽 4면을 파생 생성(입구는 앞면 중앙을 개방). 레이아웃이 바뀌면 그대로 반영.
static func build_perimeter_walls(layout: Dictionary, parent: Node3D, floor_height: float) -> void:
	var dim: Dictionary = layout.get("dimensions", {})
	var minx := float(dim.get("min_x", 0.0))
	var miny := float(dim.get("min_y", 0.0))
	var maxx := float(dim.get("max_x", minx + float(dim.get("width_m", 30.0))))
	var maxy := float(dim.get("max_y", miny + float(dim.get("height_m", 20.0))))
	var h := 3.0
	var t := 0.2
	var cy := floor_height + h * 0.5
	var mat := _wall_material()
	var w := maxx - minx
	var d := maxy - miny
	var cx := (minx + maxx) * 0.5
	var cz := (miny + maxy) * 0.5
	# 뒷벽(miny), 좌벽(minx), 우벽(maxx) — 전체 길이
	_box(parent, Vector3(cx, cy, miny), Vector3(w, h, t), mat)
	_box(parent, Vector3(minx, cy, cz), Vector3(t, h, d), mat)
	_box(parent, Vector3(maxx, cy, cz), Vector3(t, h, d), mat)
	# 앞벽(maxy) — 중앙 4m 입구 개방 → 좌/우 두 조각
	var gap := 4.0
	var seg := (w - gap) * 0.5
	if seg > 0.1:
		_box(parent, Vector3(minx + seg * 0.5, cy, maxy), Vector3(seg, h, t), mat)
		_box(parent, Vector3(maxx - seg * 0.5, cy, maxy), Vector3(seg, h, t), mat)


## 리셉션: 입구 안쪽에 L자 카운터 + 뒤 선반. spawn_default(로비) 근처에 배치.
static func build_reception(layout: Dictionary, parent: Node3D, floor_height: float) -> void:
	var dim: Dictionary = layout.get("dimensions", {})
	var maxy := float(dim.get("max_y", float(dim.get("height_m", 20.0))))
	var minx := float(dim.get("min_x", 0.0))
	var maxx := float(dim.get("max_x", float(dim.get("width_m", 30.0))))
	var cx := (minx + maxx) * 0.5
	var mat := _wall_material()
	var top := floor_height + 1.1
	# 입구 안쪽(로비) 카운터 — 정면 + 측면
	var fz := maxy - 3.0
	_box(parent, Vector3(cx, floor_height + 0.55, fz), Vector3(3.2, 1.1, 0.5), mat)
	_box(parent, Vector3(cx - 1.6, floor_height + 0.55, fz - 1.0), Vector3(0.5, 1.1, 2.0), mat)
	# 카운터 상판(밝은 나무톤)
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color(0.55, 0.40, 0.26)
	wood.roughness = 0.6
	_box(parent, Vector3(cx, top, fz), Vector3(3.4, 0.06, 0.6), wood)
	# 뒤 선반(GLB)
	var shelf := _instance("shelf")
	if shelf:
		parent.add_child(shelf)
		shelf.position = Vector3(cx, floor_height, fz - 1.6)
		shelf.rotation.y = PI


## 레이아웃 furniture(=책상)·seat(=의자)·장식(화분/소파)을 GLB로 배치한다.
static func populate(layout: Dictionary, parent: Node3D, floor_height: float) -> int:
	var placed := 0
	apply_floor_material(parent)
	build_perimeter_walls(layout, parent, floor_height)
	build_reception(layout, parent, floor_height)

	# 1) 가구(책상) — furniture.coords에 desk 모델
	for f in layout.get("furniture", []):
		var c: Dictionary = f.get("coords", {})
		var desk := _instance("desk")
		if desk:
			parent.add_child(desk)
			desk.position = Vector3(float(c.get("x", 0.0)), floor_height, float(c.get("y", 0.0)))
			placed += 1
		var lamp := _instance("lamp")
		if lamp:
			parent.add_child(lamp)
			lamp.position = Vector3(float(c.get("x", 0.0)) + 0.4, floor_height + 0.75, float(c.get("y", 0.0)))
			lamp.scale = Vector3(0.7, 0.7, 0.7)

	# 2) 좌석(의자) — seat.coords에 chair, facing 방향으로 회전(책상 앞에 배치되도록 약간 오프셋)
	for s in layout.get("seats", []):
		var sc: Dictionary = s.get("coords", {})
		var facing := deg_to_rad(float(s.get("facing", 0.0)))
		var chair := _instance("chair")
		if chair:
			parent.add_child(chair)
			var ox := sin(facing) * 0.55
			var oz := cos(facing) * 0.55
			chair.position = Vector3(float(sc.get("x", 0.0)) + ox, floor_height, float(sc.get("y", 0.0)) + oz)
			chair.rotation.y = facing + PI
			placed += 1

	# 3) 장식 — 바닥 모서리에 화분, 여유 공간에 소파+커피테이블(라운지)
	var dim: Dictionary = layout.get("dimensions", {})
	var minx := float(dim.get("min_x", 0.0))
	var miny := float(dim.get("min_y", 0.0))
	var maxx := float(dim.get("max_x", minx + float(dim.get("width_m", 20.0))))
	var maxy := float(dim.get("max_y", miny + float(dim.get("height_m", 15.0))))
	var plant_spots := [
		Vector2(minx + 1.2, miny + 1.2), Vector2(maxx - 1.2, miny + 1.2),
		Vector2(minx + 1.2, maxy - 1.2), Vector2(maxx - 1.2, maxy - 1.2),
	]
	var i := 0
	for p in plant_spots:
		var plant := _instance("plant_a" if i % 2 == 0 else "plant_b")
		if plant:
			parent.add_child(plant)
			plant.position = Vector3(p.x, floor_height, p.y)
			placed += 1
		i += 1

	# 라운지: 바닥 앞쪽 중앙에 소파 + 커피테이블
	var lounge := Vector2((minx + maxx) * 0.5, maxy - 3.0)
	var sofa := _instance("sofa")
	if sofa:
		parent.add_child(sofa)
		sofa.position = Vector3(lounge.x, floor_height, lounge.y)
		placed += 1
	var ctable := _instance("coffee_table")
	if ctable:
		parent.add_child(ctable)
		ctable.position = Vector3(lounge.x, floor_height, lounge.y - 1.4)
		placed += 1

	return placed


## 스튜디오 HDRI 기반 환경(IBL) + 보조 광원. Forward+/Compatibility 모두 동작.
static func setup_environment(parent: Node3D) -> void:
	var env := Environment.new()
	# 배경은 어두운 단색(오피스가 '떠 보이는' HDRI 배경 방지), 조명/반사만 HDRI(IBL)로.
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.10, 0.12, 0.17)
	if ResourceLoader.exists(HDRI):
		var sky_tex := load(HDRI)
		var sky_mat := PanoramaSkyMaterial.new()
		sky_mat.panorama = sky_tex
		var sky := Sky.new()
		sky.sky_material = sky_mat
		env.sky = sky
		env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		env.ambient_light_energy = 0.5
		env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	else:
		env.ambient_light_color = Color(0.7, 0.72, 0.8)
		env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.ssao_enabled = true
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)

	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-52, -38, 0)
	light.light_energy = 1.05
	light.shadow_enabled = true
	parent.add_child(light)
