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
	"sofa2": "res://assets/models/sofa_03/sofa_03.gltf",
	"pendant": "res://assets/models/modern_ceiling_lamp_01/modern_ceiling_lamp_01.gltf",
	"round_table": "res://assets/models/round_wooden_table_01/round_wooden_table_01.gltf",
	# 사람(Quaternius CC0) — 오피스 적합만
	"person_a": "res://assets/models/people/p09.glb",  # 비즈니스 정장
	"person_b": "res://assets/models/people/p02.glb",  # 캐주얼 티
	"person_c": "res://assets/models/people/p03.glb",  # 후디
	"person_d": "res://assets/models/people/p10.glb",  # 캐주얼
	"person_e": "res://assets/models/people/p01.glb",  # 캐주얼
}
const PERSON_IDS := ["person_a", "person_b", "person_c", "person_d", "person_e"]
const HDRI := "res://assets/hdri/brown_photostudio_02.hdr"
const FLOOR_TEX := "res://assets/textures/acg_woodfloor/"   # ambientCG WoodFloor043 2K
const WALL_TEX := "res://assets/textures/wood_planks/"
const PLASTER_TEX := "res://assets/textures/acg_plaster/"    # ambientCG Plaster003 2K
const CARPET_TEX := "res://assets/textures/acg_carpet/"      # ambientCG Carpet012 2K


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
	# 밝은 오크(시안의 밝은 마루) — 과도한 화이트닝은 텍스처를 날리므로 절제(1.08).
	mat.albedo_color = Color(1.08, 1.02, 0.92)
	# 마루 타일링(2K 플랭크)
	mat.uv1_scale = Vector3(7.0, 5.0, 1.0)
	mat.metallic = 0.0
	mat.roughness = 0.72
	# 폴리시드 우드 광택(프리미엄 바닥 반사) — 넓고 부드러운 sheen(날카로운 핫스팟 방지)
	mat.clearcoat_enabled = true
	mat.clearcoat = 0.2
	mat.clearcoat_roughness = 0.45
	(mesh as MeshInstance3D).material_override = mat


static func _instance(id: String) -> Node3D:
	var path: String = MODELS.get(id, "")
	if path == "" or not ResourceLoader.exists(path):
		return null
	var packed := load(path)
	if packed == null:
		return null
	return packed.instantiate()


## 따뜻한 오프화이트 벽 재질(외곽 벽/리셉션 카운터 공용) — 플라스터 텍스처.
static func _wall_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	if ResourceLoader.exists(PLASTER_TEX + "diffuse.jpg"):
		m.albedo_texture = load(PLASTER_TEX + "diffuse.jpg")
		if ResourceLoader.exists(PLASTER_TEX + "normal.jpg"):
			m.normal_enabled = true; m.normal_texture = load(PLASTER_TEX + "normal.jpg"); m.normal_scale = 0.4
		m.uv1_scale = Vector3(6.0, 4.0, 1.0)
	m.albedo_color = Color(0.88, 0.86, 0.82)  # 밝고 따뜻한 오프화이트(피처월 화사하게)
	m.roughness = 0.9
	m.metallic = 0.0
	return m


## 컷어웨이 낮은 턱(돌하우스 앞/좌 엣지) — 깨끗한 웜 크림 트림(프리미엄 플로어 엣지).
static func _sill_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.90, 0.88, 0.84)
	m.roughness = 0.6
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


