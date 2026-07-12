import json, math, shutil, zipfile, os
from pathlib import Path
import numpy as np
import trimesh
from trimesh.transformations import translation_matrix, rotation_matrix, concatenate_matrices
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

ROOT=Path('/mnt/data/virtual_office_production_assets_v4_0')
ZIP=Path('/mnt/data/virtual_office_production_assets_v4_0.zip')
PREV=ROOT/'previews/v4'
(PREV/'contact_sheets').mkdir(parents=True,exist_ok=True)
(PREV/'thumbnails').mkdir(parents=True,exist_ok=True)
(PREV/'characters').mkdir(parents=True,exist_ok=True)
for d in ['docs','registry','qa','ui/v4_png','ui/v4_svg','source']:
    (ROOT/d).mkdir(parents=True,exist_ok=True)

def font(size=20,bold=False):
    paths=['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
           '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']
    for p in paths:
        if os.path.exists(p): return ImageFont.truetype(p,size)
    return ImageFont.load_default()
FONT_TINY=font(13); FONT_SMALL=font(17); FONT_MED=font(20); FONT_BOLD=font(25,True); FONT_BIG=font(34,True)

def add_scene(dst, path, loc=(0,0,0), rz=0, scale=1.0, prefix=''):
    sc=trimesh.load(path,force='scene')
    G=concatenate_matrices(translation_matrix(loc), rotation_matrix(math.radians(rz),[0,0,1]), np.diag([scale,scale,scale,1]))
    for node in sc.graph.nodes_geometry:
        try:
            T, geom_name = sc.graph.get(node)
            geom=sc.geometry[geom_name]
            if not isinstance(geom,trimesh.Trimesh): continue
            m=geom.copy(); m.apply_transform(concatenate_matrices(G,T))
            dst.add_geometry(m,geom_name=f'{prefix}{geom_name}',node_name=f'{prefix}{node}')
        except Exception:
            pass
    return dst

# Rebuild vertical slice and gallery if missing/incomplete
main_scene=ROOT/'scenes/SCENE_ACME_HQ_HERO_V4_001.glb'
vertical=ROOT/'scenes/SCENE_VERTICAL_SLICE_HERO_V4_001.glb'
gallery=ROOT/'scenes/SCENE_ASSET_GALLERY_HERO_V4_001.glb'
reception=ROOT/'models/v4_hero/HERO_RECEPTION_LOBBY_V4_001.glb'
meeting=ROOT/'models/v4_hero/HERO_GLASS_MEETING_ROOM_V4_001.glb'
work=ROOT/'models/v4_hero/HERO_WORKSTATION_CLUSTER_V4_001.glb'
lounge=ROOT/'models/v4_hero/HERO_LOUNGE_BLUE_AREA_V4_001.glb'
pantry=ROOT/'models/v4_hero/HERO_PANTRY_CAFE_V4_001.glb'
char_m=ROOT/'models/v4_characters/CHAR_MALE_HERO_V4_001.glb'
char_f=ROOT/'models/v4_characters/CHAR_FEMALE_HERO_V4_001.glb'
char_r=ROOT/'models/v4_characters/CHAR_RECEPTIONIST_HERO_V4_001.glb'

if not vertical.exists():
    s=trimesh.Scene()
    if reception.exists(): add_scene(s,reception,(-2.4,1.4,0),0,.78,'rec_')
    if work.exists(): add_scene(s,work,(-.2,-1.0,0),0,.85,'work_')
    if meeting.exists(): add_scene(s,meeting,(2.5,.75,0),0,.72,'meet_')
    s.export(vertical)
