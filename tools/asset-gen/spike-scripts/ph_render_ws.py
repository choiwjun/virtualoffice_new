# 워크스테이션 분리 렌더 — 그룹 분리 원칙(18-spec): 캐릭터가 의자(뒤)와 책상(앞) 사이에 z-정렬되도록
# ws-desk(책상+노트북) / ws-chair(의자)를 별도 스프라이트로. 실행: blender -b -P ph_render_ws.py -- <ph_dir> <out_dir>
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

def render(name, cam, meshes, margin=1.7):
    mn, mx = bbox(meshes)
    center = (mn + mx) / 2
    dim = mx - mn
    scale = max(dim.x, dim.y, dim.z) * margin
    cam.data.ortho_scale = scale
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = center - fwd * 12
    ground = Vector((center.x, center.y, 0))
    rot = cam.rotation_euler.to_matrix()
    up = rot @ Vector((0, 1, 0))
    v = 0.5 + (ground - cam.location).dot(up) / scale
    anchor_top = (1 - v) * 100
    bpy.context.scene.render.filepath = os.path.join(OUT_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"MODULE {name} ortho {scale:.3f} anchor {anchor_top:.1f}", flush=True)

# ws-desk: 책상 + 노트북(앞층 — 캐릭터 다리를 가리는 쪽)
sc, cam = build_scene()
desk = import_part("metal_office_desk")
dmn, dmx = bbox(desk)
laptop = import_part("classic_laptop", loc=((dmn.x + dmx.x) / 2, (dmn.y + dmx.y) / 2, dmx.z), rot_z=195)
render("ws-desk", cam, desk + laptop, margin=1.6)

# ws-chair: 의자 단독(뒤층)
sc, cam = build_scene()
chair = import_part("modern_arm_chair_01", rot_z=180)
render("ws-chair", cam, chair, margin=1.7)

print("ALL DONE")
