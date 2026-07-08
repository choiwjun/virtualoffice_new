"""
render-pipeline/build_office.py
Phase 0 Depth-Composite Spike — Blender Headless Render Script

@TASK T0.1 — Blender 헤드리스 오피스 씬 렌더 + 카메라 행렬 export
@SPEC docs/planning/16-render-spike-and-roadmap.md#A.2
@SPEC docs/3d-design/photoreal-web-strategy.md#2-4

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" \\
    --background --python render-pipeline/build_office.py

  # 출력 경로 override (optional)
  blender --background --python render-pipeline/build_office.py -- --out ./render-pipeline/out

산출물:
  out/office_bg.png       — Cycles Color 패스 (포토리얼 배경, RGBA)
  out/office_depth.png    — Z Depth 패스 (선형화, 0=near 1=far, grayscale 16bit)
  out/camera.json         — 카메라 행렬·ortho scale·near/far·위치·회전

Blender 5.1 API 변경 대응:
  - Material blend_method/shadow_method 제거됨 (Cycles 불필요)
  - bpy.data.worlds["World"] → get-or-create 패턴
  - scene.node_tree/use_nodes 폐지 → compositing_node_group 방식
  - CompositorNodeComposite 폐지 → 컬러는 scene.render.filepath 저장
  - CompositorNodeOutputFile.format → OPEN_EXR_MULTILAYER 전용
    → depth는 material_override + View Z Depth Emission 2차 렌더로 해결

Depth 인코딩 규약 (R3F 셰이더 정합):
  - 0.0 = near (카메라에 가까움, 검정)
  - 1.0 = far  (카메라에서 멀리, 흰색)
  - ShaderNode Camera Data "View Z Depth" → Map Range(near..far → 0..1) → Emission
  - 이는 depthComposite.glsl.ts의 bgDepth=0(near)..1(far) 규약과 일치
  - 직교 카메라 gl_FragCoord.z: 0=near, 1=far (동일 방향)
"""

import bpy
import json
import math
import os
import sys

# ---------------------------------------------------------------------------
# 0. CLI 인자 파싱
# ---------------------------------------------------------------------------
argv = sys.argv
double_dash = argv.index("--") + 1 if "--" in argv else len(argv)
extra_args = argv[double_dash:]

OUT_DIR = "./render-pipeline/out"
if "--out" in extra_args:
    idx = extra_args.index("--out")
    OUT_DIR = extra_args[idx + 1]

OUT_DIR = os.path.abspath(OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)

RENDER_W = 1920
RENDER_H = 1080

# ---------------------------------------------------------------------------
# 1. 씬 초기화
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "OfficeSpike"
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

# ---------------------------------------------------------------------------
# 2. 씬 구성
#    좌표계: Blender Y-up / Z-forward(뷰 기준)
#    오피스 좌표: X=가로, Y=세로, Z=높이
#
#    단순 씬 구성:
#      - 바닥 (Floor): 10m x 10m 평면, Z=0
#      - 책상 (Desk): 1.4m x 0.7m x 0.75m 박스, 씬 중앙
#      - 유리벽 (GlassWall): 3m x 0.05m x 2m 평면(반투명)
# ---------------------------------------------------------------------------

def make_material_opaque(name: str, color: tuple) -> bpy.types.Material:
    """PBR 불투명 머티리얼"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def make_material_glass(name: str) -> bpy.types.Material:
    """반투명 유리 머티리얼"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    # blend_method/shadow_method는 EEVEE 전용이며 Blender 5.1에서 제거됨.
    # 렌더 엔진이 Cycles이므로 BSDF transmission/alpha로 유리를 표현.
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.7, 0.85, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Transmission Weight"].default_value = 0.8
    bsdf.inputs["Alpha"].default_value = 0.35
    return mat


# -- 바닥 --
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
floor = bpy.context.object
floor.name = "Floor"
mat_floor = make_material_opaque("MatFloor", (0.85, 0.82, 0.78))
floor.data.materials.append(mat_floor)

# -- 책상 --
#  center: (0, 1.2, 0.375)  ← 아바타가 X 방향으로 통과할 때 책상 앞/뒤 테스트용
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.0, 1.2, 0.375))
desk = bpy.context.object
desk.name = "Desk"
desk.scale = (1.4, 0.7, 0.75)
bpy.ops.object.transform_apply(scale=True)
mat_desk = make_material_opaque("MatDesk", (0.55, 0.40, 0.25))
desk.data.materials.append(mat_desk)

