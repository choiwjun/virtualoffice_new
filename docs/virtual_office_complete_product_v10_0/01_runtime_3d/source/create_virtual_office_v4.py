import os, math, json, shutil, zipfile, random
from pathlib import Path
import numpy as np
import trimesh
from trimesh.visual.texture import TextureVisuals
from trimesh.visual.material import PBRMaterial
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = Path('/mnt/data/virtual_office_production_assets_v3_0')
ROOT = Path('/mnt/data/virtual_office_production_assets_v4_0')
ZIP_PATH = Path('/mnt/data/virtual_office_production_assets_v4_0.zip')
random.seed(404)
np.random.seed(404)

if ROOT.exists():
    shutil.rmtree(ROOT)
shutil.copytree(SRC, ROOT)
for d in [
    'models/v4_hero','models/v4_characters','metadata/v4_assets','previews/v4','previews/v4/thumbnails','previews/v4/contact_sheets','scenes','materials/v4_pbr','docs','registry','qa','ui/v4_png'
]:
    (ROOT/d).mkdir(parents=True, exist_ok=True)

try:
    FONT_BOLD = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 34)
    FONT_MED = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
    FONT_SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
    FONT_TINY = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
except Exception:
    FONT_BOLD = FONT_MED = FONT_SMALL = FONT_TINY = None

def clamp(x, a=0, b=255): return int(max(a, min(b, x)))
def rgba01(rgba): return [rgba[0]/255, rgba[1]/255, rgba[2]/255, rgba[3]/255]

def noise_img(base, size=512, strength=14, alpha=255):
    base = np.array(base[:3], dtype=np.int16)
    n = np.random.normal(0, strength, (size,size,1)).astype(np.int16)
    arr=np.clip(base+n,0,255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, np.full((size,size), alpha, np.uint8)]), 'RGBA')

def normal_img(size=512, strength=4):
    arr=np.zeros((size,size,3),dtype=np.uint8); arr[:,:,0]=128; arr[:,:,1]=128; arr[:,:,2]=255
    if strength:
        arr[:,:,0]=np.clip(arr[:,:,0].astype(int)+np.random.randint(-strength,strength+1,(size,size)),0,255)
        arr[:,:,1]=np.clip(arr[:,:,1].astype(int)+np.random.randint(-strength,strength+1,(size,size)),0,255)
    return Image.fromarray(arr,'RGB')

def mr_img(rough=.6, metal=0, size=512):
    arr=np.zeros((size,size,3),dtype=np.uint8); arr[:,:,0]=255; arr[:,:,1]=int(rough*255); arr[:,:,2]=int(metal*255)
    return Image.fromarray(arr,'RGB')

def wood_texture(size=512, base=(142,86,48), dark=(58,32,18)):
    img=Image.new('RGBA',(size,size),base+(255,)); d=ImageDraw.Draw(img,'RGBA')
    for y in range(size):
        wave=math.sin(y/11)*12+math.sin(y/37)*22+np.random.randint(-3,4)
        col=tuple(clamp(base[i]+wave) for i in range(3))+(255,)
        d.line((0,y,size,y),fill=col)
    for k in range(30):
        y=random.randint(0,size-1)
        pts=[]
        for x in range(-60,size+60,10):
            pts.append((x, y+int(math.sin(x/30+k)*12)+int(math.sin(x/13+k*.7)*4)))
        d.line(pts,fill=dark+(random.randint(80,170),),width=random.choice([1,1,2]))
    return img.filter(ImageFilter.GaussianBlur(.2))

