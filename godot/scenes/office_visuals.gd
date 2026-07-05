class_name OfficeVisuals
extends RefCounted

## 데이터 기반 실사 GLB 배치 (2번 방향). office_layout의 furniture/seat/dimensions를 읽어
## Poly Haven CC0 모델을 인스턴싱한다. 배치가 바뀌면(좌석/방 편집→배포) 그대로 반영된다.
## 조명은 스튜디오 HDRI로 이미지기반(IBL) — 실사급 앰비언트/반사.

const MODELS := {
	"desk": "res://assets/models/metal_office_desk/metal_office_desk.gltf",
	"chair": "res://assets/models/modern_arm_chair_01/modern_arm_chair_01.gltf",
	"sofa": "res://assets/models/sofa_02/sofa_02.gltf",
	"coffee_table": "res://assets/models/modern_coffee_table_01/modern_coffee_table_01.gltf",
	"plant_a": "res://assets/models/potted_plant_04/potted_plant_04.gltf",
	"plant_b": "res://assets/models/potted_plant_01/potted_plant_01.gltf",
	"plant_c": "res://assets/models/nettle_plant/nettle_plant.gltf",
	"shelf": "res://assets/models/wooden_bookshelf_worn/wooden_bookshelf_worn.gltf",
	"lamp": "res://assets/models/desk_lamp_arm_01/desk_lamp_arm_01.gltf",
	"clock": "res://assets/models/wall_clock/wall_clock.gltf",
	"frame": "res://assets/models/hanging_picture_frame_02/hanging_picture_frame_02.gltf",
	"projector": "res://assets/models/projector_screen/projector_screen.gltf",
	"cabinet": "res://assets/models/drawer_cabinet/drawer_cabinet.gltf",
}
const HDRI := "res://assets/hdri/brown_photostudio_02.hdr"
const FLOOR_TEX := "res://assets/textures/wooden_planks/"
const WALL_TEX := "res://assets/textures/wood_planks/"


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
		mat.normal_scale = 0.8
	var rgh := FLOOR_TEX + "rough.jpg"
	if ResourceLoader.exists(rgh):
		mat.roughness_texture = load(rgh)
	# 밝고 차분한 우드톤(시안의 밝은 마루) — 텍스처 × albedo_color
	mat.albedo_color = Color(0.86, 0.80, 0.72)
	# 마루 타일링
	mat.uv1_scale = Vector3(10.0, 7.0, 1.0)
	mat.metallic = 0.0
	mat.roughness = 0.9  # 무광 — 반사 핫스팟 방지
	(mesh as MeshInstance3D).material_override = mat


static func _instance(id: String) -> Node3D:
	var path: String = MODELS.get(id, "")
	if path == "" or not ResourceLoader.exists(path):
		return null
	var packed := load(path)
	if packed == null:
		return null
	return packed.instantiate()


## 따뜻한 오프화이트 벽 재질(외곽 벽/리셉션 카운터 공용).
static func _wall_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.74, 0.72, 0.69)  # 따뜻한 오프화이트(순백 클리핑 방지)
	m.roughness = 0.95
	m.metallic = 0.0
	return m


## 브랜드 강조 재질(발광 스트립/브랜드월용).
static func _brand_material(emissive := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.28, 0.30, 0.55)  # 브랜드 인디고 계열
	m.roughness = 0.55
	if emissive:
		m.emission_enabled = true
		m.emission = Color(0.39, 0.40, 0.95)
		m.emission_energy_multiplier = 1.6
	return m


## 우드 슬랫 벽 재질(시안의 ACME 우드월). WALL_TEX 목재 판자 텍스처.
static func _wood_wall_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	var diff := WALL_TEX + "diffuse.jpg"
	if ResourceLoader.exists(diff):
		m.albedo_texture = load(diff)
	var nrm := WALL_TEX + "normal.jpg"
	if ResourceLoader.exists(nrm):
		m.normal_enabled = true
		m.normal_texture = load(nrm)
	var rgh := WALL_TEX + "rough.jpg"
	if ResourceLoader.exists(rgh):
		m.roughness_texture = load(rgh)
	m.albedo_color = Color(0.80, 0.66, 0.48)  # 따뜻한 우드톤
	m.uv1_scale = Vector3(3.0, 2.0, 1.0)
	m.roughness = 0.7
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