# -- 책상다리 (보조 형태감) --
for dx, dy in [(-0.6, -0.25), (0.6, -0.25), (-0.6, 0.25), (0.6, 0.25)]:
    bpy.ops.mesh.primitive_cube_add(
        size=1, location=(0.0 + dx, 1.2 + dy, 0.185)
    )
    leg = bpy.context.object
    leg.name = f"DeskLeg_{dx:.0f}_{dy:.0f}"
    leg.scale = (0.06, 0.06, 0.37)
    bpy.ops.object.transform_apply(scale=True)
    mat_leg = make_material_opaque("MatLeg", (0.3, 0.3, 0.3))
    leg.data.materials.append(mat_leg)

# -- 유리벽 --
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.0, -0.5, 1.0))
glass_wall = bpy.context.object
glass_wall.name = "GlassWall"
glass_wall.scale = (3.0, 0.05, 2.0)
bpy.ops.object.transform_apply(scale=True)
mat_glass = make_material_glass("MatGlass")
glass_wall.data.materials.append(mat_glass)

# -- 격자 타일 바닥 (좌표 정합 확인용 그리드 라인) --
bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=10, size=10, location=(0, 0, 0.001))
grid = bpy.context.object
grid.name = "FloorGrid"
mat_grid = bpy.data.materials.new("MatGrid")
mat_grid.use_nodes = True
bsdf_g = mat_grid.node_tree.nodes["Principled BSDF"]
bsdf_g.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1.0)
bsdf_g.inputs["Roughness"].default_value = 1.0
grid.data.materials.append(mat_grid)

# ---------------------------------------------------------------------------
# 3. 조명
# ---------------------------------------------------------------------------
# 메인 Sun
bpy.ops.object.light_add(type="SUN", location=(5, -5, 10))
sun = bpy.context.object
sun.name = "SunLight"
sun.data.energy = 3.0
sun.data.angle = math.radians(5)
sun.rotation_euler = (math.radians(55), 0, math.radians(-45))

# 보조 Area (fill)
bpy.ops.object.light_add(type="AREA", location=(-3, -4, 6))
fill = bpy.context.object
fill.name = "FillLight"
fill.data.energy = 200
fill.data.size = 4.0
fill.rotation_euler = (math.radians(60), 0, math.radians(30))

# World (HDRI 대신 단색) — 시작 파일에 World가 없으면 생성
world = bpy.data.worlds.get("World")
if world is None:
    world = bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg_node = world.node_tree.nodes["Background"]
bg_node.inputs["Color"].default_value = (0.75, 0.82, 0.95, 1.0)
bg_node.inputs["Strength"].default_value = 0.8

# ---------------------------------------------------------------------------
# 4. 직교(Orthographic) 아이소메트릭 카메라 설정
#
#    아이소메트릭 표준: elevation = arctan(1/sqrt(2)) ≈ 35.264°
#    azimuth 45° 방향(우상-좌하 대각)
#
#    카메라 위치: 씬 중심(0,0,0)에서 iso 방향으로 d=15 떨어진 지점
# ---------------------------------------------------------------------------
bpy.ops.object.camera_add()
cam_obj = bpy.context.object
cam_obj.name = "IsoCam"
cam = cam_obj.data
cam.type = "ORTHO"

# ortho scale: 화면에 보일 월드 세로 폭 (m 단위)
# RENDER_H/RENDER_W 비율로 가로는 자동 계산됨
ORTHO_SCALE = 8.0  # 씬이 8m 세로 폭으로 보임
cam.ortho_scale = ORTHO_SCALE
cam.clip_start = 0.1
cam.clip_end = 100.0

# 아이소 위치·회전
# elevation = 35.264° = arctan(1/sqrt(2))
ELEV = math.degrees(math.atan(1 / math.sqrt(2)))  # ~35.264
AZIM = 45.0  # 북동 방향

d = 15.0  # 원점에서 카메라까지 거리
azim_rad = math.radians(AZIM)
elev_rad = math.radians(ELEV)
cam_x = d * math.cos(elev_rad) * math.sin(azim_rad)
cam_y = -d * math.cos(elev_rad) * math.cos(azim_rad)
cam_z = d * math.sin(elev_rad)

cam_obj.location = (cam_x, cam_y, cam_z)