## 절차적 모던 아트 텍스처(갤러리월 캔버스용) — 색면+기하 구성(Bauhaus 톤).
static func _make_art_texture(idx: int) -> ImageTexture:
	var W := 256
	var H := 320
	var img := Image.create(W, H, false, Image.FORMAT_RGB8)
	# 팔레트(브랜드 인디고/블루 + 웜 액센트)
	var palettes := [
		[Color(0.93, 0.92, 0.88), Color(0.20, 0.35, 0.72), Color(0.94, 0.55, 0.22), Color(0.15, 0.17, 0.24)],
		[Color(0.96, 0.94, 0.90), Color(0.16, 0.55, 0.62), Color(0.88, 0.30, 0.34), Color(0.22, 0.26, 0.34)],
		[Color(0.91, 0.90, 0.86), Color(0.30, 0.32, 0.60), Color(0.55, 0.72, 0.45), Color(0.18, 0.20, 0.28)],
	]
	var pal: Array = palettes[idx % palettes.size()]
	img.fill(pal[0])
	# 구성 변형(인덱스별로 다른 기하)
	var m := idx % 3
	if m == 0:
		_fill_rect(img, 0.10, 0.12, 0.55, 0.5, pal[1])
		_fill_rect(img, 0.40, 0.45, 0.5, 0.42, pal[2])
		_fill_rect(img, 0.12, 0.70, 0.30, 0.18, pal[3])
	elif m == 1:
		_fill_rect(img, 0.0, 0.0, 1.0, 0.34, pal[1])
		_fill_circle(img, 0.66, 0.60, 0.24, pal[2])
		_fill_rect(img, 0.10, 0.78, 0.80, 0.10, pal[3])
	else:
		_fill_rect(img, 0.08, 0.10, 0.36, 0.78, pal[3])
		_fill_rect(img, 0.50, 0.14, 0.40, 0.34, pal[2])
		_fill_rect(img, 0.50, 0.55, 0.40, 0.32, pal[1])
	return ImageTexture.create_from_image(img)


static func _fill_rect(img: Image, fx: float, fy: float, fw: float, fh: float, col: Color) -> void:
	var W := img.get_width(); var H := img.get_height()
	var x0 := int(fx * W); var y0 := int(fy * H)
	var x1 := int((fx + fw) * W); var y1 := int((fy + fh) * H)
	for y in range(max(0, y0), min(H, y1)):
		for x in range(max(0, x0), min(W, x1)):
			img.set_pixel(x, y, col)


static func _fill_circle(img: Image, fx: float, fy: float, fr: float, col: Color) -> void:
	var W := img.get_width(); var H := img.get_height()
	var cx := fx * W; var cy := fy * H; var r := fr * W
	for y in range(H):
		for x in range(W):
			if Vector2(x - cx, y - cy).length() <= r:
				img.set_pixel(x, y, col)


## 벽 갤러리 캔버스: 어두운 프레임 + 아트 텍스처 패널(살짝 발광으로 또렷하게).
static func _add_wall_art(parent: Node3D, cx: float, cy: float, cz: float, w: float, h: float, idx: int) -> void:
	# 프레임은 벽쪽(뒤), 캔버스는 앞으로 돌출 → 카메라(+z)에서 아트가 프레임에 안 가림.
	var frame_mat := StandardMaterial3D.new()
	frame_mat.albedo_color = Color(0.10, 0.10, 0.12)
	frame_mat.roughness = 0.5
	_box(parent, Vector3(cx, cy, cz), Vector3(w + 0.10, h + 0.10, 0.03), frame_mat)
	var art := StandardMaterial3D.new()
	var tex := _make_art_texture(idx)
	art.albedo_texture = tex
	art.roughness = 0.9
	# 뒷벽은 직사광이 약함 → 자기발광을 충분히 줘 아트 색이 또렷(과하지 않게).
	art.emission_enabled = true
	art.emission_texture = tex
	art.emission_energy_multiplier = 0.9
	_box(parent, Vector3(cx, cy, cz + 0.045), Vector3(w, h, 0.02), art)


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


## 평평한 러그(바닥 위 얇은 박스) — 카펫 텍스처 + 존 컬러 틴트.
static func _add_rug(parent: Node3D, cx: float, cz: float, w: float, d: float, floor_height: float, col: Color) -> void:
	var m := StandardMaterial3D.new()
	if ResourceLoader.exists(CARPET_TEX + "diffuse.jpg"):
		m.albedo_texture = load(CARPET_TEX + "diffuse.jpg")
		if ResourceLoader.exists(CARPET_TEX + "normal.jpg"):
			m.normal_enabled = true; m.normal_texture = load(CARPET_TEX + "normal.jpg")
		m.uv1_scale = Vector3(w * 0.5, d * 0.5, 1.0)
	m.albedo_color = col
	m.roughness = 1.0
	_box(parent, Vector3(cx, floor_height + 0.02, cz), Vector3(w, 0.04, d), m)


