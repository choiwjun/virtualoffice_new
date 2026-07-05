extends Node3D

## 웹 임베드용 오피스 뷰어 (시안 방향: 데이터 기반 실사 3D).
## 구조(바닥/방벽/충돌)는 office_layout_loader, 가구/의자/화분은 실 GLB(office_visuals),
## 조명은 스튜디오 HDRI(IBL). 좌석/방 배치가 바뀌면 그대로 반영된다.

const SAMPLE := "res://scenes/sample_office_layout.json"

var _yaw := 0.0
var _pivot: Node3D
var _cam: Camera3D
var _dragging := false


func _ready() -> void:
	var LoaderScript := load("res://scenes/office_layout_loader.gd")
	var loader = LoaderScript.new()
	loader.primitive_furniture = false  # 프리미티브 대신 실 GLB 사용
	add_child(loader)
	var layout: Dictionary = LoaderScript.load_file(SAMPLE)
	loader.build(layout)

	# 실사 GLB 가구/의자/화분/소파 + HDRI 조명(IBL)
	var VisualsScript := load("res://scenes/office_visuals.gd")
	VisualsScript.setup_environment(self)
	VisualsScript.populate(layout, self, loader.floor_height)

	# 아이소 카메라 리그(마우스 오빗)
	_pivot = Node3D.new()
	_pivot.position = Vector3(15.0, 0.0, 10.0)
	add_child(_pivot)
	_cam = Camera3D.new()
	_pivot.add_child(_cam)
	_cam.position = Vector3(0.0, 20.0, 26.0)
	_cam.look_at(_pivot.global_position, Vector3.UP)
	_cam.current = true


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		_dragging = event.pressed
	elif event is InputEventMouseMotion and _dragging:
		_yaw -= event.relative.x * 0.01
		_pivot.rotation.y = _yaw


func _process(_delta: float) -> void:
	if _cam:
		_cam.look_at(_pivot.global_position, Vector3.UP)
