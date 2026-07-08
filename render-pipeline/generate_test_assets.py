"""
render-pipeline/generate_test_assets.py
Phase 0 Depth-Composite Spike — Blender 없을 때 테스트 에셋 생성기

Blender가 설치되지 않은 환경에서 build_office.py와 동일한 포맷의
더미 렌더 결과물을 Python PIL로 생성합니다.
- out/office_bg.png  : 색상 배경 (바닥/책상/유리벽 형태 포함)
- out/office_depth.png: 깊이맵 (0=near/흰색, 1=far/검정)
- out/camera.json    : 카메라 행렬 (build_office.py와 동일 포맷)

Usage:
  python render-pipeline/generate_test_assets.py
"""

import json
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT_DIR, exist_ok=True)

RENDER_W = 1920
RENDER_H = 1080

# ---------------------------------------------------------------------------
# PNG 인코더 (PIL 없이 순수 Python)
# ---------------------------------------------------------------------------

def encode_png(width: int, height: int, pixels_rgba: list) -> bytes:
    """RGBA pixels (list of (R,G,B,A) tuples) → PNG bytes"""

    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    # PNG signature
    sig = b"\x89PNG\r\n\x1a\n"

    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    # Actually let's do RGBA (color type 6)
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)

    # IDAT
    raw_rows = []
    for y in range(height):
        row = b"\x00"  # filter type None
        for x in range(width):
            r, g, b, a = pixels_rgba[y * width + x]
            row += bytes([r, g, b, a])
        raw_rows.append(row)

    compressed = zlib.compress(b"".join(raw_rows), 6)

    return (
        sig
        + chunk(b"IHDR", ihdr_data)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


def encode_png_gray(width: int, height: int, pixels_gray: list) -> bytes:
    """Grayscale pixels (list of 0-255 int) → PNG bytes (grayscale)"""

    def chunk(name: bytes, data: bytes) -> bytes:
        c = name + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)

    raw_rows = []
    for y in range(height):
        row = b"\x00"
        for x in range(width):
            row += bytes([pixels_gray[y * width + x]])
        raw_rows.append(row)

    compressed = zlib.compress(b"".join(raw_rows), 6)

    return (
        sig
        + chunk(b"IHDR", ihdr_data)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


# ---------------------------------------------------------------------------
# 아이소메트릭 씬 파라미터 (build_office.py와 동일)
# ---------------------------------------------------------------------------
ORTHO_SCALE = 8.0
ELEV = math.degrees(math.atan(1 / math.sqrt(2)))  # 35.264°
AZIM = 45.0
NEAR = 0.1
FAR = 100.0
ASPECT = RENDER_W / RENDER_H

ortho_h = ORTHO_SCALE
ortho_w = ORTHO_SCALE * ASPECT

# 아이소 행렬 (단순화된 직교 아이소 변환)
# 아이소메트릭 투영에서 3D → 2D 픽셀 변환:
#   screen_x = (world_x - world_y) * cos(30°)
#   screen_y = (world_x + world_y) * sin(30°) - world_z
# 고전 아이소(카발리에): cos30°≈0.866, sin30°=0.5
# 실제 blender 45°/35.264°에 맞춤:
#   우리 좌표에서 x,y → 화면 변환
CX = RENDER_W // 2   # 씬 중심이 화면 중앙
CY = RENDER_H // 2

# 월드 단위 → 픽셀 스케일
PX_PER_M = RENDER_H / ortho_h  # pixels per meter (세로 기준)


def world_to_screen(wx: float, wy: float, wz: float):
    """
    Blender 직교 아이소 (azim=45, elev=35.264) → 화면 픽셀
    간소화된 수식:
      iso_x = (wx - wy) / sqrt(2)
      iso_y = (wx + wy) / sqrt(2) * sin(elev) - wz * cos(elev)  ← 실제 투영
    여기서 직교이므로 크기 보존:
      px = CX + iso_x * PX_PER_M
      py = CY - iso_y * PX_PER_M  (화면 y는 위가 작음)
    """
    elev_r = math.radians(ELEV)
    azim_r = math.radians(AZIM)

    # view space (카메라가 바라보는 방향 기준 평면 투영)
    sx = (wx * math.cos(azim_r) - wy * math.sin(azim_r))
    sy = (wx * math.sin(azim_r) + wy * math.cos(azim_r)) * math.sin(elev_r) - wz * math.cos(elev_r)

    px = CX + sx * PX_PER_M
    py = CY - sy * PX_PER_M
    return px, py


def world_to_depth(wx: float, wy: float, wz: float) -> float:
    """
    월드 좌표 → 깊이값 [0,1] (near=0, far=1)
    직교 카메라이므로 깊이 = 카메라 시선 방향의 투영 거리
    """
    d = 15.0  # 카메라 거리
    elev_r = math.radians(ELEV)
    azim_r = math.radians(AZIM)

    cam_x = d * math.cos(elev_r) * math.sin(azim_r)
    cam_y = -d * math.cos(elev_r) * math.cos(azim_r)
    cam_z = d * math.sin(elev_r)

    # 카메라 시선 벡터 (정규화)
    dir_x = -cam_x / d
    dir_y = -cam_y / d
    dir_z = -cam_z / d

    # 카메라에서 점까지 벡터
    dx = wx - cam_x
    dy = wy - cam_y
    dz = wz - cam_z

    # 시선 방향 투영 = depth (카메라 공간 깊이)
    depth = -(dx * dir_x + dy * dir_y + dz * dir_z)
    depth = max(NEAR, min(FAR, depth + d))  # 절대 거리로 변환

    return (depth - NEAR) / (FAR - NEAR)


# ---------------------------------------------------------------------------
# 배경 이미지 생성 (office_bg.png)
# ---------------------------------------------------------------------------
print(f"[generate_test_assets] 배경 이미지 생성 ({RENDER_W}x{RENDER_H})...")

bg_pixels = [(40, 40, 50, 255)] * (RENDER_W * RENDER_H)  # 기본 배경

# 바닥 그리기 (연한 베이지)
FLOOR_COLOR = (210, 205, 195, 255)
DESK_COLOR = (130, 90, 55, 255)
GLASS_COLOR = (160, 210, 240, 160)   # 반투명 파랑
GRID_COLOR = (180, 175, 165, 255)

# 바닥 폴리곤 (-5~5, -5~5, z=0)  — 화면에 투영
floor_corners_world = [
    (-5, -5, 0), (5, -5, 0), (5, 5, 0), (-5, 5, 0)
]
floor_corners_screen = [world_to_screen(*p) for p in floor_corners_world]


def in_quad(x: int, y: int, corners: list) -> bool:
    """점(x,y)이 볼록 사각형 corners 내부인지 — cross product 방법"""
    n = len(corners)
    for i in range(n):
        ax, ay = corners[i]
        bx, by = corners[(i + 1) % n]
        cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
        if cross < 0:
            return False
    return True


def lerp_color(c1: tuple, c2: tuple, t: float) -> tuple:
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))