## 발광 재질(창/천장등/LED). col=발광색, energy=강도.
static func _emissive(col: Color, energy: float, albedo := Color(0.9, 0.9, 0.9)) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = albedo
	m.emission_enabled = true
	m.emission = col
	m.emission_energy_multiplier = energy
	return m


## 유리(반투명) 재질.
static func _glass(col := Color(0.62, 0.76, 0.85, 0.12)) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.05
	m.metallic = 0.1
	return m


## 밝은 채광창(벽 상단 발광 패널). 시안의 airy 데이라이트.
static func build_windows(dim_minx: float, dim_miny: float, dim_maxx: float, dim_maxy: float, parent: Node3D, floor_height: float) -> void:
	var h := 3.0
	var win := _emissive(Color(0.95, 0.97, 1.0), 1.7, Color(0.85, 0.9, 1.0))
	var wy := floor_height + h * 0.62
	var wh := h * 0.5
	# 뒷벽(miny) — 전체높이 피처월이라 넓은 채광창 2구간
	var bx := dim_minx + (dim_maxx - dim_minx) * 0.62
	_box(parent, Vector3(bx, wy, dim_miny + 0.13), Vector3(3.4, wh, 0.04), win)
	var bx2 := dim_minx + (dim_maxx - dim_minx) * 0.86
	_box(parent, Vector3(bx2, wy, dim_miny + 0.13), Vector3(3.0, wh, 0.04), win)
	# 우벽(maxx) — 전체높이 피처월, 상·하 채광창(좌벽 창은 컷어웨이로 이전)
	var rz := dim_miny + (dim_maxy - dim_miny) * 0.3
	_box(parent, Vector3(dim_maxx - 0.13, wy, rz), Vector3(0.04, wh, 4.5), win)
	var rz2 := dim_miny + (dim_maxy - dim_miny) * 0.68
	_box(parent, Vector3(dim_maxx - 0.13, wy, rz2), Vector3(0.04, wh, 4.0), win)


## 천장 조명 패널(그리드) — 은은한 발광(핫스팟 방지 강도). 열린 상단이라 얇은 패널만.
static func build_ceiling_lights(dim_minx: float, dim_miny: float, dim_maxx: float, dim_maxy: float, parent: Node3D, floor_height: float) -> void:
	var y := floor_height + 3.0 - 0.04
	var strip := _emissive(Color(1.0, 0.98, 0.92), 0.9, Color(0.9, 0.9, 0.9))
	var w := dim_maxx - dim_minx
	var d := dim_maxy - dim_miny
	# 룸 길이 방향 선형 LED 3줄(리세스드 천장 조명 느낌)
	for gz in [0.28, 0.5, 0.72]:
		_box(parent, Vector3(dim_minx + w * 0.5, y, dim_miny + d * gz), Vector3(w * 0.82, 0.04, 0.16), strip)


## 유리방 상/하단 블루 LED 트림(시안의 글로우 엣지). room coords 기준 사각 둘레.
static func add_room_led(room: Dictionary, parent: Node3D, floor_height: float) -> void:
	var c: Dictionary = room.get("coords", {})
	if c.is_empty():
		return
	var rx := float(c.get("x", 0.0)); var ry := float(c.get("y", 0.0))
	var rw := float(c.get("width", 4.0)); var rh := float(c.get("height", 4.0))
	var led := _emissive(Color(0.25, 0.6, 1.0), 3.2, Color(0.2, 0.5, 0.9))
	var top := floor_height + 2.85
	var s := 0.06
	# 상단 둘레 4변
	_box(parent, Vector3(rx + rw * 0.5, top, ry), Vector3(rw, s, s), led)
	_box(parent, Vector3(rx + rw * 0.5, top, ry + rh), Vector3(rw, s, s), led)
	_box(parent, Vector3(rx, top, ry + rh * 0.5), Vector3(s, s, rh), led)
	_box(parent, Vector3(rx + rw, top, ry + rh * 0.5), Vector3(s, s, rh), led)
	# 바닥 라인(앞/뒤)
	var fled := floor_height + 0.05
	_box(parent, Vector3(rx + rw * 0.5, fled, ry + rh), Vector3(rw, s, s), led)


