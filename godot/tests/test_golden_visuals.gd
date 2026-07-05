extends GutTest

## Phase 1 골든 샘플 시각/HUD/미니맵 검증 (P1-S1-T5/T6 + 로더 시각 메시).
## preload로 스크립트를 직접 참조(신규 class_name 전역 등록 여부와 무관하게 동작).

const SAMPLE := "res://scenes/sample_office_layout.json"
const HudScript := preload("res://scenes/avatar_hud.gd")
const MinimapScript := preload("res://scenes/minimap.gd")
const LoaderScript := preload("res://scenes/office_layout_loader.gd")


func _count_meshes(node: Node) -> int:
	var n := 0
	if node is MeshInstance3D:
		n += 1
	for c in node.get_children():
		n += _count_meshes(c)
	return n


func test_loader_attaches_visual_meshes():
	var layout := LoaderScript.load_file(SAMPLE)
	assert_gt(layout.size(), 0, "샘플 레이아웃 로드")
	var loader := LoaderScript.new()
	add_child_autofree(loader)
	loader.build(layout)
	var meshes := _count_meshes(loader)
	# 바닥 1 + 좌석/스폰/방벽/가구 다수 → 최소 좌석 수 이상.
	assert_gt(meshes, loader.seats.size(), "시각 메시가 좌석 수보다 많이 생성됨 (골든샘플 렌더)")


func test_hud_status_mapping():
	# 7상태(D13) 전부 유효 + 아이콘/색 매핑.
	for s in ["offline", "online", "working", "meeting", "focus", "away", "external"]:
		assert_true(HudScript.is_valid_status(s), "유효 상태: %s" % s)
		assert_ne(HudScript.icon_for(s), "", "아이콘 존재: %s" % s)
	assert_false(HudScript.is_valid_status("bogus"), "미지원 상태 거부")


func test_hud_text():
	var hud := HudScript.new()
	hud.user_name = "김철수"
	hud.dept = "플랫폼팀"
	hud.status = "meeting"
	var t: String = hud.hud_text()
	assert_true(t.contains("김철수"), "이름 표시")
	assert_true(t.contains("플랫폼팀"), "부서 표시")
	assert_true(t.contains(HudScript.icon_for("meeting")), "상태 아이콘 표시")
	hud.free()


func test_minimap_transform():
	var dims := {"width_m": 30.0, "height_m": 20.0, "min_x": 0.0, "min_y": 0.0}
	var sz := Vector2(200, 150)
	assert_eq(MinimapScript.world_to_minimap(0, 0, dims, sz), Vector2(0, 0), "좌상단")
	assert_eq(MinimapScript.world_to_minimap(30, 20, dims, sz), Vector2(200, 150), "우하단")
	assert_eq(MinimapScript.world_to_minimap(15, 10, dims, sz), Vector2(100, 75), "중앙")


func test_minimap_markers():
	var mm := MinimapScript.new()
	add_child_autofree(mm)
	mm.configure({"width_m": 30.0, "height_m": 20.0, "min_x": 0.0, "min_y": 0.0}, Vector2(200, 150))
	mm.update_marker("u1", 15, 10)
	mm.update_marker("u2", 0, 0)
	assert_eq(mm.marker_count(), 2, "마커 2개")
	mm.remove_marker("u1")
	assert_eq(mm.marker_count(), 1, "제거 후 1개")
