# Poly Haven 모듈 렌더 — PBR 재질 유지, 모듈 합성(워크스테이션/회의세트), 직교 iso 카메라
# 실행: blender -b -P ph_render.py -- <ph_dir> <out_dir>
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
PH_DIR, OUT_DIR = argv[0], argv[1]
os.makedirs(OUT_DIR, exist_ok=True)

def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 1024
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
    # 고도를 올려 그림자 길이 축소(프레임 잘림 방지) — X를 낮출수록 태양이 높음
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

def import_part(slug, loc=(0, 0, 0), rot_z=0.0):
    path = os.path.join(PH_DIR, slug, slug + ".gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before and o.type in ("MESH", "EMPTY")]
    roots = [o for o in objs if o.parent is None or o.parent not in objs]
    pivot = bpy.data.objects.new("pv_" + slug, None)
    bpy.context.scene.collection.objects.link(pivot)
    for r in roots:
        r.parent = pivot
    pivot.rotation_euler = (0, 0, math.radians(rot_z))
    pivot.location = Vector(loc)
    bpy.context.view_layer.update()
    return [o for o in objs if o.type == "MESH"]

def bbox(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        eo = o.evaluated_get(dg)
        pts += [eo.matrix_world @ Vector(c) for c in eo.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

def fit_camera(cam, meshes, margin=1.4):
    mn, mx = bbox(meshes)
    center = (mn + mx) / 2
    dim = mx - mn
    scale = max(dim.x, dim.y, dim.z) * margin
    cam.data.ortho_scale = scale
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = center - fwd * 12
    return scale

def render(name, cam, meshes, margin=1.4):
    scale = fit_camera(cam, meshes, margin)
    bpy.context.view_layer.update()
    # 접지 앵커 정밀 산출: bbox 바닥 중심(z=0)을 카메라 평면에 투영 → 이미지 상단 기준 비율
    mn, mx = bbox(meshes)
    ground = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 0))
    rot = cam.rotation_euler.to_matrix()
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    d = ground - cam.location
    u = 0.5 + d.dot(right) / scale
    v = 0.5 + d.dot(up) / scale
    anchor_top = (1 - v) * 100  # translate(-50%, -X%)의 X
    bpy.context.scene.render.filepath = os.path.join(OUT_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"MODULE {name} ortho {scale:.3f} anchor {anchor_top:.1f} u {u * 100:.1f}")

# ── 모듈 정의 ──────────────────────────────────────────────
def mod_workstation():
    sc, cam = build_scene()
    desk = import_part("metal_office_desk")
    dmn, dmx = bbox(desk)
    laptop = import_part("classic_laptop", loc=((dmn.x + dmx.x) / 2, (dmn.y + dmx.y) / 2, dmx.z), rot_z=195)
    chair = import_part("modern_arm_chair_01", rot_z=180)
    cmn, cmx = bbox(chair)
    depth = cmx.y - cmn.y
    ch_pivot = bpy.data.objects.get("pv_modern_arm_chair_01")
    ch_pivot.location = Vector(((dmn.x + dmx.x) / 2, dmx.y + depth * 0.28, 0))
    bpy.context.view_layer.update()
    render("workstation", cam, desk + laptop + chair, margin=1.8)

def mod_meeting():
    sc, cam = build_scene()
    table = import_part("dining_table")
    tmn, tmx = bbox(table)
    cx, w = (tmn.x + tmx.x) / 2, tmx.x - tmn.x
    parts = list(table)
    for dx, side, rot in ((-w * 0.22, "n", 180), (w * 0.22, "n", 180), (-w * 0.22, "s", 0), (w * 0.22, "s", 0)):
        chair = import_part("modern_arm_chair_01", rot_z=rot)
        cmn, cmx = bbox(chair)
        depth = cmx.y - cmn.y
        pv = [o for o in bpy.data.objects if o.name.startswith("pv_modern_arm_chair_01")][-1]
        y = tmx.y + depth * 0.30 if side == "n" else tmn.y - depth * 0.30
        pv.location = Vector((cx + dx, y, 0))
        bpy.context.view_layer.update()
        parts += chair
    render("meeting", cam, parts, margin=1.75)

def mod_single(name, slug, margin=1.7):
    sc, cam = build_scene()
    meshes = import_part(slug)
    render(name, cam, meshes, margin)

mod_workstation()
mod_meeting()
mod_single("sofa", "Sofa_01")
mod_single("coffee_table", "coffee_table_round_01")
mod_single("plant_big", "potted_plant_01")
mod_single("plant_small", "potted_plant_02")
mod_single("shelf", "Shelf_01")
print("ALL DONE")
