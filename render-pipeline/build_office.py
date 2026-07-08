"""
render-pipeline/build_office.py
Phase 0 Depth-Composite Spike — Blender Headless Render Script

@TASK T0.1 — Blender 헤드리스 오피스 씬 렌더 + 카메라 행렬 export
@SPEC docs/planning/16-render-spike-and-roadmap.md#A.2
@SPEC docs/3d-design/photoreal-web-strategy.md#2-4

Usage:
  "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" \
    --background --python render-pipeline/build_office.py

  # 출력 경로 override (optional)
  blender --background --python render-pipeline/build_office.py -- --out ./render-pipeline/out

산출물:
  out/office_bg.png       — Cycles Color 패스 (포토리얼 배경)
  out/office_depth.png    — Z Depth 패스 (선형화, 0=near 1=far, grayscale)
  out/camera.json         — 카메라 행렬·ortho scale·near/far·위치·회전
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
    mat.blend_method = "BLEND"
    mat.shadow_method = "NONE"
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
#  center: (0, 1, 0.375)  ← 아바타가 X 방향으로 통과할 때 책상 앞/뒤 테스트용
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
# Freestyle 또는 간단한 Grid 사용
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

# World (HDRI 대신 단색)
world = bpy.data.worlds["World"]
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
#    카메라 위치: 씬 중심(0,0,0)에서 iso 방향으로 d=12 떨어진 지점
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
# 회전 = (90-ELEV, 0, AZIM)  in Euler XYZ
cam_obj.rotation_euler = (
    math.radians(90 - ELEV),  # X
    0.0,                        # Y
    math.radians(AZIM),         # Z
)

scene.camera = cam_obj

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

# ---------------------------------------------------------------------------
# 6. 패스 설정 (Color + Z Depth)
# ---------------------------------------------------------------------------
scene.view_layers[0].use_pass_z = True
scene.view_layers[0].use_pass_combined = True

# Compositor nodes
scene.use_nodes = True
tree = scene.node_tree
for node in tree.nodes:
    tree.nodes.remove(node)

rl_node = tree.nodes.new("CompositorNodeRLayers")
rl_node.location = (0, 0)

# Color 출력 (office_bg.png)
composite_color = tree.nodes.new("CompositorNodeComposite")
composite_color.location = (400, 100)
tree.links.new(rl_node.outputs["Image"], composite_color.inputs["Image"])

# Depth 출력 — 선형 Z를 [0,1]로 정규화
#   normalize: (Z - near) / (far - near)
#   Blender Depth 패스는 near~far 범위의 실제 거리값
normalize = tree.nodes.new("CompositorNodeNormalize")
normalize.location = (250, -200)
tree.links.new(rl_node.outputs["Depth"], normalize.inputs[0])

file_output = tree.nodes.new("CompositorNodeOutputFile")
file_output.location = (500, -200)
file_output.base_path = OUT_DIR
file_output.format.file_format = "PNG"
file_output.format.color_mode = "BW"
file_output.format.color_depth = "16"
file_output.file_slots[0].path = "office_depth_raw"
tree.links.new(normalize.outputs[0], file_output.inputs[0])

# 메인 렌더 출력 경로 (Color)
scene.render.filepath = os.path.join(OUT_DIR, "office_bg.png")
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"

# ---------------------------------------------------------------------------
# 7. 렌더 실행
# ---------------------------------------------------------------------------
print(f"[build_office] 렌더 시작 → {OUT_DIR}")
bpy.ops.render.render(write_still=True)

# Depth 파일 이름 정리 (Blender가 프레임 번호를 붙임)
import glob
depth_files = sorted(glob.glob(os.path.join(OUT_DIR, "office_depth_raw*.png")))
if depth_files:
    final_depth = os.path.join(OUT_DIR, "office_depth.png")
    os.replace(depth_files[-1], final_depth)
    print(f"[build_office] Depth 저장: {final_depth}")

# ---------------------------------------------------------------------------
# 8. camera.json export
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
near = cam.clip_start
far = cam.clip_end

proj_mat = [
    [2 / ortho_w,  0,           0,                          0],
    [0,            2 / ortho_h, 0,                          0],
    [0,            0,          -2 / (far - near),  -(far + near) / (far - near)],
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
    "clip_near": near,
    "clip_far": far,
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
    }
}

json_path = os.path.join(OUT_DIR, "camera.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(camera_data, f, indent=2)

print(f"[build_office] camera.json 저장: {json_path}")
print("[build_office] 완료!")
print(f"  Color  → {scene.render.filepath}")
print(f"  Depth  → {os.path.join(OUT_DIR, 'office_depth.png')}")
print(f"  Camera → {json_path}")
