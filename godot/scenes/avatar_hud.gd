class_name AvatarHud
extends Node3D

## 아바타 머리 위 HUD (P1-S1-T5). 이름/부서/상태 아이콘을 카메라를 향해 표시(Billboard).
## 상태 7종(D13): offline/online/working/meeting/focus/away/external.

## D13 상태 → 표시 아이콘/색 매핑(정적·순수 — GUT 검증 가능).
const STATUS_ICON := {
	"offline": "⚫", "online": "🟢", "working": "💼",
	"meeting": "🗣", "focus": "🎧", "away": "🌙", "external": "✈",
}
const STATUS_COLOR := {
	"offline": Color(0.4, 0.4, 0.4), "online": Color(0.13, 0.77, 0.37),
	"working": Color(0.20, 0.51, 0.96), "meeting": Color(0.61, 0.35, 0.96),
	"focus": Color(0.96, 0.62, 0.11), "away": Color(0.58, 0.64, 0.72),
	"external": Color(0.38, 0.72, 0.96),
}

var _label: Label3D
var user_name: String = ""
var dept: String = ""
var status: String = "offline"


func _ready() -> void:
	if _label == null:
		_label = Label3D.new()
		_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_label.no_depth_test = true
		_label.position = Vector3(0, 2.1, 0)  ## 머리 위 2.1m
		add_child(_label)
	_refresh()


static func icon_for(s: String) -> String:
	return STATUS_ICON.get(s, "⚫")


static func color_for(s: String) -> Color:
	return STATUS_COLOR.get(s, Color(0.4, 0.4, 0.4))


static func is_valid_status(s: String) -> bool:
	return STATUS_ICON.has(s)


func set_info(p_name: String, p_dept: String) -> void:
	user_name = p_name
	dept = p_dept
	_refresh()


func set_status(p_status: String) -> void:
	if is_valid_status(p_status):
		status = p_status
		_refresh()


## 라벨에 표시할 텍스트(순수 — 테스트 가능).
func hud_text() -> String:
	var head := "%s %s" % [icon_for(status), user_name]
	if dept != "":
		head += "\n%s" % dept
	return head


func _refresh() -> void:
	if _label == null:
		return
	_label.text = hud_text()
	_label.modulate = color_for(status)