# 카메라가 원점(0,0,0)을 향하도록 회전
# Blender 방향: -Z = 렌더 방향
# 회전 = (90-ELEV, 0, AZIM) in Euler XYZ
cam_obj.rotation_euler = (
    math.radians(90 - ELEV),  # X
    0.0,                        # Y
    math.radians(AZIM),         # Z
)

scene.camera = cam_obj

NEAR = cam.clip_start  # 0.1
FAR  = cam.clip_end    # 100.0

# ---------------------------------------------------------------------------
# 5. 렌더 설정 (Cycles)
# ---------------------------------------------------------------------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"      # GPU 없는 환경 보장; GPU 있으면 "GPU"로 변경
scene.cycles.samples = 128       # 스파이크용 최소값; 품질용은 512+
scene.cycles.use_denoising = True

scene.render.resolution_x = RENDER_W
scene.render.resolution_y = RENDER_H
scene.render.resolution_percentage = 100

# compositing_node_group: 컬러 렌더 시에는 None (컴포지터 비활성화)
# Blender 5.1에서 CompositorNodeComposite 폐지 → 렌더 결과를 직접 filepath로 저장
scene.compositing_node_group = None

# ---------------------------------------------------------------------------
# 6-A. 1차 렌더: 컬러 (office_bg.png)
#      Cycles 일반 렌더 → scene.render.filepath 저장
# ---------------------------------------------------------------------------
scene.render.filepath = os.path.join(OUT_DIR, "office_bg.png")
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"

print(f"[build_office] 1차 렌더(컬러) 시작 → {scene.render.filepath}")
bpy.ops.render.render(write_still=True)
print(f"[build_office] office_bg.png 저장 완료")

# ---------------------------------------------------------------------------
# 6-B. 2차 렌더: Depth (office_depth.png)
#
#      Blender 5.1 CompositorNodeOutputFile은 OPEN_EXR_MULTILAYER 전용.
#      → 대안: view_layer.material_override 로 씬 전체를 depth 재질로 교체하여
#              2차 렌더링 수행.
#
#      Depth 재질 구성:
#        ShaderNodeCameraData ("View Z Depth") → ShaderNodeMapRange(NEAR..FAR → 0..1)
#        → ShaderNodeEmission (강도 1.0)
#        → ShaderNodeOutputMaterial
#
#      Depth 인코딩 규약:
#        0.0 = near (카메라에 가까움, 검정)  ← 픽셀값 0
#        1.0 = far  (카메라에서 멀리, 흰색)  ← 픽셀값 255/65535
#
#      R3F 셰이더 정합 (depthComposite.glsl.ts):
#        bgDepth = texture2D(uOfficeDepth, screenUV).r  → 0=near, 1=far
#        avatarDepth = gl_FragCoord.z                   → 0=near, 1=far (직교카메라 선형)
#        if (avatarDepth > bgDepth + bias) → discard
#        → 동일 방향이므로 정합됨
# ---------------------------------------------------------------------------

# Depth 전용 재질 생성
depth_mat = bpy.data.materials.new("DepthOverrideMat")
depth_mat.use_nodes = True
nt = depth_mat.node_tree

# 기존 노드 제거
for node in list(nt.nodes):
    nt.nodes.remove(node)

# Camera Data 노드 (View Z Depth: 실제 거리, m 단위)
cam_data_node = nt.nodes.new("ShaderNodeCameraData")
cam_data_node.location = (-600, 0)

# Map Range: NEAR..FAR (m) → 0..1
# "View Z Depth" 출력 = outputs[1] (Blender 5.1 확인됨)
map_range_node = nt.nodes.new("ShaderNodeMapRange")
map_range_node.location = (-300, 0)
map_range_node.inputs["From Min"].default_value = NEAR
map_range_node.inputs["From Max"].default_value = FAR
map_range_node.inputs["To Min"].default_value = 0.0
map_range_node.inputs["To Max"].default_value = 1.0
map_range_node.clamp = True

# Emission
emission_node = nt.nodes.new("ShaderNodeEmission")
emission_node.location = (0, 0)
emission_node.inputs["Strength"].default_value = 1.0

# Material Output (Surface)
out_node = nt.nodes.new("ShaderNodeOutputMaterial")
out_node.location = (300, 0)

# 링크 연결
# CameraData outputs[1] = "View Z Depth"
nt.links.new(cam_data_node.outputs["View Z Depth"], map_range_node.inputs["Value"])
nt.links.new(map_range_node.outputs["Result"], emission_node.inputs["Color"])
nt.links.new(emission_node.outputs["Emission"], out_node.inputs["Surface"])

