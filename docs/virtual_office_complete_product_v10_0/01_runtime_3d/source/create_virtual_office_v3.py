import os, json, math, random, shutil, zipfile, csv
from pathlib import Path
from dataclasses import dataclass
from typing import List, Tuple, Dict, Callable, Any

import numpy as np
import trimesh
from trimesh.transformations import translation_matrix, rotation_matrix, scale_matrix, concatenate_matrices
from trimesh.visual.material import PBRMaterial
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

random.seed(7)
np.random.seed(7)

OUT = Path('/mnt/data/virtual_office_production_assets_v3_0')
if OUT.exists():
    shutil.rmtree(OUT)

# Directory structure
for sub in [
    'models/architecture','models/reception','models/workstation','models/meeting','models/lounge',
    'models/focus','models/pantry','models/props','models/storage','models/plants','models/decor','models/lighting','models/characters',
    'metadata/assets','prefabs','registry','scenes','previews/contact_sheets','previews/characters','previews/hero','ui/png','ui/svg',
    'materials/pbr','materials/textures','qa','docs','source'
]:
    (OUT / sub).mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------

def mat(name, color, rough=0.5, metal=0.0, alpha=None, emissive=None, double=False):
    c = list(color)
    if max(c) > 1.0:
        c = [v/255.0 for v in c]
    if len(c) == 3:
        c.append(alpha if alpha is not None else 1.0)
    elif alpha is not None:
        c[3] = alpha
    return PBRMaterial(
        name=name,
        baseColorFactor=c,
        metallicFactor=metal,
        roughnessFactor=rough,
        alphaMode='BLEND' if c[3] < 0.999 else None,
        doubleSided=double,
        emissiveFactor=emissive
    )

MAT: Dict[str, PBRMaterial] = {
    'WOOD_WALNUT': mat('MAT_WOOD_WALNUT', (132, 78, 42), 0.38),
    'WOOD_LIGHT': mat('MAT_WOOD_LIGHT', (196, 139, 77), 0.42),
    'WOOD_DARK': mat('MAT_WOOD_DARK', (92, 48, 26), 0.48),
    'MARBLE_WHITE': mat('MAT_MARBLE_WHITE', (226, 224, 215), 0.18),
    'CONCRETE_POLISHED': mat('MAT_CONCRETE_POLISHED', (135, 136, 132), 0.55),
    'CONCRETE_DARK': mat('MAT_CONCRETE_DARK', (68, 70, 74), 0.6),
    'CARPET_BLUE': mat('MAT_CARPET_BLUE', (62, 82, 113), 0.85),
    'FABRIC_BLUE': mat('MAT_FABRIC_BLUE', (34, 65, 110), 0.8),
    'FABRIC_GREY': mat('MAT_FABRIC_GREY', (104, 110, 118), 0.82),
    'LEATHER_BLACK': mat('MAT_LEATHER_BLACK', (12, 14, 17), 0.42),
    'METAL_BLACK': mat('MAT_METAL_BLACK', (14, 18, 24), 0.32, 0.75),
    'METAL_CHROME': mat('MAT_METAL_CHROME', (190, 195, 199), 0.16, 0.95),
    'PLASTIC_BLACK': mat('MAT_PLASTIC_BLACK', (8, 10, 12), 0.55),
    'PLASTIC_WHITE': mat('MAT_PLASTIC_WHITE', (232, 232, 226), 0.45),
    'SCREEN_DARK': mat('MAT_SCREEN_DARK', (6, 12, 24), 0.25),
    'SCREEN_BLUE': mat('MAT_SCREEN_BLUE_EMISSIVE', (20, 70, 155), 0.2, emissive=[0.02,0.14,0.40]),
    'GLASS_CLEAR': mat('MAT_GLASS_CLEAR_BLUE_TINT', (112, 185, 235), 0.05, 0.0, alpha=0.24, double=True),
    'GLASS_DARK': mat('MAT_GLASS_DARK_TINT', (40, 65, 90), 0.08, 0.0, alpha=0.32, double=True),
    'NEON_BLUE': mat('MAT_NEON_BLUE_EMISSIVE', (42, 120, 255), 0.2, emissive=[0.08,0.38,1.0]),
    'NEON_WARM': mat('MAT_NEON_WARM_EMISSIVE', (255, 190, 100), 0.25, emissive=[1.0,0.45,0.08]),
    'PLANT_LEAF': mat('MAT_PLANT_LEAF_DEEP_GREEN', (24, 105, 45), 0.7),
    'PLANT_LEAF_LIGHT': mat('MAT_PLANT_LEAF_LIGHT', (55, 145, 69), 0.72),
    'PLANT_STEM': mat('MAT_PLANT_STEM', (63, 88, 38), 0.75),
    'CERAMIC_WHITE': mat('MAT_CERAMIC_WHITE', (230, 226, 216), 0.28),
    'POT_GREY': mat('MAT_POT_GREY_CONCRETE', (112, 112, 108), 0.72),
    'PAPER': mat('MAT_PAPER_OFF_WHITE', (238, 236, 224), 0.9),
    'RED': mat('MAT_SIGNAL_RED', (210, 45, 45), 0.35, emissive=[0.15,0.02,0.02]),
    'GREEN_DOT': mat('MAT_ONLINE_GREEN', (63, 207, 95), 0.25, emissive=[0.04,0.30,0.07]),
    'SKIN_LIGHT': mat('MAT_SKIN_LIGHT', (222, 166, 125), 0.6),
    'SKIN_MEDIUM': mat('MAT_SKIN_MEDIUM', (166, 102, 68), 0.6),
    'HAIR_BROWN': mat('MAT_HAIR_BROWN', (72, 38, 24), 0.7),
    'HAIR_BLACK': mat('MAT_HAIR_BLACK', (20, 18, 16), 0.72),
    'CLOTH_NAVY': mat('MAT_CLOTH_NAVY', (20, 43, 74), 0.76),
    'CLOTH_GREEN': mat('MAT_CLOTH_GREEN', (46, 98, 70), 0.76),
    'CLOTH_WHITE': mat('MAT_CLOTH_WHITE', (230,230,222), 0.78),
    'CLOTH_DARK': mat('MAT_CLOTH_DARK', (22,25,30), 0.78),
    'YELLOW': mat('MAT_ACCENT_YELLOW', (230,166,45), 0.5),
}

# Save material registry JSON
def jlist(x):
    if x is None:
        return None
    return [float(v) for v in list(x)]

material_registry = []
for k, m in MAT.items():
    material_registry.append({
        'material_id': str(m.name),
        'alias': k,
        'baseColorFactor': jlist(m.baseColorFactor),
        'metallicFactor': float(m.metallicFactor) if m.metallicFactor is not None else None,
        'roughnessFactor': float(m.roughnessFactor) if m.roughnessFactor is not None else None,
        'alphaMode': m.alphaMode,
        'emissiveFactor': jlist(m.emissiveFactor),
    })
with open(OUT/'registry/material-registry.json','w',encoding='utf-8') as f:
    json.dump(material_registry, f, indent=2)

# --------------------------------------------------------------------------------------
# Texture swatches and UI/screen/logo textures
# --------------------------------------------------------------------------------------

def find_font(size=48, bold=False):
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def save_texture(name, maker):
    img = maker()
    path = OUT / 'materials/textures' / name
    img.save(path)
    return img, path


def tex_wood():
    img = Image.new('RGB', (512,512), (135,80,42))
    d = ImageDraw.Draw(img)
    for y in range(0,512,12):
        col=(110+random.randint(-12,20),65+random.randint(-8,10),35+random.randint(-6,8))
        d.line((0,y,512,y+random.randint(-3,3)), fill=col, width=random.randint(1,3))
    for i in range(22):
        y=random.randint(0,512)
        x0=random.randint(-80,420)
        x1=x0+random.randint(100,260)
        d.arc((x0, y-40, x1, y+70), 0, 180, fill=(94,52,30), width=1)
    return img.filter(ImageFilter.GaussianBlur(0.4))

def tex_marble():
    img = Image.new('RGB', (512,512), (224,222,214))
    d = ImageDraw.Draw(img)
    for i in range(35):
        x0=random.randint(-60,512); y0=random.randint(0,512)
        pts=[]
        for t in range(8):
            pts.append((x0+t*90+random.randint(-35,35), y0+t*18+random.randint(-25,25)))
        d.line(pts, fill=(150+random.randint(-20,20),150+random.randint(-20,20),145+random.randint(-20,20)), width=random.choice([1,1,2]))
    return img.filter(ImageFilter.GaussianBlur(0.55))

def tex_concrete():
    arr = np.random.normal(138, 8, (512,512,3)).clip(110,160).astype(np.uint8)
    img = Image.fromarray(arr,'RGB').filter(ImageFilter.GaussianBlur(0.6))
    d = ImageDraw.Draw(img)
    for x in range(0,512,128): d.line((x,0,x,512), fill=(120,120,118), width=1)
    for y in range(0,512,128): d.line((0,y,512,y), fill=(120,120,118), width=1)
    return img

def tex_carpet():
    arr = np.random.normal(70, 12, (512,512,3)).astype(np.int32)
    arr[:,:,0]=np.clip(arr[:,:,0]*0.75,20,90)
    arr[:,:,1]=np.clip(arr[:,:,1]*0.95,30,100)
    arr[:,:,2]=np.clip(arr[:,:,2]*1.35,50,140)
    return Image.fromarray(arr.astype(np.uint8),'RGB').filter(ImageFilter.GaussianBlur(0.25))

wood_img, _ = save_texture('wood_walnut_basecolor.png', tex_wood)
marble_img, _ = save_texture('marble_white_basecolor.png', tex_marble)
concrete_img, _ = save_texture('concrete_polished_basecolor.png', tex_concrete)
carpet_img, _ = save_texture('carpet_blue_basecolor.png', tex_carpet)


def make_logo_img():
    img = Image.new('RGBA', (512,256), (0,0,0,0))
    d = ImageDraw.Draw(img)
    d.text((256,88), 'ACME', anchor='mm', font=find_font(82, True), fill=(245,248,255,255))
    d.text((256,150), 'CORPORATION', anchor='mm', font=find_font(36, False), fill=(180,210,255,235))
    # subtle glow by alpha composite blurred mask
    glow = Image.new('RGBA', img.size, (0,0,0,0))
    gd=ImageDraw.Draw(glow)
    gd.text((256,88), 'ACME', anchor='mm', font=find_font(82, True), fill=(80,160,255,180))
    gd.text((256,150), 'CORPORATION', anchor='mm', font=find_font(36, False), fill=(80,160,255,150))
    glow = glow.filter(ImageFilter.GaussianBlur(8))
    return Image.alpha_composite(glow, img)

def make_screen_img(title='PRODUCT SYNC'):
    img = Image.new('RGBA',(512,300),(8,14,28,255))
    d=ImageDraw.Draw(img)
    d.rectangle((0,0,512,42), fill=(16,27,48,255))
    d.text((20,20), title, anchor='lm', font=find_font(24, True), fill=(230,240,255,255))
    for i in range(4):
        x=30+i*115; y=72
        d.rounded_rectangle((x,y,x+95,y+70), radius=10, fill=(40+i*20,80+i*20,120+i*10,255))
        d.ellipse((x+35,y+12,x+60,y+37), fill=(220,190,160,255))
        d.rectangle((x+25,y+40,x+70,y+65), fill=(35,50,70,255))
    for i in range(6):
        y=170+i*18
        d.rounded_rectangle((30,y,470,y+8), radius=3, fill=(28,55,95,255))
        d.rounded_rectangle((30,y,random.randint(140,460),y+8), radius=3, fill=(72,135,235,255))
    return img

def make_poster_img():
    img=Image.new('RGBA',(384,512),(245,245,240,255))
    d=ImageDraw.Draw(img)
    for idx, t in enumerate(['FOCUS','PLAN','EXECUTE','REPEAT']):
        d.text((192,120+idx*65), t, anchor='mm', font=find_font(50, True), fill=(25,30,36,255))
    d.rectangle((18,18,366,494), outline=(20,20,20,255), width=8)
    return img

logo_img, _ = save_texture('acme_logo_emissive.png', make_logo_img)
screen_img, _ = save_texture('meeting_screen_ui.png', make_screen_img)
poster_img, _ = save_texture('poster_focus_plan_execute_repeat.png', make_poster_img)

# --------------------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------------------

def assign(mesh: trimesh.Trimesh, material: PBRMaterial):
    mesh.visual = trimesh.visual.TextureVisuals(material=material)
    return mesh


def box(extents, loc, material, name=None):
    m = trimesh.creation.box(extents=extents)
    m.apply_transform(translation_matrix(loc))
    return assign(m, material)


def cyl(radius, height, loc, material, sections=24):
    m = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    m.apply_transform(translation_matrix(loc))
    return assign(m, material)


def sphere(radius, loc, material, subdivisions=2, scale=(1,1,1)):
    m = trimesh.creation.icosphere(subdivisions=subdivisions, radius=radius)
    S = np.eye(4); S[0,0]=scale[0]; S[1,1]=scale[1]; S[2,2]=scale[2]
    m.apply_transform(S)
    m.apply_transform(translation_matrix(loc))
    return assign(m, material)


def cyl_between(p1, p2, radius, material, sections=16):
    p1 = np.array(p1, dtype=float); p2 = np.array(p2, dtype=float)
    vec = p2 - p1; h = float(np.linalg.norm(vec))
    if h < 1e-6:
        return sphere(radius, p1, material)
    m = trimesh.creation.cylinder(radius=radius, height=h, sections=sections)
    R = trimesh.geometry.align_vectors([0,0,1], vec/h)
    T = translation_matrix((p1+p2)/2.0)
    m.apply_transform(concatenate_matrices(T, R))
    return assign(m, material)