if not gallery.exists():
    s=trimesh.Scene(); files=[reception,meeting,work,lounge,pantry,char_m,char_f,char_r]
    for idx,p in enumerate([p for p in files if p.exists()]):
        x=-5.0+(idx%4)*3.2; y=1.9-(idx//4)*3.0
        add_scene(s,p,(x,y,0),0,.62,f'g{idx}_')
    s.export(gallery)

# Render with matplotlib, using face sampling for speed

def color_from_mat(mat, geom_name=''):
    col=np.array([0.62,0.62,0.62,1.0])
    try:
        bc=np.array(mat.baseColorFactor,dtype=float)
        if bc.max()>1: bc=bc/255.0
        if len(bc)==3: col=np.r_[bc,1]
        if len(bc)==4: col=bc
    except Exception:
        pass
    name=(str(getattr(mat,'name',''))+' '+str(geom_name)).upper()
    if 'GLASS' in name: col=np.array([0.22,0.50,0.82,0.25])
    if 'NEON' in name or 'EMISSIVE' in name or 'SCREEN' in name or 'LIGHT' in name:
        # keep material hue but make brighter
        col[:3]=np.maximum(col[:3],np.array([0.05,0.22,0.80])); col[3]=max(col[3],0.78)
    return col

def render_glb(path, out, size=(1400,900), elev=42, azim=-48, max_faces_per_geom=180, dark=True, title=None):
    sc=trimesh.load(path,force='scene')
    fig=plt.figure(figsize=(size[0]/100,size[1]/100),dpi=100)
    ax=fig.add_subplot(111,projection='3d'); ax.set_proj_type('ortho'); ax.view_init(elev=elev,azim=azim); ax.set_axis_off()
    bg=(0.025,0.035,0.050) if dark else (0.92,0.92,0.92)
    fig.patch.set_facecolor(bg); ax.set_facecolor(bg)
    polys=[]; colors=[]; light=np.array([-0.45,-0.58,.85]); light=light/np.linalg.norm(light)
    for node in sc.graph.nodes_geometry:
        try:
            T, geom_name = sc.graph.get(node)
            geom=sc.geometry[geom_name]
            if not isinstance(geom,trimesh.Trimesh) or len(geom.faces)==0: continue
            mesh=geom.copy(); mesh.apply_transform(T)
            col=color_from_mat(getattr(mesh.visual,'material',None),geom_name)
            faces=mesh.faces
            if len(faces)>max_faces_per_geom:
                faces=faces[np.linspace(0,len(faces)-1,max_faces_per_geom).astype(int)]
            tri=mesh.vertices[faces]
            normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]); lens=np.linalg.norm(normals,axis=1); lens[lens==0]=1; normals=normals/lens[:,None]
            shade=np.clip(np.dot(normals,light)*0.42+0.76,0.42,1.18)
            for t,sh in zip(tri,shade):
                c=col.copy(); c[:3]=np.clip(c[:3]*sh,0,1); polys.append(t); colors.append(c)
        except Exception:
            continue
    if polys:
        pc=Poly3DCollection(polys, facecolors=colors, edgecolors=(0.02,0.02,0.025,0.13), linewidths=0.04)
        ax.add_collection3d(pc)
    try:
        b=sc.bounds
        ax.set_xlim(b[0,0]-.45,b[1,0]+.45); ax.set_ylim(b[0,1]-.45,b[1,1]+.45); ax.set_zlim(0,b[1,2]+.65)
        ax.set_box_aspect((b[1,0]-b[0,0], b[1,1]-b[0,1], (b[1,2]-b[0,2])*1.32))
    except Exception:
        pass
    plt.subplots_adjust(0,0,1,1)
    out.parent.mkdir(parents=True,exist_ok=True)
    plt.savefig(out,facecolor=fig.get_facecolor(),bbox_inches='tight',pad_inches=0)
    plt.close(fig)
    # resize exact and optional label
    im=Image.open(out).convert('RGBA').resize(size,Image.LANCZOS)
    if title:
        d=ImageDraw.Draw(im,'RGBA'); d.rounded_rectangle((18,16,size[0]-18,62),radius=14,fill=(8,14,24,185)); d.text((36,27),title,font=FONT_MED,fill=(245,248,255,255))
    im.save(out)
    return out

