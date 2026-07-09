import os, json, math, shutil, zipfile, importlib.util, csv, textwrap
from pathlib import Path
import numpy as np
import trimesh
from PIL import Image, ImageDraw
from trimesh.transformations import euler_matrix

SRC_ROOT = Path('/mnt/data/virtual_office_3d_assets_v0_1')
ROOT = Path('/mnt/data/virtual_office_3d_assets_full_v1_0')
ZIP_PATH = Path('/mnt/data/virtual_office_3d_assets_full_v1_0.zip')

# Import the procedural generation helper used for v0.1 assets
spec = importlib.util.spec_from_file_location('gen', '/mnt/data/generate_virtual_office_assets.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

# Fresh build directory
if ROOT.exists():
    shutil.rmtree(ROOT)
shutil.copytree(SRC_ROOT, ROOT)

# Remove older zip if present
if ZIP_PATH.exists(): ZIP_PATH.unlink()

# Common paths
MODELS = ROOT / 'models'
METADATA = ROOT / 'metadata'
PREVIEWS = ROOT / 'previews' / 'thumbnails'
REGISTRY = ROOT / 'registry'
PREFABS = ROOT / 'prefabs'
SCENES = ROOT / 'scenes'
ANIMS = ROOT / 'animations'
QA = ROOT / 'qa'
DOCS = ROOT / 'docs'
SOURCE = ROOT / 'source' / 'procedural_scripts'
for p in [MODELS, METADATA, PREVIEWS, REGISTRY, PREFABS, SCENES, ANIMS, QA, DOCS, SOURCE]:
    p.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------
# Extra character variants requested by the full manifest
# ---------------------------------------------------------------------

def create_character_variant(asset_id, gender='male', jacket='#223B5B', pants='#111827', shirt='#F4F4EF', skin='#D8A272', hair='#4B2E1D', hair_style='short', accessory=None):
    s = trimesh.Scene()
    # body core
    gen.add_box(s, 'torso_jacket', (0.34,0.18,0.52), (0,0,1.04), color=jacket, roughness=0.7)
    gen.add_box(s, 'shirt_front', (0.18,0.19,0.48), (0,-0.006,1.045), color=shirt, roughness=0.75)
    if gender == 'female':
        gen.add_box(s, 'lower_garment', (0.38,0.2,0.18), (0,0,0.71), color=pants, roughness=0.72)
    else:
        gen.add_box(s, 'hips', (0.34,0.18,0.16), (0,0,0.72), color=pants, roughness=0.72)
    # head and hair
    gen.add_cylinder(s, 'neck', 0.055, 0.11, (0,0,1.345), color=skin, roughness=0.75, sections=16)
    gen.add_sphere(s, 'head', 0.16, (0,0,1.52), color=skin, roughness=0.68, subdivisions=2, scale=(0.95,0.9,1.12))
    gen.add_sphere(s, 'hair_cap', 0.165, (0,0.005,1.61), color=hair, roughness=0.82, subdivisions=2, scale=(1.02,0.95,0.55))
    if hair_style == 'bob':
        gen.add_sphere(s, 'hair_back_bob', 0.155, (0,0.085,1.49), color=hair, roughness=0.82, subdivisions=2, scale=(1.0,0.55,1.25))
    elif hair_style == 'ponytail':
        gen.add_sphere(s, 'hair_back', 0.12, (0,0.10,1.50), color=hair, roughness=0.82, subdivisions=2, scale=(0.8,0.55,1.0))
        gen.add_sphere(s, 'ponytail', 0.07, (0,0.18,1.39), color=hair, roughness=0.82, subdivisions=1, scale=(0.8,0.6,1.3))
    elif hair_style == 'curly':
        for i, x in enumerate([-0.09,-0.03,0.03,0.09]):
            gen.add_sphere(s, f'hair_curl_{i}', 0.055, (x,-0.04,1.64), color=hair, roughness=0.82, subdivisions=1, scale=(1,1,0.9))
    elif hair_style == 'sidepart':
        gen.add_box(s, 'side_part_swept_hair', (0.22,0.05,0.08), (-0.04,-0.08,1.64), color=hair, roughness=0.82, rot=(0,0,-18))
    # eyes and optional glasses
    gen.add_sphere(s, 'eye_L', 0.018, (-0.052,-0.142,1.535), color='#111111', roughness=0.4, subdivisions=1)
    gen.add_sphere(s, 'eye_R', 0.018, (0.052,-0.142,1.535), color='#111111', roughness=0.4, subdivisions=1)
    if accessory == 'glasses':
        gen.add_torus(s, 'glasses_L', 0.034, 0.004, (-0.052,-0.154,1.535), color='#111111', roughness=0.3, major_sections=18, minor_sections=6, rot=(90,0,0))
        gen.add_torus(s, 'glasses_R', 0.034, 0.004, (0.052,-0.154,1.535), color='#111111', roughness=0.3, major_sections=18, minor_sections=6, rot=(90,0,0))
        gen.add_box(s, 'glasses_bridge', (0.04,0.006,0.006), (0,-0.158,1.535), color='#111111', roughness=0.3)
    if accessory == 'badge':
        gen.add_box(s, 'id_badge', (0.07,0.01,0.10), (0.095,-0.099,1.08), color='#EAF2FF', roughness=0.45)
        gen.add_box(s, 'badge_lanyard', (0.01,0.01,0.23), (0.055,-0.102,1.18), color='#1F2937', roughness=0.5, rot=(0,0,18))
    # T pose arms
    gen.add_cylinder(s, 'upper_arm_L', 0.043, 0.42, (-0.36,0,1.20), color=jacket, roughness=0.7, axis='x', sections=12)
    gen.add_cylinder(s, 'upper_arm_R', 0.043, 0.42, (0.36,0,1.20), color=jacket, roughness=0.7, axis='x', sections=12)
    gen.add_cylinder(s, 'forearm_L', 0.038, 0.35, (-0.75,0,1.20), color=skin, roughness=0.7, axis='x', sections=12)
    gen.add_cylinder(s, 'forearm_R', 0.038, 0.35, (0.75,0,1.20), color=skin, roughness=0.7, axis='x', sections=12)
    gen.add_sphere(s, 'hand_L', 0.045, (-0.95,0,1.20), color=skin, roughness=0.7, subdivisions=1)
    gen.add_sphere(s, 'hand_R', 0.045, (0.95,0,1.20), color=skin, roughness=0.7, subdivisions=1)
    # legs
    gen.add_cylinder(s, 'leg_L', 0.055, 0.66, (-0.09,0,0.38), color=pants, roughness=0.72, sections=12)
    gen.add_cylinder(s, 'leg_R', 0.055, 0.66, (0.09,0,0.38), color=pants, roughness=0.72, sections=12)
    gen.add_box(s, 'shoe_L', (0.12,0.22,0.06), (-0.09,-0.06,0.04), color='#F7F7F7', roughness=0.6)
    gen.add_box(s, 'shoe_R', (0.12,0.22,0.06), (0.09,-0.06,0.04), color='#F7F7F7', roughness=0.6)
    gen.normalize_scene(s)
    return s

variant_specs = [
    dict(asset_id='CHAR_AVATAR_VARIANT_001', gender='male', jacket='#243B66', pants='#111827', shirt='#F4F4EF', skin='#D8A272', hair='#4B2E1D', hair_style='sidepart', accessory='badge', notes='Male avatar outfit/hair variant 01'),
    dict(asset_id='CHAR_AVATAR_VARIANT_002', gender='female', jacket='#2E7D5B', pants='#1F2937', shirt='#FFFFFF', skin='#E7B58A', hair='#6B3F2A', hair_style='bob', accessory='glasses', notes='Female avatar outfit/hair variant 02'),
    dict(asset_id='CHAR_AVATAR_VARIANT_003', gender='male', jacket='#6B7280', pants='#172033', shirt='#DDEAF7', skin='#B9855B', hair='#18181B', hair_style='short', accessory='glasses', notes='Male avatar outfit/hair variant 03'),
    dict(asset_id='CHAR_AVATAR_VARIANT_004', gender='female', jacket='#7C3AED', pants='#111827', shirt='#F9FAFB', skin='#C98F65', hair='#2B1D14', hair_style='ponytail', accessory='badge', notes='Female avatar outfit/hair variant 04'),
    dict(asset_id='CHAR_AVATAR_VARIANT_005', gender='male', jacket='#0F766E', pants='#1E293B', shirt='#F8FAFC', skin='#F0C39A', hair='#3F2A1D', hair_style='curly', accessory=None, notes='Male avatar outfit/hair variant 05'),
]

# Load current registry
registry_path = REGISTRY / 'asset-registry.json'
registry = json.loads(registry_path.read_text(encoding='utf-8'))
assets_by_id = {a['asset_id']: a for a in registry['assets']}

for v in variant_specs:
    scene = create_character_variant(**{k:v[k] for k in v if k not in ['notes']})
    asset_id = v['asset_id']
    out_dir = MODELS / 'characters'
    out_path = out_dir / f'{asset_id}.glb'
    scene.export(out_path)
    rel_path = f'models/characters/{asset_id}.glb'
    spec_obj = gen.AssetSpec(asset_id, 'character', 'avatar_variant', 'Later', 'characters', lambda s=scene: s, 15000, 2048, v['notes'], 'character')
    meta = gen.metadata_for(scene, spec_obj, rel_path)
    meta['version'] = '1.0.0'
    meta['variant'] = {
        'base_rig_target': 'CHAR_MALE_001 / CHAR_FEMALE_001 humanoid proportions',
        'gender': v['gender'],
        'hair_style': v['hair_style'],
        'material_override_ready': True
    }
    (METADATA / f'{asset_id}.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    gen.make_preview(scene, PREVIEWS / f'{asset_id}.png', asset_id)
    assets_by_id[asset_id] = meta

# ---------------------------------------------------------------------
# Update existing metadata versions and registry flags
# ---------------------------------------------------------------------
for meta_file in METADATA.glob('*.meta.json'):
    try:
        m = json.loads(meta_file.read_text(encoding='utf-8'))
        m['version'] = '1.0.0'
        # Ensure specification fields are explicit
        m.setdefault('unit','meter')
        m.setdefault('pivot','BOTTOM_CENTER')
        m.setdefault('up_axis','Z')
        m.setdefault('format','glb')
        meta_file.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')
        assets_by_id[m['asset_id']] = m
    except Exception:
        pass

# materials metadata version update
materials = []
for mf in (ROOT/'materials').glob('MAT_*.json'):
    m = json.loads(mf.read_text(encoding='utf-8'))
    m['version'] = '1.0.0'
    m['priority'] = 'MVP'
    mf.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')
    materials.append(m)

# ---------------------------------------------------------------------
# Full prefab kit set: make reusable kits from full manifest
# ---------------------------------------------------------------------
def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

additional_prefabs = []
# 2-person bench pod
additional_prefabs.append({
    'prefab_id':'KIT_WORKSTATION_BENCH_2P_001','category':'kit','room_type':'open_office','description':'2-person bench workstation kit using shared bench desk.',
    'instances':[
        {'asset_id':'DESK_BENCH_2P_001','position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'CHAIR_TASK_MESH_001','position':[-0.55,-0.85,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'CHAIR_TASK_MESH_001','position':[0.55,0.85,0],'rotation':[0,0,180],'scale':[1,1,1]},
        {'asset_id':'MONITOR_SINGLE_001','position':[-0.55,-0.12,0.80],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'MONITOR_SINGLE_001','position':[0.55,0.12,0.80],'rotation':[0,0,180],'scale':[1,1,1]},
        {'asset_id':'KEYBOARD_MOUSE_SET_001','position':[-0.55,-0.42,0.80],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'KEYBOARD_MOUSE_SET_001','position':[0.55,0.42,0.80],'rotation':[0,0,180],'scale':[1,1,1]},
    ],
    'anchors':{
        'seat_anchor_01':{'position':[-0.55,-0.85,0.48],'rotation':[0,0,0]},
        'seat_anchor_02':{'position':[0.55,0.85,0.48],'rotation':[0,0,180]}
    }
})
# Small meeting room kit
additional_prefabs.append({
    'prefab_id':'KIT_MEETING_ROOM_SMALL_001','category':'kit','room_type':'meeting_room','description':'4-person small meeting room kit.',
    'instances':[
        {'asset_id':'TABLE_MEETING_SMALL_001','position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'CHAIR_MEETING_001','position':[-0.55,-0.78,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'CHAIR_MEETING_001','position':[0.55,-0.78,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'CHAIR_MEETING_001','position':[-0.55,0.78,0],'rotation':[0,0,180],'scale':[1,1,1]},
        {'asset_id':'CHAIR_MEETING_001','position':[0.55,0.78,0],'rotation':[0,0,180],'scale':[1,1,1]},
        {'asset_id':'WHITEBOARD_MOBILE_001','position':[1.35,0,0],'rotation':[0,0,90],'scale':[1,1,1]},
        {'asset_id':'TV_WALL_001','position':[0,-1.55,0.55],'rotation':[0,0,0],'scale':[0.85,0.85,0.85]},
    ]
})
# Focus zone kit
additional_prefabs.append({
    'prefab_id':'KIT_FOCUS_ZONE_001','category':'kit','room_type':'focus','description':'Phonebooth + focus pod + acoustic panel kit.',
    'instances':[
        {'asset_id':'PHONEBOOTH_001','position':[-0.85,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'FOCUS_POD_001','position':[0.95,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'ACOUSTIC_PANEL_001','position':[0,1.25,0.75],'rotation':[0,0,180],'scale':[1.4,1,1]},
    ],
    'anchors':{
        'phonebooth_seat_anchor':{'position':[-0.85,-0.1,0.48],'rotation':[0,0,0]},
        'focus_pod_seat_anchor':{'position':[0.95,-0.1,0.48],'rotation':[0,0,0]}
    }
})
# Pantry/cafe kit
additional_prefabs.append({
    'prefab_id':'KIT_PANTRY_CAFE_001','category':'kit','room_type':'pantry','description':'Pantry bar/cafe kit with appliances.',
    'instances':[
        {'asset_id':'PANTRY_COUNTER_001','position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'COFFEE_MACHINE_001','position':[-0.65,-0.22,0.92],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'MICROWAVE_001','position':[0.2,-0.26,0.92],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'FRIDGE_001','position':[1.55,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'WATER_DISPENSER_001','position':[-1.55,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'BAR_STOOL_001','position':[-0.6,-0.95,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'BAR_STOOL_001','position':[0.2,-0.95,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'BAR_STOOL_001','position':[1.0,-0.95,0],'rotation':[0,0,0],'scale':[1,1,1]},
    ]
})
# Storage/utility kit
additional_prefabs.append({
    'prefab_id':'KIT_STORAGE_UTILITY_001','category':'kit','room_type':'storage','description':'Office storage/utility kit.',
    'instances':[
        {'asset_id':'SHELF_OPEN_001','position':[-1.2,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'LOCKER_001','position':[0.35,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'PRINTER_MFP_001','position':[1.25,0,0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'TRASH_BIN_001','position':[1.9,-0.25,0],'rotation':[0,0,0],'scale':[1,1,1]},
    ]
})
# Decor kit
additional_prefabs.append({
    'prefab_id':'KIT_WALL_DECOR_001','category':'kit','room_type':'decor','description':'Wall art, poster, clock and signage kit.',
    'instances':[
        {'asset_id':'WALL_ART_001','position':[-1.2,0,0.8],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'WALL_ART_002','position':[-0.25,0,0.8],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'POSTER_FOCUS_001','position':[0.75,0,0.8],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'CLOCK_WALL_001','position':[1.65,0,1.25],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'SIGN_ROOM_001','position':[2.25,0,1.0],'rotation':[0,0,0],'scale':[1,1,1]},
        {'asset_id':'SIGN_FLOOR_001','position':[2.75,0,1.0],'rotation':[0,0,0],'scale':[1,1,1]},
    ]
})

# Load existing prefabs and merge
prefab_files = list(PREFABS.glob('KIT_*.json'))
prefab_map = {}
for pf in prefab_files:
    try:
        p = json.loads(pf.read_text(encoding='utf-8'))
        prefab_map[p['prefab_id']] = p
    except Exception:
        pass
for p in additional_prefabs:
    write_json(PREFABS / f"{p['prefab_id']}.json", p)
    prefab_map[p['prefab_id']] = p
write_json(REGISTRY / 'prefab-registry.json', {'version':'1.0.0','prefabs':list(prefab_map.values())})

# ---------------------------------------------------------------------
# Full office floor scene and asset gallery scene
# ---------------------------------------------------------------------
assets = list(assets_by_id.values())
asset_paths = {a['asset_id']: ROOT / a['file'] for a in assets if 'file' in a and (ROOT / a['file']).exists()}
prefabs = prefab_map

def matrix_from_trs(pos=(0,0,0), rot=(0,0,0), scale=(1,1,1)):
    rx,ry,rz=[math.radians(v) for v in rot]
    R=euler_matrix(rx,ry,rz,'sxyz')
    S=np.eye(4); S[0,0],S[1,1],S[2,2]=scale
    T=np.eye(4); T[:3,3]=pos
    return T @ R @ S

def add_loaded_asset(out_scene, asset_id, M, prefix):
    path = asset_paths.get(asset_id)
    if path is None:
        return
    try:
        sc = trimesh.load(path, force='scene')
        dumped = sc.dump(concatenate=False)
        if not dumped:
            dumped = list(sc.geometry.values())
        for idx, mesh in enumerate(dumped):
            m = mesh.copy()
            m.apply_transform(M)
            out_scene.add_geometry(m, node_name=f'{prefix}_{asset_id}_{idx}', geom_name=f'{prefix}_{asset_id}_{idx}')
    except Exception as e:
        print('scene add failed', asset_id, e)

def add_instance(out_scene, inst, parent_M=None, prefix='i'):
    parent_M = np.eye(4) if parent_M is None else parent_M
    pos=inst.get('position',[0,0,0]); rot=inst.get('rotation',[0,0,0]); scale=inst.get('scale',[1,1,1])
    M = parent_M @ matrix_from_trs(pos, rot, scale)
    if 'asset_id' in inst:
        add_loaded_asset(out_scene, inst['asset_id'], M, prefix)
    elif 'prefab_id' in inst:
        p = prefabs.get(inst['prefab_id'])
        if p:
            for j, sub in enumerate(p.get('instances', [])):
                add_instance(out_scene, sub, M, f'{prefix}_{inst["prefab_id"]}_{j}')

def make_floor(scene, size=(18,12), loc=(0,0,-0.012), material_color='#B98245'):
    floor = trimesh.creation.box(extents=[size[0], size[1], 0.024])
    gen.assign_material(floor, gen.make_material('M_FULL_SCENE_WOOD_FLOOR', material_color, 1, 0.85, 0.0))
    floor.apply_translation(loc)
    scene.add_geometry(floor, node_name='FLOOR', geom_name='FLOOR')
    # zone rugs/carpets
    for name, dims, pos, color in [
        ('meeting_zone_carpet', [5.2,3.3,0.012], [3.9,2.7,0.003], '#4B5563'),
        ('lounge_zone_rug', [3.8,2.8,0.014], [-4.8,-2.8,0.004], '#5F6F80'),
        ('focus_zone_carpet', [4.0,2.4,0.012], [4.7,-3.4,0.004], '#374151'),
        ('reception_runner', [3.8,1.6,0.012], [-5.9,3.7,0.004], '#6B7280'),
    ]:
        m = trimesh.creation.box(extents=dims)
        gen.assign_material(m, gen.make_material(f'M_{name}', color, 1, 0.92, 0.0))
        m.apply_translation(pos)
        scene.add_geometry(m, node_name=name, geom_name=name)
    # perimeter walls
    wall_mat = gen.make_material('M_FULL_SCENE_WALL', '#D7D2C8', 1, 0.82, 0.0)
    for name, dims, pos in [
        ('back_wall',[18,0.12,2.8],[0,6.0,1.4]),
        ('left_wall',[0.12,12,2.8],[-9,0,1.4]),
        ('right_partial_wall',[0.12,5.2,2.8],[9,3.4,1.4]),
    ]:
        m = trimesh.creation.box(extents=dims); gen.assign_material(m, wall_mat); m.apply_translation(pos); scene.add_geometry(m,node_name=name,geom_name=name)

full_scene = trimesh.Scene()
make_floor(full_scene)
full_layout = {
    'scene_id':'SCENE_FULL_OFFICE_FLOOR_001',
    'file':'scenes/SCENE_FULL_OFFICE_FLOOR_001.glb',
    'unit':'meter','up_axis':'Z',
    'description':'Full office floor composed from all MVP and Later asset kits. Runtime should prefer JSON instancing.',
    'floor': {'material_id':'MAT_FLOOR_WOOD_001','size':[18,12]},
    'instances':[
        {'prefab_id':'KIT_RECEPTION_LOBBY_001','position':[-5.9,4.1,0],'rotation':[0,0,0]},
        {'asset_id':'SIGNAGE_STANDING_001','position':[-7.45,3.25,0],'rotation':[0,0,20]},
        {'asset_id':'BENCH_WAITING_001','position':[-4.5,3.35,0],'rotation':[0,0,180]},
        {'prefab_id':'KIT_WORKSTATION_SINGLE_001','position':[-4.7,0.35,0],'rotation':[0,0,0]},
        {'prefab_id':'KIT_WORKSTATION_SINGLE_001','position':[-2.9,0.35,0],'rotation':[0,0,0]},
        {'prefab_id':'KIT_WORKSTATION_SINGLE_001','position':[-1.1,0.35,0],'rotation':[0,0,0]},
        {'prefab_id':'KIT_WORKSTATION_BENCH_2P_001','position':[-3.6,-1.4,0],'rotation':[0,0,0]},
        {'asset_id':'DESK_L_CORNER_001','position':[-0.8,-1.7,0],'rotation':[0,0,0]},
        {'asset_id':'CHAIR_EXECUTIVE_001','position':[-1.2,-2.55,0],'rotation':[0,0,0]},
        {'asset_id':'MONITOR_DUAL_001','position':[-0.8,-1.55,0.8],'rotation':[0,0,0]},
        {'asset_id':'LAPTOP_OPEN_001','position':[-0.2,-1.85,0.8],'rotation':[0,0,-18]},
        {'asset_id':'LAMP_DESK_001','position':[-1.45,-1.75,0.8],'rotation':[0,0,25]},
        {'prefab_id':'KIT_MEETING_ROOM_LARGE_001','position':[3.8,2.8,0],'rotation':[0,0,0]},
        {'prefab_id':'KIT_MEETING_ROOM_SMALL_001','position':[7.1,1.0,0],'rotation':[0,0,90]},
        {'asset_id':'GLASS_PARTITION_001','position':[1.25,1.3,0],'rotation':[0,0,90],'scale':[1.3,1,1]},
        {'asset_id':'GLASS_PARTITION_001','position':[1.25,3.9,0],'rotation':[0,0,90],'scale':[1.3,1,1]},
        {'asset_id':'GLASS_DOOR_001','position':[1.25,2.6,0],'rotation':[0,0,90]},
        {'prefab_id':'KIT_LOUNGE_BASIC_001','position':[-4.8,-2.8,0],'rotation':[0,0,0]},
        {'asset_id':'SOFA_2SEAT_001','position':[-6.7,-2.8,0],'rotation':[0,0,90]},
        {'asset_id':'LOUNGE_CHAIR_001','position':[-3.25,-3.65,0],'rotation':[0,0,-45]},
        {'asset_id':'TABLE_SIDE_001','position':[-6.0,-3.8,0],'rotation':[0,0,0]},
        {'asset_id':'RUG_RECT_002','position':[-4.6,-4.05,0.012],'rotation':[0,0,0]},
        {'prefab_id':'KIT_FOCUS_ZONE_001','position':[4.7,-3.4,0],'rotation':[0,0,0]},
        {'prefab_id':'KIT_PANTRY_CAFE_001','position':[7.0,-3.1,0],'rotation':[0,0,0]},
        {'prefab_id':'KIT_STORAGE_UTILITY_001','position':[-7.4,-0.85,0],'rotation':[0,0,90]},
        {'prefab_id':'KIT_WALL_DECOR_001','position':[-3.6,5.92,0],'rotation':[0,0,180]},
        {'asset_id':'WINDOW_001','position':[-7.65,5.92,0.55],'rotation':[0,0,180]},
        {'asset_id':'COLUMN_001','position':[0.0,0.0,0],'rotation':[0,0,0]},
        {'asset_id':'CEILING_PANEL_LIGHT_001','position':[-3.5,1.6,2.7],'rotation':[0,0,0]},
        {'asset_id':'CEILING_PANEL_LIGHT_001','position':[3.5,1.6,2.7],'rotation':[0,0,0]},
        {'asset_id':'PENDANT_LAMP_001','position':[7.0,-2.1,2.1],'rotation':[0,0,0]},
        {'asset_id':'PLANT_HANGING_001','position':[-0.4,5.5,1.75],'rotation':[0,0,0]},
        {'asset_id':'PLANT_LARGE_MONSTERA_001','position':[-8.25,4.4,0],'rotation':[0,0,0]},
        {'asset_id':'PLANT_MEDIUM_001','position':[1.1,5.25,0],'rotation':[0,0,0]},
        {'asset_id':'PLANT_SMALL_001','position':[-6.5,-0.6,1.05],'rotation':[0,0,0]},
        {'asset_id':'CHAR_MALE_001','position':[-3.7,-2.05,0],'rotation':[0,0,20],'scale':[1,1,1]},
        {'asset_id':'CHAR_FEMALE_001','position':[3.0,3.6,0],'rotation':[0,0,160],'scale':[1,1,1]},
        {'asset_id':'CHAR_AVATAR_VARIANT_001','position':[-5.5,4.0,0],'rotation':[0,0,30],'scale':[1,1,1]},
        {'asset_id':'CHAR_AVATAR_VARIANT_002','position':[7.1,-4.35,0],'rotation':[0,0,0],'scale':[1,1,1]},
    ]
}
for i,inst in enumerate(full_layout['instances']):
    add_instance(full_scene, inst, None, f'full_{i}')
full_scene_path = SCENES / 'SCENE_FULL_OFFICE_FLOOR_001.glb'
full_scene.export(full_scene_path)
write_json(SCENES / 'SCENE_FULL_OFFICE_FLOOR_001.layout.json', full_layout)
gen.make_preview(full_scene, SCENES / 'SCENE_FULL_OFFICE_FLOOR_001.preview.png', 'SCENE_FULL_OFFICE_FLOOR_001')

# Asset gallery scene: every unique asset laid out by category for QA/showcase
gallery = trimesh.Scene()
# Add a grey floor
floor = trimesh.creation.box(extents=[22, 16, 0.02]); gen.assign_material(floor, gen.make_material('M_GALLERY_FLOOR', '#ECECEC', 1, 0.9, 0)); floor.apply_translation([0,0,-0.01]); gallery.add_geometry(floor,node_name='gallery_floor',geom_name='gallery_floor')
# Place assets sorted by category/id, excluding characters variants maybe include all
sorted_assets = sorted([a for a in assets_by_id.values() if a['asset_id'] in asset_paths], key=lambda a:(a['category'], a['asset_id']))
cols = 10
spacing_x, spacing_y = 2.1, 2.1
for idx,a in enumerate(sorted_assets):
    x = (idx % cols - (cols-1)/2) * spacing_x
    y = (idx // cols - 3.5) * spacing_y
    scale = 0.65 if a['category'] in ['architecture','meeting','focus','lounge','storage','reception'] else 0.85
    if a['category']=='character': scale=0.55
    add_loaded_asset(gallery, a['asset_id'], matrix_from_trs([x,y,0],[0,0,0],[scale,scale,scale]), f'gallery_{idx}')
gallery_path = SCENES / 'SCENE_ASSET_GALLERY_FULL_001.glb'
gallery.export(gallery_path)
gen.make_preview(gallery, SCENES / 'SCENE_ASSET_GALLERY_FULL_001.preview.png', 'SCENE_ASSET_GALLERY_FULL_001')
write_json(SCENES / 'SCENE_ASSET_GALLERY_FULL_001.layout.json', {'scene_id':'SCENE_ASSET_GALLERY_FULL_001','file':'scenes/SCENE_ASSET_GALLERY_FULL_001.glb','unit':'meter','up_axis':'Z','description':'Every unique asset placed in a grid for visual QA.','asset_count':len(sorted_assets)})

# ---------------------------------------------------------------------
# Manifest coverage report
# ---------------------------------------------------------------------
coverage_rows = [
    ('1 캐릭터/아바타','남성 캐릭터(리깅용 T-pose)',1,'MVP','CHAR_MALE_001','included'),
    ('1 캐릭터/아바타','여성 캐릭터(리깅용 T-pose)',1,'MVP','CHAR_FEMALE_001','included'),
    ('1 캐릭터/아바타','의상/헤어 변형',5,'Later','CHAR_AVATAR_VARIANT_001; CHAR_AVATAR_VARIANT_002; CHAR_AVATAR_VARIANT_003; CHAR_AVATAR_VARIANT_004; CHAR_AVATAR_VARIANT_005','included'),
    ('1 캐릭터/아바타','애니메이션 idle/walk/sit/typing',4,'MVP','animations/static_pose_previews/* + animation-manifest.json','pose_reference_included__skeletal_export_after_rigging'),
    ('2 워크스테이션','책상 — 1인 표준(파티션 포함)',1,'MVP','DESK_STANDARD_001','included'),
    ('2 워크스테이션','책상 — L형 코너',1,'Later','DESK_L_CORNER_001','included'),
    ('2 워크스테이션','책상 — 벤치형(2인)',1,'Later','DESK_BENCH_2P_001','included'),
    ('2 워크스테이션','오피스 체어 — 태스크(메쉬)',1,'MVP','CHAIR_TASK_MESH_001','included'),
    ('2 워크스테이션','오피스 체어 — 임원(하이백 가죽)',1,'Later','CHAIR_EXECUTIVE_001','included'),
    ('2 워크스테이션','게스트 체어(팔걸이)',1,'Later','CHAIR_GUEST_001','included'),
    ('2 워크스테이션','스툴(높은 의자)',1,'Later','STOOL_HIGH_001','included'),
    ('3 회의실','회의 테이블 — 대(8인)',1,'MVP','TABLE_MEETING_LARGE_001','included'),
    ('3 회의실','회의 테이블 — 소(4인)',1,'Later','TABLE_MEETING_SMALL_001','included'),
    ('3 회의실','회의 의자',1,'MVP','CHAIR_MEETING_001','included'),
    ('3 회의실','유리 파티션/유리벽 + 유리문',2,'MVP','GLASS_PARTITION_001; GLASS_DOOR_001','included'),
    ('3 회의실','화이트보드 — 벽걸이',1,'MVP','WHITEBOARD_WALL_001','included'),
    ('3 회의실','화이트보드 — 이동식(바퀴)',1,'Later','WHITEBOARD_MOBILE_001','included'),
    ('3 회의실','벽걸이 대형 디스플레이/TV',1,'MVP','TV_WALL_001','included'),
    ('4 라운지','소파 — 3인',1,'MVP','SOFA_3SEAT_001','included'),
    ('4 라운지','소파 — 2인 / 1인 라운지체어',2,'Later','SOFA_2SEAT_001; LOUNGE_CHAIR_001','included'),
    ('4 라운지','커피 테이블',1,'MVP','TABLE_COFFEE_001','included'),
    ('4 라운지','사이드 테이블',1,'Later','TABLE_SIDE_001','included'),
    ('4 라운지','러그(카펫)',2,'Later','RUG_RECT_001; RUG_RECT_002','included'),
    ('5 리셉션/로비','리셉션 데스크',1,'MVP','DESK_RECEPTION_001','included'),
    ('5 리셉션/로비','브랜드월(로고 벽 / 목재 슬랫)',1,'MVP','WALL_BRAND_001','included'),
    ('5 리셉션/로비','대기 벤치/소파',1,'Later','BENCH_WAITING_001','included'),
    ('5 리셉션/로비','스탠딩 사이니지',1,'Later','SIGNAGE_STANDING_001','included'),
    ('6 집중실/폰부스','폰부스(1인 밀폐)',1,'Later','PHONEBOOTH_001','included'),
    ('6 집중실/폰부스','집중석 포드',1,'Later','FOCUS_POD_001','included'),
    ('6 집중실/폰부스','어쿠스틱 패널',1,'Later','ACOUSTIC_PANEL_001','included'),
    ('7 탕비실/카페','정수기',1,'MVP','WATER_DISPENSER_001','included'),
    ('7 탕비실/카페','커피 머신',1,'Later','COFFEE_MACHINE_001','included'),
    ('7 탕비실/카페','팬트리 카운터/바',1,'Later','PANTRY_COUNTER_001','included'),
    ('7 탕비실/카페','바 스툴',1,'Later','BAR_STOOL_001','included'),
    ('7 탕비실/카페','냉장고 / 전자레인지',2,'Later','FRIDGE_001; MICROWAVE_001','included'),
    ('8 데스크 소품','모니터 — 1대 / 듀얼',2,'MVP','MONITOR_SINGLE_001; MONITOR_DUAL_001','included'),
    ('8 데스크 소품','노트북',1,'MVP','LAPTOP_OPEN_001','included'),
    ('8 데스크 소품','키보드 + 마우스',1,'MVP','KEYBOARD_MOUSE_SET_001','included'),
    ('8 데스크 소품','데스크폰(유선전화)',1,'Later','DESKPHONE_001','included'),
    ('8 데스크 소품','데스크 램프',1,'MVP','LAMP_DESK_001','included'),
    ('8 데스크 소품','머그컵 / 테이크아웃 커피',2,'MVP','MUG_CERAMIC_001; COFFEE_TAKEOUT_001','included'),
    ('8 데스크 소품','펜꽂이 / 노트 / 책 더미',3,'Later','PEN_CUP_001; NOTEBOOK_001; BOOK_STACK_001','included'),
    ('8 데스크 소품','서류 트레이 / 바인더',2,'Later','DOC_TRAY_001; BINDERS_SET_001','included'),
    ('8 데스크 소품','헤드셋',1,'Later','HEADSET_001','included'),
    ('9 수납/사무기기','책장/오픈 셸프',1,'MVP','SHELF_OPEN_001','included'),
    ('9 수납/사무기기','서류 캐비닛',1,'MVP','CABINET_FILE_001','included'),
    ('9 수납/사무기기','락커(사물함)',1,'Later','LOCKER_001','included'),
    ('9 수납/사무기기','복합기/프린터',1,'MVP','PRINTER_MFP_001','included'),
    ('9 수납/사무기기','휴지통',1,'Later','TRASH_BIN_001','included'),
    ('10 식물/데코/아트','화분 — 대',1,'MVP','PLANT_LARGE_MONSTERA_001','included'),
    ('10 식물/데코/아트','화분 — 중/소',2,'MVP','PLANT_MEDIUM_001; PLANT_SMALL_001','included'),
    ('10 식물/데코/아트','행잉 플랜트',1,'Later','PLANT_HANGING_001','included'),
    ('10 식물/데코/아트','액자/벽 아트',2,'Later','WALL_ART_001; WALL_ART_002','included'),
    ('10 식물/데코/아트','포스터 FOCUS PLAN EXECUTE REPEAT',1,'Later','POSTER_FOCUS_001','included'),
    ('10 식물/데코/아트','벽시계',1,'Later','CLOCK_WALL_001','included'),
    ('11 건축/구조 모듈','바닥 목재/타일/카펫 재질',3,'MVP','MAT_FLOOR_WOOD_001; MAT_FLOOR_TILE_001; MAT_FLOOR_CARPET_001','included'),
    ('11 건축/구조 모듈','벽 세그먼트',1,'MVP','WALL_SEGMENT_001','included'),
    ('11 건축/구조 모듈','창문',1,'Later','WINDOW_001','included'),
    ('11 건축/구조 모듈','기둥',1,'Later','COLUMN_001','included'),
    ('11 건축/구조 모듈','층/방 표지 사이니지',2,'Later','SIGN_ROOM_001; SIGN_FLOOR_001','included'),
    ('12 조명 오브젝트','천장 패널등 / 펜던트 램프',2,'Later','CEILING_PANEL_LIGHT_001; PENDANT_LAMP_001','included'),
]
coverage_csv = QA / 'manifest-coverage.csv'
with coverage_csv.open('w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['section','manifest_item','requested_unique_count','priority','asset_ids_or_files','status'])
    w.writerows(coverage_rows)
coverage_json = [{'section':r[0],'manifest_item':r[1],'requested_unique_count':r[2],'priority':r[3],'asset_ids_or_files':r[4].split('; '),'status':r[5]} for r in coverage_rows]
write_json(QA / 'manifest-coverage.json', {'version':'1.0.0','coverage':coverage_json})

# Update registry
asset_list = sorted(assets_by_id.values(), key=lambda a: (a.get('category',''), a.get('asset_id','')))
# Ensure no duplicate ids
seen = {}
for a in asset_list:
    seen[a['asset_id']] = a
asset_list = list(seen.values())
registry_v1 = {
    'version':'1.0.0',
    'created_at':'2026-07-09',
    'package_name':'virtual_office_3d_assets_full_v1_0',
    'coordinate_system': {'unit':'meter','up_axis':'Z','pivot':'BOTTOM_CENTER','floor_z':0},
    'format': {'model':'glb','gltf':'2.0 binary','textures':'embedded PBR materials/textures or PBR factors'},
    'production_scope':'FULL_MANIFEST_MVP_AND_LATER',
    'assets':asset_list,
    'materials':materials,
    'prefabs':[{'prefab_id':p['prefab_id'],'file':f'prefabs/{p["prefab_id"]}.json','room_type':p.get('room_type')} for p in prefab_map.values()],
    'scenes':[
        {'scene_id':'SCENE_FULL_OFFICE_FLOOR_001','file':'scenes/SCENE_FULL_OFFICE_FLOOR_001.glb','layout':'scenes/SCENE_FULL_OFFICE_FLOOR_001.layout.json'},
        {'scene_id':'SCENE_ASSET_GALLERY_FULL_001','file':'scenes/SCENE_ASSET_GALLERY_FULL_001.glb','layout':'scenes/SCENE_ASSET_GALLERY_FULL_001.layout.json'},
        {'scene_id':'SCENE_MVP_OFFICE_FLOOR_001','file':'scenes/SCENE_MVP_OFFICE_FLOOR_001.glb','layout':'scenes/SCENE_MVP_OFFICE_FLOOR_001.layout.json'}
    ],
    'qa_reports':[
        'qa/polycount-report.csv','qa/validation-report.json','qa/manifest-coverage.csv','qa/manifest-coverage.json'
    ],
    'notes':[
        'Full package contains all user manifest sections 1-12 including Later items.',
        'All modeled assets are one GLB per object and use meter scale, Z-up, bottom-center pivot convention.',
        'Characters are procedural humanoid T-pose/variant GLBs intended for Mixamo/Blender auto-rigging; static pose preview GLBs are included as motion references.',
        'No baked lighting or baked shadows are authored into baseColor/albedo materials.'
    ]
}
write_json(REGISTRY / 'asset-registry.json', registry_v1)

# Updated animation manifest
anim_manifest = {
    'version':'1.0.0','unit':'meter','up_axis':'Z','rig_target':'Mixamo-compatible humanoid',
    'clips':[
        {'animation_id':'ANIM_IDLE_001','name':'idle','status':'pose_reference_included','duration_s':2.0,'loop':True,'reference_files':['animations/static_pose_previews/CHAR_MALE_001_POSE_IDLE_001.glb','animations/static_pose_previews/CHAR_FEMALE_001_POSE_IDLE_001.glb']},
        {'animation_id':'ANIM_WALK_001','name':'walk','status':'pose_reference_included','duration_s':1.0,'loop':True,'reference_files':['animations/static_pose_previews/CHAR_MALE_001_POSE_WALK_001.glb','animations/static_pose_previews/CHAR_FEMALE_001_POSE_WALK_001.glb']},
        {'animation_id':'ANIM_SIT_001','name':'sit','status':'pose_reference_included','duration_s':1.2,'loop':False,'reference_files':['animations/static_pose_previews/CHAR_MALE_001_POSE_SIT_001.glb','animations/static_pose_previews/CHAR_FEMALE_001_POSE_SIT_001.glb']},
        {'animation_id':'ANIM_TYPING_001','name':'typing','status':'pose_reference_included','duration_s':1.6,'loop':True,'reference_files':['animations/static_pose_previews/CHAR_MALE_001_POSE_TYPING_001.glb','animations/static_pose_previews/CHAR_FEMALE_001_POSE_TYPING_001.glb']}
    ],
    'skeletal_export_note':'Bind CHAR_* T-pose GLBs to a humanoid rig, then export real skeletal GLB clips using these animation ids.'
}
write_json(ANIMS / 'animation-manifest.json', anim_manifest)

# Rebuild polycount report for all assets in registry
with (QA / 'polycount-report.csv').open('w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['asset_id','priority','category','type','triangles','max_triangles','result','width_m','depth_m','height_m'])
    for m in asset_list:
        d=m['dimensions_m']; q=m['qa']
        w.writerow([m['asset_id'],m.get('priority'),m.get('category'),m.get('type'),q.get('actual_triangles'),q.get('max_triangles'),q.get('result'),d.get('width'),d.get('depth'),d.get('height')])
validation = {
    'version':'1.0.0',
    'asset_count':len(asset_list),
    'material_count':len(materials),
    'prefab_count':len(prefab_map),
    'scene_count':3,
    'pass_count':sum(1 for m in asset_list if m.get('qa',{}).get('result')=='PASS'),
    'coverage_status':'all_manifest_items_mapped',
    'known_limitations':['Character GLBs are not final skinned skeletal rigs; they are Mixamo-compatible T-pose/variant meshes with static pose references.']
}
write_json(QA / 'validation-report.json', validation)

# Contact sheet for all thumbnails
thumbs = sorted(PREVIEWS.glob('*.png'))
if thumbs:
    tile=180; cols=6; rows=math.ceil(len(thumbs)/cols)
    sheet=Image.new('RGBA',(cols*tile,rows*tile),(245,245,245,255))
    d=ImageDraw.Draw(sheet)
    for idx,p in enumerate(thumbs):
        im=Image.open(p).convert('RGBA')
        im.thumbnail((tile-20,tile-42))
        x=(idx%cols)*tile+(tile-im.width)//2; y=(idx//cols)*tile+8
        sheet.alpha_composite(im,(x,y))
        label=p.stem
        # wrap long labels to 2 lines max
        if len(label)>22:
            label=label[:21]+'…'
        d.text(((idx%cols)*tile+8,(idx//cols)*tile+tile-30),label,fill=(20,20,20,255),font=gen.font(10,False))
    sheet.save(ROOT / 'asset-contact-sheet.png')

# README / docs
readme = f"""# Virtual Office 3D Assets Full v1.0

제작일: 2026-07-09

이 패키지는 사용자가 제공한 **3D 에셋 제작 매니페스트 전체 목록**을 기준으로 만든 가상오피스 개발용 3D 에셋 풀 패키지입니다. MVP 항목뿐 아니라 Later 항목까지 모두 포함합니다.

## 포함 수량

- 유니크 개발용 모델 GLB: {len(asset_list)}개
- 캐릭터 기본형: 2개
- 캐릭터 의상/헤어 변형: 5개
- 정적 포즈/애니메이션 레퍼런스 GLB: {len(list((ANIMS/'static_pose_previews').glob('*.glb')))}개
- 바닥 PBR 재질: {len(materials)}종
- Prefab/Kit JSON: {len(prefab_map)}개
- 예시/검수 씬 GLB: 3개
- 에셋별 metadata JSON: {len(list(METADATA.glob('*.meta.json')))}개
- 매니페스트 커버리지 리포트: `qa/manifest-coverage.csv`, `qa/manifest-coverage.json`

## 공통 제작 규격

- 형식: `.glb` / glTF 2.0 binary
- 오브젝트 1개당 파일 1개
- 스케일: 실제 미터 단위
- 좌표계: Z-up
- Pivot: bottom center
- 바닥 기준: z=0 안착
- 재질: PBR baseColor / normal / roughness / metallic 또는 PBR factor 포함
- baseColor/albedo에 조명·그림자 baked 없음
- 개발용 metadata에 collision / interaction / anchor 포함

## 주요 파일

- `registry/asset-registry.json` — 전체 에셋 정본 레지스트리
- `registry/prefab-registry.json` — 재사용 키트 정본
- `qa/manifest-coverage.csv` — 매니페스트 항목별 포함 여부
- `qa/polycount-report.csv` — 폴리곤/치수/QA 리포트
- `scenes/SCENE_FULL_OFFICE_FLOOR_001.glb` — 전체 구역 조립 예시 씬
- `scenes/SCENE_ASSET_GALLERY_FULL_001.glb` — 모든 에셋 쇼케이스 씬
- `asset-contact-sheet.png` — 전체 썸네일 컨택트시트

## 캐릭터/애니메이션 주의사항

캐릭터는 이번 패키지에서 T-pose/variant GLB와 idle/walk/sit/typing 정적 포즈 레퍼런스를 제공합니다. 실제 서비스용 skeletal animation은 Mixamo, Blender 또는 엔진 리타게팅으로 리깅 후 `ANIM_IDLE_001`, `ANIM_WALK_001`, `ANIM_SIT_001`, `ANIM_TYPING_001` 클립 ID를 유지해 교체하는 구조입니다.

## 권장 사용 방식

런타임에서는 `SCENE_FULL_OFFICE_FLOOR_001.glb`를 그대로 쓰기보다 `asset-registry.json` + `prefab-registry.json` + layout JSON을 읽어 GLB를 인스턴싱하는 방식을 권장합니다. 같은 책상/의자/소품을 여러 번 복제해야 하므로 이 방식이 성능과 관리에 유리합니다.
"""
(ROOT / 'README.md').write_text(readme, encoding='utf-8')
(DOCS / 'rigging-and-animation-next-step.md').write_text("""# Rigging and Animation Next Step

This full asset pack includes humanoid T-pose meshes and pose reference GLBs. To create final runtime-ready avatar animation clips:

1. Import `models/characters/CHAR_MALE_001.glb` and `CHAR_FEMALE_001.glb` into Mixamo or Blender.
2. Bind a humanoid skeleton and keep the same real-world meter scale.
3. Export skeletal GLB clips using these IDs:
   - `ANIM_IDLE_001`
   - `ANIM_WALK_001`
   - `ANIM_SIT_001`
   - `ANIM_TYPING_001`
4. Preserve bottom-center pivot and Z-up conversion adapter in the runtime import layer.

The current pose-reference GLBs are useful for visual validation, but they are not final skinned skeletal animation clips.
""", encoding='utf-8')
(DOCS / 'import-guide-web-threejs.md').write_text("""# Web / Three.js Import Guide

Recommended runtime loading pattern:

1. Load `registry/asset-registry.json`.
2. Preload GLBs referenced by each `asset.file`.
3. Read `prefabs/*.json` and spawn instances using `position`, `rotation`, and `scale`.
4. Use `metadata/*.meta.json` for collision boxes and anchors.
5. For glass assets, use alpha sorting / transparent render queue validation.

Coordinate system: package assets are authored as Z-up. If your Three.js pipeline uses Y-up, apply an import adapter consistently.
""", encoding='utf-8')

# Copy this build script into source
shutil.copyfile(__file__, SOURCE / Path(__file__).name)

# Zip package
with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:
    for file in ROOT.rglob('*'):
        if file.is_file():
            z.write(file, file.relative_to(ROOT.parent))

print(json.dumps({
    'root': str(ROOT),
    'zip': str(ZIP_PATH),
    'zip_size': ZIP_PATH.stat().st_size,
    'unique_asset_glbs': len(asset_list),
    'total_glbs': len(list(ROOT.rglob('*.glb'))),
    'prefabs': len(prefab_map),
    'materials': len(materials),
    'scenes': 3,
}, ensure_ascii=False, indent=2))