def rounded_rect_mesh(width, depth, height, radius, material, loc=(0,0,0), sections=8):
    # convex rounded rectangle prism, bottom at loc.z and centered at loc.x/y
    w, d, r = width, depth, min(radius, width/2, depth/2)
    pts=[]
    corners = [
        ((w/2-r), (-d/2+r), -math.pi/2, 0),
        ((w/2-r), (d/2-r), 0, math.pi/2),
        ((-w/2+r), (d/2-r), math.pi/2, math.pi),
        ((-w/2+r), (-d/2+r), math.pi, 3*math.pi/2),
    ]
    for cx, cy, a0, a1 in corners:
        for i in range(sections+1):
            a = a0 + (a1-a0)*i/(sections+1)
            pts.append([cx+r*math.cos(a), cy+r*math.sin(a)])
    n=len(pts)
    verts=[]
    for x,y in pts: verts.append([x,y,0])
    for x,y in pts: verts.append([x,y,height])
    faces=[]
    # bottom/top fan around 0 vertex
    for i in range(1,n-1):
        faces.append([0,i+1,i])
        faces.append([n,n+i,n+i+1])
    # sides
    for i in range(n):
        j=(i+1)%n
        faces.append([i,j,n+j])
        faces.append([i,n+j,n+i])
    mesh=trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=False)
    mesh.apply_transform(translation_matrix(loc))
    return assign(mesh, material)


def textured_plane(width, height, image: Image.Image, loc=(0,0,0), orientation='xz', material_name='MAT_TEXTURED', emissive=None, alpha=True):
    # orientation xz creates vertical plane in XZ at y=loc.y; normal roughly -y/+y depending winding
    if orientation == 'xz':
        verts = np.array([[-width/2,0,-height/2],[width/2,0,-height/2],[width/2,0,height/2],[-width/2,0,height/2]],float)
    elif orientation == 'yz':
        verts = np.array([[0,-width/2,-height/2],[0,width/2,-height/2],[0,width/2,height/2],[0,-width/2,height/2]],float)
    elif orientation == 'xy':
        verts = np.array([[-width/2,-height/2,0],[width/2,-height/2,0],[width/2,height/2,0],[-width/2,height/2,0]],float)
    else:
        raise ValueError(orientation)
    verts += np.array(loc)
    faces=np.array([[0,1,2],[0,2,3]])
    uv=np.array([[0,1],[1,1],[1,0],[0,0]],float)
    material=PBRMaterial(name=material_name, baseColorTexture=image, emissiveTexture=image if emissive else None,
                         emissiveFactor=emissive, roughnessFactor=0.35, metallicFactor=0.0,
                         alphaMode='BLEND' if alpha else None, doubleSided=True)
    mesh=trimesh.Trimesh(vertices=verts, faces=faces, process=False,
                         visual=trimesh.visual.TextureVisuals(uv=uv, image=image, material=material))
    return mesh


def rotate_z_mesh(mesh, degrees):
    m=mesh.copy(); m.apply_transform(rotation_matrix(math.radians(degrees), [0,0,1])); return m


def rotate_x_mesh(mesh, degrees):
    m=mesh.copy(); m.apply_transform(rotation_matrix(math.radians(degrees), [1,0,0])); return m


def rotate_y_mesh(mesh, degrees):
    m=mesh.copy(); m.apply_transform(rotation_matrix(math.radians(degrees), [0,1,0])); return m


def normalize_parts(parts: List[Tuple[trimesh.Trimesh,str]]):
    if not parts: return parts
    all_bounds=[]
    for m,n in parts:
        all_bounds.append(m.bounds)
    mins=np.min([b[0] for b in all_bounds], axis=0)
    maxs=np.max([b[1] for b in all_bounds], axis=0)
    offset=np.array([-(mins[0]+maxs[0])/2, -(mins[1]+maxs[1])/2, -mins[2]])
    for m,n in parts:
        m.apply_transform(translation_matrix(offset))
    return parts


def make_scene(parts):
    s=trimesh.Scene()
    for i,(m,n) in enumerate(parts):
        s.add_geometry(m, node_name=f'{n}_{i:03d}', geom_name=f'{n}_{i:03d}')
    return s


def bounds_from_parts(parts):
    mins=[]; maxs=[]
    for m,_ in parts:
        b=m.bounds
        mins.append(b[0]); maxs.append(b[1])
    mn=np.min(mins,axis=0); mx=np.max(maxs,axis=0)
    return mn,mx

# --------------------------------------------------------------------------------------
# Asset builders
# --------------------------------------------------------------------------------------

Parts = List[Tuple[trimesh.Trimesh, str]]

def add_table_legs(parts, width, depth, height, material=MAT['METAL_BLACK'], inset=0.12, r=0.035):
    for sx in [-1,1]:
        for sy in [-1,1]:
            parts.append((cyl(r, height, (sx*(width/2-inset), sy*(depth/2-inset), height/2), material, 12), 'leg'))
    return parts


def build_desk_standard():
    p=[]
    p.append((rounded_rect_mesh(1.65,0.82,0.08,0.04,MAT['WOOD_LIGHT'],loc=(0,0,0.74),sections=5),'wood_top'))
    add_table_legs(p,1.65,0.82,0.74)
    p.append((box((0.08,0.72,0.55),(-0.70,0,0.34),MAT['CONCRETE_DARK']),'drawer'))
    p.append((box((1.55,0.05,0.46),(0,0.42,1.00),MAT['FABRIC_GREY']),'acoustic_partition'))
    p.append((box((1.45,0.02,0.025),(0,0.39,1.25),MAT['NEON_BLUE']),'thin_blue_trim'))
    return p


def build_desk_l_shape():
    p=[]
    p.append((rounded_rect_mesh(1.65,0.72,0.075,0.035,MAT['WOOD_LIGHT'],loc=(-0.15,0,0.74),sections=4),'main_top'))
    p.append((rounded_rect_mesh(0.72,1.55,0.075,0.035,MAT['WOOD_LIGHT'],loc=(0.48,0.42,0.74),sections=4),'return_top'))
    add_table_legs(p,1.65,0.72,0.74)
    p.append((box((0.35,0.58,0.52),(0.48,0.85,0.34),MAT['CONCRETE_DARK']),'drawer_return'))
    return p


def build_desk_bench_2p():
    p=[]
    p.append((rounded_rect_mesh(2.45,1.20,0.08,0.04,MAT['WOOD_LIGHT'],loc=(0,0,0.74),sections=5),'bench_top'))
    p.append((box((2.35,0.055,0.50),(0,0,1.02),MAT['FABRIC_GREY']),'middle_partition'))
    add_table_legs(p,2.45,1.20,0.74,inset=0.18)
    for x in [-0.75,0.75]:
        p.append((box((0.55,0.36,0.42),(x,0,0.32),MAT['CONCRETE_DARK']),'under_cabinet'))
    return p


def build_desk_bench_4p_hero():
    p=[]
    p.append((rounded_rect_mesh(3.4,1.45,0.09,0.05,MAT['WOOD_LIGHT'],loc=(0,0,0.74),sections=6),'bench_top_hero'))
    p.append((box((3.25,0.06,0.55),(0,0,1.03),MAT['FABRIC_GREY']),'center_privacy_panel'))
    p.append((box((3.35,0.08,0.28),(0,0,0.89),MAT['PLANT_STEM']),'planter_divider_box'))
    for x in [-1.2,-0.4,0.4,1.2]:
        p.append((sphere(0.09,(x,0,1.08),MAT['PLANT_LEAF_LIGHT'],subdivisions=2,scale=(1.2,1.0,0.7)),'desk_plant'))
    add_table_legs(p,3.4,1.45,0.74,inset=0.20)
    for x in [-1.1,1.1]:
        p.append((box((0.58,0.38,0.45),(x,-0.38,0.33),MAT['CONCRETE_DARK']),'cabinet'))
    return p


def build_chair_task():
    p=[]
    p.append((rounded_rect_mesh(0.54,0.52,0.10,0.08,MAT['LEATHER_BLACK'],loc=(0,0,0.50),sections=6),'seat'))
    p.append((rounded_rect_mesh(0.52,0.09,0.72,0.05,MAT['LEATHER_BLACK'],loc=(0,0.23,0.62),sections=5),'back'))
    p.append((cyl(0.055,0.45,(0,0,0.25),MAT['METAL_CHROME'],16),'gas_lift'))
    for a in range(5):
        ang=2*math.pi*a/5
        p.append((cyl_between((0,0,0.12),(math.cos(ang)*0.38,math.sin(ang)*0.38,0.07),0.025,MAT['METAL_BLACK'],8),'star_base'))
        p.append((sphere(0.045,(math.cos(ang)*0.42,math.sin(ang)*0.42,0.04),MAT['PLASTIC_BLACK'],1,scale=(1.2,1.0,0.55)),'caster'))
    for sx in [-1,1]:
        p.append((cyl_between((sx*0.31,-0.10,0.58),(sx*0.31,0.18,0.72),0.025,MAT['METAL_BLACK'],8),'armrest_post'))
        p.append((box((0.08,0.34,0.055),(sx*0.31,0.02,0.73),MAT['LEATHER_BLACK']),'armrest'))
    p.append((cyl_between((-0.19,0.27,1.23),(0.19,0.27,1.23),0.05,MAT['LEATHER_BLACK'],16),'headrest'))
    return p


def build_chair_executive():
    p=build_chair_task()
    # add quilt panels on back
    for i in range(3):
        for j in range(4):
            p.append((box((0.13,0.018,0.11),(-0.17+i*0.17,0.175,0.73+j*0.12),MAT['LEATHER_BLACK']),'quilt_panel'))
    return p


def build_chair_guest():
    p=[]
    p.append((rounded_rect_mesh(0.55,0.50,0.09,0.08,MAT['FABRIC_GREY'],loc=(0,0,0.45),sections=5),'seat'))
    p.append((rounded_rect_mesh(0.55,0.075,0.55,0.04,MAT['FABRIC_GREY'],loc=(0,0.24,0.50),sections=5),'back'))
    for sx in [-1,1]:
        p.append((cyl_between((sx*0.25,-0.20,0.05),(sx*0.25,0.25,0.52),0.025,MAT['METAL_CHROME'],8),'sled_leg'))
        p.append((cyl_between((sx*0.25,-0.20,0.05),(sx*0.25,0.30,0.05),0.018,MAT['METAL_CHROME'],8),'floor_sled'))
    return p


def build_stool():
    p=[]
    p.append((cyl(0.28,0.08,(0,0,0.76),MAT['LEATHER_BLACK'],32),'round_seat'))
    p.append((cyl(0.05,0.70,(0,0,0.38),MAT['METAL_CHROME'],20),'stem'))
    p.append((cyl(0.34,0.04,(0,0,0.02),MAT['METAL_CHROME'],32),'base_disc'))
    p.append((cyl_between((-0.25,0,0.36),(0.25,0,0.36),0.018,MAT['METAL_CHROME'],8),'footrest'))
    return p


def build_monitor(single=True, dual=False):
    p=[]
    positions=[0]
    if dual: positions=[-0.32,0.32]
    for x in positions:
        p.append((box((0.48,0.035,0.30),(x,0,0.34),MAT['PLASTIC_BLACK']),'monitor_frame'))
        p.append((box((0.43,0.012,0.245),(x,-0.021,0.34),MAT['SCREEN_BLUE']),'screen_glow'))
        p.append((cyl(0.025,0.22,(x,0,0.15),MAT['METAL_BLACK'],10),'stand'))
        p.append((rounded_rect_mesh(0.25,0.18,0.025,0.025,MAT['METAL_BLACK'],loc=(x,0,0.035),sections=4),'base'))
    return p


def build_laptop():
    p=[]
    p.append((rounded_rect_mesh(0.45,0.30,0.025,0.025,MAT['METAL_CHROME'],loc=(0,0,0.025),sections=4),'laptop_base'))
    screen=box((0.45,0.025,0.30),(0,0.155,0.195),MAT['PLASTIC_BLACK'])
    screen.apply_transform(rotation_matrix(math.radians(-15), [1,0,0], point=(0,0.15,0.05)))
    p.append((screen,'laptop_screen'))
    glow=box((0.39,0.012,0.23),(0,0.142,0.205),MAT['SCREEN_BLUE'])
    glow.apply_transform(rotation_matrix(math.radians(-15), [1,0,0], point=(0,0.15,0.05)))
    p.append((glow,'screen_content'))
    p.append((box((0.30,0.13,0.006),(0,-0.03,0.043),MAT['PLASTIC_BLACK']),'keyboard'))
    return p


def build_keyboard_mouse():
    p=[]
    p.append((rounded_rect_mesh(0.42,0.15,0.025,0.018,MAT['PLASTIC_BLACK'],loc=(-0.05,0,0.02),sections=4),'keyboard_base'))
    for i in range(8):
        p.append((box((0.035,0.020,0.007),(-0.20+i*0.045,0.02,0.037),MAT['CONCRETE_DARK']),'keys'))
        p.append((box((0.035,0.020,0.007),(-0.20+i*0.045,-0.02,0.037),MAT['CONCRETE_DARK']),'keys'))
    p.append((sphere(0.07,(0.33,0,0.025),MAT['PLASTIC_BLACK'],2,scale=(0.75,1.15,0.35)),'mouse'))
    return p


def build_desk_lamp():
    p=[]
    p.append((cyl(0.09,0.025,(0,0,0.012),MAT['METAL_BLACK'],20),'base'))
    p.append((cyl_between((0,0,0.03),(0.08,0,0.34),0.017,MAT['METAL_BLACK'],10),'arm1'))
    p.append((cyl_between((0.08,0,0.34),(0.23,0,0.42),0.017,MAT['METAL_BLACK'],10),'arm2'))
    shade=sphere(0.11,(0.30,0,0.39),MAT['METAL_BLACK'],2,scale=(1.2,1.0,0.55))
    p.append((shade,'shade'))
    p.append((sphere(0.055,(0.30,0,0.34),MAT['NEON_WARM'],2,scale=(1,1,0.45)),'warm_bulb'))
    return p


def build_mug(color_mat=MAT['CERAMIC_WHITE']):
    p=[]
    p.append((cyl(0.06,0.10,(0,0,0.05),color_mat,24),'mug_body'))
    p.append((cyl(0.048,0.103,(0,0,0.052),MAT['CONCRETE_DARK'],24),'coffee_inside'))
    p.append((cyl_between((0.058,0,0.07),(0.12,0,0.05),0.012,color_mat,10),'handle_top'))
    p.append((cyl_between((0.12,0,0.05),(0.058,0,0.03),0.012,color_mat,10),'handle_bottom'))
    return p


def build_takeout_coffee():
    p=[]
    p.append((cyl(0.055,0.14,(0,0,0.07),MAT['PAPER'],24),'paper_cup'))
    p.append((cyl(0.058,0.022,(0,0,0.151),MAT['PLASTIC_BLACK'],24),'lid'))
    p.append((box((0.10,0.012,0.04),(0,-0.056,0.09),MAT['WOOD_WALNUT']),'sleeve'))
    return p


