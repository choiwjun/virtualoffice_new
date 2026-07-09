import os, json, math, shutil, zipfile, textwrap
from pathlib import Path
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Any, Tuple

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.transformations import euler_matrix
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('/mnt/data/virtual_office_3d_assets_v0_1')
MODELS = ROOT / 'models'
METADATA = ROOT / 'metadata'
PREVIEWS = ROOT / 'previews' / 'thumbnails'
TURNTABLES = ROOT / 'previews' / 'turntables'
REGISTRY = ROOT / 'registry'
PREFABS = ROOT / 'prefabs'
MATERIALS = ROOT / 'materials'
TEXTURES = MATERIALS / 'textures'
QA = ROOT / 'qa'
SCENES = ROOT / 'scenes'
ANIMS = ROOT / 'animations'
SOURCE = ROOT / 'source' / 'procedural_scripts'

for p in [MODELS, METADATA, PREVIEWS, TURNTABLES, REGISTRY, PREFABS, MATERIALS, TEXTURES, QA, SCENES, ANIMS, SOURCE]:
    p.mkdir(parents=True, exist_ok=True)

# ---------------------------
# Material helpers
# ---------------------------
MATERIAL_CACHE: Dict[Tuple, PBRMaterial] = {}

def rgba(hex_color: str, alpha: float = 1.0):
    hex_color = hex_color.strip().lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join(c*2 for c in hex_color)
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (r, g, b, int(max(0,min(1,alpha))*255))

def make_uniform_image(color_rgba, size=(4,4), mode='RGBA'):
    if mode == 'RGB':
        color = color_rgba[:3]
    else:
        color = color_rgba
    return Image.new(mode, size, color)

def make_material(name: str, color: str = '#ffffff', alpha: float = 1.0, roughness: float = 0.65, metallic: float = 0.0, double_sided=False):
    key = (name, color, round(alpha,3), round(roughness,3), round(metallic,3), double_sided)
    if key in MATERIAL_CACHE:
        return MATERIAL_CACHE[key]
    color_rgba = rgba(color, alpha)
    base_img = make_uniform_image(color_rgba, mode='RGBA')
    # glTF metallicRoughness texture: G=roughness, B=metallic. R unused.
    mr_img = Image.new('RGB', (4,4), (0, int(roughness*255), int(metallic*255)))
    normal_img = Image.new('RGB', (4,4), (128,128,255))
    mat = PBRMaterial(
        name=name,
        baseColorFactor=[color_rgba[0]/255, color_rgba[1]/255, color_rgba[2]/255, color_rgba[3]/255],
        baseColorTexture=base_img,
        metallicRoughnessTexture=mr_img,
        normalTexture=normal_img,
        metallicFactor=float(metallic),
        roughnessFactor=float(roughness),
        alphaMode='BLEND' if alpha < 0.999 else 'OPAQUE',
        doubleSided=double_sided,
    )
    MATERIAL_CACHE[key] = mat
    return mat

def font(size=32, bold=False):
    paths = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ]
    for path in paths:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()

def make_text_image(text: str, size=(512,256), bg='#ffffff', fg='#111111', accent=None, align='center'):
    img = Image.new('RGBA', size, rgba(bg, 1.0))
    draw = ImageDraw.Draw(img)
    # optional accent blocks for screens/signs
    if accent:
        for i, c in enumerate(accent):
            draw.rectangle([12+i*42, 12, 42+i*42, 42], fill=rgba(c, 1))
    lines = text.split('\n')
    f = font(max(14, min(64, int(size[1]/(len(lines)*2.1)))), bold=True)
    line_heights = []
    widths = []
    for line in lines:
        bbox = draw.textbbox((0,0), line, font=f)
        widths.append(bbox[2]-bbox[0])
        line_heights.append(bbox[3]-bbox[1])
    total_h = sum(line_heights) + int(0.25*f.size)*(len(lines)-1)
    y = (size[1]-total_h)//2
    for i,line in enumerate(lines):
        w = widths[i]
        x = (size[0]-w)//2 if align == 'center' else 24
        draw.text((x,y), line, font=f, fill=rgba(fg,1.0))
        y += line_heights[i] + int(0.25*f.size)
    return img

def make_textured_material(name, image, roughness=0.7, metallic=0.0, alpha=1.0, double_sided=True):
    mr_img = Image.new('RGB', (4,4), (0, int(roughness*255), int(metallic*255)))
    normal_img = Image.new('RGB', (4,4), (128,128,255))
    return PBRMaterial(
        name=name,
        baseColorFactor=[1,1,1,alpha],
        baseColorTexture=image,
        metallicRoughnessTexture=mr_img,
        normalTexture=normal_img,
        metallicFactor=metallic,
        roughnessFactor=roughness,
        alphaMode='BLEND' if alpha < 0.999 else 'OPAQUE',
        doubleSided=double_sided,
    )

COLORS = {
    'wood': '#B98245',
    'wood_dark': '#7A4B2A',
    'metal_dark': '#1F2933',
    'metal': '#6B7280',
    'metal_light': '#C0C7CF',
    'plastic_black': '#111827',
    'fabric_black': '#1F2937',
    'fabric_gray': '#6B7280',
    'fabric_blue': '#243B66',
    'fabric_green': '#2E7D5B',
    'fabric_cream': '#EAE2D6',
    'white': '#F7F7F2',
    'screen': '#111827',
    'screen_blue': '#69B7D8',
    'glass': '#9ED8EA',
    'plant': '#2F7D32',
    'plant_light': '#5EAA4A',
    'paper': '#FAFAF3',
    'coffee': '#5B351E',
    'red': '#C0392B',
    'yellow': '#F2C94C',
    'orange': '#E67E22',
    'blue': '#2F80ED',
}

# ---------------------------
# Geometry helpers
# ---------------------------

def assign_material(mesh: trimesh.Trimesh, material: PBRMaterial):
    mesh.visual = trimesh.visual.TextureVisuals(uv=np.zeros((len(mesh.vertices),2)), material=material)
    return mesh

def transform_mesh(mesh: trimesh.Trimesh, loc=(0,0,0), rot=(0,0,0), scale=None):
    if scale is not None:
        mesh.apply_scale(scale)
    if rot != (0,0,0):
        rx, ry, rz = [math.radians(v) for v in rot]
        mesh.apply_transform(euler_matrix(rx, ry, rz, 'sxyz'))
    if loc != (0,0,0):
        mesh.apply_translation(loc)
    return mesh

def add_mesh(scene: trimesh.Scene, mesh: trimesh.Trimesh, name: str):
    scene.add_geometry(mesh, geom_name=name, node_name=name)
    return mesh

def add_box(scene, name, dims, loc, color='#ffffff', alpha=1, roughness=0.65, metallic=0, rot=(0,0,0)):
    mat = make_material(f'M_{name}', color, alpha, roughness, metallic)
    mesh = trimesh.creation.box(extents=dims)
    assign_material(mesh, mat)
    transform_mesh(mesh, loc=loc, rot=rot)
    return add_mesh(scene, mesh, name)

def add_cylinder(scene, name, radius, height, loc, color='#ffffff', alpha=1, roughness=0.65, metallic=0, sections=24, axis='z', rot=(0,0,0)):
    mat = make_material(f'M_{name}', color, alpha, roughness, metallic)
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    # cylinder is along z by default
    r = rot
    if axis == 'x':
        r = (0,90,0)
    elif axis == 'y':
        r = (90,0,0)
    assign_material(mesh, mat)
    transform_mesh(mesh, loc=loc, rot=r)
    return add_mesh(scene, mesh, name)

def add_cone(scene, name, radius, height, loc, color='#ffffff', alpha=1, roughness=0.65, metallic=0, sections=24, rot=(0,0,0)):
    mat = make_material(f'M_{name}', color, alpha, roughness, metallic)
    mesh = trimesh.creation.cone(radius=radius, height=height, sections=sections)
    assign_material(mesh, mat)
    transform_mesh(mesh, loc=loc, rot=rot)
    return add_mesh(scene, mesh, name)

def add_sphere(scene, name, radius, loc, color='#ffffff', alpha=1, roughness=0.65, metallic=0, subdivisions=2, scale=(1,1,1), rot=(0,0,0)):
    mat = make_material(f'M_{name}', color, alpha, roughness, metallic)
    mesh = trimesh.creation.icosphere(subdivisions=subdivisions, radius=radius)
    assign_material(mesh, mat)
    transform_mesh(mesh, loc=loc, rot=rot, scale=scale)
    return add_mesh(scene, mesh, name)

def add_torus(scene, name, major_radius, minor_radius, loc, color='#ffffff', alpha=1, roughness=0.65, metallic=0, major_sections=32, minor_sections=12, rot=(0,0,0)):
    mat = make_material(f'M_{name}', color, alpha, roughness, metallic)
    mesh = trimesh.creation.torus(major_radius=major_radius, minor_radius=minor_radius, major_sections=major_sections, minor_sections=minor_sections)
    assign_material(mesh, mat)
    transform_mesh(mesh, loc=loc, rot=rot)
    return add_mesh(scene, mesh, name)

def add_textured_plane(scene, name, width, height, loc, image, orientation='vertical_y', roughness=0.7, metallic=0.0, alpha=1.0, rot=(0,0,0)):
    # vertical_y plane lies in XZ, normal roughly +/-Y. horizontal plane lies in XY.
    if orientation == 'vertical_y':
        verts = np.array([[-width/2,0,-height/2], [width/2,0,-height/2], [width/2,0,height/2], [-width/2,0,height/2]], dtype=float)
    elif orientation == 'vertical_x':
        verts = np.array([[0,-width/2,-height/2], [0,width/2,-height/2], [0,width/2,height/2], [0,-width/2,height/2]], dtype=float)
    else:  # horizontal
        verts = np.array([[-width/2,-height/2,0], [width/2,-height/2,0], [width/2,height/2,0], [-width/2,height/2,0]], dtype=float)
    faces = np.array([[0,1,2], [0,2,3]])
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mat = make_textured_material(f'M_{name}', image, roughness=roughness, metallic=metallic, alpha=alpha, double_sided=True)
    mesh.visual = trimesh.visual.TextureVisuals(uv=np.array([[0,0],[1,0],[1,1],[0,1]], dtype=float), material=mat)
    transform_mesh(mesh, loc=loc, rot=rot)
    return add_mesh(scene, mesh, name)

def normalize_scene(scene: trimesh.Scene):
    bounds = scene.bounds
    if bounds is None:
        return scene
    minb, maxb = bounds
    center_xy = (minb[:2] + maxb[:2]) / 2.0
    trans = np.eye(4)
    trans[:3,3] = [-center_xy[0], -center_xy[1], -minb[2]]
    scene.apply_transform(trans)
    return scene

def scene_bounds_dims(scene: trimesh.Scene):
    b = scene.bounds
    if b is None:
        return [0,0,0]
    dims = b[1] - b[0]
    return [round(float(x), 4) for x in dims]

def scene_triangles(scene: trimesh.Scene):
    total = 0
    for geom in scene.geometry.values():
        total += len(geom.faces)
    return int(total)

# ---------------------------
# Reusable components
# ---------------------------

def legs(scene, prefix, xs, ys, height=0.72, radius=0.035, color=COLORS['metal_dark']):
    for i,x in enumerate(xs):
        for j,y in enumerate(ys):
            add_cylinder(scene, f'{prefix}_leg_{i}_{j}', radius, height, (x,y,height/2), color=color, metallic=0.35, roughness=0.35, sections=12)