## 책상 위 모니터(스탠드 + 발광 스크린). 데스크 상판 높이(~0.75)에 배치.
static func _add_monitor(parent: Node3D, x: float, z: float, floor_height: float) -> void:
	var top := floor_height + 0.75
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.06, 0.07, 0.09)
	dark.roughness = 0.4
	# 받침 + 목
	_box(parent, Vector3(x, top + 0.02, z + 0.25), Vector3(0.24, 0.02, 0.16), dark)
	_box(parent, Vector3(x, top + 0.14, z + 0.25), Vector3(0.04, 0.24, 0.04), dark)
	# 패널(베젤)
	_box(parent, Vector3(x, top + 0.30, z + 0.27), Vector3(0.62, 0.36, 0.03), dark)
	# 스크린(발광)
	var screen := StandardMaterial3D.new()
	screen.albedo_color = Color(0.20, 0.42, 0.60)
	screen.emission_enabled = true
	screen.emission = Color(0.35, 0.62, 0.85)
	screen.emission_energy_multiplier = 1.1
	_box(parent, Vector3(x, top + 0.30, z + 0.255), Vector3(0.56, 0.31, 0.01), screen)


## 평평한 러그(바닥 위 얇은 박스).
static func _add_rug(parent: Node3D, cx: float, cz: float, w: float, d: float, floor_height: float, col: Color) -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 1.0
	_box(parent, Vector3(cx, floor_height + 0.02, cz), Vector3(w, 0.04, d), m)


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
	# 브랜드월: 뒷벽 좌측에 우드 슬랫 패널(ACME 우드월) + 상단 은은한 LED 스트립
	var bw: float = min(9.0, w * 0.35)
	_box(parent, Vector3(minx + bw * 0.5 + 0.4, cy, miny + 0.10), Vector3(bw, h - 0.2, 0.12), _wood_wall_material())
	_box(parent, Vector3(minx + bw * 0.5 + 0.4, floor_height + h - 0.25, miny + 0.14), Vector3(bw, 0.08, 0.05), _brand_material(true))


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

	# 1) 가구(책상) — furniture.coords에 desk 모델 + 모니터(발광 스크린) + 램프
	for f in layout.get("furniture", []):
		var ftype := String(f.get("type", "desk"))
		if ftype != "desk":
			continue  # 화분 등은 별도 처리
		var c: Dictionary = f.get("coords", {})
		var fx := float(c.get("x", 0.0))
		var fz := float(c.get("y", 0.0))
		var desk := _instance("desk")
		if desk:
			parent.add_child(desk)
			desk.position = Vector3(fx, floor_height, fz)
			placed += 1
		_add_monitor(parent, fx, fz, floor_height)
		var lamp := _instance("lamp")
		if lamp:
			parent.add_child(lamp)
			lamp.position = Vector3(fx + 0.45, floor_height + 0.75, fz - 0.2)
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

	# 3) 회의실 집기 — 각 room 내부에 테이블 + 의자(오른쪽 빈 공간 채움)
	for r in layout.get("rooms", []):
		placed += _furnish_room(r, parent, floor_height)

	# 4) 장식 — 벽면 화분, 라운지(소파+커피테이블+러그)
	var dim: Dictionary = layout.get("dimensions", {})
	var minx := float(dim.get("min_x", 0.0))
	var miny := float(dim.get("min_y", 0.0))
	var maxx := float(dim.get("max_x", minx + float(dim.get("width_m", 20.0))))
	var maxy := float(dim.get("max_y", miny + float(dim.get("height_m", 15.0))))
	var plant_spots := [
		Vector2(minx + 1.0, miny + 1.0), Vector2(maxx - 1.0, miny + 1.0),
		Vector2(minx + 1.0, maxy - 1.0), Vector2(maxx - 1.0, maxy - 1.0),
		Vector2(minx + 1.0, (miny + maxy) * 0.5),
	]
	var i := 0
	for p in plant_spots:
		var plant := _instance("plant_a" if i % 2 == 0 else "plant_b")
		if plant:
			parent.add_child(plant)
			plant.position = Vector3(p.x, floor_height, p.y)
			placed += 1
		i += 1

	# 라운지: 오른쪽 하단 빈 공간(회의실 아래)에 러그 + 소파 + 커피테이블
	var lounge := Vector2(maxx - 5.0, maxy - 4.0)
	_add_rug(parent, lounge.x, lounge.y, 5.0, 4.0, floor_height, Color(0.20, 0.24, 0.34))
	var sofa := _instance("sofa")
	if sofa:
		parent.add_child(sofa)
		sofa.position = Vector3(lounge.x, floor_height, lounge.y + 1.2)
		placed += 1
	var ctable := _instance("coffee_table")
	if ctable:
		parent.add_child(ctable)
		ctable.position = Vector3(lounge.x, floor_height, lounge.y - 0.3)
		placed += 1
	var lplant := _instance("plant_c")
	if lplant:
		parent.add_child(lplant)
		lplant.position = Vector3(lounge.x + 2.2, floor_height, lounge.y + 1.4)
		placed += 1

	# 5) 벽면 데코 — 책장(좌벽) + 서랍장(뒷벽) + 벽시계 + 액자 + 추가 화분
	var back := miny + 0.35
	var shelf1 := _instance("shelf")
	if shelf1:
		parent.add_child(shelf1)
		shelf1.position = Vector3(minx + 0.4, floor_height, miny + (maxy - miny) * 0.55)
		shelf1.rotation.y = -PI * 0.5  # 좌벽을 등지도록
		placed += 1
	var cab1 := _instance("cabinet")
	if cab1:
		parent.add_child(cab1)
		cab1.position = Vector3(minx + (maxx - minx) * 0.62, floor_height, back)
		placed += 1
	var cab2 := _instance("cabinet")
	if cab2:
		parent.add_child(cab2)
		cab2.position = Vector3(minx + (maxx - minx) * 0.75, floor_height, back)
		placed += 1
	var clock := _instance("clock")
	if clock:
		parent.add_child(clock)
		clock.position = Vector3(minx + (maxx - minx) * 0.68, floor_height + 2.2, miny + 0.18)
		placed += 1
	var frame := _instance("frame")
	if frame:
		parent.add_child(frame)
		frame.position = Vector3(minx + (maxx - minx) * 0.55, floor_height + 1.8, miny + 0.18)
		placed += 1
	# 화분 추가(라운지·중앙 통로)
	for pc in [Vector2((minx + maxx) * 0.5, miny + 1.0), Vector2(maxx - 2.0, (miny + maxy) * 0.5)]:
		var pl := _instance("plant_c")
		if pl:
			parent.add_child(pl)
			pl.position = Vector3(pc.x, floor_height, pc.y)
			placed += 1

	return placed