# 바닥 픽셀 채우기
for y in range(RENDER_H):
    for x in range(RENDER_W):
        idx = y * RENDER_W + x
        if in_quad(x, y, floor_corners_screen):
            # 격자 패턴 (1m 격자)
            is_grid = False
            # 격자선 위치는 근사 (픽셀 기반)
            grid_spacing = int(PX_PER_M)
            # 간단한 격자: x or y가 grid_spacing 배수 근처
            fx = (x - CX + RENDER_W) % grid_spacing
            fy = (y - CY + RENDER_H) % grid_spacing
            if fx < 2 or fy < 2:
                is_grid = True
            bg_pixels[idx] = GRID_COLOR if is_grid else FLOOR_COLOR

# 책상 그리기 — 상자의 3개 면(상면, 앞면, 측면) 근사
# 책상 world 좌표: center(0,1.2,0) scale(1.4,0.7,0.75) → min(-0.7,0.85,0) max(0.7,1.55,0.75)
desk_x1, desk_x2 = -0.7, 0.7
desk_y1, desk_y2 = 0.85, 1.55
desk_z_top = 0.75

# 상면 4 코너
desk_top = [
    (desk_x1, desk_y1, desk_z_top),
    (desk_x2, desk_y1, desk_z_top),
    (desk_x2, desk_y2, desk_z_top),
    (desk_x1, desk_y2, desk_z_top),
]
desk_top_s = [world_to_screen(*p) for p in desk_top]

