"""
build_office_cc0_v2.py — 같은 CC0 에셋, 아트디렉션만 개선(중립 HDRI + 목재바닥 텍스처 + 벽).
v1과 비교해 "병목=아트디렉션"을 증명하는 용도.
"""
import bpy, math, os, sys, mathutils

argv = sys.argv
extra = argv[argv.index("--") + 1:] if "--" in argv else []
OUT_DIR = os.path.abspath(extra[extra.index("--out") + 1]) if "--out" in extra else \
    os.path.abspath("./render-pipeline/out_cc0_v2")
os.makedirs(OUT_DIR, exist_ok=True)
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets_cc0")
W, H = 1280, 720

bpy.ops.wm.read_factory_settings(use_empty=True)

# 1. 중립 HDRI (brown_photostudio_02) — 부드러운 무채색 조명, 배경은 회색으로 가림
world = bpy.data.worlds.new("World"); bpy.context.scene.world = world
world.use_nodes = True; nt = world.node_tree; nt.nodes.clear()
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(ASSETS, "hdri", "brown_photostudio_02_2k.hdr"))
bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 1.1
lp = nt.nodes.new("ShaderNodeLightPath")
bgv = nt.nodes.new("ShaderNodeBackground"); bgv.inputs["Color"].default_value = (0.9, 0.9, 0.92, 1); bgv.inputs["Strength"].default_value = 1.0
mix = nt.nodes.new("ShaderNodeMixShader")
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])  # 조명=HDRI, 카메라에 보이는 배경=회색
nt.links.new(bg.outputs["Background"], mix.inputs[1])
nt.links.new(bgv.outputs["Background"], mix.inputs[2])
nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])

def img(path, noncolor=False):
    im = bpy.data.images.load(path)
    if noncolor: im.colorspace_settings.name = "Non-Color"
    return im

# 2. 목재 바닥 (실제 CC0 텍스처)
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
floor = bpy.context.object
m = bpy.data.materials.new("Floor"); m.use_nodes = True; floor.data.materials.append(m)
nt2 = m.node_tree; bsdf = nt2.nodes["Principled BSDF"]
tc = nt2.nodes.new("ShaderNodeTexCoord"); mp = nt2.nodes.new("ShaderNodeMapping")
mp.inputs["Scale"].default_value = (15, 15, 15)
nt2.links.new(tc.outputs["UV"], mp.inputs["Vector"])
tf = os.path.join(ASSETS, "tex_floor")
d = nt2.nodes.new("ShaderNodeTexImage"); d.image = img(os.path.join(tf, "floor_diff.jpg"))
r = nt2.nodes.new("ShaderNodeTexImage"); r.image = img(os.path.join(tf, "floor_rough.jpg"), True)
n = nt2.nodes.new("ShaderNodeTexImage"); n.image = img(os.path.join(tf, "floor_nor.jpg"), True)
nm = nt2.nodes.new("ShaderNodeNormalMap")
for node in (d, r, n): nt2.links.new(mp.outputs["Vector"], node.inputs["Vector"])
nt2.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
nt2.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
nt2.links.new(n.outputs["Color"], nm.inputs["Color"]); nt2.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

# 3. 벽 코너 (카메라 반대편 -x/+y). 하나는 목재 슬랫(리셉션 월 느낌), 하나는 오프화이트
def wall(loc, rot, color, wood=False):
    bpy.ops.mesh.primitive_plane_add(size=10, location=loc)
    w = bpy.context.object; w.rotation_euler = rot
    wm = bpy.data.materials.new("Wall"); wm.use_nodes = True; w.data.materials.append(wm)
    b = wm.node_tree.nodes["Principled BSDF"]
    if wood:
        t = wm.node_tree
        mp2 = t.nodes.new("ShaderNodeMapping"); mp2.inputs["Scale"].default_value = (5, 5, 5)
        tc2 = t.nodes.new("ShaderNodeTexCoord"); t.links.new(tc2.outputs["UV"], mp2.inputs["Vector"])
        di = t.nodes.new("ShaderNodeTexImage"); di.image = img(os.path.join(tf, "floor_diff.jpg"))
        t.links.new(mp2.outputs["Vector"], di.inputs["Vector"]); t.links.new(di.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.5
    else:
        b.inputs["Base Color"].default_value = color; b.inputs["Roughness"].default_value = 0.8
    return w
wall((0, 2.6, 2.5), (math.radians(90), 0, 0), (0.82, 0.79, 0.74, 1), wood=True)      # 뒤 목재벽
wall((-3.4, 0, 2.5), (math.radians(90), 0, math.radians(90)), (0.86, 0.85, 0.86, 1))  # 좌 오프화이트벽

# 4. 가구 배치 (v1과 동일)
def place(name, tx, ty, rz=0.0, lift=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, name, name + ".gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent not in new]
    e = bpy.data.objects.new(f"c_{name}", None); bpy.context.collection.objects.link(e)
    for rt in roots:
        rt.parent = e; rt.matrix_parent_inverse = e.matrix_world.inverted()
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ mathutils.Vector(c)).z for o in new if o.type == "MESH" for c in o.bound_box]
    e.location = (tx, ty, -(min(zs) if zs else 0) + lift); e.rotation_euler = (0, 0, math.radians(rz))
    bpy.context.view_layer.update()
place("metal_office_desk", 0.0, 0.4, 0)
place("modern_arm_chair_01", 0.0, -0.7, 180)
place("classic_laptop", 0.0, 0.35, 180, 0.74)
place("Sofa_01", -2.4, -0.6, 25)
place("potted_plant_01", 1.9, 1.3, 0)
place("potted_plant_01", -2.9, 1.4, 0)

# 5. 태양광(선명한 그림자)
bpy.ops.object.light_add(type="SUN", location=(6, -6, 12))
s = bpy.context.object; s.data.energy = 2.2; s.data.angle = math.radians(2.5)
s.rotation_euler = (math.radians(52), 0, math.radians(-42))

# 6. 카메라 (동일 아이소)
bpy.ops.object.camera_add(); co = bpy.context.object; c = co.data
c.type = "ORTHO"; c.ortho_scale = 6.8; c.clip_start = 0.1; c.clip_end = 100
E = math.degrees(math.atan(1/math.sqrt(2))); A = 45.0; dd = 15.0
er, ar = math.radians(E), math.radians(A)
co.location = (dd*math.cos(er)*math.sin(ar), -dd*math.cos(er)*math.cos(ar), dd*math.sin(er))
co.rotation_euler = (math.radians(90-E), 0, math.radians(A)); bpy.context.scene.camera = co

# 7. 렌더 (GPU)
sc = bpy.context.scene; sc.render.engine = "CYCLES"
try:
    pr = bpy.context.preferences.addons["cycles"].preferences; pr.get_devices()
    for bk in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        if any(dv.type == bk for dv in pr.devices):
            pr.compute_device_type = bk
            for dv in pr.devices: dv.use = (dv.type == bk)
            sc.cycles.device = "GPU"; print(f"[v2] GPU {bk}"); break
    else: sc.cycles.device = "CPU"
except Exception: sc.cycles.device = "CPU"
sc.cycles.samples = 256; sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.01
sc.cycles.use_denoising = True
sc.render.resolution_x = W; sc.render.resolution_y = H
sc.view_settings.view_transform = "AgX"
sc.render.filepath = os.path.join(OUT_DIR, "office_cc0_v2.png")
print("[v2] 렌더 시작"); bpy.ops.render.render(write_still=True); print("[v2] 완료")
