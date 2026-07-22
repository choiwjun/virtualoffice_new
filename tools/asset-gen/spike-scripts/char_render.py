# Mixamo FBX(Josh) -> 상태별 프레임 스프라이트 베이크 — 가구(ph_render)와 동일 카메라/라이팅.
# 실행: blender -b -P char_render.py -- <fbx_dir> <out_dir>
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
FBX_DIR, OUT_DIR = argv[0], argv[1]
PROBE = "--probe" in argv  # 1프레임만 렌더(방향/프레이밍 검증용)

# (파일, 출력폴더, 샘플 수, 회전Z°) — 회전은 아이소 시점에서 정면-좌하 바라보게 조정
ANIMS = [
    ("walk.fbx", "walk", 16, 180),
    ("sit.fbx", "sit", 12, 180),
    ("typing.fbx", "typing", 24, 180),
    ("idle.fbx", "idle", 12, 180),
]

def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = 512
    sc.render.resolution_y = 512
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.90, 0.89, 0.87, 1)
    bg.inputs[1].default_value = 0.45
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.6
    sun.data.angle = math.radians(14)
    sun.rotation_euler = (math.radians(32), 0, math.radians(115))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 150
    fill.data.size = 10
    fill.location = (5, -5, 6)
    fill.rotation_euler = (math.radians(35), 0, math.radians(45))
    sc.collection.objects.link(fill)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.is_shadow_catcher = True
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.type = "ORTHO"
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam

def bbox(meshes, dg=None):
    # 아마추어 변형 메시는 bound_box가 레스트 포즈 기준 — 평가된 실제 버텍스로 계산해야 한다.
    dg = dg or bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        mw = eo.matrix_world
        step = max(1, len(me.vertices) // 4000)  # 샘플링(속도)
        for i in range(0, len(me.vertices), step):
            p = mw @ me.vertices[i].co
            mn = Vector((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
            mx = Vector((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
        eo.to_mesh_clear()
    return mn, mx

for fbx, name, samples, rot_z in ANIMS:
    sc, cam = build_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(FBX_DIR, fbx))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    arms = [o for o in imported if o.type == "ARMATURE"]
    # Mixamo FBX 투명도 수리 — FBX Opacity가 Principled Alpha=0으로 들어와 Cycles에서
    # 몸/옷이 투명해진다(속눈썹만 렌더되는 증상). 알파 링크 제거 + 1.0 강제.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                for l in list(mat.node_tree.links):
                    if l.to_node == node and l.to_socket.name == "Alpha":
                        mat.node_tree.links.remove(l)
                node.inputs["Alpha"].default_value = 1.0
    # 루트(아마추어) 회전 — 아이소 카메라에서 정면-좌하 방향
    for a in arms:
        a.rotation_euler.rotate_axis("Z", math.radians(rot_z))
    bpy.context.view_layer.update()
    # 프레임 범위 = 액션 범위
    f0, f1 = 1, 100
    if arms and arms[0].animation_data and arms[0].animation_data.action:
        fr = arms[0].animation_data.action.frame_range
        f0, f1 = int(fr[0]), int(fr[1])
    total = max(1, f1 - f0)
    os.makedirs(os.path.join(OUT_DIR, name), exist_ok=True)

    # 전 프레임 통합 bbox로 카메라 1회 고정(프레임별 흔들림 방지) — 8프레임 간격 샘플로 근사
    pts_mn, pts_mx = None, None
    probe = list(range(f0, f1 + 1, max(1, total // 8))) or [f0]
    for f in probe:
        sc.frame_set(f)
        mn, mx = bbox(meshes)
        pts_mn = mn if pts_mn is None else Vector(map(min, pts_mn, mn))
        pts_mx = mx if pts_mx is None else Vector(map(max, pts_mx, mx))
    center = (pts_mn + pts_mx) / 2
    dim = pts_mx - pts_mn
    scale = max(dim.x, dim.y, dim.z) * 1.45
    cam.data.ortho_scale = scale
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = center - fwd * 12
    # 접지 앵커(발밑 = 실측 최저 z) 투영
    ground = Vector((center.x, center.y, pts_mn.z))
    rot = cam.rotation_euler.to_matrix()
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    d = ground - cam.location
    v = 0.5 + d.dot(up) / scale
    anchor_top = (1 - v) * 100

    n_out = 1 if PROBE else samples
    for i in range(n_out):
        f = f0 + round(i * total / samples)
        sc.frame_set(min(f, f1))
        sc.render.filepath = os.path.join(OUT_DIR, name, f"{i:02d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"CHAR {name} frames {n_out} ortho {scale:.3f} anchor {anchor_top:.1f} range {f0}-{f1}", flush=True)

print("ALL DONE")