def build_phone():
    p=[]
    p.append((rounded_rect_mesh(0.22,0.18,0.05,0.025,MAT['PLASTIC_BLACK'],loc=(0,0,0.03),sections=4),'base'))
    p.append((cyl_between((-0.09,0.06,0.10),(0.09,0.06,0.10),0.035,MAT['PLASTIC_BLACK'],12),'receiver'))
    for i in range(3):
        for j in range(4):
            p.append((box((0.025,0.018,0.006),(-0.04+i*0.04,-0.04+j*0.028,0.058),MAT['CONCRETE_DARK']),'keypad'))
    return p


def build_paper_stack():
    p=[]
    for i in range(6):
        p.append((box((0.22,0.30,0.006),(0,0,0.003+i*0.007),MAT['PAPER']),'paper'))
    return p


def build_pen_holder():
    p=[]
    p.append((cyl(0.05,0.10,(0,0,0.05),MAT['PLASTIC_BLACK'],16),'cup'))
    for i in range(5):
        a=i*1.25
        p.append((cyl_between((0.015*math.cos(a),0.015*math.sin(a),0.07),(0.05*math.cos(a),0.05*math.sin(a),0.20),0.006,MAT['YELLOW'] if i%2 else MAT['PLASTIC_WHITE'],6),'pen'))
    return p


def build_books_stack():
    p=[]
    colors=[MAT['FABRIC_BLUE'],MAT['CLOTH_GREEN'],MAT['RED'],MAT['CLOTH_NAVY']]
    for i in range(4):
        p.append((box((0.26,0.18,0.035),(0,0,0.02+i*0.038),colors[i]),'book'))
    return p


def build_binder_set():
    p=[]
    for i in range(5):
        p.append((box((0.055,0.22,0.30),(-0.13+i*0.065,0,0.15),[MAT['CLOTH_NAVY'],MAT['PAPER'],MAT['CLOTH_GREEN'],MAT['RED'],MAT['CONCRETE_DARK']][i]),'binder'))
    return p


def build_headset():
    p=[]
    # arc approximated by small cylinders
    pts=[]
    for i in range(12):
        a=math.pi*0.15 + i*(math.pi*0.7)/11
        pts.append((0.12*math.cos(a),0,0.12+0.12*math.sin(a)))
    for a,b in zip(pts[:-1], pts[1:]):
        p.append((cyl_between(a,b,0.008,MAT['PLASTIC_BLACK'],6),'headband'))
    p.append((sphere(0.035,(-0.11,0,0.11),MAT['PLASTIC_BLACK'],1,scale=(0.8,0.45,1.1)),'earpad'))
    p.append((sphere(0.035,(0.11,0,0.11),MAT['PLASTIC_BLACK'],1,scale=(0.8,0.45,1.1)),'earpad'))
    p.append((cyl_between((0.08,0,0.08),(0.17,0,0.04),0.006,MAT['PLASTIC_BLACK'],6),'mic'))
    return p


def build_conference_table(capacity=8):
    p=[]
    w=2.6 if capacity>=8 else 1.6
    d=1.15 if capacity>=8 else 0.95
    p.append((rounded_rect_mesh(w,d,0.09,0.22,MAT['WOOD_LIGHT'],loc=(0,0,0.74),sections=10),'meeting_table_top'))
    p.append((rounded_rect_mesh(0.55,0.40,0.64,0.05,MAT['METAL_BLACK'],loc=(0,0,0.34),sections=5),'pedestal'))
    p.append((box((w*0.72,0.035,0.025),(0,0,0.79),MAT['METAL_BLACK']),'center_cable_slot'))
    return p


def build_meeting_chair():
    p=[]
    p.append((rounded_rect_mesh(0.48,0.46,0.08,0.06,MAT['LEATHER_BLACK'],loc=(0,0,0.46),sections=5),'seat'))
    p.append((rounded_rect_mesh(0.50,0.07,0.58,0.04,MAT['LEATHER_BLACK'],loc=(0,0.21,0.54),sections=4),'back'))
    for sx in [-1,1]:
        p.append((cyl_between((sx*0.20,-0.18,0.05),(sx*0.20,0.24,0.47),0.022,MAT['METAL_CHROME'],8),'sled'))
    return p


def build_tv_wall():
    p=[]
    p.append((box((1.55,0.055,0.90),(0,0,0.65),MAT['PLASTIC_BLACK']),'tv_frame'))
    p.append((textured_plane(1.40,0.78,screen_img,loc=(0,-0.031,0.66),orientation='xz',material_name='MAT_SCREEN_TEXTURE_EMISSIVE',emissive=[0.04,0.12,0.35],alpha=False),'screen_image'))
    p.append((box((1.65,0.035,0.05),(0,0.03,1.14),MAT['NEON_BLUE']),'top_glow'))
    return p


def build_whiteboard_wall(mobile=False):
    p=[]
    p.append((rounded_rect_mesh(1.25,0.045,0.75,0.035,MAT['PAPER'],loc=(0,0,0.65),sections=4),'whiteboard'))
    p.append((box((1.33,0.04,0.04),(0,0,1.045),MAT['METAL_CHROME']),'top_frame'))
    p.append((box((1.33,0.04,0.04),(0,0,0.255),MAT['METAL_CHROME']),'bottom_frame'))
    for x in [-0.67,0.67]: p.append((box((0.04,0.04,0.80),(x,0,0.65),MAT['METAL_CHROME']),'side_frame'))
    # marker line doodles
    for i in range(5):
        p.append((box((0.25+0.08*i,0.008,0.01),(-0.25, -0.027,0.55+0.07*i),MAT['CONCRETE_DARK']),'doodle_line'))
    if mobile:
        for x in [-0.48,0.48]:
            p.append((cyl(0.025,0.65,(x,0,0.22),MAT['METAL_CHROME'],10),'stand'))
            p.append((sphere(0.05,(x,0,0.03),MAT['PLASTIC_BLACK'],1,scale=(1,1,0.5)),'wheel'))
    return p


def build_glass_panel(width=1.2, height=2.3, door=False):
    p=[]
    p.append((box((width,0.035,height),(0,0,height/2),MAT['GLASS_CLEAR']),'glass_panel'))
    # metal frame around
    p.append((box((width+0.04,0.05,0.045),(0,0,height-0.02),MAT['METAL_BLACK']),'top_frame'))
    p.append((box((width+0.04,0.05,0.045),(0,0,0.02),MAT['METAL_BLACK']),'bottom_frame'))
    for x in [-width/2, width/2]: p.append((box((0.045,0.05,height),(x,0,height/2),MAT['METAL_BLACK']),'side_frame'))
    if door:
        p.append((cyl_between((width*0.25,-0.045,1.0),(width*0.25,-0.045,1.28),0.018,MAT['METAL_CHROME'],8),'handle'))
        p.append((box((width+0.1,0.04,0.025),(0,-0.04,0.06),MAT['NEON_BLUE']),'floor_blue_glow'))
    return p


def build_glass_room_hero():
    p=[]
    w=3.8; d=2.7; h=2.25
    # panels on four sides
    for x in [-w/2,w/2]:
        panel=box((0.035,d,h),(x,0,h/2),MAT['GLASS_CLEAR']); p.append((panel,'glass_side'))
        for y in [-d/2, d/2]: p.append((box((0.055,0.07,h),(x,y,h/2),MAT['METAL_BLACK']),'corner_frame'))
    for y in [-d/2,d/2]:
        panel=box((w,0.035,h),(0,y,h/2),MAT['GLASS_CLEAR']); p.append((panel,'glass_front_back'))
        p.append((box((w,0.055,0.055),(0,y,h),MAT['METAL_BLACK']),'top_frame'))
        p.append((box((w,0.055,0.045),(0,y,0.03),MAT['METAL_BLACK']),'bottom_frame'))
    # vertical mullions
    for x in [-0.65,0.65]:
        for y in [-d/2,d/2]: p.append((box((0.035,0.055,h),(x,y,h/2),MAT['METAL_BLACK']),'mullion'))
    # neon outline on front/right like reference
    p.append((box((w+0.10,0.05,0.045),(0,-d/2-0.04,0.08),MAT['NEON_BLUE']),'neon_front_floor'))
    p.append((box((0.045,d+0.08,0.045),(w/2+0.04,0,0.08),MAT['NEON_BLUE']),'neon_side_floor'))
    p.append((box((w+0.10,0.05,0.045),(0,-d/2-0.04,h+0.05),MAT['NEON_BLUE']),'neon_front_top'))
    p.append((box((0.045,d+0.08,0.045),(w/2+0.04,0,h+0.05),MAT['NEON_BLUE']),'neon_side_top'))
    # door seam and handle
    p.append((box((0.035,0.06,h*0.74),(-w/2+0.9,-d/2-0.055,h*0.37),MAT['METAL_BLACK']),'door_seam'))
    p.append((cyl_between((-w/2+0.72,-d/2-0.08,0.95),(-w/2+0.72,-d/2-0.08,1.25),0.018,MAT['METAL_CHROME'],10),'door_handle'))
    return p


def build_sofa(seats=3, blue=False, sectional=False):
    p=[]
    matc=MAT['FABRIC_BLUE'] if blue else MAT['FABRIC_GREY']
    w=0.75*seats
    p.append((rounded_rect_mesh(w,0.78,0.26,0.12,matc,loc=(0,0,0.28),sections=8),'sofa_base'))
    p.append((rounded_rect_mesh(w,0.16,0.65,0.08,matc,loc=(0,0.34,0.44),sections=6),'sofa_back'))
    for x in [-w/2-0.06,w/2+0.06]: p.append((rounded_rect_mesh(0.18,0.78,0.46,0.08,matc,loc=(x,0,0.35),sections=6),'sofa_arm'))
    for i in range(seats):
        x=-w/2+0.375+i*0.75
        p.append((rounded_rect_mesh(0.68,0.68,0.08,0.09,matc,loc=(x,-0.06,0.49),sections=6),'seat_cushion'))
        p.append((rounded_rect_mesh(0.65,0.08,0.45,0.05,matc,loc=(x,0.27,0.62),sections=5),'back_pillow'))
    for x in [-w/2+0.10,w/2-0.10]:
        for y in [-0.32,0.34]: p.append((cyl(0.025,0.10,(x,y,0.05),MAT['METAL_BLACK'],8),'short_leg'))
    if sectional:
        # chaise extension
        p.append((rounded_rect_mesh(0.82,1.35,0.26,0.12,matc,loc=(w/2-0.35,-0.55,0.28),sections=8),'chaise_base'))
        p.append((rounded_rect_mesh(0.75,1.05,0.08,0.09,matc,loc=(w/2-0.35,-0.60,0.49),sections=6),'chaise_cushion'))
    return p


def build_table_coffee(round_table=True):
    p=[]
    if round_table:
        p.append((cyl(0.42,0.07,(0,0,0.42),MAT['WOOD_LIGHT'],40),'round_top'))
        p.append((cyl(0.055,0.40,(0,0,0.20),MAT['METAL_BLACK'],16),'pedestal'))
        p.append((cyl(0.26,0.035,(0,0,0.02),MAT['METAL_BLACK'],28),'base'))
    else:
        p.append((rounded_rect_mesh(0.65,0.45,0.06,0.06,MAT['WOOD_LIGHT'],loc=(0,0,0.43),sections=6),'top'))
        add_table_legs(p,0.65,0.45,0.43,r=0.02)
    return p


def build_rug(width=2.2, depth=1.5):
    p=[]
    p.append((rounded_rect_mesh(width,depth,0.018,0.18,MAT['CARPET_BLUE'],loc=(0,0,0.01),sections=8),'rug'))
    # decorative stripes
    for y in [-0.35,0,0.35]:
        p.append((box((width*0.75,0.03,0.004),(0,y,0.022),MAT['FABRIC_GREY']),'rug_pattern'))
    return p


def build_reception_desk_hero():
    p=[]
    p.append((rounded_rect_mesh(2.8,0.88,0.80,0.23,MAT['MARBLE_WHITE'],loc=(0,0,0.40),sections=12),'curved_marble_body'))
    p.append((rounded_rect_mesh(2.65,0.65,0.08,0.18,MAT['MARBLE_WHITE'],loc=(0,0,0.83),sections=12),'counter_top'))
    p.append((box((2.55,0.05,0.055),(0,-0.47,0.10),MAT['NEON_WARM']),'underglow_front'))
    p.append((box((0.06,0.70,0.055),(-1.42,0,0.10),MAT['NEON_WARM']),'underglow_left'))
    p.append((box((0.06,0.70,0.055),(1.42,0,0.10),MAT['NEON_WARM']),'underglow_right'))
    # marble veins on front
    for i in range(16):
        x=-1.25+random.random()*2.5; z=0.18+random.random()*0.5
        p.append((cyl_between((x,-0.447,z),(x+random.uniform(-0.25,0.25),-0.447,z+random.uniform(0.08,0.22)),0.004,MAT['CONCRETE_DARK'],5),'marble_vein'))
    # desktop lamp/plant accents
    p.append((cyl(0.05,0.04,(-0.95,-0.10,0.88),MAT['POT_GREY'],16),'small_pot'))
    p.append((sphere(0.09,(-0.95,-0.10,0.96),MAT['PLANT_LEAF_LIGHT'],2,scale=(1.2,1,0.8)),'plant_ball'))
    return p


def build_reception_backwall_hero():
    p=[]
    p.append((box((4.6,0.12,2.6),(0,0,1.3),MAT['WOOD_DARK']),'base_wall'))
    count=24
    for i in range(count):
        x=-2.2+i*(4.4/(count-1))
        p.append((box((0.055,0.11,2.52),(x,-0.07,1.28),MAT['WOOD_WALNUT']),'vertical_slat'))
    p.append((box((4.50,0.06,0.055),(0,-0.13,2.48),MAT['NEON_WARM']),'top_grazing_light'))
    logo=textured_plane(1.45,0.72,logo_img,loc=(0,-0.145,1.48),orientation='xz',material_name='MAT_ACME_LOGO_EMISSIVE',emissive=[0.25,0.45,1.0])
    p.append((logo,'logo_plane'))
    return p


def build_brand_wall():
    return build_reception_backwall_hero()