# 앞면 4 코너 (y1 쪽, 플레이어가 보는 면)
desk_front = [
    (desk_x1, desk_y1, 0),
    (desk_x2, desk_y1, 0),
    (desk_x2, desk_y1, desk_z_top),
    (desk_x1, desk_y1, desk_z_top),
]
desk_front_s = [world_to_screen(*p) for p in desk_front]

# 측면 (x2 쪽)
desk_side = [
    (desk_x2, desk_y1, 0),
    (desk_x2, desk_y2, 0),
    (desk_x2, desk_y2, desk_z_top),
    (desk_x2, desk_y1, desk_z_top),
]
desk_side_s = [world_to_screen(*p) for p in desk_side]

DESK_TOP_COLOR = (160, 110, 65, 255)
DESK_FRONT_COLOR = (110, 75, 40, 255)
DESK_SIDE_COLOR = (90, 60, 30, 255)

for y in range(RENDER_H):
    for x in range(RENDER_W):
        idx = y * RENDER_W + x
        if in_quad(x, y, desk_top_s):
            bg_pixels[idx] = DESK_TOP_COLOR
        elif in_quad(x, y, desk_front_s):
            bg_pixels[idx] = DESK_FRONT_COLOR
        elif in_quad(x, y, desk_side_s):
            bg_pixels[idx] = DESK_SIDE_COLOR

# 유리벽 그리기 — glass_wall: center(0,-0.5,1.0) scale(3,0.05,2) → min(-1.5,-0.525,0) max(1.5,-0.475,2)
gw_x1, gw_x2 = -1.5, 1.5
gw_y = -0.5  # 얇아서 앞면만 그림
gw_z1, gw_z2 = 0.0, 2.0

glass_front = [
    (gw_x1, gw_y, gw_z1),
    (gw_x2, gw_y, gw_z1),
    (gw_x2, gw_y, gw_z2),
    (gw_x1, gw_y, gw_z2),
]
glass_front_s = [world_to_screen(*p) for p in glass_front]

GLASS_COL = (140, 190, 230, 255)

for y in range(RENDER_H):
    for x in range(RENDER_W):
        idx = y * RENDER_W + x
        if in_quad(x, y, glass_front_s):
            # 반투명 블렌드
            prev = bg_pixels[idx]
            alpha = 0.4
            blended = (
                int(prev[0] * (1 - alpha) + GLASS_COL[0] * alpha),
                int(prev[1] * (1 - alpha) + GLASS_COL[1] * alpha),
                int(prev[2] * (1 - alpha) + GLASS_COL[2] * alpha),
                255,
            )
            bg_pixels[idx] = blended

# PNG 저장
bg_path = os.path.join(OUT_DIR, "office_bg.png")
print(f"  PNG 인코딩 중 ({RENDER_W*RENDER_H:,}픽셀)...")
png_data = encode_png(RENDER_W, RENDER_H, bg_pixels)
with open(bg_path, "wb") as f:
    f.write(png_data)
print(f"  저장: {bg_path} ({len(png_data)//1024}KB)")

# ---------------------------------------------------------------------------
# 깊이맵 생성 (office_depth.png)
# ---------------------------------------------------------------------------
print(f"\n[generate_test_assets] 깊이맵 생성...")

depth_pixels = [255] * (RENDER_W * RENDER_H)  # 기본 = far (1.0 → 255)

# 바닥 깊이
for y in range(RENDER_H):
    for x in range(RENDER_W):
        idx = y * RENDER_W + x
        # 역투영하여 대략적인 월드 깊이 추정
        # 바닥(z=0), 책상(z=0~0.75), 유리벽(z=0~2)
        d_val = 1.0
        if in_quad(x, y, floor_corners_screen):
            # 바닥 깊이: 화면 위치에 따라 선형 보간
            # 아이소 좌표에서 y가 작을수록(위쪽) 더 멀다
            t = y / RENDER_H
            d_val = 0.3 + t * 0.3  # 0.3 ~ 0.6 범위
        if in_quad(x, y, desk_top_s):
            d_val = 0.2  # 책상은 바닥보다 가까움
        if in_quad(x, y, desk_front_s):
            d_val = 0.18
        if in_quad(x, y, desk_side_s):
            d_val = 0.19
        if in_quad(x, y, glass_front_s):
            d_val = 0.25  # 유리벽 (얕은 깊이)
        depth_pixels[idx] = int(max(0, min(255, d_val * 255)))

