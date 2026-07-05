class_name Minimap
extends Control

## 미니맵 (P1-S1-T6). 오피스 평면(top-down)을 미니맵 픽셀 좌표로 매핑하고 아바타/방 마커를 찍는다.
## 좌표: layout 2D (x, y=layout세로) → 미니맵 (px, py). D25 top_left·미터 기준.

var dims: Dictionary = {}      ## {width_m, height_m, min_x, min_y}
var size_px: Vector2 = Vector2(200, 150)
var _markers: Dictionary = {}  ## id -> Vector2(px)


## 월드/레이아웃 좌표(x, z=layout y) → 미니맵 픽셀. 순수·정적 — GUT 검증 가능.
static func world_to_minimap(x: float, z: float, p_dims: Dictionary, p_size: Vector2) -> Vector2:
	var min_x := float(p_dims.get("min_x", 0.0))
	var min_y := float(p_dims.get("min_y", 0.0))
	var w := float(p_dims.get("width_m", float(p_dims.get("max_x", 0.0)) - min_x))
	var h := float(p_dims.get("height_m", float(p_dims.get("max_y", 0.0)) - min_y))
	if w <= 0.0 or h <= 0.0:
		return Vector2.ZERO
	var u := clampf((x - min_x) / w, 0.0, 1.0)
	var v := clampf((z - min_y) / h, 0.0, 1.0)
	return Vector2(u * p_size.x, v * p_size.y)


func configure(p_dims: Dictionary, p_size_px: Vector2 = Vector2(200, 150)) -> void:
	dims = p_dims
	size_px = p_size_px
	custom_minimum_size = size_px


## 아바타 마커 위치 갱신(월드 x,z). 리턴: 미니맵 픽셀 좌표.
func update_marker(id: String, x: float, z: float) -> Vector2:
	var p := world_to_minimap(x, z, dims, size_px)
	_markers[id] = p
	queue_redraw()
	return p


func remove_marker(id: String) -> void:
	_markers.erase(id)
	queue_redraw()


func marker_count() -> int:
	return _markers.size()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size_px), Color(0.06, 0.09, 0.16))
	for id in _markers:
		draw_circle(_markers[id], 3.0, Color(0.13, 0.77, 0.37))