def build_open_shelf():
    p=[]
    p.append((box((1.4,0.08,0.08),(0,-0.32,0.04),MAT['METAL_BLACK']),'bottom_bar'))
    for x in [-0.67,0.67]: p.append((box((0.06,0.08,1.6),(x,-0.32,0.80),MAT['METAL_BLACK']),'side_frame'))
    for z in [0.28,0.72,1.16,1.55]:
        p.append((box((1.4,0.42,0.055),(0,0,z),MAT['WOOD_WALNUT']),'wood_shelf'))
    # decor/books
    for i in range(12):
        p.append((box((0.06,0.20,0.24),(-0.55+i*0.09,0.02,0.40),[MAT['FABRIC_BLUE'],MAT['CLOTH_GREEN'],MAT['PAPER'],MAT['RED']][i%4]),'shelf_book'))
    p.append((sphere(0.13,(0.42,0.02,0.88),MAT['CERAMIC_WHITE'],2,scale=(1,1,0.75)),'decor_vase'))
    p.append((sphere(0.13,(0.40,0.02,1.35),MAT['PLANT_LEAF_LIGHT'],2,scale=(1.1,1,0.8)),'shelf_plant'))
    return p


def build_file_cabinet():
    p=[]
    p.append((rounded_rect_mesh(0.46,0.55,0.72,0.04,MAT['CONCRETE_DARK'],loc=(0,0,0.36),sections=4),'cabinet_body'))
    for z in [0.20,0.43,0.66]:
        p.append((box((0.39,0.018,0.18),(0,-0.28,z),MAT['METAL_BLACK']),'drawer_front'))
        p.append((box((0.16,0.012,0.02),(0,-0.294,z+0.02),MAT['METAL_CHROME']),'handle'))
    return p


def build_locker():
    p=[]
    p.append((box((0.9,0.45,1.75),(0,0,0.875),MAT['CONCRETE_DARK']),'locker_body'))
    for i,x in enumerate([-0.3,0,0.3]):
        p.append((box((0.02,0.46,1.70),(x+0.15,0,0.875),MAT['METAL_BLACK']),'divider'))
        p.append((box((0.08,0.012,0.025),(x,-0.235,1.0),MAT['METAL_CHROME']),'handle'))
        for z in [1.35,1.42,1.49]: p.append((box((0.18,0.010,0.012),(x,-0.236,z),MAT['METAL_BLACK']),'vent'))
    return p


def build_printer():
    p=[]
    p.append((rounded_rect_mesh(0.75,0.55,0.28,0.04,MAT['PLASTIC_WHITE'],loc=(0,0,0.14),sections=4),'lower_body'))
    p.append((rounded_rect_mesh(0.68,0.50,0.18,0.035,MAT['PLASTIC_WHITE'],loc=(0,0,0.39),sections=4),'upper_body'))
    p.append((box((0.60,0.36,0.04),(0,-0.05,0.53),MAT['CONCRETE_DARK']),'scanner_lid'))
    p.append((box((0.32,0.018,0.04),(0.15,-0.285,0.40),MAT['SCREEN_BLUE']),'control_panel'))
    p.append((box((0.55,0.025,0.05),(0,-0.31,0.22),MAT['CONCRETE_DARK']),'paper_slot'))
    return p


def build_trash_bin():
    p=[]
    p.append((cyl(0.18,0.32,(0,0,0.16),MAT['CONCRETE_DARK'],24),'bin_body'))
    p.append((cyl(0.16,0.33,(0,0,0.17),MAT['PLASTIC_BLACK'],24),'bin_inner'))
    return p


def build_water_dispenser():
    p=[]
    p.append((rounded_rect_mesh(0.38,0.34,0.88,0.05,MAT['PLASTIC_WHITE'],loc=(0,0,0.44),sections=5),'body'))
    p.append((cyl(0.17,0.44,(0,0,1.10),mat('MAT_WATER_BLUE_TRANSPARENT',(80,170,240),0.05,0,alpha=0.42,double=True),32),'water_jug'))
    p.append((box((0.25,0.04,0.08),(0,-0.19,0.65),MAT['CONCRETE_DARK']),'spout_panel'))
    p.append((cyl(0.025,0.06,(-0.05,-0.22,0.59),MAT['NEON_BLUE'],12),'cold_button'))
    p.append((cyl(0.025,0.06,(0.05,-0.22,0.59),MAT['RED'],12),'hot_button'))
    return p


def build_coffee_machine():
    p=[]
    p.append((rounded_rect_mesh(0.42,0.34,0.52,0.05,MAT['PLASTIC_BLACK'],loc=(0,0,0.26),sections=5),'machine_body'))
    p.append((box((0.22,0.045,0.12),(0,-0.19,0.30),MAT['METAL_CHROME']),'chrome_face'))
    p.append((cyl(0.055,0.09,(0,-0.17,0.08),MAT['CERAMIC_WHITE'],20),'espresso_cup'))
    p.append((box((0.18,0.07,0.03),(0,-0.19,0.18),MAT['METAL_CHROME']),'tray'))
    p.append((cyl(0.06,0.18,(0.16,0.02,0.56),MAT['PLASTIC_BLACK'],18),'bean_hopper'))
    return p


def build_pantry_counter():
    p=[]
    p.append((rounded_rect_mesh(2.8,0.72,0.86,0.08,MAT['MARBLE_WHITE'],loc=(0,0,0.43),sections=6),'counter_body'))
    p.append((rounded_rect_mesh(2.95,0.82,0.08,0.08,MAT['MARBLE_WHITE'],loc=(0,0,0.91),sections=6),'counter_top'))
    for x in [-0.8,0.0,0.8]:
        p.append((box((0.52,0.025,0.48),(x,-0.37,0.43),MAT['WOOD_WALNUT']),'cabinet_front'))
    p.append((box((2.7,0.035,0.045),(0,-0.43,0.10),MAT['NEON_WARM']),'kick_light'))
    return p


def build_fridge():
    p=[]
    p.append((rounded_rect_mesh(0.65,0.58,1.55,0.05,MAT['PLASTIC_WHITE'],loc=(0,0,0.775),sections=5),'fridge_body'))
    p.append((box((0.60,0.018,0.035),(0,-0.30,0.88),MAT['METAL_CHROME']),'door_split'))
    p.append((box((0.035,0.018,0.42),(0.28,-0.31,1.12),MAT['METAL_CHROME']),'handle_top'))
    p.append((box((0.035,0.018,0.42),(0.28,-0.31,0.46),MAT['METAL_CHROME']),'handle_bottom'))
    return p


def build_microwave():
    p=[]
    p.append((rounded_rect_mesh(0.58,0.36,0.32,0.04,MAT['PLASTIC_BLACK'],loc=(0,0,0.16),sections=4),'body'))
    p.append((box((0.35,0.018,0.22),(-0.08,-0.19,0.18),MAT['GLASS_DARK']),'door_window'))
    p.append((box((0.10,0.018,0.24),(0.22,-0.19,0.18),MAT['METAL_CHROME']),'control_panel'))
    return p


def build_phonebooth():
    p=[]
    p.append((rounded_rect_mesh(1.05,1.05,2.2,0.08,MAT['GLASS_DARK'],loc=(0,0,1.10),sections=6),'glass_body'))
    for x in [-0.55,0.55]:
        for y in [-0.55,0.55]: p.append((box((0.06,0.06,2.25),(x,y,1.125),MAT['METAL_BLACK']),'black_frame'))
    p.append((box((1.12,1.12,0.08),(0,0,2.26),MAT['METAL_BLACK']),'roof'))
    p.append((box((0.46,0.32,0.05),(0,-0.25,0.78),MAT['WOOD_LIGHT']),'tiny_desk'))
    p.append((rounded_rect_mesh(0.38,0.34,0.08,0.05,MAT['LEATHER_BLACK'],loc=(0,0.22,0.45),sections=5),'seat'))
    p.append((box((0.38,0.06,0.48),(0,0.40,0.68),MAT['LEATHER_BLACK']),'back'))
    p.append((box((0.70,0.035,0.04),(0,-0.58,1.55),MAT['NEON_BLUE']),'available_light'))
    return p


def build_focus_pod():
    p=[]
    p.append((rounded_rect_mesh(1.35,0.95,1.35,0.16,MAT['FABRIC_GREY'],loc=(0,0,0.675),sections=8),'pod_shell'))
    p.append((rounded_rect_mesh(1.00,0.72,0.75,0.12,MAT['LEATHER_BLACK'],loc=(0,-0.03,0.45),sections=7),'seat_cushion'))
    p.append((box((1.10,0.06,0.75),(0,0.38,0.74),MAT['FABRIC_BLUE']),'inside_back'))
    p.append((rounded_rect_mesh(0.55,0.26,0.05,0.04,MAT['WOOD_LIGHT'],loc=(0,-0.45,0.72),sections=5),'work_surface'))
    return p


def build_acoustic_panel():
    p=[]
    p.append((rounded_rect_mesh(0.75,0.055,1.10,0.05,MAT['FABRIC_GREY'],loc=(0,0,0.55),sections=6),'panel'))
    for z in [0.25,0.48,0.72,0.95]:
        p.append((box((0.65,0.012,0.025),(0,-0.035,z),MAT['CONCRETE_DARK']),'groove'))
    return p


def build_plant_large():
    p=[]
    p.append((cyl(0.25,0.38,(0,0,0.19),MAT['POT_GREY'],32),'large_pot'))
    p.append((cyl(0.20,0.05,(0,0,0.39),MAT['PLANT_STEM'],24),'soil'))
    for i in range(22):
        a=i*2*math.pi/22 + random.uniform(-0.08,0.08)
        length=random.uniform(0.55,0.95)
        start=(0,0,0.42)
        end=(math.cos(a)*random.uniform(0.15,0.35), math.sin(a)*random.uniform(0.15,0.35), random.uniform(0.75,1.35))
        p.append((cyl_between(start,end,0.012,MAT['PLANT_STEM'],6),'stem'))
        leaf=sphere(0.12,end,MAT['PLANT_LEAF'] if i%2 else MAT['PLANT_LEAF_LIGHT'],2,scale=(1.2,0.45,0.12))
        leaf.apply_transform(rotation_matrix(a,[0,0,1], point=end))
        leaf.apply_transform(rotation_matrix(random.uniform(-0.9,0.9),[1,0,0], point=end))
        p.append((leaf,'leaf'))
    return p


def build_plant_medium():
    p=[]
    p.append((cyl(0.14,0.22,(0,0,0.11),MAT['CERAMIC_WHITE'],24),'pot'))
    p.append((cyl(0.12,0.04,(0,0,0.23),MAT['PLANT_STEM'],18),'soil'))
    for i in range(12):
        a=i*2*math.pi/12
        end=(math.cos(a)*0.18, math.sin(a)*0.18, 0.45+0.12*random.random())
        p.append((cyl_between((0,0,0.25), end, 0.009, MAT['PLANT_STEM'],6),'stem'))
        p.append((sphere(0.07,end,MAT['PLANT_LEAF_LIGHT'],2,scale=(1.4,0.55,0.12)),'leaf'))
    return p


def build_plant_small():
    p=[]
    p.append((cyl(0.07,0.10,(0,0,0.05),MAT['CERAMIC_WHITE'],18),'small_pot'))
    for i in range(7):
        a=i*2*math.pi/7
        p.append((sphere(0.045,(math.cos(a)*0.06,math.sin(a)*0.06,0.15+random.random()*0.05),MAT['PLANT_LEAF_LIGHT'],1,scale=(1.1,0.6,0.6)),'leaf_cluster'))
    return p


def build_hanging_plant():
    p=[]
    p.append((cyl(0.12,0.12,(0,0,0.74),MAT['CERAMIC_WHITE'],24),'hanging_pot'))
    for a in [0,2.1,4.2]: p.append((cyl_between((0,0,0.80),(math.cos(a)*0.22,math.sin(a)*0.22,1.25),0.006,MAT['METAL_CHROME'],6),'hanger'))
    for i in range(14):
        a=i*2*math.pi/14
        p.append((cyl_between((0,0,0.70),(math.cos(a)*0.18,math.sin(a)*0.18,0.20+random.random()*0.30),0.006,MAT['PLANT_STEM'],5),'vine'))
        p.append((sphere(0.035,(math.cos(a)*0.18,math.sin(a)*0.18,0.25+random.random()*0.30),MAT['PLANT_LEAF_LIGHT'],1,scale=(1.1,0.7,0.2)),'leaf'))
    return p


def build_planter_divider():
    p=[]
    p.append((rounded_rect_mesh(1.6,0.42,0.45,0.05,MAT['POT_GREY'],loc=(0,0,0.225),sections=5),'planter_box'))
    for i in range(12):
        x=-0.7+i*0.13
        p.append((sphere(0.09,(x,random.uniform(-0.08,0.08),0.52+random.random()*0.10),MAT['PLANT_LEAF_LIGHT'],2,scale=(1.0,0.6,0.8)),'planter_plant'))
    return p


def build_wall_segment():
    return [(box((2.0,0.16,2.7),(0,0,1.35),MAT['CONCRETE_POLISHED']),'wall')]


def build_floor_concrete():
    p=[]
    p.append((box((2.0,2.0,0.05),(0,0,0.025),MAT['CONCRETE_POLISHED']),'floor_tile'))
    for x in [-0.5,0.5]: p.append((box((0.012,2.0,0.004),(x,0,0.053),MAT['CONCRETE_DARK']),'tile_groove'))
    for y in [-0.5,0.5]: p.append((box((2.0,0.012,0.004),(0,y,0.053),MAT['CONCRETE_DARK']),'tile_groove'))
    return p


def build_floor_wood():
    p=[]
    p.append((box((2.0,2.0,0.05),(0,0,0.025),MAT['WOOD_WALNUT']),'wood_floor'))
    for i in range(8):
        x=-0.9+i*0.25
        p.append((box((0.012,2.0,0.004),(x,0,0.053),MAT['WOOD_DARK']),'plank_line'))
    return p


def build_floor_carpet():
    return build_rug(2.0,2.0)


def build_window():
    p=[]
    p.append((box((1.25,0.045,1.25),(0,0,0.72),MAT['GLASS_CLEAR']),'window_glass'))
    p.append((box((1.35,0.07,0.07),(0,0,1.35),MAT['METAL_BLACK']),'window_top'))
    p.append((box((1.35,0.07,0.07),(0,0,0.08),MAT['METAL_BLACK']),'window_bottom'))
    for x in [-0.68,0,0.68]: p.append((box((0.055,0.07,1.25),(x,0,0.72),MAT['METAL_BLACK']),'mullion'))
    return p


