# 점유 워크스테이션 베이크 — 책상+노트북+착석 캐릭터를 한 장으로(EEVEE).
# 3D 렌더가 오클루전을 픽셀 단위로 해결: 손=상판 위, 다리=앞판 뒤.
# 실행: blender -b -P char_desk_render.py -- <ph_dir> <fbx_dir> <out_dir> [--probe]
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
PH_DIR, FBX_DIR, OUT_DIR = argv[0], argv[1], argv[2]
PROBE = "--probe" in argv

# (fbx, 출력, 샘플, 캐릭터 회전Z°, 캐릭터 위치 오프셋(책상 뒤쪽 y+, 손이 상판에 닿게 조정))
ANIMS = [
    ("typing.fbx", "occupied-typing", 24, 0, (-0.30, 0.42)),
    ("sit.fbx", "occupied-sit", 12, 0, (-0.30, 0.50)),
]

def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 32
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
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.type = "ORTHO"
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam

def import_gltf(slug, loc=(0, 0, 0), rot_z=0.0):
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

def vert_bbox(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        mw = eo.matrix_world
        step = max(1, len(me.vertices) // 4000)
        for i in range(0, len(me.vertices), step):
            p = mw @ me.vertices[i].co
            mn = Vector((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
            mx = Vector((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
        eo.to_mesh_clear()
    return mn, mx

for fbx, name, samples, rot_z, (ox, oy) in ANIMS:
    sc, cam = build_scene()
    desk = import_gltf("metal_office_desk")
    dmn, dmx = vert_bbox(desk)
    cx = (dmn.x + dmx.x) / 2
    laptop = import_gltf("classic_laptop", loc=(cx, (dmn.y + dmx.y) / 2, dmx.z), rot_z=195)
    # 캐릭터(FBX) — 피벗으로 회전/배치, 책상 뒤(+y)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(FBX_DIR, fbx))
    imported = [o for o in bpy.data.objects if o not in before]
    cmesh = [o for o in imported if o.type == "MESH"]
    for mat in bpy.data.materials:  # Mixamo 알파 수리(EEVEE에도 안전)
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    for l in list(mat.node_tree.links):
                        if l.to_node == node and l.to_socket.name == "Alpha":
                            mat.node_tree.links.remove(l)
                    node.inputs["Alpha"].default_value = 1.0
    pivot = bpy.data.objects.new("pv_char", None)
    sc.collection.objects.link(pivot)
    roots = [o for o in imported if o.parent is None or o.parent not in imported]
    for r in roots:
        r.parent = pivot
    pivot.rotation_euler = (0, 0, math.radians(rot_z))
    pivot.location = Vector((cx + ox, dmx.y + oy, 0))
    bpy.context.view_layer.update()
    # Mixamo 피벗≠메시 중심 보정 — 실측 bbox 중심을 목표점(책상 중앙 뒤)에 정렬
    cmn0, cmx0 = vert_bbox(cmesh)
    ccen = (cmn0 + cmx0) / 2
    pivot.location.x += (cx + ox) - ccen.x
    pivot.location.y += (dmx.y + oy) - ccen.y
    bpy.context.view_layer.update()

    f0, f1 = 1, 100
    arms = [o for o in imported if o.type == "ARMATURE"]
    if arms and arms[0].animation_data and arms[0].animation_data.action:
        fr = arms[0].animation_data.action.frame_range
        f0, f1 = int(fr[0]), int(fr[1])
    total = max(1, f1 - f0)

    allm = desk + laptop + cmesh
    pts_mn, pts_mx = None, None
    for f in range(f0, f1 + 1, max(1, total // 6)):
        sc.frame_set(f)
        mn, mx = vert_bbox(allm)
        pts_mn = mn if pts_mn is None else Vector(map(min, pts_mn, mn))
        pts_mx = mx if pts_mx is None else Vector(map(max, pts_mx, mx))
    center = (pts_mn + pts_mx) / 2
    dim = pts_mx - pts_mn
    scale = max(dim.x, dim.y, dim.z) * 1.5
    cam.data.ortho_scale = scale
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = center - fwd * 12
    # 앵커는 책상 바닥 중심(z=0) — 페이지에서 ws-desk 자리에 그대로 치환되도록
    dg_center = Vector(((dmn.x + dmx.x) / 2, (dmn.y + dmx.y) / 2, 0))
    rot = cam.rotation_euler.to_matrix()
    up = rot @ Vector((0, 1, 0))
    right = rot @ Vector((1, 0, 0))
    dv = dg_center - cam.location
    v = 0.5 + dv.dot(up) / scale
    u = 0.5 + dv.dot(right) / scale
    anchor_top = (1 - v) * 100

    os.makedirs(os.path.join(OUT_DIR, name), exist_ok=True)
    n_out = 1 if PROBE else samples
    for i in range(n_out):
        f = f0 + round(i * total / samples)
        sc.frame_set(min(f, f1))
        sc.render.filepath = os.path.join(OUT_DIR, name, f"{i:02d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"OCC {name} frames {n_out} ortho {scale:.3f} anchor {anchor_top:.1f} u {u*100:.1f}", flush=True)

print("ALL DONE")
