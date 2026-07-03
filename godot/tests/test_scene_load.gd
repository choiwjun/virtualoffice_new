extends GutTest
func test_avatar_scene_loads() -> void:
	var s := load("res://scenes/avatar.tscn")
	assert_not_null(s, "avatar.tscn 로드")
	var inst = s.instantiate()
	add_child_autofree(inst)
	assert_true(inst is Avatar, "Avatar 타입")
func test_office_map_loads() -> void:
	var s := load("res://scenes/office_test_map.tscn")
	assert_not_null(s, "office_test_map.tscn 로드")
	add_child_autofree(s.instantiate())
	assert_true(true)