depth_path = os.path.join(OUT_DIR, "office_depth.png")
png_depth = encode_png_gray(RENDER_W, RENDER_H, depth_pixels)
with open(depth_path, "wb") as f:
    f.write(png_depth)
print(f"  저장: {depth_path} ({len(png_depth)//1024}KB)")

# ---------------------------------------------------------------------------
# camera.json 생성 (build_office.py와 동일 포맷)
# ---------------------------------------------------------------------------
print(f"\n[generate_test_assets] camera.json 생성...")

d = 15.0
elev_r = math.radians(ELEV)
azim_r = math.radians(AZIM)
cam_x = d * math.cos(elev_r) * math.sin(azim_r)
cam_y = -d * math.cos(elev_r) * math.cos(azim_r)
cam_z = d * math.sin(elev_r)

# 직교 투영 행렬
proj_mat = [
    [2 / ortho_w, 0, 0, 0],
    [0, 2 / ortho_h, 0, 0],
    [0, 0, -2 / (FAR - NEAR), -(FAR + NEAR) / (FAR - NEAR)],
    [0, 0, 0, 1],
]

# 뷰 행렬 (단순화 — lookAt from camera to origin)
def lookAt(eye, target, up=(0, 0, 1)):
    ex, ey, ez = eye
    tx, ty, tz = target
    ux, uy, uz = up

    # forward (eye → target)
    fl = math.sqrt((tx-ex)**2+(ty-ey)**2+(tz-ez)**2)
    fx, fy, fz = (tx-ex)/fl, (ty-ey)/fl, (tz-ez)/fl

    # right = forward × up
    rl = math.sqrt((fy*uz-fz*uy)**2+(fz*ux-fx*uz)**2+(fx*uy-fy*ux)**2)
    rx, ry, rz = (fy*uz-fz*uy)/rl, (fz*ux-fx*uz)/rl, (fx*uy-fy*ux)/rl

    # up = right × forward
    upx, upy, upz = ry*fz-rz*fy, rz*fx-rx*fz, rx*fy-ry*fx

    # View matrix (row-major)
    return [
        rx, ry, rz, -(rx*ex+ry*ey+rz*ez),
        upx, upy, upz, -(upx*ex+upy*ey+upz*ez),
        -fx, -fy, -fz, (fx*ex+fy*ey+fz*ez),
        0, 0, 0, 1,
    ]

view_mat_flat = lookAt((cam_x, cam_y, cam_z), (0, 0, 0))
proj_mat_flat = [v for row in proj_mat for v in row]

camera_data = {
    "camera_type": "ORTHO",
    "source": "generate_test_assets.py (Blender 없을 때 더미)",
    "ortho_scale": ORTHO_SCALE,
    "ortho_w": ortho_w,
    "ortho_h": ortho_h,
    "aspect": ASPECT,
    "render_w": RENDER_W,
    "render_h": RENDER_H,
    "clip_near": NEAR,
    "clip_far": FAR,
    "elevation_deg": ELEV,
    "azimuth_deg": AZIM,
    "camera_position": [cam_x, cam_y, cam_z],
    "camera_rotation_euler_xyz_rad": [
        math.radians(90 - ELEV), 0.0, math.radians(AZIM)
    ],
    "camera_rotation_euler_xyz_deg": [90 - ELEV, 0.0, AZIM],
    "view_matrix_row_major": view_mat_flat,
    "projection_matrix_row_major": proj_mat_flat,
    "world_matrix_row_major": list(range(16)),  # placeholder
    "threejs_notes": {
        "coordinate_system": "Blender Y-forward Z-up → Three.js Y-up Z-forward 변환 필요",
        "axis_remap": "Blender(x,y,z) → Three.js(x,z,-y)",
        "ortho_half_w": ortho_w / 2,
        "ortho_half_h": ortho_h / 2,
    },
}

json_path = os.path.join(OUT_DIR, "camera.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(camera_data, f, indent=2)
print(f"  저장: {json_path}")

print("\n[generate_test_assets] 완료!")
print(f"  Color  → {bg_path}")
print(f"  Depth  → {depth_path}")
print(f"  Camera → {json_path}")
print("\n  다음 단계: cd spikes/depth-composite && npm install && npm run dev")
