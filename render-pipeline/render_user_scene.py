"""사용자 제공 조립 씬(GLB)을 우리 아이소 파이프라인으로 렌더 — 검증용."""
import bpy, math, os, sys, mathutils

argv = sys.argv
extra = argv[argv.index("--") + 1:] if "--" in argv else []
def arg(k, d):
    return extra[extra.index(k) + 1] if k in extra else d
SCENE = os.path.abspath(arg("--scene", "docs/virtual_office_3d_assets_full_v1_0/scenes/SCENE_FULL_OFFICE_FLOOR_001.glb"))
OUT = os.path.abspath(arg("--out", "render-pipeline/out_userassets"))
HDRI = os.path.abspath(arg("--hdri", "render-pipeline/assets_cc0/hdri/brown_photostudio_02_2k.hdr"))
os.makedirs(OUT, exist_ok=True)
W, H = 1600, 1000

bpy.ops.wm.read_factory_settings(use_empty=True)

# HDRI 월드 (조명, 배경은 회색)
world = bpy.data.worlds.new("W"); bpy.context.scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(HDRI)
bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 1.0
lp = nt.nodes.new("ShaderNodeLightPath")
bgv = nt.nodes.new("ShaderNodeBackground"); bgv.inputs["Color"].default_value = (0.88, 0.89, 0.92, 1)
mix = nt.nodes.new("ShaderNodeMixShader"); out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
nt.links.new(bg.outputs["Background"], mix.inputs[1]); nt.links.new(bgv.outputs["Background"], mix.inputs[2])
nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])

# 씬 GLB 임포트
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SCENE)
new = [o for o in bpy.data.objects if o not in before]
print(f"[user-scene] 임포트 오브젝트 {len(new)}개")

# glb가 Z-up 저작 → 임포터가 Y-up 가정으로 +90X 회전시킴. 원점 기준 -90X로 세움.
pivot = bpy.data.objects.new("pivot", None); bpy.context.collection.objects.link(pivot)
for o in list(new):
    if o.parent is None:
        o.parent = pivot; o.matrix_parent_inverse = pivot.matrix_world.inverted()
pivot.rotation_euler = (math.radians(-90), 0, 0)
bpy.context.view_layer.update()

# 전체 바운딩박스 중심/크기
import mathutils
mn = mathutils.Vector((1e9,)*3); mx = mathutils.Vector((-1e9,)*3)
for o in new:
    if o.type != "MESH":
        continue
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector((min(mn[i], w[i]) for i in range(3)))
        mx = mathutils.Vector((max(mx[i], w[i]) for i in range(3)))
center = (mn + mx) / 2
size = mx - mn
print(f"[user-scene] center={center.to_tuple(2)} size={size.to_tuple(2)}")

# 태양광
bpy.ops.object.light_add(type="SUN"); s = bpy.context.object
s.data.energy = 2.0; s.data.angle = math.radians(2.5)
s.rotation_euler = (math.radians(52), 0, math.radians(-42))

# 아이소 직교 카메라 (씬 중심 조준, 전체 담기게 scale)
bpy.ops.object.camera_add(); co = bpy.context.object; cd = co.data
cd.type = "ORTHO"
cd.ortho_scale = max(size.x, size.y) * 1.15
cd.clip_start = 0.1; cd.clip_end = 200
E = math.degrees(math.atan(1/math.sqrt(2))); A = 45.0; d = 60.0
er, ar = math.radians(E), math.radians(A)
off = mathutils.Vector((d*math.cos(er)*math.sin(ar), -d*math.cos(er)*math.cos(ar), d*math.sin(er)))
co.location = center + off
co.rotation_euler = (math.radians(90-E), 0, math.radians(A))
bpy.context.scene.camera = co

# Cycles GPU
sc = bpy.context.scene; sc.render.engine = "CYCLES"
try:
    pr = bpy.context.preferences.addons["cycles"].preferences; pr.get_devices()
    for bk in ("OPTIX", "CUDA", "HIP"):
        if any(dv.type == bk for dv in pr.devices):
            pr.compute_device_type = bk
            for dv in pr.devices: dv.use = (dv.type == bk)
            sc.cycles.device = "GPU"; print(f"[user-scene] GPU {bk}"); break
    else: sc.cycles.device = "CPU"
except Exception: sc.cycles.device = "CPU"
sc.cycles.samples = 200; sc.cycles.use_adaptive_sampling = True; sc.cycles.use_denoising = True
sc.render.resolution_x = W; sc.render.resolution_y = H
sc.view_settings.view_transform = "AgX"
sc.render.filepath = os.path.join(OUT, "user_scene.png")
print("[user-scene] 렌더 시작"); bpy.ops.render.render(write_still=True); print("[user-scene] 완료")