# view_layer.material_override 설정
view_layer = scene.view_layers[0]
view_layer.material_override = depth_mat

# Depth 렌더는 컴포지터 불필요
scene.compositing_node_group = None

# Depth 렌더 설정 (BW 16bit PNG)
depth_path = os.path.join(OUT_DIR, "office_depth.png")
scene.render.filepath = depth_path
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "BW"
scene.render.image_settings.color_depth = "16"

print(f"[build_office] 2차 렌더(Depth) 시작 → {depth_path}")
bpy.ops.render.render(write_still=True)
print(f"[build_office] office_depth.png 저장 완료")

# material_override 해제 (씬 복원, 필요시)
view_layer.material_override = None

# ---------------------------------------------------------------------------
# 7. camera.json export
# ---------------------------------------------------------------------------
import mathutils

# 뷰 행렬 = 카메라 월드행렬의 역행렬
world_mat = cam_obj.matrix_world
view_mat = world_mat.inverted()

# 직교 투영 행렬 수동 계산
#   P[0][0] = 2 / (right - left) = 2 / (ortho_w)
#   P[1][1] = 2 / (top - bottom) = 2 / (ortho_scale)
#   P[2][2] = -2 / (far - near)
aspect = RENDER_W / RENDER_H
ortho_h = ORTHO_SCALE
ortho_w = ORTHO_SCALE * aspect

proj_mat = [
    [2 / ortho_w,  0,           0,                          0],
    [0,            2 / ortho_h, 0,                          0],
    [0,            0,          -2 / (FAR - NEAR),  -(FAR + NEAR) / (FAR - NEAR)],
    [0,            0,           0,                          1],
]

camera_data = {
    "camera_type": "ORTHO",
    "ortho_scale": ORTHO_SCALE,
    "ortho_w": ortho_w,
    "ortho_h": ortho_h,
    "aspect": aspect,
    "render_w": RENDER_W,
    "render_h": RENDER_H,
    "clip_near": NEAR,
    "clip_far": FAR,
    "elevation_deg": ELEV,
    "azimuth_deg": AZIM,
    "camera_position": list(cam_obj.location),
    "camera_rotation_euler_xyz_rad": list(cam_obj.rotation_euler),
    "camera_rotation_euler_xyz_deg": [math.degrees(e) for e in cam_obj.rotation_euler],
    # 행렬은 행(row) 우선 flat list (16개)
    "view_matrix_row_major": [v for row in view_mat for v in row],
    "projection_matrix_row_major": [v for row in proj_mat for v in row],
    "world_matrix_row_major": [v for row in world_mat for v in row],
    # Three.js 변환에 필요한 정보
    "threejs_notes": {
        "coordinate_system": "Blender Y-forward Z-up → Three.js Y-up Z-forward 변환 필요",
        "axis_remap": "Blender(x,y,z) → Three.js(x,z,-y)",
        "ortho_half_w": ortho_w / 2,
        "ortho_half_h": ortho_h / 2,
    },
    # Depth 인코딩 메타데이터
    "depth_encoding": {
        "method": "material_override_emission",
        "convention": "0=near(black), 1=far(white)",
        "near_m": NEAR,
        "far_m": FAR,
        "color_depth_bits": 16,
        "shader_node": "ShaderNodeCameraData.View_Z_Depth → MapRange(near..far→0..1) → Emission",
        "r3f_shader_compat": "depthComposite.glsl.ts bgDepth=0(near)..1(far) 정합됨",
    }
}

json_path = os.path.join(OUT_DIR, "camera.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(camera_data, f, indent=2, ensure_ascii=False)

print(f"[build_office] camera.json 저장: {json_path}")
print("[build_office] 완료!")
print(f"  Color  → {os.path.join(OUT_DIR, 'office_bg.png')}")
print(f"  Depth  → {depth_path}")
print(f"  Camera → {json_path}")

# 산출물 크기 확인
for fname in ["office_bg.png", "office_depth.png", "camera.json"]:
    fpath = os.path.join(OUT_DIR, fname)
    if os.path.exists(fpath):
        size = os.path.getsize(fpath)
        mtime = os.path.getmtime(fpath)
        import time
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime))
        print(f"  [{fname}] {size:,} bytes @ {ts}")
    else:
        print(f"  [{fname}] NOT FOUND!")