mesh_render=PREV/'scene-acme-hq-hero-v4-render.png'
render_glb(main_scene, mesh_render, (1920,1080), max_faces_per_geom=110, title='SCENE_ACME_HQ_HERO_V4_001')
render_glb(vertical, PREV/'vertical-slice-v4-render.png', (1500,950), max_faces_per_geom=160, title='SCENE_VERTICAL_SLICE_HERO_V4_001')

# UI composite similar to user design
W,H=1920,1080
scene_img=Image.open(mesh_render).convert('RGBA').resize((W,H),Image.LANCZOS)
base=Image.new('RGBA',(W,H),(5,10,18,255)); base.alpha_composite(scene_img,(0,0))
d=ImageDraw.Draw(base,'RGBA')
left_w=235; right_w=330; top_h=76
d.rectangle((0,0,left_w,H),fill=(7,16,29,247)); d.rectangle((W-right_w,0,W,H),fill=(9,18,31,248)); d.rectangle((left_w,0,W-right_w,top_h),fill=(5,10,18,232))
d.rounded_rectangle((24,24,52,52),radius=8,fill=(34,52,76,255),outline=(112,140,180,150),width=2); d.text((72,25),'Virtual Office',font=FONT_BOLD,fill=(255,255,255,255)); d.text((315,28),'Acme Corp HQ⌄',font=FONT_MED,fill=(245,245,248,255))
for idx,item in enumerate(['Office','Rooms','People','Chat','Events','Whiteboard','Files','Settings']):
    y=120+idx*62
    if item=='Office': d.rounded_rectangle((18,y-12,left_w-18,y+42),radius=14,fill=(54,97,225,245))
    d.rectangle((36,y+5,56,y+25),outline=(196,212,235,210),width=2); d.text((78,y),item,font=FONT_SMALL,fill=(245,250,255,255))
panel_y=H-300
d.rounded_rectangle((18,panel_y,left_w-18,H-110),radius=18,fill=(18,29,45,232),outline=(70,90,120,120),width=2); d.text((36,panel_y+20),'Floor 1⌃',font=FONT_SMALL,fill=(255,255,255,255)); d.rectangle((48,panel_y+65,left_w-54,panel_y+145),outline=(88,105,130,180),width=3)
for p in [(88,panel_y+95),(130,panel_y+118),(155,panel_y+88),(180,panel_y+138),(112,panel_y+145),(147,panel_y+130),(95,panel_y+125)]: d.ellipse((p[0]-5,p[1]-5,p[0]+5,p[1]+5),fill=(50,120,255,255))
d.text((34,H-72),'●  29 People Online',font=FONT_SMALL,fill=(182,238,205,255))
d.rounded_rectangle((W-right_w-400,18,W-right_w-100,58),radius=10,fill=(7,13,22,225),outline=(70,86,110,130),width=1); d.text((W-right_w-365,28),'Search...        ⌘ K',font=FONT_SMALL,fill=(155,166,184,255))
d.ellipse((W-right_w-66,18,W-right_w-22,62),fill=(218,172,136,255)); d.text((W-right_w-10,27),'Ava Taylor  ● Online',font=FONT_SMALL,fill=(245,250,255,255))
d.text((W-right_w+28,108),'People (29)',font=FONT_BOLD,fill=(255,255,255,255))
sections=[('In Office (18)',['Ava Taylor','Liam Chen','Sophia Patel','Noah Johnson','Olivia Kim']),('In a Meeting (5)',['Product Sync','Design Review']),('Online (6)',['Ethan Wright','Mia Davis'])]
y=160; colors=[(210,166,132),(130,170,145),(180,135,160),(115,160,210),(170,180,120)]
for sec,names in sections:
    d.text((W-right_w+28,y),sec+'⌄',font=FONT_SMALL,fill=(170,185,205,255)); y+=42
    for idx,n in enumerate(names):
        c=colors[idx%len(colors)]; d.ellipse((W-right_w+30,y,W-right_w+66,y+36),fill=c+(255,)); d.ellipse((W-right_w+60,y+26,W-right_w+72,y+38),fill=(65,210,110,255)); d.text((W-right_w+82,y),n,font=FONT_SMALL,fill=(230,238,250,255)); d.text((W-right_w+82,y+22),'Online' if 'Sync' not in n and 'Review' not in n else '5 people',font=FONT_TINY,fill=(140,155,175,255)); y+=56
    y+=16