## 그린 헤지(식재 파티션) — 낮은 플랜터 박스 + 위에 실제 식물(무성한 그린).
static func add_hedge(parent: Node3D, cx: float, cz: float, w: float, d: float, floor_height: float) -> void:
	# 플랜터 박스(콘크리트/우드톤)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.62, 0.58, 0.52)
	m.roughness = 0.9
	_box(parent, Vector3(cx, floor_height + 0.28, cz), Vector3(w + 0.1, 0.56, d + 0.1), m)
	# 흙
	var soil := StandardMaterial3D.new()
	soil.albedo_color = Color(0.18, 0.13, 0.10)
	_box(parent, Vector3(cx, floor_height + 0.57, cz), Vector3(w - 0.02, 0.04, d - 0.02), soil)
	# 위에 실제 식물 모델을 길이 방향으로 촘촘히(무성한 그린 divider)
	var vertical := d > w
	var span: float = (d if vertical else w)
	var count := int(clamp(span / 0.9, 2.0, 8.0))
	for i in range(count):
		var t := (float(i) + 0.5) / float(count)
		var px := cx
		var pz := cz
		if vertical:
			pz = cz - d * 0.5 + t * d
		else:
			px = cx - w * 0.5 + t * w
		var pl := _instance(["plant_a", "plant_c", "plant_b"][i % 3])
		if pl:
			parent.add_child(pl)
			pl.position = Vector3(px, floor_height + 0.55, pz)
			pl.scale = Vector3(0.7, 0.7, 0.7)


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
	# 돌하우스 컷어웨이: 카메라(전면-좌측)에 가까운 앞벽(maxy)·좌벽(minx)은 무릎높이 낮은 턱으로,
	# 먼 뒷벽(miny)·우벽(maxx)은 전체높이 피처월로 유지 → 시안처럼 트인 아이소 뷰.
	var low := 0.4
	var low_cy := floor_height + low * 0.5
	var sill := _sill_material()
	# 뒷벽(miny) — 전체높이 피처월(브랜드/갤러리)
	_box(parent, Vector3(cx, cy, miny), Vector3(w, h, t), mat)
	# 우벽(maxx) — 전체높이 피처월
	_box(parent, Vector3(maxx, cy, cz), Vector3(t, h, d), mat)
	# 좌벽(minx) — 낮은 턱(컷어웨이)
	_box(parent, Vector3(minx, low_cy, cz), Vector3(t + 0.06, low, d), sill)
	# 앞벽(maxy) — 낮은 턱, 중앙 입구 개방
	var gap := 4.0
	var seg := (w - gap) * 0.5
	if seg > 0.1:
		_box(parent, Vector3(minx + seg * 0.5, low_cy, maxy), Vector3(seg, low, t + 0.06), sill)
		_box(parent, Vector3(maxx - seg * 0.5, low_cy, maxy), Vector3(seg, low, t + 0.06), sill)
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
	# 채광창 + 천장 조명(밝고 화사한 실내감)
	var _d0: Dictionary = layout.get("dimensions", {})
	var wminx := float(_d0.get("min_x", 0.0)); var wminy := float(_d0.get("min_y", 0.0))
	var wmaxx := float(_d0.get("max_x", wminx + float(_d0.get("width_m", 30.0))))
	var wmaxy := float(_d0.get("max_y", wminy + float(_d0.get("height_m", 20.0))))
	build_windows(wminx, wminy, wmaxx, wmaxy, parent, floor_height)
	# 천장 발광 스트립은 블룸 막대가 되어 제거 — 창+지향광으로 충분히 밝음
	# 구조 기둥을 밝은 콘크리트로 랩(로더의 어두운 콜라이더 박스 가림)
	var col_mat := StandardMaterial3D.new()
	col_mat.albedo_color = Color(0.86, 0.85, 0.82)
	col_mat.roughness = 0.9
	for cd in layout.get("colliders", []):
		var b: Dictionary = cd.get("box", {})
		if b.is_empty():
			continue
		var bx := float(b.get("x", 0.0)) + float(b.get("width", 1.0)) * 0.5
		var bz := float(b.get("y", 0.0)) + float(b.get("height", 1.0)) * 0.5
		var bw2 := float(b.get("width", 1.0)) + 0.05
		var bd2 := float(b.get("height", 1.0)) + 0.05
		_box(parent, Vector3(bx, floor_height + 1.5, bz), Vector3(bw2, 3.0, bd2), col_mat)

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

	# 3.2) 사람 배치(시안처럼 통로/리셉션/회의실/라운지)
	placed += add_people(parent, floor_height)

	# 3.5) 팀존 러그 + 그린 헤지 파티션(시안의 존 구획 + 무성한 그린)
	var zi := 0
	var zone_rug_cols := [Color(0.62, 0.72, 0.95), Color(0.92, 0.90, 0.98), Color(0.70, 0.92, 0.80)]
	for z in layout.get("zones", []):
		var poly = z.get("polygon", [])
		if poly.size() < 3:
			continue
		var zx0 := 1e9; var zy0 := 1e9; var zx1 := -1e9; var zy1 := -1e9
		for pt in poly:
			zx0 = min(zx0, float(pt.get("x", 0.0))); zy0 = min(zy0, float(pt.get("y", 0.0)))
			zx1 = max(zx1, float(pt.get("x", 0.0))); zy1 = max(zy1, float(pt.get("y", 0.0)))
		var zcx := (zx0 + zx1) * 0.5; var zcz := (zy0 + zy1) * 0.5
		_add_rug(parent, zcx, zcz, (zx1 - zx0) - 0.6, (zy1 - zy0) - 0.6, floor_height, zone_rug_cols[zi % zone_rug_cols.size()])
		# 존 경계 헤지(오른쪽 변) — 통로 쪽 구획
		add_hedge(parent, zx1 + 0.1, zcz, 0.35, (zy1 - zy0) - 1.0, floor_height)
		zi += 1

	# 4) 장식 — 벽면 화분, 라운지(소파+커피테이블+러그)
	var dim: Dictionary = layout.get("dimensions", {})
	var minx := float(dim.get("min_x", 0.0))
	var miny := float(dim.get("min_y", 0.0))
	var maxx := float(dim.get("max_x", minx + float(dim.get("width_m", 20.0))))
	var maxy := float(dim.get("max_y", miny + float(dim.get("height_m", 15.0))))
	var plant_spots := [
		Vector2(minx + 1.0, miny + 1.0), Vector2(maxx - 1.0, miny + 1.0),
		Vector2(minx + 1.0, maxy - 1.0), Vector2(maxx - 1.0, maxy - 1.0),
		Vector2(minx + 1.0, (miny + maxy) * 0.5), Vector2(maxx - 1.2, (miny + maxy) * 0.62),
		Vector2((minx + maxx) * 0.5, miny + 0.9), Vector2(maxx - 1.2, miny + 5.0),
		Vector2(minx + 9.6, miny + 8.6), Vector2(maxx - 5.2, maxy - 1.2),
	]
	var i := 0
	for p in plant_spots:
		var plant := _instance(["plant_a", "plant_b", "plant_c"][i % 3])
		if plant:
			parent.add_child(plant)
			plant.position = Vector3(p.x, floor_height, p.y)
			placed += 1
		i += 1

	# 라운지: 오른쪽 하단 빈 공간(회의실 아래)에 러그 + 대형 소파 + 커피테이블 + 펜던트
	var lounge := Vector2(maxx - 5.0, maxy - 4.0)
	_add_rug(parent, lounge.x, lounge.y, 5.0, 4.0, floor_height, Color(0.58, 0.68, 0.92))
	var sofa := _instance("sofa2")
	if sofa == null:
		sofa = _instance("sofa")
	if sofa:
		parent.add_child(sofa)
		sofa.position = Vector3(lounge.x, floor_height, lounge.y + 1.3)
		placed += 1
	var pend := _instance("pendant")
	if pend:
		parent.add_child(pend)
		pend.position = Vector3(lounge.x, floor_height + 2.6, lounge.y)
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

	# 6) 벽 갤러리 — 뒷벽(브랜드월과 첫 창 사이)에 아트 캔버스 3점(시안의 갤러리월)
	var art_x := [11.0, 13.6, 16.2]
	for gi in range(art_x.size()):
		_add_wall_art(parent, art_x[gi], floor_height + 1.85, miny + 0.12, 1.35, 1.75, gi)
		placed += 1

	# 7) 카페존 — 우측 오픈 공간에 러그 + 원형 테이블 + 의자 3개
	var cafe := Vector2(maxx - 4.5, miny + 6.5)
	_add_rug(parent, cafe.x, cafe.y, 3.4, 3.4, floor_height, Color(0.85, 0.80, 0.72))
	var rt := _instance("round_table")
	if rt:
		parent.add_child(rt)
		rt.position = Vector3(cafe.x, floor_height, cafe.y)
		placed += 1
	var cyaws := [0.0, 2.1, 4.2]
	for cy2 in cyaws:
		var cch := _instance("chair")
		if cch:
			parent.add_child(cch)
			cch.position = Vector3(cafe.x + sin(cy2) * 0.9, floor_height, cafe.y + cos(cy2) * 0.9)
			cch.rotation.y = cy2 + PI
			placed += 1

	# 8) 브레이크아웃 라운지 — 전면 우측 오픈 공간(빈 마루 완화, 시안의 협업/휴게존)
	var brk := Vector2(maxx - 6.5, maxy - 2.2)
	_add_rug(parent, brk.x, brk.y, 4.6, 3.2, floor_height, Color(0.66, 0.74, 0.92))
	var brt := _instance("coffee_table")
	if brt:
		parent.add_child(brt)
		brt.position = Vector3(brk.x, floor_height, brk.y)
		placed += 1
	var brk_seats := [Vector3(-1.5, 0, 0.0), Vector3(1.5, 0, 0.0), Vector3(0, 0, 1.4)]
	var brk_yaws := [PI * 0.5, -PI * 0.5, PI]
	for bk in range(brk_seats.size()):
		var bc := _instance("chair")
		if bc:
			parent.add_child(bc)
			bc.position = Vector3(brk.x, floor_height, brk.y) + brk_seats[bk]
			bc.rotation.y = brk_yaws[bk]
			placed += 1
	var brp := _instance("plant_a")
	if brp:
		parent.add_child(brp)
		brp.position = Vector3(brk.x + 2.6, floor_height, brk.y - 1.0)
		brp.scale = Vector3(1.15, 1.15, 1.15)
		placed += 1

	return placed