def marble_texture(size=512, base=(222,219,211), vein=(112,113,122)):
    img=Image.new('RGBA',(size,size),base+(255,)); d=ImageDraw.Draw(img,'RGBA')
    for k in range(50):
        x0=random.randint(-size//2,size); y0=random.randint(-size//3,size)
        pts=[]
        for t in range(-50,size+60,9):
            x=x0+t+int(math.sin(t/22+k)*26)
            y=y0+int(t*.42)+int(math.sin(t/13+k*.5)*14)
            pts.append((x,y))
        alpha=random.randint(40,135)
        col=tuple(clamp(vein[i]+random.randint(-30,30)) for i in range(3))+(alpha,)
        d.line(pts,fill=col,width=random.choice([1,1,2,3]))
    return img.filter(ImageFilter.GaussianBlur(.35))

def fabric_texture(size=512, base=(28,55,86)):
    img=noise_img(base,size,10,255); d=ImageDraw.Draw(img,'RGBA')
    for i in range(0,size,7):
        d.line((i,0,i,size),fill=(255,255,255,14),width=1)
        d.line((0,i,size,i),fill=(0,0,0,18),width=1)
    for i in range(0,size,56):
        d.line((i,0,i,size),fill=(255,255,255,22),width=2)
    return img

def sign_texture(text='ACME\nCORPORATION', size=(1024,512)):
    img=wood_texture(1024,(100,64,37),(50,28,14)).resize(size)
    d=ImageDraw.Draw(img,'RGBA')
    d.rounded_rectangle((20,20,size[0]-20,size[1]-20),radius=28,fill=(0,0,0,30),outline=(255,220,150,60),width=3)
    lines=text.split('\n'); y=150
    for idx,line in enumerate(lines):
        f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 92 if idx==0 else 38)
        bbox=d.textbbox((0,0),line,font=f); tw=bbox[2]-bbox[0]
        # glow
        for r,a in [(7,55),(3,90)]:
            layer=Image.new('RGBA',size,(0,0,0,0)); dd=ImageDraw.Draw(layer)
            dd.text(((size[0]-tw)//2,y),line,font=f,fill=(220,235,255,a))
            layer=layer.filter(ImageFilter.GaussianBlur(r)); img.alpha_composite(layer)
        d=ImageDraw.Draw(img,'RGBA')
        d.text(((size[0]-tw)//2,y),line,font=f,fill=(235,242,255,255))
        y+=98 if idx==0 else 52
    return img

def screen_texture(title='Product Sync', size=(768,432), accent=(58,125,255)):
    img=Image.new('RGBA',size,(8,15,27,255)); d=ImageDraw.Draw(img,'RGBA')
    W,H=size
    d.rounded_rectangle((8,8,W-8,H-8),radius=18,fill=(11,20,35,255),outline=(65,92,130,255),width=4)
    d.text((38,28),title,font=FONT_BOLD,fill=(245,250,255,255))
    for i in range(5):
        x=42+i*132; y=100
        d.rounded_rectangle((x,y,x+110,y+70),radius=12,fill=tuple(accent)+(60,),outline=tuple(accent)+(180,),width=2)
        d.rectangle((x+12,y+20,x+98,y+28),fill=(190,210,245,80)); d.rectangle((x+12,y+40,x+80,y+46),fill=(120,150,200,100))
    for i in range(3):
        x=44+i*220; y=210
        d.rounded_rectangle((x,y,x+180,y+150),radius=16,fill=(24,40,58,255),outline=(70,95,130,160),width=2)
        d.ellipse((x+60,y+24,x+120,y+84),fill=[(218,172,136,255),(154,110,80,255),(184,140,108,255)][i])
        d.rectangle((x,y+110,x+180,y+150),fill=(0,0,0,70))
    return img

TEXTURES={}
def save_tex(key,img,rough=.6,metal=0):
    p=ROOT/'materials/v4_pbr'/key.lower(); p.mkdir(parents=True,exist_ok=True)
    bp=p/f'{key}_baseColor.png'; npth=p/f'{key}_normal.png'; mp=p/f'{key}_metallicRoughness.png'
    img.save(bp); normal_img(img.width if img.width==img.height else 512,4).save(npth); mr_img(rough,metal,img.width if img.width==img.height else 512).save(mp)
    TEXTURES[key]={'base':img,'normal':Image.open(npth),'mr':Image.open(mp),'paths':[str(bp.relative_to(ROOT)),str(npth.relative_to(ROOT)),str(mp.relative_to(ROOT))]}

save_tex('V4_WOOD_WALNUT', wood_texture(), .55,0)
save_tex('V4_WOOD_SLAT', wood_texture(512,(105,65,38),(48,27,15)), .62,0)
save_tex('V4_MARBLE_WHITE', marble_texture(), .28,0)
save_tex('V4_CONCRETE', noise_img((142,143,139),512,18), .68,0)
save_tex('V4_BLUE_FABRIC', fabric_texture(512,(25,53,85)), .84,0)
save_tex('V4_BLACK_LEATHER', fabric_texture(512,(22,22,25)), .45,0)
save_tex('V4_GREEN_LEAF', noise_img((38,116,56),512,24), .72,0)
save_tex('V4_DARK_METAL', noise_img((17,20,24),256,4), .34,.85)
save_tex('V4_GLASS', noise_img((160,215,240),256,2,92), .04,0)
save_tex('V4_WARM_LIGHT', Image.new('RGBA',(64,64),(255,220,142,255)), .12,0)
save_tex('V4_BLUE_EMISSIVE', Image.new('RGBA',(64,64),(45,135,255,255)), .08,0)
save_tex('V4_SKIN_LIGHT', noise_img((226,174,137),256,7), .65,0)
save_tex('V4_SKIN_MEDIUM', noise_img((172,112,74),256,7), .65,0)
save_tex('V4_HAIR_DARK', noise_img((31,22,18),256,9), .58,0)

MAT_CACHE={}
def material(name, rgba, rough=.6, metal=0, tex=None, alpha=None, emissive=None, double=True):
    key=(name,tuple(rgba),rough,metal,tex,alpha,tuple(emissive) if emissive else None,double)
    if key in MAT_CACHE: return MAT_CACHE[key]
    if tex and tex in TEXTURES:
        t=TEXTURES[tex]
        mat=PBRMaterial(name=name, baseColorFactor=rgba01(rgba), baseColorTexture=t['base'], normalTexture=t['normal'], metallicRoughnessTexture=t['mr'], roughnessFactor=rough, metallicFactor=metal, alphaMode=alpha, doubleSided=double, emissiveFactor=emissive)
    else:
        mat=PBRMaterial(name=name, baseColorFactor=rgba01(rgba), roughnessFactor=rough, metallicFactor=metal, alphaMode=alpha, doubleSided=double, emissiveFactor=emissive)
    MAT_CACHE[key]=mat; return mat

def mat_color(mat, fallback=(180,180,180,255)):
    try:
        f=mat.baseColorFactor
        if f is not None: return tuple(clamp(float(v)*255) for v in f)
    except Exception: pass
    return fallback

M={
 'wood': material('V4_M_WOOD_WALNUT',(255,255,255,255),.55,0,'V4_WOOD_WALNUT'),
 'slat': material('V4_M_WOOD_SLAT',(255,255,255,255),.62,0,'V4_WOOD_SLAT'),
 'marble': material('V4_M_MARBLE_WHITE',(255,255,255,255),.28,0,'V4_MARBLE_WHITE'),
 'concrete': material('V4_M_CONCRETE',(255,255,255,255),.68,0,'V4_CONCRETE'),
 'fabric_blue': material('V4_M_BLUE_FABRIC',(255,255,255,255),.84,0,'V4_BLUE_FABRIC'),
 'leather': material('V4_M_BLACK_LEATHER',(255,255,255,255),.45,0,'V4_BLACK_LEATHER'),
 'leaf': material('V4_M_GREEN_LEAF',(255,255,255,255),.72,0,'V4_GREEN_LEAF'),
 'metal': material('V4_M_DARK_METAL',(255,255,255,255),.34,.85,'V4_DARK_METAL'),
 'glass': material('V4_M_GLASS_CLEAR',(175,225,245,90),.04,0,'V4_GLASS','BLEND',None,True),
 'warm': material('V4_M_WARM_EMISSIVE',(255,220,142,255),.12,0,'V4_WARM_LIGHT',None,[1.0,.55,.12],True),
 'blue': material('V4_M_BLUE_EMISSIVE',(45,135,255,255),.08,0,'V4_BLUE_EMISSIVE',None,[0.0,.32,1.0],True),
 'white': material('V4_M_SOFT_WHITE',(235,236,230,255),.46,0,None),
 'black': material('V4_M_BLACK_PLASTIC',(22,24,28,255),.5,0,None),
 'skin1': material('V4_M_SKIN_LIGHT',(255,255,255,255),.65,0,'V4_SKIN_LIGHT'),
 'skin2': material('V4_M_SKIN_MEDIUM',(255,255,255,255),.65,0,'V4_SKIN_MEDIUM'),
 'hair': material('V4_M_HAIR_DARK',(255,255,255,255),.58,0,'V4_HAIR_DARK'),
 'shirt_blue': material('V4_M_SHIRT_NAVY',(28,55,88,255),.7,0,None),
 'shirt_green': material('V4_M_SHIRT_GREEN',(62,98,72,255),.72,0,None),
 'pants': material('V4_M_PANTS_DARK',(24,28,35,255),.68,0,None),
 'screen': material('V4_M_SCREEN_DARK',(9,15,24,255),.4,0,None,None,[0.02,0.04,0.08],True),
}

def apply_material(mesh, mat, name=None):
    if len(mesh.vertices):
        ext=np.ptp(mesh.vertices,axis=0)+1e-9; axes=np.argsort(ext)[-2:]
        uv=(mesh.vertices[:,axes]-mesh.vertices[:,axes].min(axis=0))/(np.ptp(mesh.vertices[:,axes],axis=0)+1e-9)
    else:
        uv=np.zeros((0,2))
    mesh.visual=TextureVisuals(uv=uv, material=mat)
    mesh.metadata['rgba']=mat_color(mat)
    if name: mesh.metadata['name']=name; mesh.name=name
    return mesh

def box(extents, loc=(0,0,0), mat=None, name='box'):
    m=trimesh.creation.box(extents=extents)
    m.apply_translation([loc[0],loc[1],loc[2]+extents[2]/2])
    if mat: apply_material(m,mat,name)
    return m

def cyl(radius,height,loc=(0,0,0),mat=None,name='cylinder',sections=32,axis='z'):
    m=trimesh.creation.cylinder(radius=radius,height=height,sections=sections)
    if axis=='x': m.apply_transform(trimesh.geometry.align_vectors([0,0,1],[1,0,0]))
    if axis=='y': m.apply_transform(trimesh.geometry.align_vectors([0,0,1],[0,1,0]))
    if axis=='z': m.apply_translation([loc[0],loc[1],loc[2]+height/2])
    else: m.apply_translation(loc)
    if mat: apply_material(m,mat,name)
    return m

def sphere(radius, loc=(0,0,0), mat=None, name='sphere', subdivisions=2):
    m=trimesh.creation.icosphere(subdivisions=subdivisions, radius=radius)
    m.apply_translation(loc)
    if mat: apply_material(m,mat,name)
    return m

def ellipsoid(scale, loc=(0,0,0), mat=None, name='ellipsoid', subdivisions=3):
    m=trimesh.creation.uv_sphere(radius=1, count=(32,16))
    S=np.diag([scale[0],scale[1],scale[2],1]); m.apply_transform(S); m.apply_translation(loc)
    if mat: apply_material(m,mat,name)
    return m

def torus(major, minor, loc=(0,0,0), mat=None, name='torus'):
    m=trimesh.creation.torus(major_radius=major, minor_radius=minor, major_sections=48, minor_sections=8)
    m.apply_translation(loc)
    if mat: apply_material(m,mat,name)
    return m

def capsule_between(p1,p2,r,mat=None,name='capsule'):
    p1=np.asarray(p1,float); p2=np.asarray(p2,float); mid=(p1+p2)/2; v=p2-p1; L=np.linalg.norm(v)
    if L<1e-6: return sphere(r,mid,mat,name)
    m=trimesh.creation.capsule(height=L, radius=r, count=(16,8))
    # default along z centered at origin
    T=trimesh.geometry.align_vectors([0,0,1], v/L); m.apply_transform(T); m.apply_translation(mid)
    if mat: apply_material(m,mat,name)
    return m

def rounded_prism(width,depth,height,r=.18,loc=(0,0,0),mat=None,name='rounded_prism',seg=10):
    r=min(r,width/2-.001,depth/2-.001)
    pts=[]
    corners=[(width/2-r, depth/2-r, 0, math.pi/2),(-width/2+r, depth/2-r, math.pi/2, math.pi),(-width/2+r,-depth/2+r, math.pi, 3*math.pi/2),(width/2-r,-depth/2+r,3*math.pi/2,2*math.pi)]
    for cx,cy,a0,a1 in corners:
        for i in range(seg+1):
            a=a0+(a1-a0)*i/seg; pts.append((cx+math.cos(a)*r, cy+math.sin(a)*r))
    # remove dup-ish
    verts=[]
    for x,y in pts: verts.append([x,y,0])
    for x,y in pts: verts.append([x,y,height])
    n=len(pts); faces=[]
    for i in range(n):
        j=(i+1)%n
        faces.append([i,j,n+j]); faces.append([i,n+j,n+i])
    bottom=len(verts); top=bottom+1; verts.append([0,0,0]); verts.append([0,0,height])
    for i in range(n):
        j=(i+1)%n
        faces.append([bottom,j,i]); faces.append([top,n+i,n+j])
    m=trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=False)
    m.apply_translation(loc)
    if mat: apply_material(m,mat,name)
    return m

def plane(width,height,loc=(0,0,0),orientation='y+',mat=None,name='plane'):
    w=width/2; h=height
    if orientation.startswith('y'):
        verts=np.array([[-w,0,0],[w,0,0],[w,0,h],[-w,0,h]],float)
    elif orientation.startswith('x'):
        verts=np.array([[0,-w,0],[0,w,0],[0,w,h],[0,-w,h]],float)
    elif orientation=='z+':
        verts=np.array([[-w,-height/2,0],[w,-height/2,0],[w,height/2,0],[-w,height/2,0]],float)
    faces=np.array([[0,1,2],[0,2,3]])
    m=trimesh.Trimesh(vertices=verts,faces=faces,process=False); m.apply_translation(loc)
    uv=np.array([[0,0],[1,0],[1,1],[0,1]],float)
    m.visual=TextureVisuals(uv=uv, material=mat or M['white']); m.metadata['rgba']=mat_color(mat or M['white']); m.metadata['name']=name; m.name=name
    return m

def textured_plane(width,height,loc,orientation,img,mat_name,name,emissive=None):
    mat=PBRMaterial(name=mat_name,baseColorFactor=[1,1,1,1],baseColorTexture=img,roughnessFactor=.45,metallicFactor=0,alphaMode=None,doubleSided=True,emissiveFactor=emissive)
    return plane(width,height,loc,orientation,mat,name)

def transform(meshes, translation=(0,0,0), rz=0, scale=1):
    T=np.eye(4)
    if isinstance(scale,(tuple,list,np.ndarray)):
        T[:3,:3]=np.diag(scale)
    else: T[:3,:3]*=scale
    if rz:
        T=trimesh.transformations.rotation_matrix(math.radians(rz),[0,0,1]) @ T
    T=trimesh.transformations.translation_matrix(translation) @ T
    out=[]
    for m in meshes:
        mm=m.copy(); mm.apply_transform(T); out.append(mm)
    return out

def scene_from(meshes):
    sc=trimesh.Scene()
    for i,m in enumerate(meshes): sc.add_geometry(m,node_name=m.metadata.get('name',f'mesh_{i}'),geom_name=m.metadata.get('name',f'mesh_{i}'))
    return sc

def normalize_meshes(meshes):
    verts=[m.vertices for m in meshes if len(m.vertices)]
    if not verts: return meshes, [0,0,0]
    v=np.vstack(verts); mn=v.min(axis=0); mx=v.max(axis=0); center=(mn[:2]+mx[:2])/2
    delta=np.array([-center[0],-center[1],-mn[2]])
    for m in meshes: m.apply_translation(delta)
    dims=(mx-mn).tolist(); return meshes,dims

def export_module(asset_id, meshes, subdir='v4_hero', category='v4_hero', notes=''):
    meshes=[m for m in meshes if isinstance(m,trimesh.Trimesh)]
    meshes,dims=normalize_meshes(meshes)
    path=ROOT/'models'/subdir/f'{asset_id}.glb'; path.parent.mkdir(parents=True,exist_ok=True)
    scene_from(meshes).export(path)
    tris=sum(len(m.faces) for m in meshes)
    meta={
        'asset_id':asset_id,'name':asset_id.replace('_',' ').title(),'version':'4.0','quality_tier':'v4_hero_refined_procedural','category':category,'type':'production_hero_module','priority':'P0','file':str(path.relative_to(ROOT)),'format':'glb/glTF 2.0 binary','unit':'meter','up_axis':'Z','pivot':'BOTTOM_CENTER','floor_z':0,
        'dimensions_m':{'width':round(dims[0],3),'depth':round(dims[1],3),'height':round(dims[2],3)},'triangle_count':int(tris),'materials':{'pbr':True,'v4_texture_sets':True,'basecolor_baked_lighting':False,'alpha_glass_or_emissive_when_required':True},
        'collision':{'type':'BOX','center':[0,0,round(dims[2]/2,3)],'size':[round(dims[0],3),round(dims[1],3),round(dims[2],3)]},
        'anchors':{'camera_focus_anchor':{'position':[0,0,round(dims[2]*.55,3)],'rotation':[0,0,0]},'status_anchor':{'position':[0,0,round(dims[2]+.3,3)],'rotation':[0,0,0]}},
        'interaction':{'module':True},'tags':['v4','hero','high_detail','reference_aligned','procedural_mesh'], 'notes':notes
    }
    # module-specific anchors
    if 'MEETING' in asset_id or 'GLASS' in asset_id:
        meta['anchors']['room_label_anchor']={'position':[0,0,round(dims[2]+.35,3)],'rotation':[0,0,0]}
        meta['interaction']['can_enter_room']=True
    if 'WORKSTATION' in asset_id:
        meta['anchors']['work_anchor']={'position':[0,-.45,.78],'rotation':[0,0,0]}
        meta['interaction']['can_work']=True
    (ROOT/'metadata/v4_assets'/f'{asset_id}.meta.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False),encoding='utf-8')
    meta['thumbnail']=f'previews/v4/thumbnails/{asset_id}.png'
    return meta, meshes

def chair(pos=(0,0,0), mat_seat=None, name='chair'):
    mat_seat=mat_seat or M['leather']; x,y,z=pos
    meshes=[
        rounded_prism(.55,.52,.10,.08,(x,y,z+.43),mat_seat,name+'_seat'),
        rounded_prism(.58,.11,.72,.05,(x,y+.24,z+.48),mat_seat,name+'_back'),
        cyl(.035,.45,(x-.23,y,z+.12),M['metal'],name+'_gas'),
        cyl(.035,.45,(x+.23,y,z+.12),M['metal'],name+'_gas2'),
        cyl(.045,.42,(x,y,z+.08),M['metal'],name+'_center')]
    # arms, base, wheels
    meshes += [box((.08,.55,.055),(x-.34,y,z+.58),M['metal'],name+'_arm_l'),box((.08,.55,.055),(x+.34,y,z+.58),M['metal'],name+'_arm_r')]
    for ang in [0,72,144,216,288]:
        dx=math.cos(math.radians(ang))*.35; dy=math.sin(math.radians(ang))*.35
        meshes.append(capsule_between((x,y,z+.08),(x+dx,y+dy,z+.08),.026,M['metal'],name+'_base'))
        meshes.append(cyl(.055,.04,(x+dx,y+dy,z+.02),M['black'],name+'_wheel',sections=16,axis='x'))
    return meshes

def monitor(pos=(0,0,0), dual=False, title='Dashboard'):
    x,y,z=pos; meshes=[]
    for i,dx in enumerate(([-.31,.31] if dual else [0])):
        img=screen_texture(title if i==0 else 'Tasks',(512,288))
        meshes.append(plane(.55,.32,(x+dx,y,z+.55),'y-',M['screen'],'monitor_panel'))
        meshes.append(textured_plane(.52,.29,(x+dx,y-.012,z+.565),'y-',img,'V4_M_SCREEN_UI','screen_ui',emissive=[.02,.04,.08]))
        meshes.append(box((.08,.04,.22),(x+dx,y+.025,z+.31),M['metal'],'monitor_stand'))
        meshes.append(rounded_prism(.28,.16,.025,.035,(x+dx,y+.01,z+.28),M['metal'],'monitor_base'))
    return meshes

def laptop(pos=(0,0,0), title='Laptop'):
    x,y,z=pos
    img=screen_texture(title,(384,216),(50,160,235))
    return [rounded_prism(.48,.32,.025,.035,(x,y,z),M['metal'],'laptop_base'), plane(.46,.27,(x,y+.15,z+.05),'y-',M['screen'],'laptop_screen'), textured_plane(.43,.24,(x,y+.137,z+.066),'y-',img,'V4_M_LAPTOP_SCREEN','laptop_screen_ui',emissive=[.02,.04,.08])]

def keyboard_mouse(pos=(0,0,0)):
    x,y,z=pos; meshes=[rounded_prism(.44,.15,.025,.025,(x,y,z),M['black'],'keyboard')]
    for i in range(12):
        meshes.append(box((.025,.018,.006),(x-.18+i*.033,y,z+.026),M['white'],'key'))
    meshes.append(ellipsoid((.06,.09,.025),(x+.33,y-.01,z+.025),M['black'],'mouse'))
    return meshes

def plant(pos=(0,0,0), scale=1.0, tall=True, name='plant'):
    x,y,z=pos; meshes=[cyl(.16*scale,.28*scale,(x,y,z),M['marble'],name+'_pot'),cyl(.12*scale,.06*scale,(x,y,z+.26*scale),M['black'],name+'_soil')]
    n=18 if tall else 10
    for i in range(n):
        ang=2*math.pi*i/n; h=random.uniform(.35,.85)*(1.2 if tall else .6)*scale
        rad=random.uniform(.04,.07)*scale
        start=(x,y,z+.28*scale); end=(x+math.cos(ang)*random.uniform(.12,.3)*scale,y+math.sin(ang)*random.uniform(.12,.3)*scale,z+.25*scale+h)
        meshes.append(capsule_between(start,end,.012*scale,M['leaf'],name+'_stem'))
        leaf=ellipsoid((rad*1.5,rad*.45,rad*.08),end,M['leaf'],name+'_leaf')
        # orient leaf roughly in XY
        leaf.apply_transform(trimesh.transformations.rotation_matrix(ang,[0,0,1],point=end))
        meshes.append(leaf)
    return meshes

def person(pos=(0,0,0), gender='male', pose='standing', shirt=None, skin=None, name='person'):
    x,y,z=pos; shirt=shirt or (M['shirt_blue'] if gender=='male' else M['shirt_green']); skin=skin or (M['skin2'] if gender=='male' else M['skin1'])
    hair=M['hair']; pants=M['pants']; meshes=[]
    # body
    meshes.append(ellipsoid((.18,.12,.33),(x,y,z+1.05),shirt,name+'_torso'))
    meshes.append(cyl(.08,.12,(x,y,z+1.38),skin,name+'_neck'))
    meshes.append(ellipsoid((.16,.14,.17),(x,y,z+1.55),skin,name+'_head'))
    meshes.append(ellipsoid((.17,.15,.08),(x,y-.01,z+1.67),hair,name+'_hair'))
    meshes.append(ellipsoid((.035,.018,.018),(x-.055,y-.128,z+1.57),M['black'],name+'_eye_l'))
    meshes.append(ellipsoid((.035,.018,.018),(x+.055,y-.128,z+1.57),M['black'],name+'_eye_r'))
    if pose=='sitting':
        hips=(x,y,z+.76); knee_l=(x-.12,y-.12,z+.55); knee_r=(x+.12,y-.12,z+.55); foot_l=(x-.12,y-.34,z+.14); foot_r=(x+.12,y-.34,z+.14)
        sh_l=(x-.18,y,z+1.2); hand_l=(x-.24,y-.34,z+.83); sh_r=(x+.18,y,z+1.2); hand_r=(x+.24,y-.34,z+.83)
    elif pose=='typing':
        hips=(x,y,z+.76); knee_l=(x-.12,y-.08,z+.55); knee_r=(x+.12,y-.08,z+.55); foot_l=(x-.12,y-.31,z+.14); foot_r=(x+.12,y-.31,z+.14)
        sh_l=(x-.18,y,z+1.2); hand_l=(x-.17,y-.45,z+.83); sh_r=(x+.18,y,z+1.2); hand_r=(x+.17,y-.45,z+.83)
    else:
        hips=(x,y,z+.72); knee_l=(x-.11,y,z+.38); knee_r=(x+.11,y,z+.38); foot_l=(x-.11,y-.04,z+.06); foot_r=(x+.11,y+.06,z+.06)
        if pose=='walking': foot_l=(x-.18,y-.18,z+.06); foot_r=(x+.18,y+.12,z+.06)
        sh_l=(x-.18,y,z+1.2); hand_l=(x-.22,y-.06,z+.78); sh_r=(x+.18,y,z+1.2); hand_r=(x+.22,y+.08,z+.78)
    meshes += [capsule_between(hips,knee_l,.055,pants,name+'_leg_l'),capsule_between(knee_l,foot_l,.052,pants,name+'_shin_l'),capsule_between(hips,knee_r,.055,pants,name+'_leg_r'),capsule_between(knee_r,foot_r,.052,pants,name+'_shin_r'),ellipsoid((.12,.055,.04),foot_l,M['black'],name+'_shoe_l'),ellipsoid((.12,.055,.04),foot_r,M['black'],name+'_shoe_r')]
    meshes += [capsule_between(sh_l,hand_l,.045,shirt,name+'_arm_l'),capsule_between(sh_r,hand_r,.045,shirt,name+'_arm_r'),sphere(.055,hand_l,skin,name+'_hand_l'),sphere(.055,hand_r,skin,name+'_hand_r')]
    return meshes

def meeting_table(pos=(0,0,0), seats=8):
    x,y,z=pos
    meshes=[rounded_prism(2.45,1.05,.09,.18,(x,y,z+.72),M['wood'],'meeting_top'),rounded_prism(2.25,.85,.04,.14,(x,y,z+.67),M['metal'],'meeting_under')]
    for dx in [-1.0,1.0]:
        meshes.append(rounded_prism(.12,.72,.66,.04,(x+dx,y,z),M['metal'],'meeting_leg'))
    # speakerphone and documents
    meshes.append(ellipsoid((.18,.12,.035),(x,y,z+.82),M['black'],'speakerphone'))
    for dx in [-.65,-.2,.25,.7]: meshes.append(box((.22,.14,.006),(x+dx,y+.16,z+.815),M['white'],'paper_on_table'))
    return meshes

def glass_room_module(title='Product Sync'):
    meshes=[]
    # floor and glass panels
    meshes.append(rounded_prism(3.7,2.65,.05,.04,(0,0,0),M['concrete'],'room_floor'))
    w,d,h=3.55,2.5,2.25; t=.04
    # glass panels
    meshes += [box((w,t,h),(0,d/2,0),M['glass'],'glass_back'),box((w,t,h),(0,-d/2,0),M['glass'],'glass_front'),box((t,d,h),(-w/2,0,0),M['glass'],'glass_left'),box((t,d,h),(w/2,0,0),M['glass'],'glass_right')]
    # metal frames verticals and horizontals
    for sx in [-w/2,0,w/2]:
        for sy in [-d/2,d/2]: meshes.append(cyl(.025,h,(sx,sy,0),M['metal'],'room_post',sections=12))
    for sx in [-w/2,w/2]:
        for sy in [-d/2,0,d/2]: meshes.append(cyl(.022,h,(sx,sy,0),M['metal'],'room_post_side',sections=12))
    for z in [0,h]:
        meshes += [box((w+.06,.055,.055),(0,d/2,z),M['metal'],'frame'),box((w+.06,.055,.055),(0,-d/2,z),M['metal'],'frame'),box((.055,d+.06,.055),(-w/2,0,z),M['metal'],'frame'),box((.055,d+.06,.055),(w/2,0,z),M['metal'],'frame')]
    # neon outline on top/front
    meshes += [box((w+.14,.045,.045),(0,-d/2-.04,h+.03),M['blue'],'neon_front'),box((.045,d+.14,.045),(-w/2-.04,0,h+.03),M['blue'],'neon_l'),box((.045,d+.14,.045),(w/2+.04,0,h+.03),M['blue'],'neon_r'),box((w+.14,.045,.045),(0,d/2+.04,h+.03),M['blue'],'neon_back')]
    # meeting furniture
    meshes += meeting_table((0,0,0),8)
    for idx,(px,py,rz) in enumerate([(-1.0,-.95,0),(-.35,-.95,0),(.35,-.95,0),(1.0,-.95,0),(-1.0,.95,180),(-.35,.95,180),(.35,.95,180),(1.0,.95,180)]):
        meshes += transform(chair((0,0,0),M['leather'],f'meeting_chair_{idx}'),(px,py,0),rz,.8)
    # tv wall and room label board
    meshes.append(box((1.35,.055,.8),(0,d/2-.08,.92),M['black'],'tv_wall_frame'))
    img=screen_texture(title,(768,432))
    meshes.append(textured_plane(1.25,.7,(0,d/2-.118,1.0),'y-',img,'V4_MEETING_SCREEN','meeting_screen',emissive=[.03,.07,.12]))
    meshes.append(plane(1.1,.38,(0,-d/2-.07,h+.25),'y-',M['black'],'floating_label_back'))
    # small plants inside
    meshes += plant((-1.35,.8,0),.55,False,'room_plant')
    meshes += person((.65,.45,0),'female','sitting',M['shirt_green'],M['skin1'],'meeting_person1')
    meshes += person((-.65,-.45,0),'male','sitting',M['shirt_blue'],M['skin2'],'meeting_person2')
    return meshes

def reception_module():
    meshes=[]
    meshes.append(rounded_prism(4.5,2.9,.06,.08,(0,0,0),M['concrete'],'reception_floor'))
    # wood slat wall + concrete side panels
    meshes.append(box((4.0,.12,2.65),(0,1.28,0),M['slat'],'back_wall_base'))
    for i in range(28):
        x=-1.9+i*(3.8/27)
        meshes.append(box((.045,.11,2.72),(x,1.19,0),M['wood'],'individual_wood_slat'))
    meshes.append(box((3.7,.05,.045),(0,1.12,2.62),M['warm'],'wall_top_warm_led'))
    logo=sign_texture('ACME\nCORPORATION',(1024,512))
    meshes.append(textured_plane(1.55,.78,(0,1.105,1.38),'y-',logo,'V4_ACME_LOGO_SIGN','acme_logo',emissive=[.08,.08,.08]))
    # curved marble desk
    meshes.append(rounded_prism(2.45,.82,.72,.24,(0,-.55,0),M['marble'],'curved_reception_desk_base'))
    meshes.append(rounded_prism(2.6,.94,.08,.26,(0,-.55,.72),M['marble'],'curved_reception_desk_top'))
    meshes.append(box((2.35,.05,.045),(0,-.99,.13),M['warm'],'desk_under_glow_front'))
    meshes.append(box((.05,.65,.045),(-1.25,-.55,.13),M['warm'],'desk_under_glow_l'))
    meshes.append(box((.05,.65,.045),(1.25,-.55,.13),M['warm'],'desk_under_glow_r'))
    # desk details
    meshes += monitor((-.45,-.84,.76),False,'Reception')
    meshes += keyboard_mouse((-.45,-.55,.775))
    meshes += plant((.78,-.78,.77),.38,False,'deskplant')
    meshes.append(rounded_prism(.18,.18,.08,.04,(.15,-.85,.78),M['black'],'phone'))
    meshes += chair((-.45,-.25,0),M['leather'],'reception_chair')
    meshes += person((-.45,-.16,0),'female','sitting',M['shirt_green'],M['skin1'],'receptionist')
    # decor shelf right side
    meshes.append(box((.9,.3,1.85),(1.75,.82,0),M['metal'],'shelf_frame'))
    for z in [.42,.88,1.34,1.78]: meshes.append(box((.85,.32,.04),(1.75,.82,z),M['wood'],'shelf_plank'))
    for ix in [-.25,.05,.27]: meshes.append(box((.12,.18,.26),(1.75+ix,.78,.47),M['white'],'binder'))
    meshes += plant((1.53,.74,.88),.28,False,'shelf_plant')
    meshes += plant((-1.75,.55,0),.85,True,'lobby_large_plant_l')
    meshes += plant((1.95,-.8,0),.72,True,'lobby_large_plant_r')
    return meshes

def workstation_module():
    meshes=[]
    # bench desk cluster 4p with planter divider
    meshes.append(rounded_prism(3.25,1.45,.08,.14,(0,0,.72),M['wood'],'desk_cluster_top'))
    meshes.append(rounded_prism(3.05,.22,.42,.08,(0,0,.78),M['marble'],'central_planter'))
    for x in [-1.35,1.35]:
        for y in [-.55,.55]: meshes.append(box((.1,.1,.72),(x,y,0),M['metal'],'desk_leg'))
    # workstations each side
    positions=[(-.85,-.55,0),( .85,-.55,0),(-.85,.55,180),(.85,.55,180)]
    for idx,(px,py,rz) in enumerate(positions):
        meshes += transform(chair((0,0,0),M['leather'],f'taskchair_{idx}'),(px,py*1.55,0),rz,.82)
        meshes += transform(monitor((0,0,.23),dual=(idx%2==0),title='Office'),(px,py*.48,.53),rz,1)
        meshes += transform(keyboard_mouse((0,-.23,.755)),(px,py*.35,0),rz,1)
        meshes.append(rounded_prism(.16,.16,.08,.04,(px+.34,py*.7,.76),M['white'],'mug'))
        meshes.append(box((.26,.18,.01),(px-.36,py*.7,.765),M['white'],'note'))
    # plants and dividers
    for px in [-1.15,-.35,.35,1.15]: meshes += plant((px,0,.84),.25,False,'deskdivider_plant')
    # seated users
    meshes += transform(person((0,0,0),'male','typing',M['shirt_blue'],M['skin2'],'worker_male'),(-.85,-1.05,0),0,.86)
    meshes += transform(person((0,0,0),'female','typing',M['shirt_green'],M['skin1'],'worker_female'),(.85,1.05,0),180,.86)
    # cable trays and detail objects
    meshes.append(capsule_between((-1.55,-.08,.70),(1.55,-.08,.70),.018,M['black'],'cable_tray'))
    for i in range(6):
        meshes.append(capsule_between((-1.2+i*.45,-.25,.755),(-1.15+i*.45,-.45,.755),.007,M['black'],'loose_cable'))
    return meshes

def lounge_module():
    meshes=[]
    meshes.append(rounded_prism(2.6,1.65,.025,.16,(0,0,0),M['fabric_blue'],'blue_rug'))
    # sectional sofa: cushions + back + arms
    for i,x in enumerate([- .72,0,.72]):
        meshes.append(rounded_prism(.7,.65,.18,.1,(x,.1,.28),M['fabric_blue'],'sofa_seat'))
        meshes.append(ellipsoid((.33,.09,.22),(x,.45,.58),M['fabric_blue'],'sofa_back_cushion'))
    meshes.append(rounded_prism(2.25,.18,.62,.08,(0,.54,.18),M['fabric_blue'],'sofa_back'))
    meshes.append(rounded_prism(.2,.72,.38,.08,(-1.22,.18,.18),M['fabric_blue'],'sofa_arm_l'))
    meshes.append(rounded_prism(.2,.72,.38,.08,(1.22,.18,.18),M['fabric_blue'],'sofa_arm_r'))
    for x in [-.45,.42]: meshes.append(ellipsoid((.18,.08,.14),(x,-.02,.58),M['white'],'throw_pillow'))
    meshes.append(rounded_prism(.82,.82,.06,.18,(0,-.75,.38),M['wood'],'coffee_table_top'))
    meshes.append(cyl(.07,.36,(0,-.75,0),M['metal'],'coffee_table_pedestal'))
    meshes.append(cyl(.28,.035,(0,-.75,0),M['metal'],'coffee_table_base'))
    meshes.append(rounded_prism(.18,.18,.08,.04,(-.18,-.75,.45),M['white'],'cup_on_lounge_table'))
    meshes += plant((-1.55,.45,0),.72,True,'lounge_plant')
    meshes += plant((1.55,-.55,0),.42,False,'lounge_small_plant')
    # side lounge chair
    meshes += transform(chair((0,0,0),M['fabric_blue'],'round_lounge_chair'),(1.45,-1.05,0),-35,.82)
    return meshes

def pantry_module():
    meshes=[]
    meshes.append(rounded_prism(3.2,1.05,.86,.16,(0,0,0),M['marble'],'pantry_island'))
    meshes.append(box((3.0,.045,.045),(0,-.56,.15),M['warm'],'pantry_underlight'))
    for x in [-1.1,0,1.1]:
        meshes += transform(chair((0,0,0),M['fabric_blue'],'barstool'),(x,-.95,0),0,.62)
        meshes.append(cyl(.07,.8,(x,-.95,0),M['metal'],'bar_stool_post'))
    # coffee machine and appliances
    meshes.append(rounded_prism(.48,.34,.42,.06,(-1.05,.22,.88),M['black'],'coffee_machine'))
    meshes.append(cyl(.12,.08,(-1.05,.03,.96),M['white'],'coffee_cup_inside'))
    meshes.append(rounded_prism(.44,.28,.55,.05,(-.35,.26,.88),M['metal'],'water_dispenser_mini'))
    meshes.append(cyl(.17,.35,(-.35,.27,1.34),M['glass'],'water_bottle'))
    for x in [.45,.68,.91]: meshes.append(cyl(.045,.28,(x,.18,.88),M['white'],'bottle'))
    # pendant lights
    for x in [-.9,0,.9]:
        meshes.append(cyl(.012,.55,(x,0,1.55),M['metal'],'pendant_wire'))
        meshes.append(cyl(.18,.18,(x,0,1.35),M['warm'],'pendant_shade'))
    return meshes

def label_board(text, subtitle=''):
    img=Image.new('RGBA',(512,220),(18,24,34,230)); d=ImageDraw.Draw(img,'RGBA')
    d.rounded_rectangle((4,4,508,216),radius=28,fill=(18,24,34,230),outline=(95,125,180,160),width=3)
    d.text((42,38),text,font=FONT_BOLD,fill=(250,252,255,255));
    if subtitle: d.text((44,104),subtitle,font=FONT_MED,fill=(170,185,205,255))
    d.ellipse((30,92,52,114),fill=(65,210,110,255))
    return textured_plane(1.15,.48,(0,0,0),'y-',img,'V4_ROOM_LABEL','room_label',emissive=[.02,.04,.08])

# Create individual v4 characters
V4_METAS=[]
CHAR_MESHES=[]
for aid, gender, pose, shirt, skin in [
    ('CHAR_MALE_HERO_V4_001','male','standing',M['shirt_blue'],M['skin2']),
    ('CHAR_FEMALE_HERO_V4_001','female','standing',M['shirt_green'],M['skin1']),
    ('CHAR_RECEPTIONIST_HERO_V4_001','female','sitting',M['shirt_green'],M['skin1'])]:
    meta,meshes=export_module(aid,person((0,0,0),gender,pose,shirt,skin,aid.lower()),'v4_characters','characters','V4 stylized high-detail static humanoid, rig-ready proportions; replace with skinned rig for production animation.')
    meta['type']='avatar'; meta['anchors']['name_tag_anchor']={'position':[0,0,1.95],'rotation':[0,0,0]}; meta['interaction']['can_select']=True
    (ROOT/'metadata/v4_assets'/f'{aid}.meta.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False),encoding='utf-8')
    V4_METAS.append(meta)
    CHAR_MESHES.append((aid,meshes))

# Create hero modules
modules=[]
for aid,builder,note in [
    ('HERO_RECEPTION_LOBBY_V4_001',reception_module,'V4 refined reception with individual wood slats, curved marble counter, emissive logo/signage and dense decor.'),
    ('HERO_GLASS_MEETING_ROOM_V4_001',lambda: glass_room_module('Product Sync'),'V4 glass meeting room with transparent panels, metal frames, blue emissive outline, TV screen UI, table, chairs, people and plants.'),
    ('HERO_WORKSTATION_CLUSTER_V4_001',workstation_module,'V4 workstation cluster with 4 seats, divider planter, monitors, keyboards, cables, seated avatars and desk props.'),
    ('HERO_LOUNGE_BLUE_AREA_V4_001',lounge_module,'V4 lounge module with sectional sofa, rug, coffee table, pillows, lounge chair and plants.'),
    ('HERO_PANTRY_CAFE_V4_001',pantry_module,'V4 pantry/cafe island with marble counter, bar stools, pendant lighting, coffee machine and accessories.')]:
    meta,meshes=export_module(aid,builder(),'v4_hero','hero',note)
    modules.append((aid,meshes)); V4_METAS.append(meta)

# Build full v4 scene
scene=[]
# base floor zones
scene.append(rounded_prism(11.8,7.4,.05,.08,(0,0,0),M['concrete'],'office_concrete_floor'))
scene.append(box((4.8,2.4,.055),(-3.2,-2.35,0),M['wood'],'wood_floor_cafe'))
scene.append(box((11.9,.12,.22),(0,3.76,0),M['metal'],'back_boundary'))
scene.append(box((.12,7.5,.22),(-5.98,0,0),M['metal'],'left_boundary'))
scene.append(box((.12,7.5,.22),(5.98,0,0),M['metal'],'right_boundary'))
scene.append(box((11.9,.12,.22),(0,-3.76,0),M['metal'],'front_boundary'))
# tile grid lines
for x in np.linspace(-5.4,5.4,10): scene.append(box((.018,7.25,.012),(x,0,.055),M['black'],'subtle_tile_x'))
for y in np.linspace(-3.2,3.2,7): scene.append(box((11.2,.018,.012),(0,y,.055),M['black'],'subtle_tile_y'))
# place modules
for aid,meshes in modules:
    if aid=='HERO_RECEPTION_LOBBY_V4_001': scene += transform(meshes,(-3.25,1.9,.05),0,1.0)
    elif aid=='HERO_LOUNGE_BLUE_AREA_V4_001': scene += transform(meshes,(-3.7,-.65,.08),0,.95)
    elif aid=='HERO_PANTRY_CAFE_V4_001': scene += transform(meshes,(-3.25,-2.75,.06),0,.95)
    elif aid=='HERO_WORKSTATION_CLUSTER_V4_001':
        scene += transform(meshes,(-.6,-.15,.06),0,1.0)
        scene += transform(meshes,(.8,-2.15,.06),180,.9)
    elif aid=='HERO_GLASS_MEETING_ROOM_V4_001':
        scene += transform(meshes,(2.85,1.55,.06),0,.95)
        scene += transform(meshes,(3.25,-1.65,.06),0,1.05)
# additional characters walking
scene += transform(person((0,0,0),'male','walking',M['shirt_blue'],M['skin2'],'walk_liam'),(-1.2,1.0,.06),-35,.9)
scene += transform(person((0,0,0),'female','walking',M['shirt_green'],M['skin1'],'walk_sophia'),(.75,.9,.06),25,.9)
scene += transform(person((0,0,0),'male','standing',M['shirt_blue'],M['skin2'],'ethan'),(-1.3,-2.9,.06),-10,.85)
# plants and divider around scene
for p,s in [((-5.05,2.6,.06),.9),((-4.9,-1.8,.06),.75),((5.25,2.9,.06),.75),((5.15,-2.9,.06),.85),((1.45,2.95,.06),.55)]:
    scene += plant(p,s,True,'scene_large_plant')
# labels over rooms and people
scene += transform([label_board('Design Room','4 in room')],(2.7,2.25,2.45),0,1)
scene += transform([label_board('Product Sync','5 in room')],(3.4,-.85,2.45),0,1)
# name tags as planes
for txt,pos in [('Olivia',(-2.95,1.05,1.6)),('Liam',(-.95,1.05,1.6)),('Sophia',(.8,.95,1.6)),('Noah',(-.85,-.95,1.6)),('Ethan',(-1.32,-2.95,1.55))]:
    img=Image.new('RGBA',(300,100),(24,30,40,220)); d=ImageDraw.Draw(img,'RGBA')
    d.rounded_rectangle((4,4,296,96),radius=28,fill=(24,30,40,225)); d.ellipse((28,36,50,58),fill=(65,210,110,255)); d.text((64,32),txt,font=FONT_MED,fill=(250,250,255,255))
    scene.append(textured_plane(.72,.24,pos,'y-',img,f'V4_NAME_{txt}','name_tag',emissive=[.02,.04,.05]))
# video icon on product room
scene.append(cyl(.24,.06,(2.35,-2.72,1.18),M['blue'],'video_icon_disc',sections=48,axis='y'))
scene.append(box((.2,.04,.14),(2.35,-2.75,1.18),M['white'],'video_cam_body'))
# normalize scene only to bottom center? keep relative and export
scene_from(scene).export(ROOT/'scenes/SCENE_ACME_HQ_HERO_V4_001.glb')
# vertical slice with only reception + glass + workstation
vs=[]
for aid,meshes in modules:
    if aid=='HERO_RECEPTION_LOBBY_V4_001': vs += transform(meshes,(-2.2,1.15,0),0,.95)
    if aid=='HERO_WORKSTATION_CLUSTER_V4_001': vs += transform(meshes,(.5,-.95,0),0,.95)
    if aid=='HERO_GLASS_MEETING_ROOM_V4_001': vs += transform(meshes,(2.3,1.0,0),0,.85)
scene_from(vs).export(ROOT/'scenes/SCENE_VERTICAL_SLICE_HERO_V4_001.glb')
# asset gallery scene
gallery=[]
for idx,(aid,meshes) in enumerate(modules):
    gallery += transform(meshes,((idx%3)*4.2-4.2, -(idx//3)*3.3,0),0,.8)
scene_from(gallery).export(ROOT/'scenes/SCENE_ASSET_GALLERY_HERO_V4_001.glb')

# -------- Renderer --------
def face_rgba(mesh): return mesh.metadata.get('rgba',(190,190,190,255))

def render_meshes(meshes, path, size=(900,640), label=None, bg=(222,226,230,0), shadow=True, supersample=2):
    # Re-enter if requested at supersampled size
    if supersample and supersample>1:
        tmp=Path(str(path)+'.tmp.png')
        render_meshes(meshes,tmp,(size[0]*supersample,size[1]*supersample),label,bg,shadow,1)
        im=Image.open(tmp).convert('RGBA').resize(size,Image.LANCZOS); tmp.unlink(missing_ok=True); im.save(path); return
    W,H=size; img=Image.new('RGBA',(W,H),bg); draw=ImageDraw.Draw(img,'RGBA')
    verts=[]
    for m in meshes:
        if len(m.vertices): verts.append(m.vertices)
    if not verts: img.save(path); return
    allv=np.vstack(verts); center=(allv.min(axis=0)+allv.max(axis=0))/2; extent=max(np.ptp(allv[:,0]),np.ptp(allv[:,1]),np.ptp(allv[:,2]),.1)
    cam=np.array([4.2,-5.0,3.2])*extent + center; target=center; f=(target-cam); f=f/np.linalg.norm(f)
    up=np.array([0,0,1.0]); right=np.cross(f,up); right=right/np.linalg.norm(right); up2=np.cross(right,f)
    def project(v):
        vv=v-target; return vv.dot(right), vv.dot(up2), vv.dot(f)
    proj=np.array([project(v)[:2] for v in allv]); span=max(proj.max(axis=0)-proj.min(axis=0))
    scale=min(W*.78,H*.78)/(span+1e-9); cx,cy=W/2,H*.55
    if shadow:
        draw.ellipse((W*.15,H*.75,W*.85,H*.94),fill=(0,0,0,28))
        draw.ellipse((W*.25,H*.77,W*.75,H*.9),fill=(0,0,0,22))
    light=np.array([-0.45,-0.6,1.0]); light=light/np.linalg.norm(light)
    faces=[]
    for m in meshes:
        rgba=face_rgba(m); verts=m.vertices
        for face in m.faces:
            tri=verts[face]
            n=np.cross(tri[1]-tri[0],tri[2]-tri[0]); nl=np.linalg.norm(n)
            if nl<1e-9: continue
            n=n/nl; depth=np.mean([project(v)[2] for v in tri]); pts=[]
            for v in tri:
                x,y,z=project(v); pts.append((cx+x*scale, cy-y*scale))
            shade=.55+.45*max(0,float(n.dot(light)))
            # emissive materials get boosted based on blue/warm names
            col=tuple(clamp(c*shade) for c in rgba[:3])+(rgba[3],)
            faces.append((depth,pts,col))
    faces.sort(key=lambda x:x[0])
    for _,pts,col in faces:
        if col[3] < 120:
            draw.polygon(pts,fill=col)
        else:
            draw.polygon(pts,fill=col)
    if label:
        draw.rounded_rectangle((16,16,W-16,58),radius=14,fill=(9,14,24,190))
        draw.text((32,26),label,font=FONT_SMALL,fill=(245,248,255,255))
    img.save(path)

# render module thumbs now that render exists? (We rendered earlier before definition - fix: re-render all v4 thumbnails)
for aid,meshes in modules:
    render_meshes(meshes, ROOT/'previews/v4/thumbnails'/f'{aid}.png', (760,540), label=aid)
for aid,meshes in CHAR_MESHES:
    render_meshes(meshes, ROOT/'previews/v4/thumbnails'/f'{aid}.png', (620,760), label=aid)
# Render scene and UI composite
render_meshes(scene, ROOT/'previews/v4/scene-acme-hq-hero-v4-render.png', (1920,1080), label='SCENE_ACME_HQ_HERO_V4_001', bg=(6,11,18,255), shadow=False, supersample=1)
render_meshes(vs, ROOT/'previews/v4/vertical-slice-v4-render.png', (1500,950), label='SCENE_VERTICAL_SLICE_HERO_V4_001', bg=(231,234,238,255), shadow=True)

# UI composite similar to supplied product screenshot
W,H=1920,1080
scene_img=Image.open(ROOT/'previews/v4/scene-acme-hq-hero-v4-render.png').convert('RGBA').resize((W,H),Image.LANCZOS)
base=Image.new('RGBA',(W,H),(5,10,18,255)); base.alpha_composite(scene_img,(0,0))
d=ImageDraw.Draw(base,'RGBA')
left_w=230; right_w=330; top_h=76
# dark side panels and top
d.rectangle((0,0,left_w,H),fill=(7,16,29,246)); d.rectangle((W-right_w,0,W,H),fill=(9,18,31,248)); d.rectangle((left_w,0,W-right_w,top_h),fill=(5,10,18,230))
d.rounded_rectangle((24,24,50,50),radius=7,fill=(34,52,76,255),outline=(112,140,180,130),width=2); d.text((72,22),'Virtual Office',font=FONT_BOLD,fill=(255,255,255,255)); d.text((315,27),'Acme Corp HQ⌄',font=FONT_MED,fill=(245,245,248,255))
items=['Office','Rooms','People','Chat','Events','Whiteboard','Files','Settings']; y=116
for item in items:
    if item=='Office': d.rounded_rectangle((18,y-10,left_w-18,y+42),radius=14,fill=(54,97,225,245))
    d.rectangle((36,y+5,56,y+25),outline=(196,212,235,210),width=2); d.text((78,y),item,font=FONT_SMALL,fill=(245,250,255,255)); y+=62
# minimap and online
panel_y=H-300
d.rounded_rectangle((18,panel_y,left_w-18,H-110),radius=18,fill=(18,29,45,232),outline=(70,90,120,120),width=2); d.text((36,panel_y+20),'Floor 1⌃',font=FONT_SMALL,fill=(255,255,255,255))
d.rectangle((48,panel_y+65,left_w-54,panel_y+145),outline=(88,105,130,180),width=3)
for p in [(88,panel_y+95),(130,panel_y+118),(155,panel_y+88),(180,panel_y+138),(112,panel_y+145),(147,panel_y+130),(95,panel_y+125)]: d.ellipse((p[0]-5,p[1]-5,p[0]+5,p[1]+5),fill=(50,120,255,255))
d.text((34,H-72),'●  29 People Online',font=FONT_SMALL,fill=(182,238,205,255))
# search and profile
d.rounded_rectangle((W-right_w-400,18,W-right_w-100,58),radius=10,fill=(7,13,22,225),outline=(70,86,110,130),width=1); d.text((W-right_w-365,28),'Search...        ⌘ K',font=FONT_SMALL,fill=(155,166,184,255))
d.ellipse((W-right_w-66,18,W-right_w-22,62),fill=(218,172,136,255)); d.text((W-right_w-10,27),'Ava Taylor  ● Online',font=FONT_SMALL,fill=(245,250,255,255))
# people panel
d.text((W-right_w+28,108),'People (29)',font=FONT_BOLD,fill=(255,255,255,255))
sections=[('In Office (18)',['Ava Taylor','Liam Chen','Sophia Patel','Noah Johnson','Olivia Kim']),('In a Meeting (5)',['Product Sync','Design Review']),('Online (6)',['Ethan Wright','Mia Davis'])]
y=160; colors=[(210,166,132),(130,170,145),(180,135,160),(115,160,210),(170,180,120)]
for sec,names in sections:
    d.text((W-right_w+28,y),sec+'⌄',font=FONT_SMALL,fill=(170,185,205,255)); y+=42
    for idx,n in enumerate(names):
        c=colors[idx%len(colors)]; d.ellipse((W-right_w+30,y,W-right_w+66,y+36),fill=c+(255,)); d.ellipse((W-right_w+60,y+26,W-right_w+72,y+38),fill=(65,210,110,255))
        d.text((W-right_w+82,y),n,font=FONT_SMALL,fill=(230,238,250,255)); d.text((W-right_w+82,y+22),'Online' if 'Sync' not in n and 'Review' not in n else '5 people',font=FONT_SMALL,fill=(140,155,175,255)); y+=56
    y+=16
# floating meeting video card
panel=(W-right_w-560,H-400,W-right_w-40,H-58)
d.rounded_rectangle(panel,radius=20,fill=(13,21,34,240),outline=(85,115,160,180),width=2)
d.text((panel[0]+24,panel[1]+20),'Product Sync  ',font=FONT_SMALL,fill=(255,255,255,255)); d.rounded_rectangle((panel[0]+126,panel[1]+18,panel[0]+176,panel[1]+39),radius=7,fill=(230,60,64,255)); d.text((panel[0]+134,panel[1]+21),'LIVE',font=FONT_SMALL,fill=(255,255,255,255)); d.text((panel[0]+190,panel[1]+21),'24:18',font=FONT_SMALL,fill=(220,230,244,255))
tile_w=150; tile_h=84; sx=panel[0]+30; sy=panel[1]+62; names=['Ava Taylor','Noah Johnson','Sophia Patel','Liam Chen','Olivia Kim']
for i,name in enumerate(names):
    x=sx+(i%3)*(tile_w+18); y0=sy+(i//3)*(tile_h+17); d.rounded_rectangle((x,y0,x+tile_w,y0+tile_h),radius=12,fill=(36,48,63,255),outline=(80,100,130,110),width=1)
    d.ellipse((x+48,y0+11,x+102,y0+65),fill=colors[i%len(colors)]+(255,)); d.rectangle((x,y0+58,x+tile_w,y0+tile_h),fill=(0,0,0,80)); d.text((x+10,y0+61),name,font=FONT_TINY,fill=(255,255,255,255))
for i,label in enumerate(['●','▣','☻','✋','…']):
    cx=panel[0]+55+i*62; cy=panel[3]-42; d.ellipse((cx-20,cy-20,cx+20,cy+20),fill=(28,39,56,255)); d.text((cx-5,cy-10),label,font=FONT_SMALL,fill=(235,242,255,255))
d.rounded_rectangle((panel[2]-76,panel[3]-62,panel[2]-24,panel[3]-24),radius=12,fill=(214,69,75,255)); d.text((panel[2]-58,panel[3]-56),'☎',font=FONT_SMALL,fill=(255,255,255,255))
# bottom hint
d.rounded_rectangle((W//2-235,H-84,W//2+235,H-38),radius=16,fill=(50,46,44,210),outline=(130,120,110,100),width=1); d.text((W//2-170,H-71),'Walk up to a room and press   E   to enter',font=FONT_SMALL,fill=(245,240,235,255))
# subtle vignette
v=Image.new('RGBA',(W,H),(0,0,0,0)); vd=ImageDraw.Draw(v,'RGBA'); vd.rectangle((0,0,W,H),outline=(0,0,0,100),width=50); v=v.filter(ImageFilter.GaussianBlur(55)); base.alpha_composite(v)
base.convert('RGB').save(ROOT/'previews/v4/hero-office-preview-v4.png',quality=95)
shutil.copy(ROOT/'previews/v4/hero-office-preview-v4.png','/mnt/data/hero-office-preview-v4.png')

# contact sheets
items=[]
for meta in V4_METAS:
    thumb=ROOT/meta.get('thumbnail','')
    if thumb.exists(): items.append((meta['asset_id'],thumb))
items.append(('SCENE_ACME_HQ_HERO_V4_001',ROOT/'previews/v4/hero-office-preview-v4.png'))
cell_w,cell_h=520,360; cols=3; rows=math.ceil(len(items)/cols)
sheet=Image.new('RGB',(cols*cell_w,rows*cell_h),(20,26,36)); dd=ImageDraw.Draw(sheet)
for idx,(name,path) in enumerate(items):
    im=Image.open(path).convert('RGBA'); im.thumbnail((cell_w-40,cell_h-76),Image.LANCZOS)
    x=(idx%cols)*cell_w; y=(idx//cols)*cell_h
    dd.rounded_rectangle((x+14,y+14,x+cell_w-14,y+cell_h-14),radius=18,fill=(32,40,54),outline=(80,105,142),width=2)
    sheet.paste(im,(x+(cell_w-im.width)//2,y+26),im if im.mode=='RGBA' else None)
    dd.text((x+24,y+cell_h-42),name,font=FONT_SMALL,fill=(235,242,255))
sheet.save(ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png','/mnt/data/asset-contact-sheet-v4.png')
# character contact
char_items=[(m['asset_id'],ROOT/m['thumbnail']) for m in V4_METAS if m['category']=='characters']
cell_w,cell_h=420,480; sheet2=Image.new('RGB',(len(char_items)*cell_w,cell_h),(22,28,38)); d2=ImageDraw.Draw(sheet2)
for idx,(name,path) in enumerate(char_items):
    im=Image.open(path).convert('RGBA'); im.thumbnail((cell_w-50,cell_h-90),Image.LANCZOS); x=idx*cell_w
    d2.rounded_rectangle((x+14,14,x+cell_w-14,cell_h-14),radius=18,fill=(32,40,54),outline=(80,105,142),width=2)
    sheet2.paste(im,(x+(cell_w-im.width)//2,30),im); d2.text((x+24,cell_h-48),name,font=FONT_SMALL,fill=(245,248,255))
sheet2.save(ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png','/mnt/data/character-contact-sheet-v4.png')

# registries
reg_path=ROOT/'registry/asset-registry.json'
try: reg=json.loads(reg_path.read_text(encoding='utf-8'))
except Exception: reg={'assets':[]}
reg['version']='4.0'; reg['name']='Virtual Office Production Asset Pack v4.0 Hero Refinement'; reg['quality_goal']='highest-quality procedural hero refinement aligned to supplied virtual office design: denser geometry, refined glass-room kits, richer materials, UI product preview and v4 hero modules.'
reg.setdefault('assets',[]); reg['assets'].extend(V4_METAS); reg['asset_count']=len(reg['assets'])
reg_path.write_text(json.dumps(reg,indent=2,ensure_ascii=False),encoding='utf-8')
pref_path=ROOT/'registry/prefab-registry.json'
try: pref=json.loads(pref_path.read_text(encoding='utf-8'))
except Exception: pref={'prefabs':[]}
pref['version']='4.0'; pref.setdefault('prefabs',[])
for meta in V4_METAS:
    pref['prefabs'].append({'prefab_id':meta['asset_id'].replace('HERO_','KIT_HERO_'),'version':'4.0','category':meta['category'],'file':meta['file'],'preview':meta.get('thumbnail'),'instances':[{'asset_id':meta['asset_id'],'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}],'anchors':meta.get('anchors',{}),'notes':meta.get('notes','')})
pref['prefabs'].append({'prefab_id':'KIT_ACME_HQ_HERO_SCENE_V4_001','version':'4.0','category':'hero_scene','room_type':'full_virtual_office','file':'scenes/SCENE_ACME_HQ_HERO_V4_001.glb','preview':'previews/v4/hero-office-preview-v4.png','notes':'v4 hero office scene assembled from refined modules.'})
pref_path.write_text(json.dumps(pref,indent=2,ensure_ascii=False),encoding='utf-8')
# material registry v4
mat_reg={'version':'4.0','materials':[{'id':k,'textures':v['paths']} for k,v in TEXTURES.items()]}
(ROOT/'registry/material-registry-v4.json').write_text(json.dumps(mat_reg,indent=2,ensure_ascii=False),encoding='utf-8')
# docs/reports
report=f'''# Virtual Office Production Asset Pack v4.0 — Hero Refinement Report\n\n## 제작 기준\n- 첨부 가상오피스 시안의 고급 오피스 분위기를 기준으로 v3를 폐기하지 않고, 전체 매니페스트는 유지하면서 핵심 시각 품질 구역을 v4 히어로 모듈로 교체/추가했습니다.\n- GLB 단위, meter scale, Z-up, bottom-center pivot, PBR material metadata 규칙을 유지했습니다.\n\n## v4 신규/고도화 에셋\n- HERO_RECEPTION_LOBBY_V4_001: 개별 목재 슬랫, 곡면 대리석 데스크, 발광 로고, 하부 간접조명, 데스크 소품, 리셉션 캐릭터.\n- HERO_GLASS_MEETING_ROOM_V4_001: 투명 유리 패널, 금속 프레임, 파란 emissive outline, 회의 테이블/의자/TV UI/회의 인물.\n- HERO_WORKSTATION_CLUSTER_V4_001: 4인 벤치 데스크, 플랜터 파티션, 듀얼 모니터, 키보드/마우스, 케이블, 컵/문서, 앉은 캐릭터.\n- HERO_LOUNGE_BLUE_AREA_V4_001: 블루 섹셔널 소파, 쿠션, 러그, 커피 테이블, 라운지 체어, 식물.\n- HERO_PANTRY_CAFE_V4_001: 대리석 바, 바스툴, 펜던트 조명, 커피머신, 정수기, 소품.\n- CHAR_MALE_HERO_V4_001 / CHAR_FEMALE_HERO_V4_001 / CHAR_RECEPTIONIST_HERO_V4_001.\n\n## 신규 씬\n- scenes/SCENE_ACME_HQ_HERO_V4_001.glb\n- scenes/SCENE_VERTICAL_SLICE_HERO_V4_001.glb\n- scenes/SCENE_ASSET_GALLERY_HERO_V4_001.glb\n\n## 한계와 후속 권장\n이 v4는 현재 환경에서 제작 가능한 절차적 GLB 고도화 버전입니다. 첨부 시안 수준의 완전한 런칭급/근접촬영급 포토리얼 퀄리티로 마감하려면 Blender/Maya/Substance Painter 기반 수작업 모델링, 고해상도 베이킹, 캐릭터 스켈레탈 리깅, 엔진 조명/HDRI/SSAO/Bloom 세팅을 후속으로 진행하는 것이 좋습니다.\n'''
(ROOT/'docs/v4-hero-refinement-report.md').write_text(report,encoding='utf-8')
readme=ROOT/'README.md'
readme.write_text(readme.read_text(encoding='utf-8')+"\n\n## v4.0 Hero Refinement\n\nSee `docs/v4-hero-refinement-report.md`. Main preview: `previews/v4/hero-office-preview-v4.png`. Main scene: `scenes/SCENE_ACME_HQ_HERO_V4_001.glb`.\n",encoding='utf-8')
# validation and polycount extension
rows=[['asset_id','triangle_count','file']]
for meta in V4_METAS: rows.append([meta['asset_id'],meta['triangle_count'],meta['file']])
with (ROOT/'qa/polycount-report-v4.csv').open('w',encoding='utf-8') as f:
    for r in rows: f.write(','.join(map(str,r))+'\n')
val={'version':'4.0','checks':{'v4_hero_modules':len([m for m in V4_METAS if m['category']=='hero']),'v4_characters':len([m for m in V4_METAS if m['category']=='characters']),'main_scene_glb_exists':(ROOT/'scenes/SCENE_ACME_HQ_HERO_V4_001.glb').exists(),'preview_png_exists':(ROOT/'previews/v4/hero-office-preview-v4.png').exists()},'notes':['v4 package includes full v3 manifest assets plus v4 hero-quality replacement modules and scenes.']}
(ROOT/'qa/validation-report-v4.json').write_text(json.dumps(val,indent=2,ensure_ascii=False),encoding='utf-8')
# top-level copies for easy download
shutil.copy(ROOT/'previews/v4/hero-office-preview-v4.png',ROOT/'hero-office-preview-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png',ROOT/'asset-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png',ROOT/'character-contact-sheet-v4.png')
# preview png zip
pngzip=Path('/mnt/data/virtual_office_v4_preview_pngs.zip')
if pngzip.exists(): pngzip.unlink()
with zipfile.ZipFile(pngzip,'w',zipfile.ZIP_DEFLATED) as z:
    for p in [ROOT/'previews/v4/hero-office-preview-v4.png', ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png', ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png', ROOT/'previews/v4/vertical-slice-v4-render.png']:
        z.write(p, p.name)
# final zip
if ZIP_PATH.exists(): ZIP_PATH.unlink()
with zipfile.ZipFile(ZIP_PATH,'w',zipfile.ZIP_DEFLATED) as z:
    for p in ROOT.rglob('*'):
        z.write(p, p.relative_to(ROOT.parent))
print('created', ZIP_PATH, ZIP_PATH.stat().st_size)
print('root', ROOT)