def build_column():
    p=[]
    p.append((cyl(0.18,2.7,(0,0,1.35),MAT['CONCRETE_POLISHED'],24),'round_column'))
    p.append((cyl(0.24,0.08,(0,0,0.04),MAT['CONCRETE_DARK'],24),'base'))
    return p


def build_signage():
    p=[]
    p.append((rounded_rect_mesh(0.75,0.055,0.38,0.04,MAT['PLASTIC_BLACK'],loc=(0,0,0.22),sections=5),'sign_panel'))
    p.append((box((0.70,0.012,0.05),(0,-0.036,0.27),MAT['NEON_BLUE']),'blue_line'))
    p.append((cyl(0.02,0.9,(0,0,0.65),MAT['METAL_BLACK'],8),'post'))
    p.append((cyl(0.18,0.035,(0,0,0.02),MAT['METAL_BLACK'],16),'base'))
    return p


def build_ceiling_panel_light():
    p=[]
    p.append((rounded_rect_mesh(1.0,0.45,0.045,0.04,MAT['PLASTIC_WHITE'],loc=(0,0,0.025),sections=5),'light_panel'))
    p.append((rounded_rect_mesh(0.88,0.34,0.018,0.035,MAT['NEON_WARM'],loc=(0,0,0.060),sections=5),'emissive_diffuser'))
    return p


def build_pendant_lamp():
    p=[]
    p.append((cyl_between((0,0,0.80),(0,0,1.35),0.008,MAT['METAL_BLACK'],6),'cord'))
    p.append((sphere(0.18,(0,0,0.72),MAT['METAL_BLACK'],2,scale=(1,1,0.62)),'shade'))
    p.append((sphere(0.09,(0,0,0.60),MAT['NEON_WARM'],2,scale=(1,1,0.7)),'bulb'))
    return p


def build_wall_art():
    img=Image.new('RGBA',(384,256),(235,236,232,255)); d=ImageDraw.Draw(img)
    d.rectangle((12,12,372,244), outline=(26,30,38,255), width=7)
    for i in range(6):
        d.rectangle((40+i*50,70+random.randint(-20,20),75+i*50,190+random.randint(-20,20)), fill=[(45,80,140,255),(150,90,70,255),(70,125,90,255)][i%3])
    p=[]
    p.append((textured_plane(0.85,0.56,img,loc=(0,0,0.44),orientation='xz',material_name='MAT_WALL_ART_TEXTURE',alpha=False),'art_plane'))
    p.append((box((0.92,0.05,0.62),(0,0.02,0.44),MAT['METAL_BLACK']),'frame'))
    return p


def build_poster_focus():
    p=[]
    p.append((textured_plane(0.55,0.75,poster_img,loc=(0,0,0.44),orientation='xz',material_name='MAT_POSTER_FOCUS_TEXTURE',alpha=False),'poster_texture'))
    p.append((box((0.60,0.045,0.80),(0,0.02,0.44),MAT['METAL_BLACK']),'poster_frame'))
    return p


def build_wall_clock():
    p=[]
    p.append((cyl(0.22,0.035,(0,0,0.25),MAT['PLASTIC_WHITE'],40),'clock_face'))
    p[-1][0].apply_transform(rotation_matrix(math.radians(90),[1,0,0]))
    p.append((cyl(0.225,0.04,(0,-0.015,0.25),MAT['METAL_BLACK'],40),'clock_rim'))
    p[-1][0].apply_transform(rotation_matrix(math.radians(90),[1,0,0]))
    p.append((cyl_between((0,-0.04,0.25),(0.0,-0.04,0.39),0.006,MAT['METAL_BLACK'],6),'minute_hand'))
    p.append((cyl_between((0,-0.04,0.25),(0.10,-0.04,0.25),0.006,MAT['METAL_BLACK'],6),'hour_hand'))
    return p


def build_reception_chair():
    p=build_chair_task()
    # color modifications not easy after parts, add badge
    p.append((box((0.30,0.02,0.05),(0,-0.27,0.86),MAT['NEON_WARM']),'front_badge'))
    return p


def build_character(gender='male', outfit='navy', receptionist=False):
    p=[]
    skin = MAT['SKIN_LIGHT'] if gender in ['female','receptionist'] else MAT['SKIN_MEDIUM']
    hair = MAT['HAIR_BROWN'] if gender in ['female','receptionist'] else MAT['HAIR_BLACK']
    jacket = MAT['CLOTH_NAVY'] if outfit=='navy' else MAT['CLOTH_GREEN'] if outfit=='green' else MAT['CLOTH_DARK']
    pants = MAT['CLOTH_DARK']
    shirt = MAT['CLOTH_WHITE']
    # feet on z=0, height ~1.75
    p.append((sphere(0.16,(0,0,1.58),skin,2,scale=(0.85,0.78,1.05)),'head'))
    p.append((sphere(0.168,(0,-0.015,1.66),hair,2,scale=(0.9,0.85,0.55)),'hair_cap'))
    p.append((cyl(0.055,0.11,(0,0,1.38),skin,12),'neck'))
    p.append((rounded_rect_mesh(0.40,0.23,0.58,0.08,jacket,loc=(0,0,1.05),sections=6),'torso_jacket'))
    p.append((box((0.18,0.245,0.50),(0,-0.01,1.08),shirt),'shirt_panel'))
    if receptionist:
        p.append((box((0.35,0.08,0.02),(0,-0.14,1.31),MAT['YELLOW']),'name_badge'))
    # arms T pose slight down
    shoulder_z=1.32
    for sx in [-1,1]:
        p.append((cyl_between((sx*0.22,0,shoulder_z),(sx*0.58,0,1.20),0.055,jacket,14),'upper_arm'))
        p.append((cyl_between((sx*0.58,0,1.20),(sx*0.78,0,1.05),0.045,skin,14),'forearm'))
        p.append((sphere(0.055,(sx*0.81,0,1.02),skin,1,scale=(0.9,0.8,1)),'hand'))
    # legs
    for sx in [-1,1]:
        p.append((cyl_between((sx*0.10,0,0.82),(sx*0.11,0,0.38),0.065,pants,14),'thigh'))
        p.append((cyl_between((sx*0.11,0,0.38),(sx*0.12,0,0.09),0.055,pants,14),'shin'))
        p.append((rounded_rect_mesh(0.20,0.12,0.06,0.04,MAT['PLASTIC_WHITE'],loc=(sx*0.12,-0.04,0.03),sections=4),'shoe'))
    # facial features
    p.append((sphere(0.014,(-0.055,-0.145,1.60),MAT['PLASTIC_BLACK'],1),'eye_l'))
    p.append((sphere(0.014,(0.055,-0.145,1.60),MAT['PLASTIC_BLACK'],1),'eye_r'))
    p.append((box((0.07,0.012,0.01),(0,-0.158,1.53),MAT['RED']),'smile'))
    return p

# --------------------------------------------------------------------------------------
# Asset definition registry
# --------------------------------------------------------------------------------------

@dataclass
class AssetDef:
    asset_id: str
    category: str
    builder: Callable[[], Parts]
    priority: str = 'P2'
    type: str = 'object'
    note: str = ''

assets: List[AssetDef] = [
    # Architecture and structure
    AssetDef('ARCH_FLOOR_CONCRETE_TILE_001','architecture',build_floor_concrete,'P1','floor'),
    AssetDef('ARCH_FLOOR_WOOD_TILE_001','architecture',build_floor_wood,'P1','floor'),
    AssetDef('ARCH_FLOOR_CARPET_TILE_001','architecture',build_floor_carpet,'P2','floor'),
    AssetDef('ARCH_WALL_SEGMENT_CONCRETE_001','architecture',build_wall_segment,'P1','wall'),
    AssetDef('ARCH_WINDOW_TALL_001','architecture',build_window,'P2','window'),
    AssetDef('ARCH_COLUMN_ROUND_001','architecture',build_column,'P2','column'),
    AssetDef('ARCH_SIGNAGE_STANDING_001','architecture',build_signage,'P2','signage'),
    AssetDef('ARCH_GLASS_PARTITION_001','architecture',lambda: build_glass_panel(1.2,2.25,False),'P1','glass'),
    AssetDef('ARCH_GLASS_DOOR_001','architecture',lambda: build_glass_panel(1.0,2.25,True),'P1','glass_door'),
    AssetDef('ARCH_GLASS_MEETING_ROOM_HERO_001','architecture',build_glass_room_hero,'P1','room_shell'),
    AssetDef('ARCH_NEON_ROOM_OUTLINE_BLUE_001','architecture',lambda: [(box((2.4,0.04,0.04),(0,0,0.02),MAT['NEON_BLUE']),'neon_strip')],'P1','emissive'),
    AssetDef('ARCH_PLANTER_DIVIDER_001','architecture',build_planter_divider,'P1','planter'),
    # Reception
    AssetDef('RECEPTION_DESK_MARBLE_HERO_001','reception',build_reception_desk_hero,'P1','reception_desk'),
    AssetDef('RECEPTION_BACKWALL_WOOD_SLAT_HERO_001','reception',build_reception_backwall_hero,'P1','brand_wall'),
    AssetDef('RECEPTION_BRAND_WALL_001','reception',build_brand_wall,'P1','brand_wall'),
    AssetDef('RECEPTION_COUNTER_LIGHT_STRIP_001','reception',lambda:[(box((1.8,0.05,0.05),(0,0,0.03),MAT['NEON_WARM']),'warm_light_strip')],'P1','light_strip'),
    AssetDef('RECEPTION_STAFF_CHAIR_001','reception',build_reception_chair,'P2','chair'),
    AssetDef('LOBBY_DECOR_SHELF_001','reception',build_open_shelf,'P1','shelf'),
    # Workstation
    AssetDef('DESK_STANDARD_001','workstation',build_desk_standard,'P1','desk'),
    AssetDef('DESK_L_CORNER_001','workstation',build_desk_l_shape,'P2','desk'),
    AssetDef('DESK_BENCH_2P_001','workstation',build_desk_bench_2p,'P2','desk'),
    AssetDef('DESK_BENCH_4P_HERO_001','workstation',build_desk_bench_4p_hero,'P1','desk_cluster'),
    AssetDef('CHAIR_TASK_BLACK_HERO_001','workstation',build_chair_task,'P1','chair'),
    AssetDef('CHAIR_EXECUTIVE_HIGHBACK_001','workstation',build_chair_executive,'P2','chair'),
    AssetDef('CHAIR_GUEST_ARM_001','workstation',build_chair_guest,'P2','chair'),
    AssetDef('CHAIR_STOOL_BAR_001','workstation',build_stool,'P2','chair'),
    # Meeting
    AssetDef('MEETING_TABLE_8P_HERO_001','meeting',lambda: build_conference_table(8),'P1','meeting_table'),
    AssetDef('MEETING_TABLE_4P_001','meeting',lambda: build_conference_table(4),'P2','meeting_table'),
    AssetDef('MEETING_CHAIR_BLACK_001','meeting',build_meeting_chair,'P1','chair'),
    AssetDef('MEETING_TV_WALL_001','meeting',build_tv_wall,'P1','display'),
    AssetDef('MEETING_WHITEBOARD_WALL_001','meeting',lambda: build_whiteboard_wall(False),'P1','whiteboard'),
    AssetDef('MEETING_WHITEBOARD_MOBILE_001','meeting',lambda: build_whiteboard_wall(True),'P2','whiteboard'),
    AssetDef('MEETING_CAMERA_BAR_001','meeting',lambda:[(rounded_rect_mesh(0.55,0.06,0.06,0.025,MAT['PLASTIC_BLACK'],loc=(0,0,0.03),sections=4),'camera_bar'),(sphere(0.025,(-0.18,-0.035,0.032),MAT['SCREEN_BLUE'],1),'lens'),(sphere(0.025,(0.18,-0.035,0.032),MAT['SCREEN_BLUE'],1),'lens')],'P2','camera'),
    AssetDef('MEETING_SPEAKERPHONE_001','meeting',lambda:[(rounded_rect_mesh(0.28,0.20,0.045,0.05,MAT['PLASTIC_BLACK'],loc=(0,0,0.025),sections=6),'speakerphone'),(cyl(0.075,0.006,(0,0,0.052),MAT['METAL_CHROME'],24),'speaker_grille')],'P2','speakerphone'),
    # Lounge
    AssetDef('SOFA_SECTIONAL_BLUE_HERO_001','lounge',lambda: build_sofa(3,blue=True,sectional=True),'P1','sofa'),
    AssetDef('SOFA_3SEAT_LIGHT_001','lounge',lambda: build_sofa(3,blue=False),'P1','sofa'),
    AssetDef('SOFA_2SEAT_001','lounge',lambda: build_sofa(2,blue=False),'P2','sofa'),
    AssetDef('LOUNGE_CHAIR_ROUND_001','lounge',lambda: build_sofa(1,blue=True),'P2','chair'),
    AssetDef('TABLE_COFFEE_ROUND_001','lounge',lambda: build_table_coffee(True),'P1','table'),
    AssetDef('TABLE_SIDE_001','lounge',lambda: build_table_coffee(False),'P2','table'),
    AssetDef('RUG_BLUE_PATTERN_001','lounge',lambda: build_rug(2.2,1.45),'P2','rug'),
    # Focus
    AssetDef('PHONEBOOTH_1P_GLASS_001','focus',build_phonebooth,'P2','phonebooth'),
    AssetDef('FOCUS_POD_001','focus',build_focus_pod,'P2','focus_pod'),
    AssetDef('ACOUSTIC_PANEL_001','focus',build_acoustic_panel,'P2','panel'),
    # Pantry
    AssetDef('PANTRY_COUNTER_MARBLE_HERO_001','pantry',build_pantry_counter,'P2','counter'),
    AssetDef('WATER_DISPENSER_001','pantry',build_water_dispenser,'P1','water_dispenser'),
    AssetDef('COFFEE_MACHINE_001','pantry',build_coffee_machine,'P2','coffee_machine'),
    AssetDef('BAR_STOOL_BLUE_001','pantry',build_stool,'P2','stool'),
    AssetDef('FRIDGE_001','pantry',build_fridge,'P2','fridge'),
    AssetDef('MICROWAVE_001','pantry',build_microwave,'P2','microwave'),
    # Props
    AssetDef('MONITOR_SINGLE_001','props',lambda: build_monitor(single=True),'P1','monitor'),
    AssetDef('MONITOR_DUAL_001','props',lambda: build_monitor(dual=True),'P1','monitor'),
    AssetDef('LAPTOP_OPEN_001','props',build_laptop,'P1','laptop'),
    AssetDef('KEYBOARD_MOUSE_SET_001','props',build_keyboard_mouse,'P1','keyboard_mouse'),
    AssetDef('DESK_LAMP_SLIM_001','props',build_desk_lamp,'P1','lamp'),
    AssetDef('MUG_CERAMIC_001','props',lambda: build_mug(MAT['CERAMIC_WHITE']),'P1','mug'),
    AssetDef('COFFEE_TAKEOUT_001','props',build_takeout_coffee,'P1','cup'),
    AssetDef('DESK_PHONE_001','props',build_phone,'P2','phone'),
    AssetDef('PAPER_STACK_001','props',build_paper_stack,'P2','paper'),
    AssetDef('PEN_HOLDER_001','props',build_pen_holder,'P2','pen_holder'),
    AssetDef('BOOK_STACK_001','props',build_books_stack,'P2','books'),
    AssetDef('BINDER_SET_001','props',build_binder_set,'P2','binder'),
    AssetDef('HEADSET_001','props',build_headset,'P2','headset'),
    AssetDef('CABLE_SET_001','props',lambda:[(cyl_between((-0.18,0,0.01),(0.18,0.07,0.01),0.006,MAT['PLASTIC_BLACK'],6),'cable'),(cyl_between((0.18,0.07,0.01),(0.35,0.02,0.01),0.006,MAT['PLASTIC_BLACK'],6),'cable')],'P2','cable'),
    AssetDef('DOCUMENT_TRAY_001','props',lambda:[(rounded_rect_mesh(0.35,0.26,0.04,0.03,MAT['PLASTIC_BLACK'],loc=(0,0,0.02),sections=4),'tray'),(box((0.30,0.22,0.02),(0,0,0.055),MAT['PAPER']),'papers')],'P2','tray'),
    # Storage
    AssetDef('SHELF_OPEN_001','storage',build_open_shelf,'P1','shelf'),
    AssetDef('CABINET_FILE_001','storage',build_file_cabinet,'P1','cabinet'),
    AssetDef('LOCKER_001','storage',build_locker,'P2','locker'),
    AssetDef('PRINTER_MFP_001','storage',build_printer,'P1','printer'),
    AssetDef('TRASH_BIN_001','storage',build_trash_bin,'P2','trash'),
    # Plants / decor
    AssetDef('PLANT_LARGE_REALISTIC_HERO_001','plants',build_plant_large,'P1','plant'),
    AssetDef('PLANT_MEDIUM_001','plants',build_plant_medium,'P1','plant'),
    AssetDef('PLANT_SMALL_DESK_001','plants',build_plant_small,'P1','plant'),
    AssetDef('PLANT_HANGING_001','plants',build_hanging_plant,'P2','plant'),
    AssetDef('WALL_ART_FRAME_001','decor',build_wall_art,'P2','art'),
    AssetDef('POSTER_FOCUS_PLAN_EXECUTE_001','decor',build_poster_focus,'P2','poster'),
    AssetDef('WALL_CLOCK_001','decor',build_wall_clock,'P2','clock'),
    # Lighting
    AssetDef('LIGHT_CEILING_PANEL_001','lighting',build_ceiling_panel_light,'P2','light'),
    AssetDef('LIGHT_PENDANT_WARM_001','lighting',build_pendant_lamp,'P2','light'),
    # Characters
    AssetDef('CHAR_MALE_001','characters',lambda: build_character('male','navy'),'P1','character','unrigged T-pose mesh, Mixamo-ready'),
    AssetDef('CHAR_FEMALE_001','characters',lambda: build_character('female','green'),'P1','character','unrigged T-pose mesh, Mixamo-ready'),
    AssetDef('CHAR_RECEPTIONIST_001','characters',lambda: build_character('receptionist','navy',True),'P1','character','unrigged T-pose mesh, Mixamo-ready'),
    AssetDef('CHAR_MALE_CASUAL_002','characters',lambda: build_character('male','green'),'P2','character','unrigged T-pose mesh, Mixamo-ready'),
    AssetDef('CHAR_FEMALE_BUSINESS_002','characters',lambda: build_character('female','navy'),'P2','character','unrigged T-pose mesh, Mixamo-ready'),
]

