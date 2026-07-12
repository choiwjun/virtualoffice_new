extends Node3D
class_name VirtualOfficeAvatar

@onready var animation_player: AnimationPlayer = find_child("AnimationPlayer", true, false)

func play_clip(clip_id: StringName, blend: float = 0.18) -> void:
    if animation_player == null:
        push_error("AnimationPlayer not found on imported GLB")
        return
    if not animation_player.has_animation(clip_id):
        push_error("Missing animation clip: %s" % clip_id)
        return
    animation_player.play(clip_id, blend)