def wheels_base(scene, prefix, z=0.11, color=COLORS['metal_dark']):
    add_cylinder(scene, f'{prefix}_gas_lift', 0.045, 0.42, (0,0,z+0.21), color=color, metallic=0.4, roughness=0.35, sections=16)
    for i in range(5):
        ang = math.radians(i*72)
        x = math.cos(ang)*0.22; y = math.sin(ang)*0.22
        add_box(scene, f'{prefix}_star_arm_{i}', (0.28,0.035,0.035), (x/2,y/2,z), color=color, metallic=0.4, roughness=0.35, rot=(0,0,i*72))
        add_cylinder(scene, f'{prefix}_wheel_{i}', 0.045, 0.03, (x,y,0.035), color='#0E1116', roughness=0.5, sections=12, axis='y')

def plant(scene, prefix, scale=1.0, hanging=False):
    if hanging:
        add_cylinder(scene, f'{prefix}_pot', 0.18*scale, 0.22*scale, (0,0,0.11*scale), color='#D8C7A8', roughness=0.8, sections=24)
        for x in [-0.14,0.14]:
            add_cylinder(scene, f'{prefix}_cord_{x}', 0.008*scale, 0.55*scale, (x,0,0.5*scale), color=COLORS['metal_dark'], roughness=0.6, sections=8)
        base_z = 0.27*scale
    else:
        add_cylinder(scene, f'{prefix}_pot', 0.16*scale, 0.22*scale, (0,0,0.11*scale), color='#CFC2B5', roughness=0.8, sections=24)
        base_z = 0.22*scale
    for i in range(12):
        ang = i*30
        length = 0.32*scale*(0.75+0.5*((i%3)/2))
        x = math.cos(math.radians(ang))*0.08*scale
        y = math.sin(math.radians(ang))*0.08*scale
        leaf_color = COLORS['plant'] if i%2 else COLORS['plant_light']
        add_sphere(scene, f'{prefix}_leaf_{i}', 0.16*scale, (x,y,base_z+0.18*scale+0.02*(i%4)*scale), color=leaf_color, roughness=0.85, subdivisions=1, scale=(0.45,1.3,0.12), rot=(25,0,ang))
    add_cylinder(scene, f'{prefix}_stem', 0.025*scale, 0.38*scale, (0,0,base_z+0.19*scale), color='#4A6B2A', roughness=0.85, sections=8)

def add_screen(scene, prefix, w=0.5, h=0.32, loc=(0,0,0), text=None):
    add_box(scene, f'{prefix}_frame', (w+0.04, 0.035, h+0.04), loc, color='#111111', roughness=0.55)
    img = make_text_image(text or 'ONLINE', size=(512,320), bg='#1B2938', fg='#BEE8FF', accent=['#2F80ED','#27AE60','#F2C94C'])
    add_textured_plane(scene, f'{prefix}_screen', w, h, (loc[0], loc[1]-0.021, loc[2]), img, orientation='vertical_y', roughness=0.35)

def add_keyboard_mouse(scene, prefix='keyboard_mouse'):
    add_box(scene, f'{prefix}_keyboard', (0.38,0.12,0.025), (-0.07,0,0.015), color='#1B1F24', roughness=0.45)
    # key rows
    for i in range(4):
        add_box(scene, f'{prefix}_keys_{i}', (0.33,0.012,0.006), (-0.07,-0.04+i*0.026,0.032), color='#30363D', roughness=0.5)
    add_sphere(scene, f'{prefix}_mouse', 0.055, (0.23,0.0,0.04), color='#20242B', roughness=0.5, subdivisions=2, scale=(0.8,1.2,0.35))

# ---------------------------
# Asset creators
# ---------------------------

def create_character(asset_id='CHAR_MALE_001', gender='male', pose='tpose'):
    s = trimesh.Scene()
    skin = '#D8A272' if gender == 'male' else '#E7B58A'
    hair = '#4B2E1D' if gender == 'male' else '#6B3F2A'
    jacket = '#223B5B' if gender == 'male' else '#2E7D5B'
    pants = '#111827' if gender == 'male' else '#1F2937'
    shirt = '#F4F4EF'
    # torso and hips
    add_box(s, 'torso_jacket', (0.34,0.18,0.52), (0,0,1.04), color=jacket, roughness=0.7)
    add_box(s, 'shirt_front', (0.18,0.19,0.48), (0,-0.005,1.045), color=shirt, roughness=0.75)
    if gender == 'female':
        add_box(s, 'skirt_or_jacket_lower', (0.38,0.2,0.16), (0,0,0.72), color=pants, roughness=0.72)
    else:
        add_box(s, 'hips', (0.34,0.18,0.16), (0,0,0.72), color=pants, roughness=0.72)
    # head, neck, hair
    add_cylinder(s, 'neck', 0.055, 0.11, (0,0,1.345), color=skin, roughness=0.75, sections=16)
    add_sphere(s, 'head', 0.16, (0,0,1.52), color=skin, roughness=0.68, subdivisions=2, scale=(0.95,0.9,1.12))
    add_sphere(s, 'hair_cap', 0.165, (0,0.005,1.61), color=hair, roughness=0.82, subdivisions=2, scale=(1.02,0.95,0.55))
    if gender == 'female':
        add_sphere(s, 'hair_back', 0.15, (0,0.08,1.48), color=hair, roughness=0.82, subdivisions=2, scale=(1.0,0.55,1.55))
    # eyes
    add_sphere(s, 'eye_L', 0.018, (-0.052,-0.142,1.535), color='#111111', roughness=0.4, subdivisions=1)
    add_sphere(s, 'eye_R', 0.018, (0.052,-0.142,1.535), color='#111111', roughness=0.4, subdivisions=1)
    # arms depending pose
    if pose == 'tpose':
        add_cylinder(s, 'upper_arm_L', 0.043, 0.42, (-0.36,0,1.20), color=jacket, roughness=0.7, axis='x', sections=12)
        add_cylinder(s, 'upper_arm_R', 0.043, 0.42, (0.36,0,1.20), color=jacket, roughness=0.7, axis='x', sections=12)
        add_cylinder(s, 'forearm_L', 0.038, 0.35, (-0.75,0,1.20), color=skin, roughness=0.7, axis='x', sections=12)
        add_cylinder(s, 'forearm_R', 0.038, 0.35, (0.75,0,1.20), color=skin, roughness=0.7, axis='x', sections=12)
        add_sphere(s, 'hand_L', 0.045, (-0.95,0,1.20), color=skin, roughness=0.7, subdivisions=1)
        add_sphere(s, 'hand_R', 0.045, (0.95,0,1.20), color=skin, roughness=0.7, subdivisions=1)
    elif pose == 'typing':
        add_cylinder(s, 'upper_arm_L', 0.04, 0.28, (-0.22,-0.02,1.18), color=jacket, roughness=0.7, axis='y', sections=12)
        add_cylinder(s, 'upper_arm_R', 0.04, 0.28, (0.22,-0.02,1.18), color=jacket, roughness=0.7, axis='y', sections=12)
        add_cylinder(s, 'forearm_L', 0.036, 0.34, (-0.22,-0.24,1.02), color=skin, roughness=0.7, axis='y', sections=12)
        add_cylinder(s, 'forearm_R', 0.036, 0.34, (0.22,-0.24,1.02), color=skin, roughness=0.7, axis='y', sections=12)
        add_sphere(s, 'hand_L', 0.04, (-0.22,-0.43,0.94), color=skin, roughness=0.7, subdivisions=1)
        add_sphere(s, 'hand_R', 0.04, (0.22,-0.43,0.94), color=skin, roughness=0.7, subdivisions=1)
    else:
        # arms down / walking swing
        offset = 0.10 if pose == 'walk' else 0
        add_cylinder(s, 'arm_L', 0.04, 0.55, (-0.23,-0.02+offset,0.98), color=jacket, roughness=0.7, rot=(20,0,0), sections=12)
        add_cylinder(s, 'arm_R', 0.04, 0.55, (0.23,-0.02-offset,0.98), color=jacket, roughness=0.7, rot=(-20,0,0), sections=12)
        add_sphere(s, 'hand_L', 0.042, (-0.23,-0.08+offset,0.72), color=skin, roughness=0.7, subdivisions=1)
        add_sphere(s, 'hand_R', 0.042, (0.23,-0.08-offset,0.72), color=skin, roughness=0.7, subdivisions=1)
    # legs
    if pose in ['sit','typing']:
        add_cylinder(s, 'thigh_L', 0.055, 0.42, (-0.09,-0.16,0.62), color=pants, roughness=0.72, axis='y', sections=12)
        add_cylinder(s, 'thigh_R', 0.055, 0.42, (0.09,-0.16,0.62), color=pants, roughness=0.72, axis='y', sections=12)
        add_cylinder(s, 'shin_L', 0.05, 0.48, (-0.09,-0.37,0.35), color=pants, roughness=0.72, sections=12)
        add_cylinder(s, 'shin_R', 0.05, 0.48, (0.09,-0.37,0.35), color=pants, roughness=0.72, sections=12)
        add_box(s, 'shoe_L', (0.11,0.24,0.06), (-0.09,-0.47,0.07), color='#F7F7F7', roughness=0.6)
        add_box(s, 'shoe_R', (0.11,0.24,0.06), (0.09,-0.47,0.07), color='#F7F7F7', roughness=0.6)
    else:
        walk_shift = 0.10 if pose == 'walk' else 0
        add_cylinder(s, 'leg_L', 0.055, 0.66, (-0.09,-walk_shift,0.38), color=pants, roughness=0.72, rot=(8 if pose=='walk' else 0,0,0), sections=12)
        add_cylinder(s, 'leg_R', 0.055, 0.66, (0.09,walk_shift,0.38), color=pants, roughness=0.72, rot=(-8 if pose=='walk' else 0,0,0), sections=12)
        add_box(s, 'shoe_L', (0.12,0.22,0.06), (-0.09,-0.06-walk_shift,0.04), color='#F7F7F7', roughness=0.6)
        add_box(s, 'shoe_R', (0.12,0.22,0.06), (0.09,-0.06+walk_shift,0.04), color='#F7F7F7', roughness=0.6)
    normalize_scene(s)
    return s