const ANIM_WALK := "CharacterArmature|Walk"
const ANIM_IDLE := "CharacterArmature|Idle_Neutral"
const ANIM_WAVE := "CharacterArmature|Wave"
const ANIM_SIT := "__sit__"  # 실제 앉기 애니메이션 없음 → 스켈레톤 본을 직접 포즈


## 좌식 포즈: 애니메이션 없이 다리/팔 본을 직접 회전해 '책상에 앉아 일하는' 모습.
## Quaternius 리그(Hips/UpperLeg.L·R/LowerLeg.L·R/UpperArm·LowerArm) 기준.
static func _pose_seated(person: Node3D) -> void:
	var ap = person.find_child("AnimationPlayer", true, false)
	if ap:
		ap.stop()
	var sk := person.find_child("Skeleton3D", true, false)
	if sk == null or not (sk is Skeleton3D):
		return
	var s := sk as Skeleton3D
	# 델타 회전을 각 본의 rest(바인드) 방향에 합성해야 함(절대 설정하면 팔다리가 깨짐).
	# 다리: 허벅지 앞으로(수평)·정강이 아래로(무릎 90도).
	# 팔: 위팔 살짝 앞으로 내리고 아래팔을 앞으로 굽혀 '책상 위 타이핑' 자세.
	var thigh := Quaternion(Vector3(1, 0, 0), deg_to_rad(86))
	var shin := Quaternion(Vector3(1, 0, 0), deg_to_rad(-96))
	# 위팔은 rest(자연스러운 옆내림) 유지, 아래팔만 앞으로 굽혀 책상 위로(팔꿈치 굴곡).
	var fore_arm := Quaternion(Vector3(1, 0, 0), deg_to_rad(72))
	# 상체를 살짝 앞으로 숙여 '일하는' 자세
	var lean := Quaternion(Vector3(1, 0, 0), deg_to_rad(12))
	var pose := {
		"UpperLeg.L": thigh, "UpperLeg.R": thigh,
		"LowerLeg.L": shin, "LowerLeg.R": shin,
		"LowerArm.L": fore_arm, "LowerArm.R": fore_arm,
		"Abdomen": lean,
	}
	for bn in pose:
		var bi := s.find_bone(bn)
		if bi >= 0:
			var rest_q := s.get_bone_rest(bi).basis.get_rotation_quaternion()
			s.set_bone_pose_rotation(bi, rest_q * pose[bn])

