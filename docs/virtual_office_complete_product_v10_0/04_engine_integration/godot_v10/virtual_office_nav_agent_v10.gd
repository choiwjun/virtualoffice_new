extends CharacterBody3D
@export var speed := 1.35
@onready var nav: NavigationAgent3D = $NavigationAgent3D
@onready var animation: AnimationPlayer = $AnimationPlayer

func move_to(point: Vector3) -> void:
    nav.target_position = point

func _physics_process(_delta: float) -> void:
    if nav.is_navigation_finished():
        velocity = Vector3.ZERO
        if animation.has_animation("ANIM_IDLE_001"): animation.play("ANIM_IDLE_001")
        return
    var next := nav.get_next_path_position()
    var direction := (next - global_position).normalized()
    velocity = direction * speed
    look_at(global_position + direction, Vector3.UP)
    if animation.has_animation("ANIM_WALK_001"): animation.play("ANIM_WALK_001")
    move_and_slide()