def create_desk_standard():
    s = trimesh.Scene()
    add_box(s,'top',(1.6,0.8,0.06),(0,0,0.74),color=COLORS['wood'],roughness=0.7)
    legs(s,'desk',[-0.72,0.72],[-0.32,0.32],height=0.72)
    add_box(s,'drawer_pedestal',(0.34,0.44,0.62),(-0.52,0.19,0.34),color='#3B4554',roughness=0.62)
    for z in [0.22,0.38,0.54]: add_box(s,f'drawer_handle_{z}',(0.23,0.018,0.018),(-0.52,-0.035,z),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    add_box(s,'desk_partition',(1.52,0.05,0.42),(0,0.38,0.99),color='#BFC7D1',roughness=0.8)
    normalize_scene(s); return s

def create_desk_l_corner():
    s=trimesh.Scene()
    add_box(s,'main_top',(1.55,0.72,0.06),(0,0,0.74),color=COLORS['wood'],roughness=0.7)
    add_box(s,'return_top',(0.72,1.35,0.06),(0.415,-0.315,0.74),color=COLORS['wood'],roughness=0.7)
    legs(s,'l_desk',[-0.70,0.70],[-0.30,0.30],height=0.72)
    legs(s,'l_return',[0.12,0.72],[-0.92,0.02],height=0.72)
    add_box(s,'drawer',(0.34,0.44,0.62),(-0.52,0.18,0.34),color='#364152',roughness=0.62)
    normalize_scene(s); return s

def create_desk_bench():
    s=trimesh.Scene()
    add_box(s,'bench_top',(2.4,1.1,0.06),(0,0,0.74),color=COLORS['wood'],roughness=0.7)
    add_box(s,'center_divider',(2.3,0.045,0.42),(0,0,0.99),color='#C9D0D8',roughness=0.82)
    legs(s,'bench',[-1.1,1.1],[-0.48,0.48],height=0.72)
    add_box(s,'cable_tray',(2.0,0.16,0.08),(0,0,0.64),color='#20262E',roughness=0.5)
    normalize_scene(s); return s

def create_chair_task():
    s=trimesh.Scene()
    add_box(s,'seat',(0.52,0.50,0.10),(0,0,0.52),color=COLORS['fabric_black'],roughness=0.85)
    add_box(s,'back_mesh',(0.52,0.08,0.65),(0,0.23,0.86),color='#202731',roughness=0.75)
    add_box(s,'back_frame',(0.60,0.05,0.72),(0,0.265,0.88),color='#0D1117',metallic=0.2,roughness=0.4)
    add_box(s,'lumbar',(0.36,0.06,0.10),(0,0.19,0.78),color='#363F4A',roughness=0.75)
    add_box(s,'arm_L',(0.08,0.45,0.05),(-0.34,0,0.72),color='#111827',roughness=0.55)
    add_box(s,'arm_R',(0.08,0.45,0.05),(0.34,0,0.72),color='#111827',roughness=0.55)
    wheels_base(s,'chair')
    normalize_scene(s); return s

def create_chair_executive():
    s=trimesh.Scene()
    add_box(s,'seat',(0.58,0.54,0.12),(0,0,0.54),color='#1B1B1D',roughness=0.78)
    add_box(s,'high_back',(0.58,0.11,0.86),(0,0.24,0.98),color='#1B1B1D',roughness=0.78)
    for i,z in enumerate(np.linspace(0.72,1.28,4)):
        add_box(s,f'back_pad_{i}',(0.54,0.025,0.025),(0,0.177,z),color='#2C2C31',roughness=0.8)
    add_box(s,'arm_L',(0.08,0.48,0.06),(-0.37,0,0.74),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    add_box(s,'arm_R',(0.08,0.48,0.06),(0.37,0,0.74),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    wheels_base(s,'exec',color='#C7CCD1')
    normalize_scene(s); return s

def create_chair_guest():
    s=trimesh.Scene()
    add_box(s,'seat',(0.52,0.48,0.10),(0,0,0.48),color=COLORS['fabric_cream'],roughness=0.82)
    add_box(s,'back',(0.52,0.10,0.55),(0,0.22,0.78),color=COLORS['fabric_cream'],roughness=0.82)
    add_box(s,'frame_L',(0.04,0.58,0.04),(-0.33,0,0.45),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35)
    add_box(s,'frame_R',(0.04,0.58,0.04),(0.33,0,0.45),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35)
    add_box(s,'arm_L',(0.05,0.52,0.04),(-0.33,0,0.67),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35)
    add_box(s,'arm_R',(0.05,0.52,0.04),(0.33,0,0.67),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35)
    normalize_scene(s); return s

def create_stool_high():
    s=trimesh.Scene()
    add_cylinder(s,'round_seat',0.23,0.08,(0,0,0.78),color='#161B22',roughness=0.75,sections=32)
    add_cylinder(s,'stem',0.04,0.72,(0,0,0.40),color=COLORS['metal_light'],metallic=0.7,roughness=0.25,sections=20)
    add_torus(s,'foot_ring',0.18,0.012,(0,0,0.42),color=COLORS['metal_light'],metallic=0.7,roughness=0.25,major_sections=32,minor_sections=8)
    add_cylinder(s,'base',0.24,0.035,(0,0,0.02),color=COLORS['metal_light'],metallic=0.7,roughness=0.25,sections=32)
    normalize_scene(s); return s

def create_meeting_table(large=True):
    s=trimesh.Scene()
    w = 3.2 if large else 1.8; d = 1.2 if large else 1.0
    add_box(s,'table_top',(w,d,0.08),(0,0,0.74),color=COLORS['wood'],roughness=0.68)
    add_box(s,'beveled_top_shadow_free',(w-0.08,d-0.08,0.03),(0,0,0.795),color='#C9975C',roughness=0.7)
    legs(s,'meeting',[-w/2+0.32,w/2-0.32],[-d/2+0.22,d/2-0.22],height=0.72,radius=0.045)
    add_box(s,'power_module',(0.42,0.18,0.025),(0,0,0.82),color='#1C2128',roughness=0.45)
    normalize_scene(s); return s

def create_chair_meeting():
    s=trimesh.Scene()
    add_box(s,'seat',(0.48,0.46,0.08),(0,0,0.46),color='#303947',roughness=0.78)
    add_box(s,'back',(0.48,0.08,0.42),(0,0.20,0.72),color='#303947',roughness=0.78)
    add_cylinder(s,'leg_LF',0.025,0.45,(-0.20,-0.16,0.23),color=COLORS['metal_dark'],metallic=0.35,roughness=0.3,sections=10)
    add_cylinder(s,'leg_RF',0.025,0.45,(0.20,-0.16,0.23),color=COLORS['metal_dark'],metallic=0.35,roughness=0.3,sections=10)
    add_cylinder(s,'leg_LB',0.025,0.48,(-0.20,0.18,0.24),color=COLORS['metal_dark'],metallic=0.35,roughness=0.3,sections=10)
    add_cylinder(s,'leg_RB',0.025,0.48,(0.20,0.18,0.24),color=COLORS['metal_dark'],metallic=0.35,roughness=0.3,sections=10)
    normalize_scene(s); return s

def create_glass_partition(door=False):
    s=trimesh.Scene()
    w = 1.0 if door else 1.2
    add_box(s,'glass_panel',(w,0.035,2.05),(0,0,1.05),color=COLORS['glass'],alpha=0.32,roughness=0.12,metallic=0.0)
    add_box(s,'top_frame',(w+0.06,0.06,0.045),(0,0,2.085),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25)
    add_box(s,'bottom_frame',(w+0.06,0.06,0.045),(0,0,0.035),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25)
    add_box(s,'left_frame',(0.045,0.06,2.1),(-w/2,0,1.05),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25)
    add_box(s,'right_frame',(0.045,0.06,2.1),(w/2,0,1.05),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25)
    if door:
        add_cylinder(s,'door_handle',0.025,0.38,(w/2-0.16,-0.04,1.05),color=COLORS['metal_light'],metallic=0.8,roughness=0.2,axis='z',sections=16)
        add_cylinder(s,'hinge_top',0.025,0.12,(-w/2+0.04,-0.04,1.65),color=COLORS['metal_light'],metallic=0.8,roughness=0.2,axis='z',sections=12)
        add_cylinder(s,'hinge_bottom',0.025,0.12,(-w/2+0.04,-0.04,0.45),color=COLORS['metal_light'],metallic=0.8,roughness=0.2,axis='z',sections=12)
    normalize_scene(s); return s

def create_whiteboard(mobile=False):
    s=trimesh.Scene()
    img = make_text_image('Sprint Plan\n• Tasks\n• Owners\n• Risks', size=(512,320), bg='#F9FAFB', fg='#2D3748', accent=['#2F80ED','#27AE60','#F2C94C','#EB5757'])
    add_box(s,'board_back',(1.86,0.04,1.06),(0,0,1.05),color='#E5E7EB',roughness=0.5)
    add_textured_plane(s,'board_surface',1.76,0.96,(0,-0.025,1.05),img,orientation='vertical_y',roughness=0.42)
    add_box(s,'tray',(1.5,0.07,0.025),(0,-0.055,0.54),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    if mobile:
        add_cylinder(s,'left_stand',0.025,1.0,(-0.75,0,0.5),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25,sections=12)
        add_cylinder(s,'right_stand',0.025,1.0,(0.75,0,0.5),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25,sections=12)
        add_box(s,'base_bar',(1.8,0.06,0.04),(0,0,0.08),color=COLORS['metal_dark'],metallic=0.5,roughness=0.25)
        for x in [-0.8,0.8]:
            for y in [-0.15,0.15]: add_cylinder(s,f'caster_{x}_{y}',0.04,0.025,(x,y,0.025),color='#111111',roughness=0.5,axis='y',sections=10)
    normalize_scene(s); return s

def create_tv_wall():
    s=trimesh.Scene()
    add_box(s,'tv_body',(1.45,0.06,0.82),(0,0,0.45),color='#070707',roughness=0.35)
    img = make_text_image('VIDEO CALL\n09:30 AM', size=(1024,576), bg='#132235', fg='#DDF4FF', accent=['#2F80ED','#27AE60','#F2C94C','#EB5757'])
    add_textured_plane(s,'tv_screen',1.32,0.72,(0,-0.035,0.45),img,orientation='vertical_y',roughness=0.25)
    normalize_scene(s); return s

def create_sofa(seats=3):
    s=trimesh.Scene(); w=0.68*seats
    add_box(s,'base',(w,0.78,0.22),(0,0,0.23),color=COLORS['fabric_blue'],roughness=0.86)
    add_box(s,'back',(w,0.18,0.62),(0,0.32,0.55),color=COLORS['fabric_blue'],roughness=0.86)
    add_box(s,'arm_L',(0.14,0.78,0.45),(-w/2-0.07,0,0.38),color=COLORS['fabric_blue'],roughness=0.86)
    add_box(s,'arm_R',(0.14,0.78,0.45),(w/2+0.07,0,0.38),color=COLORS['fabric_blue'],roughness=0.86)
    for i in range(seats):
        x = -w/2+0.34+i*0.68
        add_box(s,f'seat_cushion_{i}',(0.62,0.62,0.09),(x,-0.08,0.39),color='#2A4C7E',roughness=0.88)
        add_box(s,f'back_cushion_{i}',(0.62,0.12,0.45),(x,0.23,0.66),color='#2B527F',roughness=0.88)
    normalize_scene(s); return s

def create_lounge_chair():
    s=trimesh.Scene()
    add_box(s,'seat',(0.66,0.64,0.18),(0,0,0.38),color=COLORS['fabric_green'],roughness=0.86)
    add_box(s,'back',(0.66,0.16,0.62),(0,0.28,0.70),color=COLORS['fabric_green'],roughness=0.86)
    add_box(s,'arm_L',(0.12,0.64,0.42),(-0.39,0,0.50),color=COLORS['fabric_green'],roughness=0.86)
    add_box(s,'arm_R',(0.12,0.64,0.42),(0.39,0,0.50),color=COLORS['fabric_green'],roughness=0.86)
    add_cylinder(s,'leg_LF',0.025,0.32,(-0.25,-0.22,0.16),color=COLORS['wood_dark'],roughness=0.65,sections=10)
    add_cylinder(s,'leg_RF',0.025,0.32,(0.25,-0.22,0.16),color=COLORS['wood_dark'],roughness=0.65,sections=10)
    add_cylinder(s,'leg_LB',0.025,0.32,(-0.25,0.22,0.16),color=COLORS['wood_dark'],roughness=0.65,sections=10)
    add_cylinder(s,'leg_RB',0.025,0.32,(0.25,0.22,0.16),color=COLORS['wood_dark'],roughness=0.65,sections=10)
    normalize_scene(s); return s

def create_table_coffee(side=False):
    s=trimesh.Scene(); w=0.55 if side else 1.1; d=0.45 if side else 0.6; h=0.42 if side else 0.38
    add_box(s,'top',(w,d,0.055),(0,0,h),color=COLORS['wood'],roughness=0.66)
    legs(s,'table',[-w/2+0.08,w/2-0.08],[-d/2+0.08,d/2-0.08],height=h,radius=0.027,color=COLORS['metal_dark'])
    normalize_scene(s); return s

def create_rug(variant=1):
    s=trimesh.Scene()
    color = '#8A6F5A' if variant==1 else '#45637B'
    add_box(s,'rug',(1.8,1.25,0.025),(0,0,0.0125),color=color,roughness=0.95)
    for i in range(5): add_box(s,f'weave_line_{i}',(1.6,0.02,0.006),(0,-0.45+i*0.22,0.03),color='#D7C2AD' if variant==1 else '#A9C0D3',roughness=0.95)
    normalize_scene(s); return s

def create_reception_desk():
    s=trimesh.Scene()
    add_box(s,'front_panel',(1.9,0.28,0.95),(0,0,0.48),color=COLORS['wood_dark'],roughness=0.68)
    add_box(s,'counter_top',(2.05,0.72,0.08),(0,-0.18,1.0),color=COLORS['wood'],roughness=0.68)
    add_box(s,'side_return',(0.56,1.0,0.78),(0.74,-0.4,0.42),color=COLORS['wood_dark'],roughness=0.68)
    logo = make_text_image('ACME', size=(512,220), bg='#7A4B2A', fg='#F7F7F2')
    add_textured_plane(s,'front_logo',0.78,0.32,(0,-0.145,0.55),logo,orientation='vertical_y',roughness=0.62)
    normalize_scene(s); return s

def create_brand_wall():
    s=trimesh.Scene()
    add_box(s,'base_wall',(2.4,0.08,1.8),(0,0,0.9),color='#EFE5D4',roughness=0.75)
    for i,x in enumerate(np.linspace(-1.08,1.08,9)):
        add_box(s,f'wood_slat_{i}',(0.08,0.10,1.8),(x,-0.045,0.9),color=COLORS['wood_dark'] if i%2 else COLORS['wood'],roughness=0.72)
    logo = make_text_image('ACME\nOFFICE', size=(512,320), bg='#EFE5D4', fg='#111827')
    add_textured_plane(s,'replaceable_logo_panel',0.82,0.52,(0,-0.092,1.05),logo,orientation='vertical_y',roughness=0.7)
    normalize_scene(s); return s

def create_waiting_bench():
    s=trimesh.Scene()
    add_box(s,'bench_seat',(1.6,0.48,0.10),(0,0,0.44),color=COLORS['fabric_gray'],roughness=0.86)
    add_box(s,'bench_back',(1.6,0.10,0.45),(0,0.2,0.70),color=COLORS['fabric_gray'],roughness=0.86)
    legs(s,'bench',[-0.65,0.65],[-0.14,0.14],height=0.42,radius=0.025)
    normalize_scene(s); return s

def create_standing_signage():
    s=trimesh.Scene()
    add_cylinder(s,'pole',0.025,1.1,(0,0,0.55),color=COLORS['metal_dark'],metallic=0.5,roughness=0.35,sections=12)
    add_cylinder(s,'base',0.22,0.035,(0,0,0.018),color=COLORS['metal_dark'],metallic=0.5,roughness=0.35,sections=24)
    img = make_text_image('WELCOME', size=(300,420), bg='#F7F7F2', fg='#111827')
    add_textured_plane(s,'sign_panel',0.42,0.62,(0,-0.025,1.08),img,orientation='vertical_y',roughness=0.65)
    add_box(s,'panel_frame',(0.48,0.035,0.68),(0,0,1.08),color=COLORS['metal_dark'],metallic=0.5,roughness=0.35)
    normalize_scene(s); return s

def create_phonebooth():
    s=trimesh.Scene()
    add_box(s,'floor',(1.05,1.05,0.04),(0,0,0.02),color='#4B5563',roughness=0.85)
    add_box(s,'back_wall',(1.05,0.06,2.1),(0,0.52,1.05),color='#293241',roughness=0.78)
    add_box(s,'left_wall',(0.06,1.05,2.1),(-0.52,0,1.05),color='#293241',roughness=0.78)
    add_box(s,'right_wall',(0.06,1.05,2.1),(0.52,0,1.05),color='#293241',roughness=0.78)
    add_box(s,'glass_door',(0.9,0.035,1.92),(0,-0.52,1.0),color=COLORS['glass'],alpha=0.32,roughness=0.12)
    add_box(s,'mini_desk',(0.75,0.32,0.055),(0,0.26,0.78),color=COLORS['wood'],roughness=0.7)
    add_box(s,'seat',(0.38,0.34,0.08),(0,-0.12,0.46),color=COLORS['fabric_black'],roughness=0.82)
    normalize_scene(s); return s

def create_focus_pod():
    s=trimesh.Scene()
    add_box(s,'privacy_back',(1.35,0.08,1.35),(0,0.42,0.68),color='#C7CDD6',roughness=0.85)
    add_box(s,'privacy_left',(0.08,1.0,1.15),(-0.68,0,0.58),color='#C7CDD6',roughness=0.85)
    add_box(s,'privacy_right',(0.08,1.0,1.15),(0.68,0,0.58),color='#C7CDD6',roughness=0.85)
    add_box(s,'pod_desk',(1.15,0.55,0.06),(0,-0.10,0.74),color=COLORS['wood'],roughness=0.68)
    add_box(s,'bench_seat',(0.75,0.38,0.12),(0,-0.46,0.46),color=COLORS['fabric_gray'],roughness=0.86)
    normalize_scene(s); return s

def create_acoustic_panel():
    s=trimesh.Scene()
    add_box(s,'panel_base',(0.72,0.045,1.2),(0,0,0.6),color='#8792A2',roughness=0.95)
    for i in range(5): add_box(s,f'rib_{i}',(0.04,0.052,1.12),(-0.28+i*0.14,-0.01,0.6),color='#697386',roughness=0.95)
    normalize_scene(s); return s

def create_water_dispenser():
    s=trimesh.Scene()
    add_box(s,'body',(0.34,0.32,0.82),(0,0,0.41),color='#E9EDF2',roughness=0.62)
    add_cylinder(s,'water_bottle',0.16,0.38,(0,0,1.02),color='#75BCE3',alpha=0.55,roughness=0.2,sections=32)
    add_box(s,'dispense_panel',(0.22,0.035,0.22),(0,-0.17,0.68),color='#2D3748',roughness=0.5)
    add_cylinder(s,'cup_holder',0.06,0.08,(0,-0.19,0.48),color='#FFFFFF',roughness=0.7,sections=16)
    normalize_scene(s); return s

def create_coffee_machine():
    s=trimesh.Scene()
    add_box(s,'machine_body',(0.44,0.36,0.55),(0,0,0.32),color='#20242B',roughness=0.45)
    add_box(s,'front_panel',(0.32,0.025,0.34),(0,-0.19,0.35),color='#111111',roughness=0.35)
    add_cylinder(s,'portafilter',0.07,0.09,(0,-0.23,0.35),color=COLORS['metal_light'],metallic=0.8,roughness=0.2,axis='y',sections=16)
    add_cylinder(s,'cup',0.07,0.10,(0,-0.24,0.12),color='#F7F7F2',roughness=0.7,sections=16)
    add_box(s,'top_lid',(0.38,0.30,0.05),(0,0,0.615),color='#3D444D',roughness=0.45)
    normalize_scene(s); return s

def create_pantry_counter():
    s=trimesh.Scene()
    add_box(s,'counter_base',(1.8,0.55,0.85),(0,0,0.425),color='#4B3A2A',roughness=0.72)
    add_box(s,'counter_top',(1.9,0.62,0.06),(0,0,0.88),color=COLORS['wood'],roughness=0.68)
    add_box(s,'back_splash',(1.9,0.05,0.45),(0,0.34,1.08),color='#E5E7EB',roughness=0.64)
    for x in [-0.55,0,0.55]: add_box(s,f'cabinet_door_{x}',(0.42,0.035,0.52),(x,-0.285,0.45),color='#6A4B33',roughness=0.74)
    normalize_scene(s); return s

def create_appliance(kind):
    s=trimesh.Scene()
    if kind=='fridge':
        add_box(s,'fridge_body',(0.58,0.55,1.45),(0,0,0.725),color='#E7EAEE',roughness=0.45)
        add_box(s,'top_door',(0.54,0.025,0.52),(0,-0.29,1.13),color='#F8FAFC',roughness=0.5)
        add_box(s,'bottom_door',(0.54,0.025,0.82),(0,-0.29,0.51),color='#F8FAFC',roughness=0.5)
        add_box(s,'handle1',(0.025,0.03,0.36),(0.24,-0.32,1.14),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
        add_box(s,'handle2',(0.025,0.03,0.50),(0.24,-0.32,0.51),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    else:
        add_box(s,'microwave_body',(0.48,0.34,0.28),(0,0,0.14),color='#30363D',roughness=0.45)
        add_box(s,'door_glass',(0.30,0.02,0.18),(-0.06,-0.18,0.15),color='#18212C',alpha=0.65,roughness=0.25)
        add_box(s,'control_panel',(0.10,0.025,0.20),(0.17,-0.18,0.15),color='#111111',roughness=0.35)
    normalize_scene(s); return s

def create_monitor(dual=False):
    s=trimesh.Scene()
    if dual:
        for i,x in enumerate([-0.31,0.31]):
            add_screen(s,f'monitor_{i}',w=0.48,h=0.30,loc=(x,0,0.46),text='DASHBOARD')
            add_cylinder(s,f'stand_{i}',0.025,0.24,(x,0.03,0.25),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35,sections=12)
            add_box(s,f'base_{i}',(0.24,0.18,0.025),(x,0.03,0.12),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35)
    else:
        add_screen(s,'monitor',w=0.5,h=0.32,loc=(0,0,0.46),text='WORK')
        add_cylinder(s,'stand',0.026,0.25,(0,0.03,0.25),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35,sections=12)
        add_box(s,'base',(0.28,0.20,0.025),(0,0.03,0.12),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35)
    normalize_scene(s); return s

def create_laptop():
    s=trimesh.Scene()
    add_box(s,'base',(0.46,0.32,0.035),(0,0,0.035),color='#252A31',roughness=0.45)
    add_box(s,'keyboard_area',(0.38,0.22,0.006),(0,-0.03,0.058),color='#111111',roughness=0.5)
    add_box(s,'screen_shell',(0.46,0.025,0.30),(0,0.17,0.22),color='#252A31',roughness=0.45)
    img=make_text_image('APP',size=(512,320),bg='#12344D',fg='#BEE8FF',accent=['#2F80ED','#27AE60'])
    add_textured_plane(s,'screen',0.40,0.24,(0,0.153,0.23),img,orientation='vertical_y',roughness=0.25)
    normalize_scene(s); return s

def create_keyboard_mouse_set():
    s=trimesh.Scene(); add_keyboard_mouse(s,'set'); normalize_scene(s); return s

def create_desk_lamp():
    s=trimesh.Scene()
    add_cylinder(s,'base',0.13,0.035,(0,0,0.018),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35,sections=24)
    add_cylinder(s,'lower_arm',0.018,0.38,(0,0,0.23),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35,rot=(20,0,0),sections=10)
    add_cylinder(s,'upper_arm',0.018,0.34,(0,-0.12,0.52),color=COLORS['metal_dark'],metallic=0.4,roughness=0.35,rot=(-55,0,0),sections=10)
    add_cone(s,'shade',0.13,0.18,(0,-0.22,0.66),color='#F2C94C',roughness=0.5,sections=24,rot=(90,0,0))
    normalize_scene(s); return s

def create_mug():
    s=trimesh.Scene()
    add_cylinder(s,'mug_body',0.09,0.12,(0,0,0.06),color='#F7F7F2',roughness=0.7,sections=24)
    add_cylinder(s,'coffee_surface',0.075,0.008,(0,0,0.124),color=COLORS['coffee'],roughness=0.5,sections=24)
    add_torus(s,'handle',0.055,0.012,(0.09,0,0.07),color='#F7F7F2',roughness=0.7,major_sections=20,minor_sections=8,rot=(0,90,0))
    normalize_scene(s); return s

def create_takeout_coffee():
    s=trimesh.Scene()
    add_cylinder(s,'cup_body',0.08,0.18,(0,0,0.09),color='#B08968',roughness=0.75,sections=24)
    add_cylinder(s,'lid',0.085,0.035,(0,0,0.195),color='#F4F1EA',roughness=0.65,sections=24)
    add_box(s,'sleeve',(0.17,0.17,0.06),(0,0,0.105),color='#6B4F3A',roughness=0.8)
    normalize_scene(s); return s

def create_deskphone():
    s=trimesh.Scene()
    add_box(s,'base',(0.34,0.22,0.08),(0,0,0.04),color='#1C2128',roughness=0.5)
    add_box(s,'handset',(0.31,0.055,0.055),(0,0.06,0.13),color='#111111',roughness=0.5)
    add_box(s,'screen',(0.12,0.012,0.065),(-0.07,-0.11,0.10),color='#1D4D5F',roughness=0.3)
    for i in range(3):
        for j in range(3): add_cylinder(s,f'button_{i}_{j}',0.012,0.006,(0.06+i*0.04,-0.07+j*0.035,0.087),color='#D1D5DB',roughness=0.45,sections=8)
    normalize_scene(s); return s

def create_pen_cup():
    s=trimesh.Scene()
    add_cylinder(s,'cup',0.06,0.11,(0,0,0.055),color='#1F2937',roughness=0.55,sections=20)
    for i in range(5):
        ang=math.radians(i*72)
        add_cylinder(s,f'pen_{i}',0.006,0.18,(math.cos(ang)*0.025,math.sin(ang)*0.025,0.14),color=[COLORS['blue'],COLORS['red'],COLORS['yellow'],COLORS['metal_light'],COLORS['orange']][i],roughness=0.5,sections=6,rot=(12*math.sin(ang),12*math.cos(ang),0))
    normalize_scene(s); return s

def create_notebook():
    s=trimesh.Scene()
    add_box(s,'pages',(0.24,0.32,0.035),(0,0,0.018),color=COLORS['paper'],roughness=0.75)
    add_box(s,'cover',(0.25,0.33,0.012),(0,0,0.047),color='#2D3748',roughness=0.6)
    add_cylinder(s,'spiral',0.009,0.30,(-0.13,0,0.06),color=COLORS['metal_light'],metallic=0.6,roughness=0.3,axis='y',sections=8)
    normalize_scene(s); return s

def create_book_stack():
    s=trimesh.Scene()
    colors=['#2F80ED','#EB5757','#27AE60']
    for i,c in enumerate(colors):
        add_box(s,f'book_{i}',(0.34-0.03*i,0.24,0.055),(0.02*i,0,0.03+i*0.055),color=c,roughness=0.72)
        add_box(s,f'pages_{i}',(0.30-0.03*i,0.22,0.012),(0.02*i,-0.005,0.058+i*0.055),color=COLORS['paper'],roughness=0.75)
    normalize_scene(s); return s

def create_doc_tray():
    s=trimesh.Scene()
    add_box(s,'tray_bottom',(0.38,0.28,0.035),(0,0,0.018),color='#1F2937',roughness=0.55)
    add_box(s,'left_wall',(0.035,0.28,0.10),(-0.19,0,0.06),color='#1F2937',roughness=0.55)
    add_box(s,'right_wall',(0.035,0.28,0.10),(0.19,0,0.06),color='#1F2937',roughness=0.55)
    add_box(s,'paper_stack',(0.32,0.22,0.025),(0,0,0.065),color=COLORS['paper'],roughness=0.8)
    normalize_scene(s); return s

def create_binders():
    s=trimesh.Scene()
    for i,c in enumerate(['#111827','#374151','#6B7280']):
        x=-0.14+i*0.14
        add_box(s,f'binder_{i}',(0.10,0.28,0.42),(x,0,0.21),color=c,roughness=0.65)
        add_box(s,f'label_{i}',(0.07,0.01,0.11),(x,-0.145,0.25),color=COLORS['paper'],roughness=0.75)
    normalize_scene(s); return s

def create_headset():
    s=trimesh.Scene()
    add_torus(s,'headband',0.18,0.016,(0,0,0.25),color='#111111',roughness=0.45,major_sections=32,minor_sections=8,rot=(90,0,0))
    add_box(s,'ear_L',(0.08,0.05,0.12),(-0.18,0,0.13),color='#111111',roughness=0.45)
    add_box(s,'ear_R',(0.08,0.05,0.12),(0.18,0,0.13),color='#111111',roughness=0.45)
    add_cylinder(s,'mic_arm',0.008,0.22,(0.20,-0.09,0.09),color='#111111',roughness=0.45,axis='y',sections=6)
    normalize_scene(s); return s

def create_shelf_open():
    s=trimesh.Scene()
    add_box(s,'frame_left',(0.06,0.34,1.22),(-0.62,0,0.61),color=COLORS['metal_dark'],metallic=0.2,roughness=0.45)
    add_box(s,'frame_right',(0.06,0.34,1.22),(0.62,0,0.61),color=COLORS['metal_dark'],metallic=0.2,roughness=0.45)
    for z in [0.08,0.42,0.78,1.14]: add_box(s,f'shelf_{z}',(1.28,0.36,0.045),(0,0,z),color=COLORS['wood'],roughness=0.7)
    # contents
    for i,x in enumerate(np.linspace(-0.42,0.1,5)): add_box(s,f'binder_{i}',(0.08,0.24,0.28),(x,-0.02,0.23),color=['#2F80ED','#27AE60','#F2C94C','#EB5757','#111827'][i],roughness=0.7)
    add_box(s,'box_storage',(0.34,0.26,0.18),(0.35,0,0.53),color='#C2A27B',roughness=0.8)
    plant(s,'small_plant',scale=0.42)
    # plant normalized scene later; move plant? apply transform to last? Simpler leave center, conflicts but okay. We'll translate plant geometries? skip.
    normalize_scene(s); return s

def create_cabinet_file():
    s=trimesh.Scene()
    add_box(s,'cabinet_body',(0.48,0.46,0.72),(0,0,0.36),color='#3D4551',roughness=0.6)
    for i,z in enumerate([0.18,0.36,0.54]):
        add_box(s,f'drawer_{i}',(0.43,0.025,0.18),(0,-0.24,z),color='#48525E',roughness=0.62)
        add_box(s,f'handle_{i}',(0.16,0.018,0.018),(0,-0.26,z+0.035),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    normalize_scene(s); return s

def create_locker():
    s=trimesh.Scene()
    add_box(s,'locker_body',(0.72,0.42,1.65),(0,0,0.825),color='#56616F',roughness=0.62)
    for i,x in enumerate([-0.18,0.18]):
        add_box(s,f'door_{i}',(0.32,0.025,1.52),(x,-0.225,0.84),color='#606B78',roughness=0.62)
        add_box(s,f'vents_{i}',(0.20,0.012,0.018),(x,-0.24,1.35),color='#1F2937',roughness=0.5)
        add_box(s,f'handle_{i}',(0.025,0.018,0.18),(x+0.11,-0.25,0.82),color=COLORS['metal_light'],metallic=0.6,roughness=0.25)
    normalize_scene(s); return s

def create_printer():
    s=trimesh.Scene()
    add_box(s,'printer_base',(0.78,0.58,0.32),(0,0,0.16),color='#D9DEE5',roughness=0.58)
    add_box(s,'scanner_top',(0.72,0.52,0.13),(0,0,0.40),color='#F1F3F5',roughness=0.55)
    add_box(s,'output_tray',(0.52,0.04,0.10),(0,-0.32,0.20),color='#AEB7C2',roughness=0.6)
    add_box(s,'display',(0.16,0.02,0.08),(0.26,-0.31,0.40),color='#1D4D5F',roughness=0.3)
    add_box(s,'paper',(0.44,0.32,0.03),(0,0.1,0.50),color=COLORS['paper'],roughness=0.8)
    normalize_scene(s); return s

def create_trash_bin():
    s=trimesh.Scene()
    add_cylinder(s,'bin',0.17,0.34,(0,0,0.17),color='#30363D',roughness=0.7,sections=24)
    add_cylinder(s,'rim',0.18,0.035,(0,0,0.35),color='#1F242B',roughness=0.65,sections=24)
    normalize_scene(s); return s

def create_wall_art(variant=1):
    s=trimesh.Scene()
    bg = '#1F2937' if variant==1 else '#F7F7F2'; fg = '#F2C94C' if variant==1 else '#2F80ED'
    text = 'ART\n01' if variant==1 else 'CALM\nSPACE'
    img=make_text_image(text,size=(400,500),bg=bg,fg=fg,accent=['#27AE60','#EB5757'] if variant==1 else ['#2F80ED','#F2C94C'])
    add_box(s,'frame',(0.56,0.035,0.72),(0,0,0.36),color=COLORS['wood_dark'],roughness=0.7)
    add_textured_plane(s,'art_surface',0.48,0.64,(0,-0.021,0.36),img,orientation='vertical_y',roughness=0.68)
    normalize_scene(s); return s

def create_poster_focus():
    s=trimesh.Scene()
    img=make_text_image('FOCUS\nPLAN\nEXECUTE\nREPEAT',size=(400,620),bg='#F7F7F2',fg='#111827')
    add_box(s,'poster_back',(0.52,0.018,0.78),(0,0,0.39),color='#F7F7F2',roughness=0.8)
    add_textured_plane(s,'poster_text',0.48,0.72,(0,-0.011,0.39),img,orientation='vertical_y',roughness=0.8)
    normalize_scene(s); return s

def create_wall_clock():
    s=trimesh.Scene()
    add_cylinder(s,'clock_face',0.22,0.035,(0,0,0.22),color='#F7F7F2',roughness=0.65,axis='y',sections=40)
    add_cylinder(s,'rim',0.23,0.04,(0,0,0.22),color=COLORS['metal_dark'],metallic=0.3,roughness=0.35,axis='y',sections=40)
    add_box(s,'hour_hand',(0.018,0.01,0.12),(0.03,-0.025,0.25),color='#111111',roughness=0.5,rot=(0,0,-35))
    add_box(s,'minute_hand',(0.014,0.01,0.16),(-0.035,-0.025,0.22),color='#111111',roughness=0.5,rot=(0,0,65))
    normalize_scene(s); return s

def create_wall_segment():
    s=trimesh.Scene(); add_box(s,'wall_segment',(2.0,0.12,2.6),(0,0,1.3),color='#E5E7EB',roughness=0.82); normalize_scene(s); return s

def create_window():
    s=trimesh.Scene()
    add_box(s,'glass',(1.1,0.035,1.45),(0,0,0.75),color=COLORS['glass'],alpha=0.38,roughness=0.12)
    add_box(s,'frame_top',(1.16,0.06,0.05),(0,0,1.475),color=COLORS['metal_light'],metallic=0.5,roughness=0.25)
    add_box(s,'frame_bottom',(1.16,0.06,0.05),(0,0,0.025),color=COLORS['metal_light'],metallic=0.5,roughness=0.25)
    add_box(s,'frame_left',(0.05,0.06,1.5),(-0.58,0,0.75),color=COLORS['metal_light'],metallic=0.5,roughness=0.25)
    add_box(s,'frame_right',(0.05,0.06,1.5),(0.58,0,0.75),color=COLORS['metal_light'],metallic=0.5,roughness=0.25)
    normalize_scene(s); return s

def create_column():
    s=trimesh.Scene(); add_cylinder(s,'round_column',0.22,2.6,(0,0,1.3),color='#D1D5DB',roughness=0.8,sections=32); normalize_scene(s); return s

def create_sign(text='ROOM A'):
    s=trimesh.Scene(); img=make_text_image(text,size=(420,180),bg='#111827',fg='#F7F7F2')
    add_box(s,'sign_back',(0.68,0.025,0.30),(0,0,0.15),color='#111827',roughness=0.55)
    add_textured_plane(s,'sign_text',0.62,0.24,(0,-0.015,0.15),img,orientation='vertical_y',roughness=0.55)
    normalize_scene(s); return s

def create_ceiling_panel_light():
    s=trimesh.Scene()
    add_box(s,'light_panel',(1.2,0.32,0.04),(0,0,0.02),color='#F7F9F9',roughness=0.35)
    add_box(s,'metal_frame',(1.26,0.38,0.035),(0,0,0.018),color=COLORS['metal_light'],metallic=0.5,roughness=0.25)
    normalize_scene(s); return s

def create_pendant_lamp():
    s=trimesh.Scene()
    add_cylinder(s,'cord',0.012,0.65,(0,0,0.60),color='#111111',roughness=0.55,sections=8)
    add_cone(s,'shade',0.22,0.28,(0,0,0.18),color='#F2C94C',roughness=0.55,sections=32)
    add_sphere(s,'bulb',0.065,(0,0,0.08),color='#FFF4C4',roughness=0.25,subdivisions=2)
    normalize_scene(s); return s

# ---------------------------
# Asset specs
# ---------------------------
@dataclass
class AssetSpec:
    asset_id: str
    category: str
    type: str
    priority: str
    folder: str
    create: Callable[[], trimesh.Scene]
    max_triangles: int
    texture_max_size: int = 1024
    notes: str = ''
    interaction_kind: str = ''

ASSETS: List[AssetSpec] = [
    AssetSpec('CHAR_MALE_001','character','avatar','MVP','characters',lambda: create_character('CHAR_MALE_001','male','tpose'),15000,2048,'Mixamo auto-rig friendly T-pose','character'),
    AssetSpec('CHAR_FEMALE_001','character','avatar','MVP','characters',lambda: create_character('CHAR_FEMALE_001','female','tpose'),15000,2048,'Mixamo auto-rig friendly T-pose','character'),
    AssetSpec('DESK_STANDARD_001','workstation','desk','MVP','workstation',create_desk_standard,3000,1024,'Standard desk with partition','desk'),
    AssetSpec('DESK_L_CORNER_001','workstation','desk','Later','workstation',create_desk_l_corner,3500,1024,'L-shaped corner desk','desk'),
    AssetSpec('DESK_BENCH_2P_001','workstation','desk','Later','workstation',create_desk_bench,4200,1024,'2-person bench workstation','desk'),
    AssetSpec('CHAIR_TASK_MESH_001','workstation','chair','MVP','workstation',create_chair_task,2500,1024,'Mesh task office chair','chair'),
    AssetSpec('CHAIR_EXECUTIVE_001','workstation','chair','Later','workstation',create_chair_executive,3000,1024,'High-back executive chair','chair'),
    AssetSpec('CHAIR_GUEST_001','workstation','chair','Later','workstation',create_chair_guest,1800,1024,'Guest chair with arms','chair'),
    AssetSpec('STOOL_HIGH_001','workstation','stool','Later','workstation',create_stool_high,1500,1024,'High stool','chair'),
    AssetSpec('TABLE_MEETING_LARGE_001','meeting','table','MVP','meeting',lambda: create_meeting_table(True),5000,1024,'8-person meeting table','meeting_table_large'),
    AssetSpec('TABLE_MEETING_SMALL_001','meeting','table','Later','meeting',lambda: create_meeting_table(False),3200,1024,'4-person meeting table','meeting_table_small'),
    AssetSpec('CHAIR_MEETING_001','meeting','chair','MVP','meeting',create_chair_meeting,1800,1024,'Meeting chair','chair'),
    AssetSpec('GLASS_PARTITION_001','meeting','glass_partition','MVP','meeting',lambda: create_glass_partition(False),800,1024,'Transparent glass partition','glass'),
    AssetSpec('GLASS_DOOR_001','meeting','glass_door','MVP','meeting',lambda: create_glass_partition(True),900,1024,'Transparent glass door','glass_door'),
    AssetSpec('WHITEBOARD_WALL_001','meeting','whiteboard','MVP','meeting',lambda: create_whiteboard(False),1600,1024,'Wall-mounted whiteboard','whiteboard'),
    AssetSpec('WHITEBOARD_MOBILE_001','meeting','whiteboard','Later','meeting',lambda: create_whiteboard(True),2500,1024,'Mobile whiteboard on wheels','whiteboard'),
    AssetSpec('TV_WALL_001','meeting','display','MVP','meeting',create_tv_wall,1000,1024,'Wall display / video call screen','screen'),
    AssetSpec('SOFA_3SEAT_001','lounge','sofa','MVP','lounge',lambda: create_sofa(3),5000,1024,'3-seat sofa','seat'),
    AssetSpec('SOFA_2SEAT_001','lounge','sofa','Later','lounge',lambda: create_sofa(2),4200,1024,'2-seat sofa','seat'),
    AssetSpec('LOUNGE_CHAIR_001','lounge','chair','Later','lounge',create_lounge_chair,3000,1024,'1-person lounge chair','chair'),
    AssetSpec('TABLE_COFFEE_001','lounge','table','MVP','lounge',lambda: create_table_coffee(False),1400,1024,'Coffee table','table'),
    AssetSpec('TABLE_SIDE_001','lounge','table','Later','lounge',lambda: create_table_coffee(True),1200,1024,'Side table','table'),
    AssetSpec('RUG_RECT_001','lounge','rug','Later','lounge',lambda: create_rug(1),500,512,'Area rug warm variant','floor_deco'),
    AssetSpec('RUG_RECT_002','lounge','rug','Later','lounge',lambda: create_rug(2),500,512,'Area rug cool variant','floor_deco'),
    AssetSpec('DESK_RECEPTION_001','reception','desk','MVP','reception',create_reception_desk,3500,1024,'Reception desk','desk'),
    AssetSpec('WALL_BRAND_001','reception','brand_wall','MVP','reception',create_brand_wall,2800,1024,'Logo wall with replaceable logo panel','wall'),
    AssetSpec('BENCH_WAITING_001','reception','bench','Later','reception',create_waiting_bench,2500,1024,'Waiting bench','seat'),
    AssetSpec('SIGNAGE_STANDING_001','reception','signage','Later','reception',create_standing_signage,1500,1024,'Standing signage','sign'),
    AssetSpec('PHONEBOOTH_001','focus','phonebooth','Later','focus',create_phonebooth,6000,1024,'1-person phonebooth','room_module'),
    AssetSpec('FOCUS_POD_001','focus','focus_pod','Later','focus',create_focus_pod,4500,1024,'Focus pod','room_module'),
    AssetSpec('ACOUSTIC_PANEL_001','focus','acoustic_panel','Later','focus',create_acoustic_panel,1000,512,'Wall acoustic panel','wall_deco'),
    AssetSpec('WATER_DISPENSER_001','pantry','water_dispenser','MVP','pantry',create_water_dispenser,2200,1024,'Water dispenser','appliance'),
    AssetSpec('COFFEE_MACHINE_001','pantry','coffee_machine','Later','pantry',create_coffee_machine,2200,1024,'Coffee machine','appliance'),
    AssetSpec('PANTRY_COUNTER_001','pantry','counter','Later','pantry',create_pantry_counter,3500,1024,'Pantry counter / bar','counter'),
    AssetSpec('BAR_STOOL_001','pantry','stool','Later','pantry',create_stool_high,1500,1024,'Bar stool','chair'),
    AssetSpec('FRIDGE_001','pantry','fridge','Later','pantry',lambda: create_appliance('fridge'),2200,1024,'Fridge','appliance'),
    AssetSpec('MICROWAVE_001','pantry','microwave','Later','pantry',lambda: create_appliance('microwave'),1400,1024,'Microwave','appliance'),
    AssetSpec('MONITOR_SINGLE_001','props','monitor','MVP','props',lambda: create_monitor(False),1500,1024,'Single monitor','prop'),
    AssetSpec('MONITOR_DUAL_001','props','monitor','MVP','props',lambda: create_monitor(True),2500,1024,'Dual monitor set','prop'),
    AssetSpec('LAPTOP_OPEN_001','props','laptop','MVP','props',create_laptop,1500,1024,'Open laptop','prop'),
    AssetSpec('KEYBOARD_MOUSE_SET_001','props','keyboard_mouse','MVP','props',create_keyboard_mouse_set,1000,512,'Keyboard + mouse set','prop'),
    AssetSpec('DESKPHONE_001','props','deskphone','Later','props',create_deskphone,1000,512,'Desk phone','prop'),
    AssetSpec('LAMP_DESK_001','props','desk_lamp','MVP','props',create_desk_lamp,1500,512,'Desk lamp visual object','prop'),
    AssetSpec('MUG_CERAMIC_001','props','mug','MVP','props',create_mug,1000,512,'Ceramic mug','prop'),
    AssetSpec('COFFEE_TAKEOUT_001','props','coffee_cup','MVP','props',create_takeout_coffee,1000,512,'Takeout coffee cup','prop'),
    AssetSpec('PEN_CUP_001','props','pen_cup','Later','props',create_pen_cup,1200,512,'Pen cup','prop'),
    AssetSpec('NOTEBOOK_001','props','notebook','Later','props',create_notebook,800,512,'Notebook','prop'),
    AssetSpec('BOOK_STACK_001','props','books','Later','props',create_book_stack,1000,512,'Book stack','prop'),
    AssetSpec('DOC_TRAY_001','props','doc_tray','Later','props',create_doc_tray,1000,512,'Document tray','prop'),
    AssetSpec('BINDERS_SET_001','props','binders','Later','props',create_binders,1000,512,'Binder set','prop'),
    AssetSpec('HEADSET_001','props','headset','Later','props',create_headset,1200,512,'Headset','prop'),
    AssetSpec('SHELF_OPEN_001','storage','shelf','MVP','storage',create_shelf_open,4500,1024,'Open shelf with contents','storage'),
    AssetSpec('CABINET_FILE_001','storage','cabinet','MVP','storage',create_cabinet_file,1800,1024,'File cabinet','storage'),
    AssetSpec('LOCKER_001','storage','locker','Later','storage',create_locker,2200,1024,'Locker','storage'),
    AssetSpec('PRINTER_MFP_001','storage','printer','MVP','storage',create_printer,3500,1024,'Multi-function printer','appliance'),
    AssetSpec('TRASH_BIN_001','storage','trash_bin','Later','storage',create_trash_bin,1000,512,'Trash bin','prop'),
    AssetSpec('PLANT_LARGE_MONSTERA_001','plants','plant','MVP','plants',lambda: (lambda sc: (plant(sc,'large',scale=1.35), normalize_scene(sc), sc)[2])(trimesh.Scene()),6000,1024,'Large monstera-like plant','plant'),
    AssetSpec('PLANT_MEDIUM_001','plants','plant','MVP','plants',lambda: (lambda sc: (plant(sc,'medium',scale=0.85), normalize_scene(sc), sc)[2])(trimesh.Scene()),3500,1024,'Medium plant','plant'),
    AssetSpec('PLANT_SMALL_001','plants','plant','MVP','plants',lambda: (lambda sc: (plant(sc,'small',scale=0.48), normalize_scene(sc), sc)[2])(trimesh.Scene()),2000,512,'Small shelf plant','plant'),
    AssetSpec('PLANT_HANGING_001','plants','plant','Later','plants',lambda: (lambda sc: (plant(sc,'hanging',scale=0.7,hanging=True), normalize_scene(sc), sc)[2])(trimesh.Scene()),3000,1024,'Hanging plant','plant'),
    AssetSpec('WALL_ART_001','decor','wall_art','Later','decor',lambda: create_wall_art(1),1000,512,'Wall art 01','wall_deco'),
    AssetSpec('WALL_ART_002','decor','wall_art','Later','decor',lambda: create_wall_art(2),1000,512,'Wall art 02','wall_deco'),
    AssetSpec('POSTER_FOCUS_001','decor','poster','Later','decor',create_poster_focus,1000,512,'Focus Plan Execute Repeat poster','wall_deco'),
    AssetSpec('CLOCK_WALL_001','decor','clock','Later','decor',create_wall_clock,1500,512,'Wall clock','wall_deco'),
    AssetSpec('WALL_SEGMENT_001','architecture','wall','MVP','architecture',create_wall_segment,500,1024,'Primitive wall segment','architecture'),
    AssetSpec('WINDOW_001','architecture','window','Later','architecture',create_window,800,1024,'Window module','architecture'),
    AssetSpec('COLUMN_001','architecture','column','Later','architecture',create_column,800,1024,'Round column','architecture'),
    AssetSpec('SIGN_ROOM_001','architecture','sign','Later','architecture',lambda: create_sign('MEETING A'),800,512,'Room sign','sign'),
    AssetSpec('SIGN_FLOOR_001','architecture','sign','Later','architecture',lambda: create_sign('3F'),800,512,'Floor sign','sign'),
    AssetSpec('CEILING_PANEL_LIGHT_001','lighting','ceiling_light','Later','lighting',create_ceiling_panel_light,800,512,'Ceiling panel light visual','lighting'),
    AssetSpec('PENDANT_LAMP_001','lighting','pendant_lamp','Later','lighting',create_pendant_lamp,1200,512,'Pendant lamp visual','lighting'),
]

# ---------------------------
# Metadata and prefabs
# ---------------------------

def interaction_metadata(spec: AssetSpec, dims: List[float]):
    w,d,h = dims
    kind = spec.interaction_kind
    if kind in ['chair','seat']:
        return {
            'can_sit': True,
            'seat_anchor': {'position': [0, -0.02, round(min(0.48, max(0.35, h*0.48)),3)], 'rotation': [0,0,0]},
            'status_anchor': {'position': [0,0,round(h+0.35,3)], 'rotation': [0,0,0]}
        }
    if kind == 'desk':
        return {
            'can_work': True,
            'work_anchor': {'position': [0, -round(d*0.35,3), round(min(0.78, h*0.68),3)], 'rotation': [0,0,0]},
            'chair_snap_anchor': {'position': [0, -round(d*0.78,3), 0], 'rotation': [0,0,0]},
            'status_anchor': {'position': [0, -round(d*0.78,3), 1.45], 'rotation': [0,0,0]}
        }
    if kind == 'meeting_table_large':
        anchors=[]
        xs=[-w*0.38,-w*0.13,w*0.13,w*0.38]
        for i,x in enumerate(xs): anchors.append({'id':f'seat_{i+1:02d}','position':[round(x,3),-round(d*0.58,3),0.48],'rotation':[0,0,0]})
        for i,x in enumerate(xs): anchors.append({'id':f'seat_{i+5:02d}','position':[round(x,3),round(d*0.58,3),0.48],'rotation':[0,0,180]})
        return {'can_meet': True, 'meeting_anchors': anchors, 'status_anchor': {'position':[0,0,1.2], 'rotation':[0,0,0]}}
    if kind == 'meeting_table_small':
        anchors=[
            {'id':'seat_01','position':[-w*0.25,-d*0.58,0.48],'rotation':[0,0,0]},
            {'id':'seat_02','position':[w*0.25,-d*0.58,0.48],'rotation':[0,0,0]},
            {'id':'seat_03','position':[-w*0.25,d*0.58,0.48],'rotation':[0,0,180]},
            {'id':'seat_04','position':[w*0.25,d*0.58,0.48],'rotation':[0,0,180]},
        ]
        return {'can_meet': True, 'meeting_anchors': anchors}
    if kind in ['glass','glass_door','wall','architecture']:
        return {'nav_blocker': True, 'transparent': kind.startswith('glass')}
    if kind in ['screen','whiteboard','sign']:
        return {'can_inspect': True, 'camera_focus_anchor': {'position':[0,-round(max(d,0.08),3),round(h*0.55,3)], 'rotation':[0,0,0]}}
    if kind == 'room_module':
        return {'can_enter': True, 'entry_anchor': {'position':[0,-round(d/2+0.2,3),0], 'rotation':[0,0,0]}, 'nav_blocker': True}
    if kind == 'character':
        return {'head_anchor': {'position':[0,0,round(h*0.92,3)]}, 'status_anchor': {'position':[0,0,round(h+0.25,3)]}}
    return {'can_inspect': True, 'interaction_anchor': {'position':[0,0,round(h*0.5,3)], 'rotation':[0,0,0]}}

def metadata_for(scene, spec: AssetSpec, glb_rel_path: str):
    dims = scene_bounds_dims(scene)
    tris = scene_triangles(scene)
    w,d,h = dims
    return {
        'asset_id': spec.asset_id,
        'name': spec.notes or spec.asset_id,
        'category': spec.category,
        'type': spec.type,
        'priority': spec.priority,
        'file': glb_rel_path,
        'unit': 'meter',
        'pivot': 'BOTTOM_CENTER',
        'up_axis': 'Z',
        'dimensions_m': {'width': w, 'depth': d, 'height': h},
        'placement': {'snap_to_floor': True, 'grid_size': 0.1, 'rotatable': True},
        'collision': {'type':'BOX', 'center':[0,0,round(h/2,3)], 'size':[w,d,h]},
        'interaction': interaction_metadata(spec, dims),
        'rendering': {
            'cast_shadow': True,
            'receive_shadow': spec.category not in ['lighting'],
            'lod_group': 'CHARACTER' if spec.category=='character' else ('LOW' if tris < 1000 else 'MEDIUM'),
            'pbr': {'baseColor': True, 'normal': True, 'roughness': True, 'metallic': True, 'textures_embedded': True, 'baked_lighting_forbidden': True}
        },
        'qa': {'actual_triangles': tris, 'max_triangles': spec.max_triangles, 'texture_max_size': spec.texture_max_size, 'pbr_required': True, 'baked_lighting_forbidden': True, 'result': 'PASS' if tris <= spec.max_triangles else 'CHECK_POLYCOUNT'},
        'version': '0.1.0'
    }

# ---------------------------
# Preview generation
# ---------------------------

def color_for_mesh(mesh):
    try:
        mat = getattr(mesh.visual, 'material', None)
        if mat is not None and getattr(mat, 'baseColorFactor', None) is not None:
            vals = mat.baseColorFactor
            return tuple(vals[:3]) + (min(1, vals[3] if len(vals)>3 else 1),)
        fc = mesh.visual.to_color().face_colors
        if len(fc):
            c = np.array(fc[0]) / 255.0
            return tuple(c)
    except Exception:
        pass
    return (0.55,0.55,0.55,1.0)

def make_preview(scene: trimesh.Scene, out_path: Path, title: str = ''):
    # Lightweight orthographic-ish preview using matplotlib.
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection
        fig = plt.figure(figsize=(4,4), dpi=140)
        ax = fig.add_subplot(111, projection='3d')
        b = scene.bounds
        dims = b[1]-b[0]
        center = (b[1]+b[0])/2
        maxdim = max(dims.max(), 0.1)
        for mesh in scene.geometry.values():
            verts = mesh.vertices
            faces = mesh.faces
            # limit heavy faces in preview
            if len(faces) > 1200:
                step = max(1, len(faces)//1200)
                faces_use = faces[::step]
            else:
                faces_use = faces
            polys = verts[faces_use]
            coll = Poly3DCollection(polys, linewidths=0.05, alpha=color_for_mesh(mesh)[3])
            coll.set_facecolor(color_for_mesh(mesh))
            coll.set_edgecolor((0,0,0,0.04))
            ax.add_collection3d(coll)
        ax.set_xlim(center[0]-maxdim/2, center[0]+maxdim/2)
        ax.set_ylim(center[1]-maxdim/2, center[1]+maxdim/2)
        ax.set_zlim(0, maxdim)
        ax.view_init(elev=24, azim=-45)
        ax.set_axis_off()
        if title:
            ax.text2D(0.02,0.96,title, transform=ax.transAxes, fontsize=7)
        plt.tight_layout(pad=0)
        fig.savefig(out_path, transparent=True)
        plt.close(fig)
    except Exception as e:
        img = Image.new('RGBA',(512,512),(245,245,245,255))
        d = ImageDraw.Draw(img)
        d.text((20,230),title or out_path.stem,fill=(20,20,20,255),font=font(20,True))
        img.save(out_path)

# ---------------------------
# Floor material texture generation
# ---------------------------

def save_floor_materials():
    mats=[]
    # wood texture
    for mat_id, kind in [('MAT_FLOOR_WOOD_001','wood'),('MAT_FLOOR_TILE_001','tile'),('MAT_FLOOR_CARPET_001','carpet')]:
        img = Image.new('RGBA',(1024,1024),rgba('#B98245' if kind=='wood' else '#D1D5DB' if kind=='tile' else '#5F6F80',1))
        draw=ImageDraw.Draw(img)
        if kind=='wood':
            for y in range(0,1024,128):
                draw.rectangle([0,y,1024,y+4],fill=rgba('#8B5A2B',1))
            for x in range(0,1024,256):
                draw.line([x,0,x+100,1024],fill=rgba('#C9975C',0.55),width=3)
        elif kind=='tile':
            for x in range(0,1024,128): draw.line([x,0,x,1024],fill=rgba('#AEB7C2',1),width=4)
            for y in range(0,1024,128): draw.line([0,y,1024,y],fill=rgba('#AEB7C2',1),width=4)
        else:
            for x in range(0,1024,12): draw.line([x,0,x+80,1024],fill=rgba('#6F8192',0.6),width=1)
        img_path = TEXTURES / f'{mat_id}_baseColor.png'
        img.save(img_path)
        Image.new('RGB',(1024,1024),(128,128,255)).save(TEXTURES / f'{mat_id}_normal.png')
        Image.new('RGB',(1024,1024),(0,230,0)).save(TEXTURES / f'{mat_id}_metallicRoughness.png')
        meta={
            'asset_id': mat_id,
            'category':'material',
            'type':'floor',
            'priority':'MVP',
            'unit':'meter',
            'tiling_m': [2,2],
            'textures': {
                'baseColor': f'materials/textures/{mat_id}_baseColor.png',
                'normal': f'materials/textures/{mat_id}_normal.png',
                'metallicRoughness': f'materials/textures/{mat_id}_metallicRoughness.png'
            },
            'pbr': {'metallic':0.0, 'roughness':0.9, 'baked_lighting_forbidden': True},
            'version':'0.1.0'
        }
        (MATERIALS / f'{mat_id}.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
        mats.append(meta)
    return mats

# ---------------------------
# Demo scene / layout JSON
# ---------------------------

def write_prefabs_and_scene():
    prefabs = [
        {
            'prefab_id':'KIT_WORKSTATION_SINGLE_001','category':'kit','room_type':'open_office',
            'instances':[
                {'asset_id':'DESK_STANDARD_001','position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'CHAIR_TASK_MESH_001','position':[0,-0.95,0],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'MONITOR_SINGLE_001','position':[0,0.08,0.77],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'KEYBOARD_MOUSE_SET_001','position':[0,-0.24,0.77],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'MUG_CERAMIC_001','position':[0.55,-0.20,0.77],'rotation':[0,0,0],'scale':[1,1,1]}
            ],
            'anchors':{'seat_anchor':{'position':[0,-0.95,0.48],'rotation':[0,0,0]},'work_anchor':{'position':[0,-0.45,0.75],'rotation':[0,0,0]},'status_anchor':{'position':[0,-0.95,1.5]}}
        },
        {
            'prefab_id':'KIT_MEETING_ROOM_LARGE_001','category':'kit','room_type':'meeting_room',
            'instances':[
                {'asset_id':'TABLE_MEETING_LARGE_001','position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
                *[{'asset_id':'CHAIR_MEETING_001','position':[x,-0.95,0],'rotation':[0,0,0],'scale':[1,1,1]} for x in [-1.2,-0.4,0.4,1.2]],
                *[{'asset_id':'CHAIR_MEETING_001','position':[x,0.95,0],'rotation':[0,0,180],'scale':[1,1,1]} for x in [-1.2,-0.4,0.4,1.2]],
                {'asset_id':'WHITEBOARD_WALL_001','position':[0,1.85,0],'rotation':[0,0,180],'scale':[1,1,1]},
                {'asset_id':'TV_WALL_001','position':[0,-1.85,0.55],'rotation':[0,0,0],'scale':[1,1,1]}
            ]
        },
        {
            'prefab_id':'KIT_RECEPTION_LOBBY_001','category':'kit','room_type':'reception',
            'instances':[
                {'asset_id':'WALL_BRAND_001','position':[0,0.35,0],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'DESK_RECEPTION_001','position':[0,-0.55,0],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'PLANT_LARGE_MONSTERA_001','position':[-1.55,-0.2,0],'rotation':[0,0,0],'scale':[1,1,1]}
            ]
        },
        {
            'prefab_id':'KIT_LOUNGE_BASIC_001','category':'kit','room_type':'lounge',
            'instances':[
                {'asset_id':'SOFA_3SEAT_001','position':[0,0.75,0],'rotation':[0,0,180],'scale':[1,1,1]},
                {'asset_id':'TABLE_COFFEE_001','position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'PLANT_MEDIUM_001','position':[1.45,0.55,0],'rotation':[0,0,0],'scale':[1,1,1]},
                {'asset_id':'RUG_RECT_001','position':[0,0.1,0],'rotation':[0,0,0],'scale':[1,1,1]}
            ]
        }
    ]
    for p in prefabs:
        (PREFABS / f"{p['prefab_id']}.json").write_text(json.dumps(p,indent=2),encoding='utf-8')
    (REGISTRY / 'prefab-registry.json').write_text(json.dumps({'version':'0.1.0','prefabs':prefabs},indent=2),encoding='utf-8')
    layout = {
        'scene_id':'SCENE_MVP_OFFICE_FLOOR_001',
        'unit':'meter','up_axis':'Z','description':'Example MVP office floor using GLB assets as JSON instances.',
        'floor': {'material_id':'MAT_FLOOR_WOOD_001','size':[12,8]},
        'instances':[
            {'prefab_id':'KIT_WORKSTATION_SINGLE_001','position':[-3,-1,0],'rotation':[0,0,0]},
            {'prefab_id':'KIT_WORKSTATION_SINGLE_001','position':[-1.2,-1,0],'rotation':[0,0,0]},
            {'prefab_id':'KIT_WORKSTATION_SINGLE_001','position':[0.6,-1,0],'rotation':[0,0,0]},
            {'prefab_id':'KIT_MEETING_ROOM_LARGE_001','position':[2.7,1.0,0],'rotation':[0,0,0]},
            {'prefab_id':'KIT_RECEPTION_LOBBY_001','position':[-3.5,2.4,0],'rotation':[0,0,0]},
            {'prefab_id':'KIT_LOUNGE_BASIC_001','position':[0.8,2.6,0],'rotation':[0,0,0]},
            {'asset_id':'GLASS_PARTITION_001','position':[1.1,0.2,0],'rotation':[0,0,90]},
            {'asset_id':'GLASS_DOOR_001','position':[1.1,-0.9,0],'rotation':[0,0,90]},
            {'asset_id':'WATER_DISPENSER_001','position':[4.7,-2.5,0],'rotation':[0,0,0]},
            {'asset_id':'PRINTER_MFP_001','position':[-4.7,-2.2,0],'rotation':[0,0,0]},
        ]
    }
    (SCENES / 'SCENE_MVP_OFFICE_FLOOR_001.layout.json').write_text(json.dumps(layout,indent=2),encoding='utf-8')

# ---------------------------
# Main build
# ---------------------------

def main():
    # copy generation script into source folder
    try:
        shutil.copyfile(__file__, SOURCE / Path(__file__).name)
    except Exception:
        pass
    all_meta=[]
    failures=[]
    for spec in ASSETS:
        try:
            scene = spec.create()
            normalize_scene(scene)
            rel_dir = Path('models') / spec.folder
            out_dir = ROOT / rel_dir
            out_dir.mkdir(parents=True, exist_ok=True)
            glb_path = out_dir / f'{spec.asset_id}.glb'
            scene.export(glb_path)
            rel_path = str((rel_dir / f'{spec.asset_id}.glb').as_posix())
            meta = metadata_for(scene, spec, rel_path)
            (METADATA / f'{spec.asset_id}.meta.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
            make_preview(scene, PREVIEWS / f'{spec.asset_id}.png', spec.asset_id)
            all_meta.append(meta)
            print('OK', spec.asset_id, meta['qa']['actual_triangles'])
        except Exception as e:
            print('FAIL', spec.asset_id, repr(e))
            failures.append({'asset_id':spec.asset_id,'error':repr(e)})
    mats = save_floor_materials()
    write_prefabs_and_scene()
    registry = {
        'version':'0.1.0',
        'created_at':'2026-07-09',
        'coordinate_system': {'unit':'meter','up_axis':'Z','pivot':'BOTTOM_CENTER','floor_z':0},
        'format': {'model':'glb','gltf':'2.0 binary','textures':'embedded PBR textures/factors where applicable'},
        'assets': all_meta,
        'materials': mats,
        'failures': failures,
        'notes': [
            'Procedural starter production cut. Every model is exported as one GLB per object.',
            'Character GLBs are static T-pose models intended for Mixamo or external humanoid rigging.',
            'Animation clips are specified in animation-manifest.json; final skeletal motion files should be generated after rig binding.',
            'BaseColor/albedo textures are uniform or text-only and contain no baked lighting/shadows.'
        ]
    }
    (REGISTRY / 'asset-registry.json').write_text(json.dumps(registry,indent=2),encoding='utf-8')
    # animation manifest + static preview poses
    anim_manifest = {
        'version':'0.1.0','unit':'meter','up_axis':'Z','rig_target':'Mixamo-compatible humanoid',
        'clips':[
            {'animation_id':'ANIM_IDLE_001','name':'idle','status':'spec_only','duration_s':2.0,'loop':True},
            {'animation_id':'ANIM_WALK_001','name':'walk','status':'spec_only','duration_s':1.0,'loop':True},
            {'animation_id':'ANIM_SIT_001','name':'sit','status':'spec_only','duration_s':1.2,'loop':False},
            {'animation_id':'ANIM_TYPING_001','name':'typing','status':'spec_only','duration_s':1.6,'loop':True}
        ],
        'note':'This pack includes character T-pose GLBs. Bind rig first, then export skeletal GLB clips into this folder.'
    }
    (ANIMS / 'animation-manifest.json').write_text(json.dumps(anim_manifest,indent=2),encoding='utf-8')
    # static pose placeholder GLBs for visual reference, not skeletal clips
    pose_dir = ANIMS / 'static_pose_previews'
    pose_dir.mkdir(exist_ok=True)
    for gender, charid in [('male','CHAR_MALE_001'),('female','CHAR_FEMALE_001')]:
        for pose in ['idle','walk','sit','typing']:
            sc=create_character(charid, gender, pose if pose!='idle' else 'idle')
            normalize_scene(sc)
            sc.export(pose_dir / f'{charid}_POSE_{pose.upper()}_001.glb')
            make_preview(sc, pose_dir / f'{charid}_POSE_{pose.upper()}_001.png', f'{charid} {pose}')
    # QA reports
    qa_rows=['asset_id,priority,category,type,triangles,max_triangles,result,width_m,depth_m,height_m']
    for m in all_meta:
        d=m['dimensions_m']; q=m['qa']
        qa_rows.append(f"{m['asset_id']},{m['priority']},{m['category']},{m['type']},{q['actual_triangles']},{q['max_triangles']},{q['result']},{d['width']},{d['depth']},{d['height']}")
    (QA / 'polycount-report.csv').write_text('\n'.join(qa_rows),encoding='utf-8')
    (QA / 'validation-report.json').write_text(json.dumps({'version':'0.1.0','asset_count':len(all_meta),'failures':failures,'pass_count':sum(1 for m in all_meta if m['qa']['result']=='PASS')},indent=2),encoding='utf-8')
    # Contact sheet
    thumbs=list(PREVIEWS.glob('*.png'))[:80]
    if thumbs:
        tile=180; cols=5; rows=math.ceil(len(thumbs)/cols)
        sheet=Image.new('RGBA',(cols*tile,rows*tile),(245,245,245,255))
        d=ImageDraw.Draw(sheet)
        for idx,p in enumerate(thumbs):
            im=Image.open(p).convert('RGBA')
            im.thumbnail((tile-20,tile-40))
            x=(idx%cols)*tile+(tile-im.width)//2; y=(idx//cols)*tile+10
            sheet.alpha_composite(im,(x,y))
            d.text(((idx%cols)*tile+8,(idx//cols)*tile+tile-26),p.stem,fill=(20,20,20,255),font=font(11,False))
        sheet.save(ROOT / 'asset-contact-sheet.png')
    # README
    readme = f"""# Virtual Office 3D Assets v0.1\n\n제작일: 2026-07-09\n\n이 패키지는 가상오피스 3D 씬용 GLB 스타터 제작물입니다. 사용자 매니페스트 기준으로 MVP와 Later 에셋을 1차 프로시저럴 모델로 생성했습니다.\n\n## 포함 내용\n\n- GLB 모델: {len(all_meta)}개\n- PBR 바닥 재질: 3종\n- 에셋별 메타데이터 JSON\n- prefab kit JSON\n- MVP 예시 씬 layout JSON\n- 썸네일 preview PNG\n- QA/polycount report\n- 캐릭터 T-pose GLB + 정적 포즈 preview GLB\n\n## 공통 규격\n\n- 파일 형식: .glb\n- 단위: meter\n- pivot: bottom center\n- floor: z=0\n- up_axis: Z\n- baseColor/albedo에 조명/그림자 baked 없음\n- GLB 내부 PBR material/texture factor 포함\n\n## 주의\n\n캐릭터는 현재 리깅 전 T-pose 모델입니다. 실제 skeletal animation은 Mixamo/Blender/엔진 리타게팅 후 `animations/`에 GLB clip으로 넣는 구조입니다.\n\nThree.js 기본 Y-up 파이프라인을 사용하는 경우, 이 패키지는 Z-up 기준이므로 importer adapter에서 축 변환을 적용하세요.\n"""
    (ROOT / 'README.md').write_text(readme,encoding='utf-8')
    # Zip package
    zip_path=Path('/mnt/data/virtual_office_3d_assets_v0_1.zip')
    if zip_path.exists(): zip_path.unlink()
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
        for file in ROOT.rglob('*'):
            if file.is_file():
                z.write(file, file.relative_to(ROOT.parent))
    print('ZIP', zip_path, zip_path.stat().st_size)
    return zip_path

if __name__ == '__main__':
    main()
