# Kenney GLB -> HORIZON 팔레트 재질 교체 + 소프트 라이팅 재렌더 (headless)
# 실행: blender -b -P rr_render.py -- <glb_dir> <out_dir>
import bpy
import colorsys
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
GLB_DIR, OUT_DIR = argv[0], argv[1]
os.makedirs(OUT_DIR, exist_ok=True)

MODELS = [
    "desk", "chairDesk", "computerScreen", "loungeDesignSofa",
    "bookcaseClosedWide", "tableCoffee", "pottedPlant",
    "kitchenCoffeeMachine", "lampRoundFloor",
]

def srgb(c):  # sRGB(0-1) -> linear
    return tuple(pow(x, 2.2) for x in c)

# HORIZON 팔레트 (sRGB)
OAK_LIGHT = srgb((0.83, 0.66, 0.47))
OAK_DARK = srgb((0.55, 0.40, 0.28))
NAVY = srgb((0.16, 0.22, 0.35))
NAVY_LIGHT = srgb((0.26, 0.34, 0.50))
GREEN = srgb((0.42, 0.60, 0.40))
CREAM = srgb((0.93, 0.91, 0.87))

def remap(rgb):
    r, g, b = rgb[:3]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if s < 0.12:
        return (CREAM if v > 0.75 else (v * 0.9, v * 0.9, v * 0.92))
    if h < 0.04 or h > 0.93:
        return NAVY_LIGHT
    if h < 0.14:
        return OAK_LIGHT if v > 0.45 else OAK_DARK
    if h < 0.20:
        return OAK_LIGHT
    if h < 0.45:
        return GREEN
    if h < 0.78:
        return NAVY
    return NAVY_LIGHT

def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = 640
    sc.render.resolution_y = 640
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    # 월드 앰비언트(웜 화이트)
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.92, 0.90, 0.87, 1)
    bg.inputs[1].default_value = 0.55
    # 키 라이트(좌상단, 소프트 섀도)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(22)
    sun.rotation_euler = (math.radians(48), 0, math.radians(115))
    sc.collection.objects.link(sun)
    # 필 라이트
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 120
    fill.data.size = 8
    fill.location = (4, -4, 5)
    fill.rotation_euler = (math.radians(35), 0, math.radians(45))
    sc.collection.objects.link(fill)
    # 섀도 캐처 바닥
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.is_shadow_catcher = True
    # 카메라(직교, 방위 45° / 고도 30° — Kenney SE 렌더와 동일 계열)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.type = "ORTHO"
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam

def fit_camera(cam, objs, margin=1.5):
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        eo = o.evaluated_get(dg)
        for c in eo.bound_box:
            pts.append(eo.matrix_world @ Vector(c))
    if not pts:
        return
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (mn + mx) / 2
    dim = mx - mn
    cam.data.ortho_scale = max(dim.x, dim.y, dim.z) * margin
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = center - fwd * 10

for name in MODELS:
    path = os.path.join(GLB_DIR, name + ".glb")
    if not os.path.exists(path):
        print("SKIP(no file):", name)
        continue
    sc, cam = build_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    # 재질 교체 — Principled Base Color를 팔레트로 리매핑
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                c = list(node.inputs["Base Color"].default_value)
                nr = remap(c)
                node.inputs["Base Color"].default_value = (nr[0], nr[1], nr[2], 1.0)
                node.inputs["Roughness"].default_value = 0.65
                if "Specular IOR Level" in node.inputs:
                    node.inputs["Specular IOR Level"].default_value = 0.2
    fit_camera(cam, imported)
    sc.render.filepath = os.path.join(OUT_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED:", name)

print("ALL DONE")