## 사람(Quaternius CC0) 배치 — 시안처럼 통로에 걷고, 리셉션/회의실/라운지에 서 있는 사람. 애니메이션 포즈.
static func add_people(parent: Node3D, floor_height: float) -> int:
	# [x, z, facing_deg, model_index, anim]
	var spots := [
		[15.0, 15.8, 0.0, 0, ANIM_WAVE],    # 리셉션 앞(정장, 인사)
		[12.5, 11.0, 200.0, 1, ANIM_WALK],  # 중앙 통로 걷기
		[11.2, 13.7, 20.0, 2, ANIM_WALK],   # 중앙 통로2
		[13.5, 9.0, 250.0, 3, ANIM_WALK],   # 중앙 통로3
		[10.0, 12.0, 90.0, 0, ANIM_IDLE],   # C존 통로
		[21.5, 10.6, 180.0, 1, ANIM_IDLE],  # 회의실 A 입구
		[21.3, 16.2, 175.0, 2, ANIM_WALK],  # 회의실 B 근처
		[25.5, 15.2, 250.0, 3, ANIM_IDLE],  # 라운지
		[24.0, 7.5, 150.0, 4, ANIM_WALK],   # 우측 오픈
		[4.2, 2.6, 130.0, 0, ANIM_IDLE],    # 브랜드월 앞
		[17.5, 6.5, 220.0, 3, ANIM_WALK],   # 우측 통로
		# 책상에 앉아 일하는 사람(시안 핵심) — 좌석 좌표, facing=책상 방향
		[3.0, 3.6, 0.0, 4, ANIM_SIT],       # A존 데스크
		[6.5, 5.4, 180.0, 1, ANIM_SIT],     # A존 데스크(마주)
		[11.5, 3.6, 0.0, 2, ANIM_SIT],      # B존 데스크
		[14.5, 5.4, 180.0, 3, ANIM_SIT],    # B존 데스크(마주)
		[3.0, 11.6, 0.0, 0, ANIM_SIT],      # C존 데스크
		[6.5, 13.4, 180.0, 2, ANIM_SIT],    # C존 데스크(마주)
	]
	var n := 0
	var idx := 0
	for s in spots:
		var mid: String = PERSON_IDS[int(s[3]) % PERSON_IDS.size()]
		var person := _instance(mid)
		if person:
			parent.add_child(person)
			person.rotation.y = deg_to_rad(float(s[2]))
			var anim: String = s[4]
			if anim == ANIM_SIT:
				# 앉은 자세: 골반이 좌석높이에 오도록 낮춤(발은 바닥) + 본 포즈
				person.position = Vector3(float(s[0]), floor_height - 0.4, float(s[1]))
				_pose_seated(person)
			else:
				person.position = Vector3(float(s[0]), floor_height, float(s[1]))
				# 애니메이션 포즈(걷기/서기/인사) — 위상 오프셋으로 다양화
				var ap = person.find_child("AnimationPlayer", true, false)
				if ap and ap.has_animation(anim):
					ap.play(anim)
					ap.seek(float(idx) * 0.41, true)
			n += 1
		idx += 1
	return n


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
	# 유리방 블루 LED 트림(시안의 글로우 엣지)
	add_room_led(room, parent, floor_height)
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
		env.ambient_light_energy = 0.78  # 밝고 화사한 실내 채광
		env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	else:
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.60, 0.62, 0.70)
		env.ambient_light_energy = 0.9
	# 톤매핑(양 렌더러 공통) — 살짝 낮춰 하이라이트 클리핑 방지
	env.tonemap_mode = (Environment.TONE_MAPPER_AGX if not low_end else Environment.TONE_MAPPER_ACES)
	env.tonemap_exposure = 1.18
	# 무거운 포스트(색보정/블룸/SSAO/SSIL)는 Forward+에서만.
	# Compatibility(웹)는 이들 미지원 + 배경(BG_COLOR)을 깨뜨리므로 제외.
	if not low_end:
		env.tonemap_white = 6.0
		env.adjustment_enabled = true
		env.adjustment_brightness = 1.0
		env.adjustment_contrast = 1.08
		env.adjustment_saturation = 1.18  # AgX 탈채도 보정(생기)
		env.glow_enabled = true
		env.glow_intensity = 0.15
		env.glow_bloom = 0.04
		env.glow_hdr_threshold = 1.9
		env.ssao_enabled = true
		env.ssao_radius = 1.5
		env.ssao_intensity = 2.0
		env.ssil_enabled = true
		# SDFGI: 실시간 전역조명(간접 바운스) — 벽/러그/바닥에서 색 번짐, 부드러운 실내 광질.
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.sdfgi_bounce_feedback = 0.6
		env.sdfgi_energy = 1.05
		env.sdfgi_min_cell_size = 0.08
		# SSR: 폴리시드 바닥에 은은한 반사(프리미엄 마감)
		env.ssr_enabled = true
		env.ssr_max_steps = 48
		env.ssr_fade_in = 0.2
		env.ssr_fade_out = 3.0
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)

	# 키 라이트: 따뜻한 태양광, 부드러운 그림자
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-58, -42, 0)
	light.light_color = Color(1.0, 0.95, 0.86)
	light.light_energy = 1.3
	light.shadow_enabled = true
	light.shadow_blur = 1.5
	light.directional_shadow_max_distance = 80.0
	parent.add_child(light)

	# 필 라이트: 반대쪽에서 약한 쿨톤(그림자 메우기, 그림자 없음)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-32, 138, 0)
	fill.light_color = Color(0.82, 0.86, 1.0)
	fill.light_energy = 0.55
	fill.shadow_enabled = false
	parent.add_child(fill)

	# 오버헤드 소프트 필(천장 방향) — 실내 균일 채광
	var top_fill := DirectionalLight3D.new()
	top_fill.rotation_degrees = Vector3(-88, 20, 0)
	top_fill.light_color = Color(1.0, 0.98, 0.94)
	top_fill.light_energy = 0.4
	top_fill.shadow_enabled = false
	parent.add_child(top_fill)
