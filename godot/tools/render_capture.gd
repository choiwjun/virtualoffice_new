extends Node3D

## 오피스 고품질 스틸 렌더 캡처(하이브리드 배경용 office-render.png 생성).
## web_office.gd와 동일한 빌드 경로/카메라 프레이밍을 사용해 라이브 3D와 시각 일치.
## 실행: godot --path godot res://tools/render_capture.tscn (윈도우드, GPU 필요)
## 결과: frontend/public/office-render.png + 오버레이 앵커 좌표 로그(스크린 %).

const SAMPLE := "res://scenes/sample_office_layout.json"
const OUT_REL := "res://../frontend/public/office-render.png"
const CAP_W := 1600
const CAP_H := 900

var _cam: Camera3D
var _layout: Dictionary


func _ready() -> void:
	get_window().size = Vector2i(CAP_W, CAP_H)
	var vp := get_viewport()
	vp.msaa_3d = Viewport.MSAA_8X
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
	vp.use_taa = false

	var LoaderScript := load("res://scenes/office_layout_loader.gd")
	var loader = LoaderScript.new()
	loader.primitive_furniture = false
	add_child(loader)
	_layout = LoaderScript.load_file(SAMPLE)
	loader.build(_layout)

	var VisualsScript := load("res://scenes/office_visuals.gd")
	VisualsScript.setup_environment(self)
	VisualsScript.populate(_layout, self, loader.floor_height)

	# web_office.gd와 동일 프레이밍(아이소 카메라)
	var pivot := Node3D.new()
	pivot.position = Vector3(14.0, 0.5, 9.0)
	add_child(pivot)
	_cam = Camera3D.new()
	pivot.add_child(_cam)
	_cam.fov = 46.0
	_cam.position = Vector3(-16.0, 13.0, 16.0)
	_cam.look_at(pivot.global_position, Vector3.UP)
	_cam.current = true

	# SDFGI/그림자/IBL 수렴 대기 후 캡처(SDFGI는 시간적 누적이라 넉넉히)
	for i in range(120):
		await get_tree().process_frame

	var img := vp.get_texture().get_image()
	var out_abs := ProjectSettings.globalize_path(OUT_REL)
	img.save_png(out_abs)
	print("RENDER_SAVED ", out_abs, " ", img.get_width(), "x", img.get_height())

	_log_anchors()
	get_tree().quit()


## 책상/회의실 월드좌표를 화면 %로 투영해 대시보드 오버레이 앵커 자동 산출.
func _log_anchors() -> void:
	var fh := 0.0
	print("=== DESK_ANCHORS (screen %) ===")
	for f in _layout.get("furniture", []):
		if String(f.get("type", "desk")) != "desk":
			continue
		var c: Dictionary = f.get("coords", {})
		var wp := Vector3(float(c.get("x", 0.0)), fh + 0.9, float(c.get("y", 0.0)))
		var sp := _cam.unproject_position(wp)
		print("  { x: %.1f, y: %.1f }," % [sp.x / CAP_W * 100.0, sp.y / CAP_H * 100.0])
	print("=== ROOM_ANCHORS (screen %) ===")
	for r in _layout.get("rooms", []):
		var c: Dictionary = r.get("coords", {})
		var cx := float(c.get("x", 0.0)) + float(c.get("width", 4.0)) * 0.5
		var cz := float(c.get("y", 0.0)) + float(c.get("height", 4.0)) * 0.5
		var wp := Vector3(cx, fh + 2.6, cz)
		var sp := _cam.unproject_position(wp)
		print("  %s { x: %.1f, y: %.1f }" % [String(r.get("name", "?")), sp.x / CAP_W * 100.0, sp.y / CAP_H * 100.0])