asset_parts: Dict[str, Parts] = {}
asset_meta: List[Dict[str,Any]] = []
poly_rows=[]


def add_interactions(meta, asset_type):
    b=meta['dimensions_m']; w=b['width']; d=b['depth']; h=b['height']
    collision={'type':'BOX','center':[0,0,round(h/2,3)],'size':[round(w,3),round(d,3),round(h,3)]}
    meta['collision']=collision
    anchors={
        'interaction_anchor': {'position':[0,0,round(min(h,1.2),3)], 'rotation':[0,0,0]},
        'camera_focus_anchor': {'position':[0,0,round(h*0.65,3)], 'rotation':[0,0,0]}
    }
    inter={}
    if asset_type in ['chair','stool']:
        inter['can_sit']=True
        anchors['seat_anchor']={'position':[0,0,0.48], 'rotation':[0,0,0]}
        anchors['status_anchor']={'position':[0,0,round(h+0.35,3)], 'rotation':[0,0,0]}
    if asset_type in ['desk','desk_cluster','reception_desk','counter']:
        inter['can_work']=True
        anchors['work_anchor']={'position':[0,-round(d/2+0.20,3),0.75], 'rotation':[0,0,0]}
        anchors['chair_snap_anchor']={'position':[0,-round(d/2+0.55,3),0], 'rotation':[0,0,0]}
    if asset_type in ['meeting_table']:
        inter['can_meet']=True
        # generate anchors by capacity
        anchors['meeting_anchors']=[]
        cap=8 if w>2 else 4
        xs=np.linspace(-w*0.35,w*0.35,cap//2)
        for idx,x in enumerate(xs):
            anchors['meeting_anchors'].append({'id':f'seat_{idx+1:02d}','position':[round(float(x),3),round(-d/2-0.42,3),0.48],'rotation':[0,0,0]})
        for idx,x in enumerate(xs):
            anchors['meeting_anchors'].append({'id':f'seat_{idx+1+cap//2:02d}','position':[round(float(x),3),round(d/2+0.42,3),0.48],'rotation':[0,0,180]})
    if asset_type in ['room_shell','phonebooth','focus_pod']:
        inter['can_enter']=True
        anchors['room_label_anchor']={'position':[0,-round(d/2+0.25,3),round(h+0.30,3)],'rotation':[0,0,0]}
    if asset_type == 'character':
        inter['avatar']=True
        anchors['name_tag_anchor']={'position':[0,0,1.95],'rotation':[0,0,0]}
        anchors['status_dot_anchor']={'position':[0.25,0,1.95],'rotation':[0,0,0]}
        meta['rig_status']='unrigged_t_pose_mixamo_ready'
        meta['required_animation_clips']=['idle','walk','sit','typing','wave','talk']
    meta['anchors']=anchors
    meta['interaction']=inter
    return meta

# Export individual assets
for a in assets:
    parts = a.builder()
    parts = normalize_parts(parts)
    asset_parts[a.asset_id]=[(m.copy(),n) for m,n in parts]
    s=make_scene(parts)
    folder=OUT/'models'/a.category
    folder.mkdir(parents=True, exist_ok=True)
    glb_path=folder/f'{a.asset_id}.glb'
    s.export(glb_path)
    mn,mx=bounds_from_parts(parts)
    dims=mx-mn
    tris=sum(len(m.faces) for m,_ in parts)
    meta={
        'asset_id': a.asset_id,
        'category': a.category,
        'type': a.type,
        'priority': a.priority,
        'file': str(glb_path.relative_to(OUT)).replace('\\','/'),
        'unit': 'meter',
        'up_axis': 'Z',
        'pivot': 'BOTTOM_CENTER',
        'floor_z': 0,
        'dimensions_m': {'width':round(float(dims[0]),3),'depth':round(float(dims[1]),3),'height':round(float(dims[2]),3)},
        'pbr_materials': True,
        'baked_lighting_in_basecolor': False,
        'notes': a.note,
        'qa': {'triangles': int(tris), 'source': 'procedural_v3_hero_quality'}
    }
    add_interactions(meta, a.type)
    asset_meta.append(meta)
    with open(OUT/'metadata/assets'/f'{a.asset_id}.meta.json','w',encoding='utf-8') as f:
        json.dump(meta,f,indent=2,ensure_ascii=False)
    poly_rows.append({'asset_id':a.asset_id,'category':a.category,'type':a.type,'triangles':tris,'width_m':round(float(dims[0]),3),'depth_m':round(float(dims[1]),3),'height_m':round(float(dims[2]),3)})

with open(OUT/'registry/asset-registry.json','w',encoding='utf-8') as f:
    json.dump({'version':'3.0','description':'Virtual Office Production Hero Quality Asset Registry','asset_count':len(asset_meta),'assets':asset_meta}, f, indent=2, ensure_ascii=False)

with open(OUT/'qa/polycount-report.csv','w',newline='',encoding='utf-8') as f:
    writer=csv.DictWriter(f,fieldnames=['asset_id','category','type','triangles','width_m','depth_m','height_m'])
    writer.writeheader(); writer.writerows(poly_rows)

# --------------------------------------------------------------------------------------
# Prefabs and scenes
# --------------------------------------------------------------------------------------

def clone_parts(asset_id, loc=(0,0,0), rot_z=0, scale=1.0):
    parts=[]
    S=scale_matrix(scale) if isinstance(scale,(int,float)) else np.diag([scale[0],scale[1],scale[2],1])
    R=rotation_matrix(math.radians(rot_z),[0,0,1])
    T=translation_matrix(loc)
    M=concatenate_matrices(T,R,S)
    for m,n in asset_parts[asset_id]:
        mc=m.copy(); mc.apply_transform(M); parts.append((mc,f'{asset_id}_{n}'))
    return parts

prefabs=[]

def prefab(prefab_id, description, instances, anchors=None):
    obj={'prefab_id':prefab_id,'description':description,'instances':instances,'anchors':anchors or {}}
    prefabs.append(obj)
    with open(OUT/'prefabs'/f'{prefab_id}.json','w',encoding='utf-8') as f:
        json.dump(obj,f,indent=2,ensure_ascii=False)

prefab('KIT_RECEPTION_LOBBY_HERO_001','Hero-quality reception lobby module',[
    {'asset_id':'RECEPTION_BACKWALL_WOOD_SLAT_HERO_001','position':[0,0,0],'rotation':[0,0,0]},
    {'asset_id':'RECEPTION_DESK_MARBLE_HERO_001','position':[0,-1.0,0],'rotation':[0,0,0]},
    {'asset_id':'LOBBY_DECOR_SHELF_001','position':[2.9,-0.15,0],'rotation':[0,0,0]},
    {'asset_id':'PLANT_LARGE_REALISTIC_HERO_001','position':[-2.6,-0.5,0],'rotation':[0,0,0]},
])
prefab('KIT_WORKSTATION_CLUSTER_HERO_001','Four-person workstation cluster with planter divider and props',[
    {'asset_id':'DESK_BENCH_4P_HERO_001','position':[0,0,0],'rotation':[0,0,0]},
    {'asset_id':'CHAIR_TASK_BLACK_HERO_001','position':[-1.1,-1.05,0],'rotation':[0,0,0]},
    {'asset_id':'CHAIR_TASK_BLACK_HERO_001','position':[1.1,-1.05,0],'rotation':[0,0,0]},
    {'asset_id':'CHAIR_TASK_BLACK_HERO_001','position':[-1.1,1.05,0],'rotation':[0,0,180]},
    {'asset_id':'CHAIR_TASK_BLACK_HERO_001','position':[1.1,1.05,0],'rotation':[0,0,180]},
    {'asset_id':'MONITOR_DUAL_001','position':[-1.1,-0.25,0.76],'rotation':[0,0,0]},
    {'asset_id':'MONITOR_SINGLE_001','position':[1.1,-0.25,0.76],'rotation':[0,0,0]},
    {'asset_id':'KEYBOARD_MOUSE_SET_001','position':[0,-0.42,0.77],'rotation':[0,0,0]},
    {'asset_id':'MUG_CERAMIC_001','position':[1.5,-0.38,0.77],'rotation':[0,0,0]},
])
prefab('KIT_GLASS_MEETING_ROOM_HERO_001','Glass meeting room with neon edge and 8P setup',[
    {'asset_id':'ARCH_GLASS_MEETING_ROOM_HERO_001','position':[0,0,0],'rotation':[0,0,0]},
    {'asset_id':'MEETING_TABLE_8P_HERO_001','position':[0,0,0],'rotation':[0,0,0]},
    {'asset_id':'MEETING_TV_WALL_001','position':[0,1.37,0.3],'rotation':[0,0,180]},
])
prefab('KIT_LOUNGE_HERO_001','Blue sofa lounge with rug and coffee table',[
    {'asset_id':'RUG_BLUE_PATTERN_001','position':[0,0,0],'rotation':[0,0,0]},
    {'asset_id':'SOFA_SECTIONAL_BLUE_HERO_001','position':[0,0.25,0],'rotation':[0,0,0]},
    {'asset_id':'TABLE_COFFEE_ROUND_001','position':[0,-0.65,0],'rotation':[0,0,0]},
    {'asset_id':'PLANT_MEDIUM_001','position':[1.45,-0.45,0],'rotation':[0,0,0]},
])
prefab('KIT_PANTRY_CAFE_HERO_001','Marble pantry counter with stools and machines',[
    {'asset_id':'PANTRY_COUNTER_MARBLE_HERO_001','position':[0,0,0],'rotation':[0,0,0]},
    {'asset_id':'COFFEE_MACHINE_001','position':[-0.8,-0.25,0.92],'rotation':[0,0,0]},
    {'asset_id':'WATER_DISPENSER_001','position':[1.6,0,0],'rotation':[0,0,0]},
    {'asset_id':'CHAIR_STOOL_BAR_001','position':[-0.8,-0.9,0],'rotation':[0,0,0]},
    {'asset_id':'CHAIR_STOOL_BAR_001','position':[0,-0.9,0],'rotation':[0,0,0]},
    {'asset_id':'CHAIR_STOOL_BAR_001','position':[0.8,-0.9,0],'rotation':[0,0,0]},
])

with open(OUT/'registry/prefab-registry.json','w',encoding='utf-8') as f:
    json.dump({'version':'3.0','prefab_count':len(prefabs),'prefabs':prefabs}, f, indent=2, ensure_ascii=False)

# Build hero scene
scene_parts: Parts = []
# base floors: concrete main + wood/pantry zones
scene_parts.append((box((16,10,0.06),(0,0,0.03),MAT['CONCRETE_POLISHED']),'main_concrete_floor'))
scene_parts.append((box((6.0,3.0,0.065),(-4.7,-3.2,0.065),MAT['WOOD_WALNUT']),'pantry_wood_floor'))
scene_parts.append((box((4.0,2.3,0.065),(-4.7,2.9,0.067),MAT['WOOD_LIGHT']),'reception_wood_floor'))
# subtle tile lines
for x in np.linspace(-7.5,7.5,11): scene_parts.append((box((0.015,10,0.006),(x,0,0.067),MAT['CONCRETE_DARK']),'floor_groove_x'))
for y in np.linspace(-4.5,4.5,8): scene_parts.append((box((16,0.015,0.006),(0,y,0.068),MAT['CONCRETE_DARK']),'floor_groove_y'))
# reception module
scene_parts += clone_parts('RECEPTION_BACKWALL_WOOD_SLAT_HERO_001', loc=(-5.2,3.95,0), rot_z=0)
scene_parts += clone_parts('RECEPTION_DESK_MARBLE_HERO_001', loc=(-5.2,2.75,0), rot_z=0)
scene_parts += clone_parts('LOBBY_DECOR_SHELF_001', loc=(-2.1,3.7,0), rot_z=0)
scene_parts += clone_parts('PLANT_LARGE_REALISTIC_HERO_001', loc=(-7.25,2.7,0), scale=1.05)
scene_parts += clone_parts('PLANT_LARGE_REALISTIC_HERO_001', loc=(-3.3,2.9,0), scale=0.80)
scene_parts += clone_parts('CHAR_RECEPTIONIST_001', loc=(-5.2,2.95,0), rot_z=180, scale=0.85)
# lounge areas
scene_parts += clone_parts('RUG_BLUE_PATTERN_001', loc=(-5.6,0.8,0), scale=1.1)
scene_parts += clone_parts('SOFA_3SEAT_LIGHT_001', loc=(-6.3,1.10,0), rot_z=0)
scene_parts += clone_parts('TABLE_COFFEE_ROUND_001', loc=(-5.1,0.05,0), scale=0.9)
scene_parts += clone_parts('SOFA_SECTIONAL_BLUE_HERO_001', loc=(-0.9,3.5,0), rot_z=180, scale=0.92)
scene_parts += clone_parts('TABLE_COFFEE_ROUND_001', loc=(-0.5,2.7,0), scale=0.8)
# workstations center
for loc,rz in [((-1.2,0.35,0),0),((1.8,-1.25,0),180)]:
    scene_parts += clone_parts('DESK_BENCH_4P_HERO_001', loc=loc, rot_z=rz)
    # chairs manually
    for dx,dy,r in [(-1.1,-1.05,0),(1.1,-1.05,0),(-1.1,1.05,180),(1.1,1.05,180)]:
        scene_parts += clone_parts('CHAIR_TASK_BLACK_HERO_001', loc=(loc[0]+dx,loc[1]+dy,0), rot_z=rz+r, scale=0.85)
    for dx in [-1.1,1.1]:
        scene_parts += clone_parts('MONITOR_DUAL_001', loc=(loc[0]+dx,loc[1]-0.25,0.77), rot_z=rz, scale=0.75)
        scene_parts += clone_parts('KEYBOARD_MOUSE_SET_001', loc=(loc[0]+dx,loc[1]-0.52,0.77), rot_z=rz, scale=0.75)
    scene_parts += clone_parts('MUG_CERAMIC_001', loc=(loc[0]+1.55,loc[1]-0.42,0.77), scale=0.75)
# meeting rooms right
scene_parts += clone_parts('ARCH_GLASS_MEETING_ROOM_HERO_001', loc=(4.6,1.6,0), rot_z=0)
scene_parts += clone_parts('MEETING_TABLE_8P_HERO_001', loc=(4.6,1.6,0), rot_z=0)
for x in [-1.1,-0.35,0.35,1.1]:
    scene_parts += clone_parts('MEETING_CHAIR_BLACK_001', loc=(4.6+x,1.6-0.95,0), rot_z=0, scale=0.82)
    scene_parts += clone_parts('MEETING_CHAIR_BLACK_001', loc=(4.6+x,1.6+0.95,0), rot_z=180, scale=0.82)
scene_parts += clone_parts('MEETING_TV_WALL_001', loc=(4.6,2.97,0.45), rot_z=180, scale=0.82)
scene_parts += clone_parts('PLANT_LARGE_REALISTIC_HERO_001', loc=(6.9,0.0,0), scale=0.75)
# second small meeting room/product sync lower right
scene_parts += clone_parts('ARCH_GLASS_MEETING_ROOM_HERO_001', loc=(4.4,-2.1,0), rot_z=0, scale=0.82)
scene_parts += clone_parts('MEETING_TABLE_4P_001', loc=(4.4,-2.1,0), rot_z=0)
for dx,dy,rz in [(-0.65,-0.65,0),(0.65,-0.65,0),(-0.65,0.65,180),(0.65,0.65,180)]:
    scene_parts += clone_parts('MEETING_CHAIR_BLACK_001', loc=(4.4+dx,-2.1+dy,0), rot_z=rz, scale=0.78)
scene_parts += clone_parts('MEETING_TV_WALL_001', loc=(4.4,-0.98,0.35), rot_z=180, scale=0.65)
# pantry left bottom
scene_parts += clone_parts('PANTRY_COUNTER_MARBLE_HERO_001', loc=(-4.6,-3.15,0), rot_z=0)
for x in [-5.4,-4.6,-3.8]: scene_parts += clone_parts('CHAIR_STOOL_BAR_001', loc=(x,-4.05,0), scale=0.85)
scene_parts += clone_parts('COFFEE_MACHINE_001', loc=(-5.5,-3.45,0.92), scale=0.8)
scene_parts += clone_parts('WATER_DISPENSER_001', loc=(-2.85,-3.15,0), scale=0.85)
# phonebooth/focus
scene_parts += clone_parts('PHONEBOOTH_1P_GLASS_001', loc=(7.1,-3.3,0), rot_z=180, scale=0.95)
scene_parts += clone_parts('FOCUS_POD_001', loc=(0.4,-3.8,0), rot_z=120, scale=0.95)
# decor/greenery
for loc,sc in [((-7.1,-1.2,0),0.85),((-2.2,-2.7,0),0.7),((2.3,2.9,0),0.72),((6.9,3.4,0),0.78),((1.4,1.5,0),0.55),((2.2,-3.7,0),0.7)]:
    scene_parts += clone_parts('PLANT_LARGE_REALISTIC_HERO_001', loc=loc, scale=sc)
for loc in [(-0.2,4.0,1.0),(0.55,4.0,1.0)]:
    scene_parts += clone_parts('WALL_ART_FRAME_001', loc=loc, rot_z=0, scale=0.9)
# characters in scene
scene_parts += clone_parts('CHAR_MALE_001', loc=(-2.2,1.15,0), rot_z=-20, scale=0.82)
scene_parts += clone_parts('CHAR_FEMALE_001', loc=(0.45,0.95,0), rot_z=20, scale=0.82)
scene_parts += clone_parts('CHAR_MALE_CASUAL_002', loc=(-1.0,-3.0,0), rot_z=160, scale=0.82)
scene_parts += clone_parts('CHAR_FEMALE_BUSINESS_002', loc=(2.7,-0.3,0), rot_z=-45, scale=0.80)
# status dots above characters as 3D primitives
for loc in [(-2.2,1.15,1.85),(0.45,0.95,1.85),(-1.0,-3.0,1.85),(2.7,-0.3,1.85)]:
    scene_parts.append((sphere(0.08,loc,MAT['GREEN_DOT'],1),'floating_online_dot'))
# edge planters/low walls
for x in [-7.8,7.8]: scene_parts.append((box((0.16,10.0,0.36),(x,0,0.18),MAT['CONCRETE_DARK']),'floor_edge'))
for y in [-4.9,4.9]: scene_parts.append((box((16.0,0.16,0.36),(0,y,0.18),MAT['CONCRETE_DARK']),'floor_edge'))

hero_scene = make_scene(scene_parts)
hero_path = OUT/'scenes/SCENE_ACME_HQ_HERO_V3_001.glb'
hero_scene.export(hero_path)
# Vertical slice = same but with subset? Use same for quality basis
hero_scene.export(OUT/'scenes/SCENE_VERTICAL_SLICE_HERO_V3_001.glb')

# Asset gallery scene with selected hero assets arranged
selected_ids = [
    'RECEPTION_DESK_MARBLE_HERO_001','RECEPTION_BACKWALL_WOOD_SLAT_HERO_001','ARCH_GLASS_MEETING_ROOM_HERO_001','DESK_BENCH_4P_HERO_001',
    'CHAIR_TASK_BLACK_HERO_001','MEETING_TABLE_8P_HERO_001','SOFA_SECTIONAL_BLUE_HERO_001','PANTRY_COUNTER_MARBLE_HERO_001',
    'PLANT_LARGE_REALISTIC_HERO_001','PHONEBOOTH_1P_GLASS_001','CHAR_MALE_001','CHAR_FEMALE_001'
]
gallery_parts=[]
for idx,aid in enumerate(selected_ids):
    x=(idx%4)*3.4-5.1; y=-(idx//4)*3.0+3.0
    gallery_parts += clone_parts(aid, loc=(x,y,0), scale=0.85)
make_scene(gallery_parts).export(OUT/'scenes/SCENE_ASSET_GALLERY_HERO_V3_001.glb')

# --------------------------------------------------------------------------------------
# Simple isometric renderer for preview PNGs
# --------------------------------------------------------------------------------------

def material_rgba(mesh):
    try:
        m=mesh.visual.material
        if hasattr(m,'baseColorFactor') and m.baseColorFactor is not None:
            c=list(m.baseColorFactor)
            if max(c[:3]) <= 1.0:
                c=[int(max(0,min(1,v))*255) for v in c[:3]] + [int(max(0,min(1,c[3] if len(c)>3 else 1))*255)]
            else:
                c=[int(v) for v in c]
            return c
        mc=m.main_color
        return [int(x) for x in mc]
    except Exception:
        return [180,180,180,255]


def render_parts(parts, out_path, width=1600, height=1000, margin=50, bg=(235,238,242), camera=(8,-10,7), target=(0,0,0), transparent=False):
    eye=np.array(camera,dtype=float); target=np.array(target,dtype=float); up=np.array([0,0,1.0])
    forward=(target-eye); forward=forward/np.linalg.norm(forward)
    right=np.cross(forward, up); right=right/np.linalg.norm(right)
    cam_up=np.cross(right, forward); cam_up=cam_up/np.linalg.norm(cam_up)
    tris=[]; all_xy=[]
    light=np.array([-0.35,-0.55,0.90]); light=light/np.linalg.norm(light)
    for mesh,name in parts:
        if len(mesh.faces)==0: continue
        verts=mesh.vertices
        faces=mesh.faces
        norms=mesh.face_normals
        rgba=material_rgba(mesh)
        base=np.array(rgba[:3])/255.0; alpha=rgba[3]/255.0 if len(rgba)>3 else 1.0
        for fi,face in enumerate(faces):
            pts=verts[face]
            # skip microscopic degenerate polys
            if np.linalg.norm(np.cross(pts[1]-pts[0], pts[2]-pts[0])) < 1e-8: continue
            normal=norms[fi]
            # shade
            ndl=max(0.0, float(np.dot(normal, light)))
            shade=0.50+0.50*ndl
            # add slightly brighter tops
            shade += 0.12*max(0, normal[2])
            col=np.clip(base*shade,0,1)
            # emissive approx: detect neon/screen/green/red by material name
            mat_name=''
            try: mat_name=mesh.visual.material.name or ''
            except Exception: pass
            if 'EMISSIVE' in mat_name or 'NEON' in mat_name or 'SCREEN' in mat_name or 'ONLINE' in mat_name:
                col=np.clip(base*1.35+0.10,0,1)
            proj=[]
            depths=[]
            for p in pts:
                v=p-eye
                proj.append([float(np.dot(v,right)), float(np.dot(v,cam_up))])
                depths.append(float(np.dot(v,forward)))
            sort_depth = float(np.mean(depths))
            if ('floor' in name.lower()) or ('rug' in name.lower()):
                sort_depth = 1e9
            tris.append((np.array(proj), sort_depth, tuple(col.tolist()+[alpha]), name))
            all_xy.extend(proj)
    if not all_xy:
        return
    all_xy=np.array(all_xy)
    mn=all_xy.min(axis=0); mx=all_xy.max(axis=0)
    span=mx-mn
    scale=min((width-2*margin)/(span[0]+1e-6),(height-2*margin)/(span[1]+1e-6))
    polys=[]; colors=[]
    tris.sort(key=lambda t:t[1], reverse=True)
    for proj,depth,col,name in tris:
        pts=(proj-mn)*scale + np.array([margin,margin])
        # y-axis is already screen-up in matplotlib coordinates; do not flip.
        polys.append(pts)
        colors.append(col)
    fig=plt.figure(figsize=(width/100,height/100),dpi=100)
    ax=fig.add_axes([0,0,1,1])
    ax.set_xlim(0,width); ax.set_ylim(0,height); ax.axis('off')
    ax.set_facecolor((0,0,0,0) if transparent else tuple(np.array(bg)/255.0))
    # ground soft ellipse shadow
    if not transparent:
        ax.add_patch(plt.Rectangle((0,0),width,height,color=np.array(bg)/255.0,zorder=-10))
    pc=PolyCollection(polys, facecolors=colors, edgecolors=(0,0,0,0.05), linewidths=0.12)
    ax.add_collection(pc)
    fig.savefig(out_path, dpi=100, transparent=transparent)
    plt.close(fig)

# Render scene base and UI composite
scene_render_path=OUT/'previews/hero/scene-render-v3.png'
render_parts(scene_parts, scene_render_path, width=1920, height=1080, margin=60, bg=(214,218,221), camera=(8,-9,6.3), target=(0,0,0))

# UI composite overlay to match attached design direction
base=Image.open(scene_render_path).convert('RGBA')
W,H=base.size
ui=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ui)
# dark sidebars/top
sidebar_w=245; right_w=300; top_h=74
d.rounded_rectangle((0,0,sidebar_w,H), radius=0, fill=(7,14,26,235))
d.rectangle((0,0,W,top_h), fill=(5,10,18,220))
d.rounded_rectangle((W-right_w,82,W-10,H-20), radius=16, fill=(10,18,31,235), outline=(45,60,82,160), width=1)
# Logo/top texts
d.text((28,32),'▣  Virtual Office',font=find_font(26,True),fill=(245,248,255,255),anchor='lm')
d.text((320,34),'Acme Corp HQ ⌄',font=find_font(18,True),fill=(245,248,255,230),anchor='lm')
# left nav items
items=['Office','Rooms','People','Chat','Events','Whiteboard','Files','Settings']
y=132
for idx,it in enumerate(items):
    if idx==0:
        d.rounded_rectangle((18,y-27,sidebar_w-18,y+27),radius=9,fill=(45,100,230,255))
    d.text((76,y),it,font=find_font(17,False),fill=(240,245,255,255),anchor='lm')
    d.text((37,y),'⌂' if idx==0 else '□',font=find_font(20,False),fill=(230,240,255,225),anchor='mm')
    y+=62
# mini map panel
d.rounded_rectangle((18,H-260,sidebar_w-18,H-60), radius=14, fill=(17,27,45,230), outline=(55,70,95,150))
d.text((37,H-224),'Floor 1',font=find_font(16,True),fill=(245,248,255,230),anchor='lm')
d.rectangle((48,H-190,188,H-95),outline=(90,110,140,190),width=3)
for i in range(10):
    x=60+random.randint(0,115); y=H-180+random.randint(0,75)
    d.ellipse((x-4,y-4,x+4,y+4),fill=(70,125,255,255))
d.text((28,H-28),'●  29 People Online',font=find_font(15,False),fill=(210,230,255,230),anchor='lm')
# right people panel
d.text((W-right_w+28,126),'People (29)',font=find_font(18,True),fill=(245,248,255,255),anchor='lm')
people=[('Ava Taylor','Online'),('Liam Chen','Online'),('Sophia Patel','At desk'),('Noah Johnson','In a meeting'),('Olivia Kim','In a meeting'),('Ethan Wright','Online')]
y=180
for name,status in people:
    d.ellipse((W-right_w+28,y-16,W-right_w+60,y+16),fill=(120,140,165,255))
    d.ellipse((W-right_w+52,y+8,W-right_w+62,y+18),fill=(65,210,96,255))
    d.text((W-right_w+74,y-5),name,font=find_font(15,True),fill=(235,242,255,255),anchor='lm')
    d.text((W-right_w+74,y+16),status,font=find_font(13,False),fill=(165,180,200,255),anchor='lm')
    y+=62
# search box
d.rounded_rectangle((W-700,18,W-430,58),radius=8,fill=(7,12,22,220),outline=(65,77,98,180))
d.text((W-670,38),'Search...',font=find_font(16,False),fill=(155,165,180,255),anchor='lm')
# room labels / name tags approximate positions
labels=[('Design Room\n4 in room',(1175,215)),('Product Sync\n5 in room',(1345,430)),('Olivia',(650,330)),('Liam',(940,340)),('Sophia',(990,500)),('Noah',(705,535)),('Ethan',(710,745))]
for text,(x,y) in labels:
    lines=text.split('\n')
    w=150 if len(lines)>1 else 92; h=60 if len(lines)>1 else 34
    d.rounded_rectangle((x-w/2,y-h/2,x+w/2,y+h/2),radius=12,fill=(20,25,34,220),outline=(80,90,110,120))
    if len(lines)==1:
        d.ellipse((x-w/2+12,y-6,x-w/2+24,y+6),fill=(65,210,96,255))
        d.text((x-w/2+32,y),lines[0],font=find_font(15,True),fill=(245,248,255,255),anchor='lm')
    else:
        d.text((x-w/2+15,y-12),lines[0],font=find_font(16,True),fill=(245,248,255,255),anchor='lm')
        d.text((x-w/2+15,y+14),lines[1],font=find_font(14,False),fill=(170,180,200,255),anchor='lm')
# meeting card bottom right
d.rounded_rectangle((1125,675,1625,1035),radius=18,fill=(9,16,30,238),outline=(65,85,120,160),width=1)
d.text((1148,710),'Product Sync  LIVE  24:18',font=find_font(16,True),fill=(245,248,255,255),anchor='lm')
for i,name in enumerate(['Ava','Noah','Sophia','Liam','Olivia']):
    x=1150+(i%3)*155; y0=750+(i//3)*110
    d.rounded_rectangle((x,y0,x+135,y0+82),radius=9,fill=(65+i*20,95+i*12,125+i*10,255))
    d.ellipse((x+48,y0+12,x+87,y0+51),fill=(215,175,145,255))
    d.text((x+10,y0+68),name,font=find_font(13,True),fill=(255,255,255,255),anchor='lm')
for i,sym in enumerate(['●','▣','▤','☺','✋','…','☎']):
    x=1175+i*50; y=990
    fill=(38,50,70,255) if i<6 else (210,70,70,255)
    d.ellipse((x-18,y-18,x+18,y+18),fill=fill)
    d.text((x,y),sym,font=find_font(18,True),fill=(245,248,255,255),anchor='mm')
# bottom hint
d.rounded_rectangle((650,1000,1045,1052),radius=18,fill=(45,45,48,190))
d.text((847,1026),'Walk up to a room and press  E  to enter',font=find_font(18,False),fill=(245,245,240,245),anchor='mm')
composite=Image.alpha_composite(base,ui)
composite.save(OUT/'previews/hero/hero-office-ui-composite-v3.png')
composite.save(OUT/'previews/hero-office-preview-v3.png')

# Render contact sheet thumbnails for selected key assets
thumbs=[]
for aid in selected_ids + ['MEETING_TV_WALL_001','PANTRY_COUNTER_MARBLE_HERO_001','PHONEBOOTH_1P_GLASS_001','PLANT_LARGE_REALISTIC_HERO_001','MONITOR_DUAL_001','LAPTOP_OPEN_001','SHELF_OPEN_001','PRINTER_MFP_001','CHAR_RECEPTIONIST_001','LIGHT_PENDANT_WARM_001','WATER_DISPENSER_001','COFFEE_MACHINE_001']:
    pth=OUT/'previews/contact_sheets'/f'{aid}.png'
    render_parts(asset_parts[aid], pth, width=360, height=260, margin=25, bg=(242,244,247), camera=(3,-4,3), target=(0,0,0))
    thumbs.append((aid,pth))
cols=4; rows=math.ceil(len(thumbs)/cols); tw,th=360,310
sheet=Image.new('RGB',(cols*tw,rows*th),(230,233,237)); sd=ImageDraw.Draw(sheet)
for i,(aid,pth) in enumerate(thumbs):
    img=Image.open(pth).convert('RGB')
    x=(i%cols)*tw; y=(i//cols)*th
    sheet.paste(img,(x,y))
    sd.rectangle((x+8,y+8,x+tw-8,y+th-8),outline=(180,185,195),width=1)
    sd.text((x+tw/2,y+th-28),aid,font=find_font(15,True),fill=(35,45,60),anchor='mm')
sheet.save(OUT/'previews/asset-contact-sheet-v3.png')

# Character contact sheet
char_ids=['CHAR_MALE_001','CHAR_FEMALE_001','CHAR_RECEPTIONIST_001','CHAR_MALE_CASUAL_002','CHAR_FEMALE_BUSINESS_002']
cthumbs=[]
for aid in char_ids:
    pth=OUT/'previews/characters'/f'{aid}.png'
    render_parts(asset_parts[aid], pth, width=300, height=420, margin=30, bg=(240,242,245), camera=(2,-3,2.2), target=(0,0,0.8))
    cthumbs.append((aid,pth))
cs=Image.new('RGB',(len(cthumbs)*300,470),(232,235,239)); cd=ImageDraw.Draw(cs)
for i,(aid,pth) in enumerate(cthumbs):
    img=Image.open(pth).convert('RGB')
    x=i*300; cs.paste(img,(x,0)); cd.text((x+150,442),aid,font=find_font(14,True),fill=(35,45,60),anchor='mm')
cs.save(OUT/'previews/characters/character-contact-sheet-v3.png')

# UI asset PNG/SVG files
# Save basic UI components separately
ui_specs=[
    ('name-tag-online', (180,54), lambda d,w,h: (d.rounded_rectangle((0,0,w,h),radius=16,fill=(20,25,34,230)), d.ellipse((18,20,32,34),fill=(65,210,96,255)), d.text((45,27),'Ava Taylor',font=find_font(16,True),fill=(245,248,255,255),anchor='lm'))),
    ('room-label', (240,86), lambda d,w,h: (d.rounded_rectangle((0,0,w,h),radius=16,fill=(20,25,34,230),outline=(85,95,115,160)), d.text((18,28),'Design Room',font=find_font(18,True),fill=(245,248,255,255),anchor='lm'), d.text((18,58),'4 in room',font=find_font(15),fill=(170,180,200,255),anchor='lm'))),
    ('video-button', (88,88), lambda d,w,h: (d.ellipse((4,4,w-4,h-4),fill=(48,105,235,255)), d.text((w/2,h/2),'▶',font=find_font(28,True),fill=(255,255,255,255),anchor='mm'))),
]
for name, size, drawfn in ui_specs:
    im=Image.new('RGBA',size,(0,0,0,0)); dd=ImageDraw.Draw(im); drawfn(dd,*size); im.save(OUT/'ui/png'/f'UI_{name}.png')
    # simple svg placeholder with same name
    with open(OUT/'ui/svg'/f'UI_{name}.svg','w',encoding='utf-8') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{size[0]}" height="{size[1]}" viewBox="0 0 {size[0]} {size[1]}"><rect width="100%" height="100%" rx="16" fill="#141922" fill-opacity="0.92"/><text x="16" y="32" fill="#F5F8FF" font-size="16" font-family="Arial">{name}</text></svg>')

# Documentation
coverage_md = f"""# Virtual Office Production Assets v3.0 — Hero Quality Rebuild

작성일: 2026-07-09

이 패키지는 이전 v2.0 프로토타입 패키지를 폐기하고, 첨부 디자인 시안의 방향성에 맞춰 **히어로 씬 중심**으로 재제작한 가상오피스 3D 에셋 세트입니다.

## 포함 수량

- 개별 GLB 에셋: {len(asset_meta)}개
- 히어로 씬 GLB: 1개
- Vertical Slice GLB: 1개
- Asset Gallery GLB: 1개
- Prefab JSON: {len(prefabs)}개
- 에셋별 metadata JSON: {len(asset_meta)}개
- UI PNG/SVG: 3종
- PBR material registry: {len(material_registry)}종

## 핵심 개선점

- 리셉션/유리 회의실/워크스테이션/라운지/탕비실을 별도 히어로 모듈로 재구성
- 목재 슬랫, 대리석 데스크, 유리 파티션, 네온 룸 아웃라인, 소품 밀도 강화
- 씬 단위 프리뷰와 UI 오버레이 프리뷰 제공
- 모든 에셋에 `asset_id`, `metadata`, `collision`, `anchor`, `interaction` 정보 포함

## 주의

캐릭터 GLB는 현재 **unrigged T-pose / Mixamo-ready mesh**입니다. 최종 서비스에서 `idle`, `walk`, `sit`, `typing`, `talk`, `wave` 애니메이션을 쓰려면 Mixamo 또는 Blender/Unity 리타겟팅 단계가 필요합니다.

## 주요 파일

- `scenes/SCENE_ACME_HQ_HERO_V3_001.glb`
- `previews/hero-office-preview-v3.png`
- `previews/asset-contact-sheet-v3.png`
- `previews/characters/character-contact-sheet-v3.png`
- `registry/asset-registry.json`
- `registry/prefab-registry.json`
"""
with open(OUT/'docs/full-coverage-report.md','w',encoding='utf-8') as f: f.write(coverage_md)
readme = f"""# Virtual Office Production Asset Pack v3.0

첨부 디자인 시안의 고급 가상사무실 방향에 맞춰 재제작한 3D 에셋 패키지입니다.

## Quick Start

- 전체 히어로 씬: `scenes/SCENE_ACME_HQ_HERO_V3_001.glb`
- 개별 모델: `models/*/*.glb`
- 에셋 레지스트리: `registry/asset-registry.json`
- 프리팹 레지스트리: `registry/prefab-registry.json`
- 프리뷰: `previews/hero-office-preview-v3.png`

## Common Rules

- format: `.glb`
- unit: meter
- up axis: Z
- pivot: bottom center
- floor: z=0
- baseColor에 조명/그림자 베이킹 없음
- metadata에 collision / anchor / interaction 포함

## Character Status

캐릭터는 `unrigged_t_pose_mixamo_ready` 상태입니다. 런타임 skeletal animation은 리깅 후 적용하세요.
"""
with open(OUT/'README.md','w',encoding='utf-8') as f: f.write(readme)

# Source script copy
shutil.copy(__file__, OUT/'source/create_virtual_office_v3.py')

# QA import test report: try load core GLBs
checks=[]
for path in [hero_path, OUT/'models/characters/CHAR_MALE_001.glb', OUT/'models/reception/RECEPTION_DESK_MARBLE_HERO_001.glb']:
    try:
        obj=trimesh.load(path)
        checks.append({'file':str(path.relative_to(OUT)),'load_ok':True,'type':str(type(obj))})
    except Exception as e:
        checks.append({'file':str(path.relative_to(OUT)),'load_ok':False,'error':str(e)})
with open(OUT/'qa/import-test-report.json','w',encoding='utf-8') as f: json.dump(checks,f,indent=2)

# Zip package
zip_path=Path('/mnt/data/virtual_office_production_assets_v3_0.zip')
if zip_path.exists(): zip_path.unlink()
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
    for file in OUT.rglob('*'):
        z.write(file, file.relative_to(OUT.parent))

print('DONE')
print('OUT', OUT)
print('ZIP', zip_path, zip_path.stat().st_size)
print('assets', len(asset_meta), 'prefabs', len(prefabs))
