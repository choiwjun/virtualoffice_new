"""
build_office_cc0.py — CC0 에셋 증거 렌더
유료 없이(Poly Haven CC0 가구 + HDRI + 절차적 바닥) 어느 품질이 나오는지 실측용.

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" \\
    --background --python render-pipeline/build_office_cc0.py -- --out ./render-pipeline/out_cc0
"""
import bpy, math, os, sys, mathutils

argv = sys.argv
extra = argv[argv.index("--") + 1:] if "--" in argv else []
OUT_DIR = os.path.abspath(extra[extra.index("--out") + 1]) if "--out" in extra else \
    os.path.abspath("./render-pipeline/out_cc0")
os.makedirs(OUT_DIR, exist_ok=True)
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets_cc0")

RENDER_W, RENDER_H = 1280, 720

# ---------------------------------------------------------------------------
# 0. 씬 클리어
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------------------
# 1. HDRI 월드 (newman_lobby, CC0) — 실내 조명
# ---------------------------------------------------------------------------
world = bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
bg = nt.nodes.new("ShaderNodeBackground")
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(ASSETS, "hdri", "newman_lobby_2k.hdr"))
bg.inputs["Strength"].default_value = 1.0
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

# ---------------------------------------------------------------------------
# 2. 바닥 (절차적 광택 목재톤 — 텍스처 미다운로드, 노드로 대체)
# ---------------------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
floor = bpy.context.object
mat = bpy.data.materials.new("Floor")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.62, 0.52, 0.42, 1.0)  # 따뜻한 목재톤
bsdf.inputs["Roughness"].default_value = 0.35                       # 살짝 광택(HDRI 반사)
floor.data.materials.append(mat)

# ---------------------------------------------------------------------------
# 3. CC0 GLTF 배치 헬퍼 (바닥에 안착 + 위치/회전)
# ---------------------------------------------------------------------------
def place(name, tx, ty, rz_deg=0.0, z_lift=0.0, s=1.0):
    path = os.path.join(ASSETS, name, name + ".gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent not in new]
    emp = bpy.data.objects.new(f"ctl_{name}", None)
    bpy.context.collection.objects.link(emp)
    for r in roots:
        r.parent = emp
        r.matrix_parent_inverse = emp.matrix_world.inverted()
    emp.scale = (s, s, s)
    bpy.context.view_layer.update()
    zs = []
    for o in new:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            zs.append((o.matrix_world @ mathutils.Vector(c)).z)
    minz = min(zs) if zs else 0.0
    emp.location = (tx, ty, -minz + z_lift)
    emp.rotation_euler = (0, 0, math.radians(rz_deg))
    bpy.context.view_layer.update()
    return emp

# 오피스 코너 배치 (미터)
place("metal_office_desk", 0.0, 0.4, rz_deg=0)
place("modern_arm_chair_01", 0.0, -0.7, rz_deg=180)   # 책상 마주보게
place("classic_laptop", 0.0, 0.35, rz_deg=180, z_lift=0.74)  # 책상 위
place("Sofa_01", -2.4, -0.6, rz_deg=25)
place("potted_plant_01", 1.9, 1.3, rz_deg=0)
place("potted_plant_01", -2.9, 1.4, rz_deg=0)

# ---------------------------------------------------------------------------
# 4. 보강 조명 (HDRI + 태양광으로 선명한 그림자)
# ---------------------------------------------------------------------------
bpy.ops.object.light_add(type="SUN", location=(6, -6, 12))
sun = bpy.context.object
sun.data.energy = 2.5
sun.data.angle = math.radians(3)  # 부드러운 그림자 경계
sun.rotation_euler = (math.radians(50), 0, math.radians(-40))

# ---------------------------------------------------------------------------
# 5. 직교 아이소 카메라 (build_office.py와 동일 규약)
# ---------------------------------------------------------------------------
bpy.ops.object.camera_add()
cam_obj = bpy.context.object
cam = cam_obj.data
cam.type = "ORTHO"
cam.ortho_scale = 6.5
cam.clip_start = 0.1
cam.clip_end = 100.0
ELEV = math.degrees(math.atan(1 / math.sqrt(2)))
AZIM = 45.0
d = 15.0
er, ar = math.radians(ELEV), math.radians(AZIM)
cam_obj.location = (d*math.cos(er)*math.sin(ar), -d*math.cos(er)*math.cos(ar), d*math.sin(er))
cam_obj.rotation_euler = (math.radians(90 - ELEV), 0.0, math.radians(AZIM))
bpy.context.scene.camera = cam_obj

# ---------------------------------------------------------------------------
# 6. Cycles 렌더 설정
# ---------------------------------------------------------------------------
scene = bpy.context.scene
scene.render.engine = "CYCLES"
# GPU 시도, 실패 시 CPU
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.get_devices()
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
            devs = [d for d in prefs.devices if d.type == backend]
            if devs:
                for d in prefs.devices:
                    d.use = (d.type == backend)
                scene.cycles.device = "GPU"
                print(f"[cc0] GPU 백엔드: {backend} ({len(devs)}개)")
                break
        except Exception:
            continue
    else:
        scene.cycles.device = "CPU"
        print("[cc0] GPU 없음 → CPU")
except Exception as e:
    scene.cycles.device = "CPU"
    print(f"[cc0] GPU 설정 실패 → CPU: {e}")

scene.cycles.samples = 256
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.01
scene.cycles.use_denoising = True
scene.render.resolution_x = RENDER_W
scene.render.resolution_y = RENDER_H
scene.render.film_transparent = False
# 뷰 트랜스폼: AgX (Blender 5.1 기본, 필믹 룩)
scene.view_settings.view_transform = "AgX"

scene.render.filepath = os.path.join(OUT_DIR, "office_cc0.png")
print("[cc0] 렌더 시작...")
bpy.ops.render.render(write_still=True)
print(f"[cc0] 완료: {scene.render.filepath}")