for name,x,y0 in [('Olivia',660,330),('Liam',970,355),('Sophia',1010,500),('Noah',710,560),('Ethan',725,770)]:
    d.rounded_rectangle((x,y0,x+100,y0+34),radius=12,fill=(20,28,38,230)); d.ellipse((x+12,y0+11,x+24,y0+23),fill=(68,218,102,255)); d.text((x+32,y0+17),name,anchor='lm',font=FONT_TINY,fill=(245,248,255,255))
for x,y0,t,s in [(1160,200,'Design Room','4 in room'),(1285,430,'Product Sync','5 in room')]:
    d.rounded_rectangle((x,y0,x+155,y0+66),radius=14,fill=(23,29,42,230)); d.text((x+16,y0+22),t,font=FONT_SMALL,fill=(245,248,255,255)); d.text((x+16,y0+46),s,font=FONT_TINY,fill=(174,185,202,255))
panel=(W-right_w-560,H-400,W-right_w-40,H-58)
d.rounded_rectangle(panel,radius=20,fill=(13,21,34,240),outline=(85,115,160,180),width=2); d.text((panel[0]+24,panel[1]+20),'Product Sync  ',font=FONT_SMALL,fill=(255,255,255,255)); d.rounded_rectangle((panel[0]+126,panel[1]+18,panel[0]+176,panel[1]+39),radius=7,fill=(230,60,64,255)); d.text((panel[0]+134,panel[1]+21),'LIVE',font=FONT_TINY,fill=(255,255,255,255)); d.text((panel[0]+190,panel[1]+21),'24:18',font=FONT_SMALL,fill=(220,230,244,255))
tile_w=150; tile_h=84; sx=panel[0]+30; sy=panel[1]+62; names=['Ava Taylor','Noah Johnson','Sophia Patel','Liam Chen','Olivia Kim']
for i,name in enumerate(names):
    x=sx+(i%3)*(tile_w+18); yy=sy+(i//3)*(tile_h+17); d.rounded_rectangle((x,yy,x+tile_w,yy+tile_h),radius=12,fill=(36,48,63,255),outline=(80,100,130,110),width=1); d.ellipse((x+48,yy+11,x+102,yy+65),fill=colors[i%len(colors)]+(255,)); d.rectangle((x,yy+58,x+tile_w,yy+tile_h),fill=(0,0,0,80)); d.text((x+10,yy+61),name,font=FONT_TINY,fill=(255,255,255,255))
for i,label in enumerate(['●','▣','☻','✋','…']):
    cx=panel[0]+55+i*62; cy=panel[3]-42; d.ellipse((cx-20,cy-20,cx+20,cy+20),fill=(28,39,56,255)); d.text((cx-5,cy-10),label,font=FONT_SMALL,fill=(235,242,255,255))
d.rounded_rectangle((panel[2]-76,panel[3]-62,panel[2]-24,panel[3]-24),radius=12,fill=(214,69,75,255)); d.text((panel[2]-58,panel[3]-56),'☎',font=FONT_SMALL,fill=(255,255,255,255))
d.rounded_rectangle((W//2-235,H-84,W//2+235,H-38),radius=16,fill=(50,46,44,210),outline=(130,120,110,100),width=1); d.text((W//2-170,H-71),'Walk up to a room and press   E   to enter',font=FONT_SMALL,fill=(245,240,235,255))
# subtle vignette
v=Image.new('RGBA',(W,H),(0,0,0,0)); vd=ImageDraw.Draw(v,'RGBA'); vd.rectangle((0,0,W,H),outline=(0,0,0,90),width=60); v=v.filter(ImageFilter.GaussianBlur(55)); base.alpha_composite(v)
hero_preview=PREV/'hero-office-preview-v4.png'
base.convert('RGB').save(hero_preview,quality=95)
shutil.copy(hero_preview,'/mnt/data/hero-office-preview-v4.png')

# Render thumbnails for v4 models
metas=[]
for p in (ROOT/'metadata/v4_assets').glob('*.json'):
    try: metas.append(json.loads(p.read_text(encoding='utf-8')))
    except Exception: pass
# sort for consistent output
metas=sorted(metas,key=lambda x:x.get('asset_id',''))
for meta in metas:
    path=ROOT/meta['file']
    if path.exists():
        thumb=PREV/'thumbnails'/f"{meta['asset_id']}.png"
        try:
            render_glb(path, thumb, (760,540) if meta.get('category')!='characters' else (620,760), max_faces_per_geom=180, title=meta['asset_id'])
        except Exception:
            img=Image.new('RGB',(760,540),(20,26,36)); ImageDraw.Draw(img).text((30,250),meta['asset_id'],font=FONT_SMALL,fill='white'); img.save(thumb)
        meta['thumbnail']=str(thumb.relative_to(ROOT))
        # update JSON
        (ROOT/'metadata/v4_assets'/f"{meta['asset_id']}.meta.json").write_text(json.dumps(meta,indent=2,ensure_ascii=False),encoding='utf-8')
# Contact sheet
items=[(m['asset_id'], ROOT/m['thumbnail']) for m in metas]
items.append(('SCENE_ACME_HQ_HERO_V4_001', hero_preview))
cell_w,cell_h=520,360; cols=3; rows=math.ceil(len(items)/cols)
sheet=Image.new('RGB',(cols*cell_w,rows*cell_h),(20,26,36)); dd=ImageDraw.Draw(sheet)
for idx,(name,path) in enumerate(items):
    im=Image.open(path).convert('RGBA'); im.thumbnail((cell_w-40,cell_h-76),Image.LANCZOS)
    x=(idx%cols)*cell_w; y=(idx//cols)*cell_h
    dd.rounded_rectangle((x+14,y+14,x+cell_w-14,y+cell_h-14),radius=18,fill=(32,40,54),outline=(80,105,142),width=2)
    sheet.paste(im,(x+(cell_w-im.width)//2,y+26),im)
    dd.text((x+24,y+cell_h-42),name,font=FONT_SMALL,fill=(235,242,255))
asset_sheet=PREV/'contact_sheets/asset-contact-sheet-v4.png'
sheet.save(asset_sheet)
shutil.copy(asset_sheet,'/mnt/data/asset-contact-sheet-v4.png')
# Character contact sheet
char_items=[(m['asset_id'], ROOT/m['thumbnail']) for m in metas if m.get('category')=='characters']
cell_w,cell_h=420,480
sheet2=Image.new('RGB',(max(1,len(char_items))*cell_w,cell_h),(22,28,38)); d2=ImageDraw.Draw(sheet2)
for idx,(name,path) in enumerate(char_items):
    im=Image.open(path).convert('RGBA'); im.thumbnail((cell_w-50,cell_h-90),Image.LANCZOS); x=idx*cell_w
    d2.rounded_rectangle((x+14,14,x+cell_w-14,cell_h-14),radius=18,fill=(32,40,54),outline=(80,105,142),width=2)
    sheet2.paste(im,(x+(cell_w-im.width)//2,30),im); d2.text((x+24,cell_h-48),name,font=FONT_SMALL,fill=(245,248,255))
char_sheet=PREV/'contact_sheets/character-contact-sheet-v4.png'
sheet2.save(char_sheet)
shutil.copy(char_sheet,'/mnt/data/character-contact-sheet-v4.png')

# Build/update registry and reports
reg_path=ROOT/'registry/asset-registry.json'
try: reg=json.loads(reg_path.read_text(encoding='utf-8'))
except Exception: reg={'assets':[]}
if isinstance(reg,list): reg={'assets':reg}
reg['version']='4.0'; reg['name']='Virtual Office Production Asset Pack v4.0 Hero Refinement'; reg['quality_goal']='Full v3 manifest plus v4 hero-refined modules aligned to the supplied virtual-office design.'
base_assets=reg.get('assets',[])
# Remove existing v4 duplicate entries
ids={m['asset_id'] for m in metas}
base_assets=[a for a in base_assets if a.get('asset_id') not in ids]
reg['assets']=base_assets+metas
reg['asset_count']=len(reg['assets'])
reg_path.write_text(json.dumps(reg,indent=2,ensure_ascii=False),encoding='utf-8')

pref_path=ROOT/'registry/prefab-registry.json'
try: pref=json.loads(pref_path.read_text(encoding='utf-8'))
except Exception: pref={'prefabs':[]}
if 'prefabs' not in pref: pref={'version':'4.0','prefabs':[]}
pref['version']='4.0'
# Remove v4 duplicates
pref['prefabs']=[p for p in pref.get('prefabs',[]) if 'V4' not in p.get('prefab_id','')]
for meta in metas:
    pref['prefabs'].append({'prefab_id':meta['asset_id'].replace('HERO_','KIT_HERO_'),'version':'4.0','category':meta['category'],'file':meta['file'],'preview':meta.get('thumbnail'),'instances':[{'asset_id':meta['asset_id'],'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}],'anchors':meta.get('anchors',{}),'notes':meta.get('notes','')})
pref['prefabs'].append({'prefab_id':'KIT_ACME_HQ_HERO_SCENE_V4_001','version':'4.0','category':'hero_scene','room_type':'full_virtual_office','file':'scenes/SCENE_ACME_HQ_HERO_V4_001.glb','preview':'previews/v4/hero-office-preview-v4.png','notes':'v4 hero office scene assembled from refined modules.'})
pref_path.write_text(json.dumps(pref,indent=2,ensure_ascii=False),encoding='utf-8')

report=f'''# Virtual Office Production Asset Pack v4.0 — Hero Refinement Report

## 제작 기준
- 첨부 가상오피스 시안의 고급 오피스 분위기를 기준으로, v3 전체 에셋은 유지하고 핵심 시각 품질 구역을 v4 히어로 모듈로 교체/추가했습니다.
- GLB 단위, meter scale, Z-up, bottom-center pivot, PBR material metadata 규칙을 유지했습니다.

## v4 신규/고도화 에셋
- HERO_RECEPTION_LOBBY_V4_001: 개별 목재 슬랫, 곡면 대리석 데스크, 발광 로고, 하부 간접조명, 데스크 소품, 리셉션 캐릭터.
- HERO_GLASS_MEETING_ROOM_V4_001: 투명 유리 패널, 금속 프레임, 파란 emissive outline, 회의 테이블/의자/TV UI/회의 인물.
- HERO_WORKSTATION_CLUSTER_V4_001: 4인 벤치 데스크, 플랜터 파티션, 듀얼 모니터, 키보드/마우스, 케이블, 컵/문서, 앉은 캐릭터.
- HERO_LOUNGE_BLUE_AREA_V4_001: 블루 섹셔널 소파, 쿠션, 러그, 커피 테이블, 라운지 체어, 식물.
- HERO_PANTRY_CAFE_V4_001: 대리석 바, 바스툴, 펜던트 조명, 커피머신, 정수기, 소품.
- CHAR_MALE_HERO_V4_001 / CHAR_FEMALE_HERO_V4_001 / CHAR_RECEPTIONIST_HERO_V4_001.

## 신규 씬
- scenes/SCENE_ACME_HQ_HERO_V4_001.glb
- scenes/SCENE_VERTICAL_SLICE_HERO_V4_001.glb
- scenes/SCENE_ASSET_GALLERY_HERO_V4_001.glb

## 한계와 후속 권장
이 v4는 현재 환경에서 제작 가능한 절차적 GLB 고도화 버전입니다. 첨부 시안 수준의 완전한 런칭급/근접촬영급 포토리얼 퀄리티로 마감하려면 Blender/Maya/Substance Painter 기반 수작업 모델링, 고해상도 베이킹, 캐릭터 스켈레탈 리깅, 엔진 조명/HDRI/SSAO/Bloom 세팅을 후속으로 진행하는 것이 좋습니다.
'''
(ROOT/'docs/v4-hero-refinement-report.md').write_text(report,encoding='utf-8')
readme=ROOT/'README.md'
base_readme=readme.read_text(encoding='utf-8') if readme.exists() else '# Virtual Office Assets\n'
if 'v4.0 Hero Refinement' not in base_readme:
    base_readme += "\n\n## v4.0 Hero Refinement\n\nSee `docs/v4-hero-refinement-report.md`. Main preview: `previews/v4/hero-office-preview-v4.png`. Main scene: `scenes/SCENE_ACME_HQ_HERO_V4_001.glb`.\n"
readme.write_text(base_readme,encoding='utf-8')
# QA
with (ROOT/'qa/polycount-report-v4.csv').open('w',encoding='utf-8') as f:
    f.write('asset_id,triangle_count,file\n')
    for m in metas: f.write(f"{m['asset_id']},{m.get('triangle_count','')},{m['file']}\n")
val={'version':'4.0','checks':{'v4_hero_modules':len([m for m in metas if m['category']=='hero']),'v4_characters':len([m for m in metas if m['category']=='characters']),'main_scene_glb_exists':main_scene.exists(),'vertical_slice_glb_exists':vertical.exists(),'gallery_glb_exists':gallery.exists(),'preview_png_exists':hero_preview.exists()},'total_model_glbs':len(list((ROOT/'models').rglob('*.glb'))),'notes':['v4 package includes full v3 manifest assets plus v4 hero-quality replacement modules and scenes.']}
(ROOT/'qa/validation-report-v4.json').write_text(json.dumps(val,indent=2,ensure_ascii=False),encoding='utf-8')
# top-level copies in package and /mnt/data
shutil.copy(hero_preview,ROOT/'hero-office-preview-v4.png')
shutil.copy(asset_sheet,ROOT/'asset-contact-sheet-v4.png')
shutil.copy(char_sheet,ROOT/'character-contact-sheet-v4.png')
shutil.copy('/mnt/data/create_virtual_office_v4.py',ROOT/'source/create_virtual_office_v4.py')
shutil.copy('/mnt/data/finalize_virtual_office_v4.py',ROOT/'source/finalize_virtual_office_v4.py')
# PNG preview zip
pngzip=Path('/mnt/data/virtual_office_v4_preview_pngs.zip')
if pngzip.exists(): pngzip.unlink()
with zipfile.ZipFile(pngzip,'w',zipfile.ZIP_DEFLATED) as z:
    for p in [hero_preview, asset_sheet, char_sheet, PREV/'vertical-slice-v4-render.png', mesh_render]:
        if p.exists(): z.write(p,p.name)
# final zip
if ZIP.exists(): ZIP.unlink()
with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as z:
    for p in ROOT.rglob('*'):
        if p.is_file(): z.write(p,p.relative_to(ROOT.parent))
# top level direct copies already made; make sure names exist
for src,dst in [(hero_preview,'/mnt/data/hero-office-preview-v4.png'),(asset_sheet,'/mnt/data/asset-contact-sheet-v4.png'),(char_sheet,'/mnt/data/character-contact-sheet-v4.png')]:
    shutil.copy(src,dst)
print(json.dumps({'zip':str(ZIP),'pngzip':str(pngzip),'root':str(ROOT),'total_model_glbs':val['total_model_glbs'],'v4_metas':len(metas),'hero_preview':str(hero_preview)},indent=2))