## 회의실 하나에 중앙 테이블 + 둘레 의자 배치(coords: 방 좌상단 x,y + width,height).
static func _furnish_room(room: Dictionary, parent: Node3D, floor_height: float) -> int:
	var c: Dictionary = room.get("coords", {})
	if c.is_empty():
		return 0
	var rx := float(c.get("x", 0.0))
	var ry := float(c.get("y", 0.0))
	var rw := float(c.get("width", 4.0))
	var rh := float(c.get("height", 4.0))
	var cx := rx + rw * 0.5
	var cz := ry + rh * 0.5
	var n := 0
	# 중앙 테이블(커피테이블 GLB를 스케일업하여 회의 테이블로)
	var table := _instance("coffee_table")
	if table:
		parent.add_child(table)
		table.position = Vector3(cx, floor_height, cz)
		table.scale = Vector3(1.7, 1.3, 1.2)
		n += 1
	# 테이블 둘레 의자 4개(상/하/좌/우)
	var offs := [
		Vector3(0, 0, -1.2), Vector3(0, 0, 1.2),
		Vector3(-1.4, 0, 0), Vector3(1.4, 0, 0),
	]
	var yaws := [0.0, PI, PI * 0.5, -PI * 0.5]
	for k in range(offs.size()):
		var ch := _instance("chair")
		if ch:
			parent.add_child(ch)
			ch.position = Vector3(cx, floor_height, cz) + offs[k]
			ch.rotation.y = yaws[k]
			n += 1
	# 프로젝터 스크린(방 뒷벽 miny 쪽)
	var proj := _instance("projector")
	if proj:
		parent.add_child(proj)
		proj.position = Vector3(cx, floor_height, ry + 0.3)
		n += 1
	return n


## 스튜디오 HDRI 기반 환경(IBL) + 따뜻한 키/필 광원 + 글로우. Forward+/Compatibility 모두 동작.
static func setup_environment(parent: Node3D) -> void:
	var env := Environment.new()
	# 배경은 어두운 단색(오피스가 '떠 보이는' HDRI 배경 방지), 조명/반사만 HDRI(IBL)로.
	# Compatibility(웹)에서 BG_COLOR가 무시되는 문제 → 기본 클리어 컬러를 강제하고 BG_CLEAR_COLOR 사용.
	var bg := Color(0.09, 0.11, 0.16)
	RenderingServer.set_default_clear_color(bg)
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.background_color = bg
	# Compatibility(웹/저사양)는 BG_COLOR와 함께 Sky를 배경으로 그려버려 하늘이 보인다 →
	# 이 경우 Sky를 붙이지 않고 평면 앰비언트로 대체(다크 배경 유지). Forward+는 HDRI IBL 사용.
	var method := ""
	if RenderingServer.has_method("get_current_rendering_method"):
		method = str(RenderingServer.call("get_current_rendering_method"))
	var low_end := OS.has_feature("web") or method == "gl_compatibility"
	if ResourceLoader.exists(HDRI) and not low_end:
		var sky_tex := load(HDRI)
		var sky_mat := PanoramaSkyMaterial.new()
		sky_mat.panorama = sky_tex
		var sky := Sky.new()
		sky.sky_material = sky_mat
		env.sky = sky
		env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		env.ambient_light_energy = 0.35  # 과다노출 방지(벽 클리핑)
		env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	else:
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.60, 0.62, 0.70)
		env.ambient_light_energy = 0.9
	# 톤매핑(양 렌더러 공통) — 살짝 낮춰 하이라이트 클리핑 방지
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.9
	# 무거운 포스트(색보정/블룸/SSAO/SSIL)는 Forward+에서만.
	# Compatibility(웹)는 이들 미지원 + 배경(BG_COLOR)을 깨뜨리므로 제외.
	if not low_end:
		env.tonemap_white = 6.0
		env.adjustment_enabled = true
		env.adjustment_brightness = 1.0
		env.adjustment_contrast = 1.06
		env.adjustment_saturation = 0.96  # 과채도 방지(바닥 오렌지 억제)
		env.glow_enabled = true
		env.glow_intensity = 0.18
		env.glow_bloom = 0.05
		env.glow_hdr_threshold = 1.4
		env.ssao_enabled = true
		env.ssao_radius = 1.5
		env.ssil_enabled = true
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)

	# 키 라이트: 따뜻한 태양광, 부드러운 그림자
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-58, -42, 0)
	light.light_color = Color(1.0, 0.96, 0.88)
	light.light_energy = 1.15
	light.shadow_enabled = true
	light.shadow_blur = 1.5
	light.directional_shadow_max_distance = 80.0
	parent.add_child(light)

	# 필 라이트: 반대쪽에서 약한 쿨톤(그림자 메우기, 그림자 없음)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-32, 138, 0)
	fill.light_color = Color(0.82, 0.86, 1.0)
	fill.light_energy = 0.35
	fill.shadow_enabled = false
	parent.add_child(fill)
