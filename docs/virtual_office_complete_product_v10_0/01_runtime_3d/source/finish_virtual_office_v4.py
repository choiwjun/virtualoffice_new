import json, math, zipfile, shutil, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path('/mnt/data/virtual_office_production_assets_v4_0')
ZIP_PATH = Path('/mnt/data/virtual_office_production_assets_v4_0.zip')
PREVIEW_ZIP = Path('/mnt/data/virtual_office_v4_preview_pngs.zip')
for d in ['previews/v4','previews/v4/contact_sheets','previews/v4/thumbnails','docs','registry','qa','ui/v4_png','source']:
    (ROOT/d).mkdir(parents=True, exist_ok=True)

try:
    FONT_HUGE = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 54)
    FONT_BOLD = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26)
    FONT_MED = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
    FONT_SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
    FONT_TINY = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
except Exception:
    FONT_HUGE=FONT_BOLD=FONT_MED=FONT_SMALL=FONT_TINY=None

# Load v4 metadata created by the generation pass
v4_metas=[]
for p in sorted((ROOT/'metadata/v4_assets').glob('*.meta.json')):
    try:
        v4_metas.append(json.loads(p.read_text(encoding='utf-8')))
    except Exception:
        pass

# Update asset registry
reg_path=ROOT/'registry/asset-registry.json'
try:
    reg=json.loads(reg_path.read_text(encoding='utf-8'))
except Exception:
    reg={'assets':[]}
reg['version']='4.0'
reg['name']='Virtual Office Production Asset Pack v4.0 Hero Refinement'
reg['quality_goal']='Reference-aligned v4 hero refinement: full v3 manifest retained, plus upgraded v4 hero GLB modules, richer PBR texture sets, full ACME HQ hero scene, and product-style UI preview.'
seen={a.get('asset_id') for a in reg.get('assets',[])}
for m in v4_metas:
    if m.get('asset_id') not in seen:
        reg.setdefault('assets',[]).append(m); seen.add(m.get('asset_id'))
reg['asset_count']=len(reg.get('assets',[]))
reg_path.write_text(json.dumps(reg,indent=2,ensure_ascii=False),encoding='utf-8')

# Update prefab registry
pref_path=ROOT/'registry/prefab-registry.json'
try:
    pref=json.loads(pref_path.read_text(encoding='utf-8'))
except Exception:
    pref={'prefabs':[]}
pref['version']='4.0'
seen_pref={p.get('prefab_id') for p in pref.get('prefabs',[])}
for m in v4_metas:
    fid='KIT_'+m['asset_id']
    if fid not in seen_pref:
        pref.setdefault('prefabs',[]).append({
            'prefab_id':fid,'version':'4.0','category':m.get('category'),'file':m.get('file'),'preview':m.get('thumbnail'),
            'instances':[{'asset_id':m['asset_id'],'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}],
            'anchors':m.get('anchors',{}),'notes':m.get('notes','')
        })
        seen_pref.add(fid)
scene_pref='KIT_ACME_HQ_HERO_SCENE_V4_001'
if scene_pref not in seen_pref:
    pref.setdefault('prefabs',[]).append({'prefab_id':scene_pref,'version':'4.0','category':'hero_scene','room_type':'full_virtual_office','file':'scenes/SCENE_ACME_HQ_HERO_V4_001.glb','preview':'previews/v4/hero-office-preview-v4.png','notes':'Main v4 office scene assembled from refined hero modules.'})
pref_path.write_text(json.dumps(pref,indent=2,ensure_ascii=False),encoding='utf-8')

# Material registry v4 from saved texture folders
mat_items=[]
for tex_dir in sorted((ROOT/'materials/v4_pbr').glob('*')):
    if tex_dir.is_dir():
        files=[str(p.relative_to(ROOT)) for p in sorted(tex_dir.glob('*.png'))]
        mat_items.append({'id':tex_dir.name.upper(),'textures':files})
(ROOT/'registry/material-registry-v4.json').write_text(json.dumps({'version':'4.0','materials':mat_items},indent=2,ensure_ascii=False),encoding='utf-8')

# ---------- High quality vector/product preview ----------
def make_preview(path):
    S=2
    W,H=1920*S,1080*S
    img=Image.new('RGBA',(W,H),(5,10,18,255))
    d=ImageDraw.Draw(img,'RGBA')
    def sc(v): return int(v*S)
    def P(x,y,z=0):
        # isometric projection tuned to product screenshot composition
        return (sc(900 + (x-y)*86), sc(495 + (x+y)*40 - z*95))
    def poly(points, fill, outline=None, width=1):
        pts=[P(*p) for p in points]
        d.polygon(pts,fill=fill)
        if outline: d.line(pts+[pts[0]],fill=outline,width=sc(width),joint='curve')
    def glow_line(points, color, width=4, blur=10):
        layer=Image.new('RGBA',(W,H),(0,0,0,0)); ld=ImageDraw.Draw(layer,'RGBA')
        pts=[P(*p) for p in points]
        ld.line(pts,fill=color,width=sc(width),joint='curve')
        layer=layer.filter(ImageFilter.GaussianBlur(sc(blur)))
        img.alpha_composite(layer)
        d.line(pts,fill=color,width=sc(max(1,width//2)),joint='curve')
    def iso_box(x,y,w,dpth,h,color,top=None,side=None,outline=(20,26,34,120)):
        top=top or tuple(min(255,c+24) for c in color[:3])+(color[3],)
        side=side or tuple(max(0,c-38) for c in color[:3])+(color[3],)
        poly([(x,y,h),(x+w,y,h),(x+w,y+dpth,h),(x,y+dpth,h)],top,outline,1)
        poly([(x,y,0),(x+w,y,0),(x+w,y,h),(x,y,h)],side,outline,1)
        poly([(x+w,y,0),(x+w,y+dpth,0),(x+w,y+dpth,h),(x+w,y,h)],tuple(max(0,c-22) for c in color[:3])+(color[3],),outline,1)
    def label(text,sub,x,y,z,w=180):
        px,py=P(x,y,z)
        box=(px-sc(w/2),py-sc(42),px+sc(w/2),py+sc(24))
        d.rounded_rectangle(box,radius=sc(16),fill=(18,24,34,235),outline=(82,105,140,150),width=sc(2))
        d.text((box[0]+sc(18),box[1]+sc(10)),text,font=FONT_SMALL,fill=(255,255,255,255))
        d.text((box[0]+sc(18),box[1]+sc(34)),sub,font=FONT_TINY,fill=(170,185,205,255))
    def name_tag(text,x,y,z):
        px,py=P(x,y,z)
        box=(px-sc(55),py-sc(23),px+sc(55),py+sc(18))
        d.rounded_rectangle(box,radius=sc(18),fill=(24,30,40,230))
        d.ellipse((box[0]+sc(12),box[1]+sc(15),box[0]+sc(24),box[1]+sc(27)),fill=(65,210,110,255))
        d.text((box[0]+sc(32),box[1]+sc(11)),text,font=FONT_TINY,fill=(245,250,255,255))
    def person2d(x,y,color=(40,85,140),skin=(215,165,128)):
        px,py=P(x,y,.1)
        d.ellipse((px-sc(8),py-sc(62),px+sc(8),py-sc(46)),fill=skin+(255,))
        d.rounded_rectangle((px-sc(10),py-sc(46),px+sc(10),py-sc(18)),radius=sc(7),fill=color+(255,))
        d.line((px-sc(7),py-sc(18),px-sc(12),py),fill=(28,30,36,255),width=sc(4))
        d.line((px+sc(7),py-sc(18),px+sc(14),py),fill=(28,30,36,255),width=sc(4))
        d.line((px-sc(10),py-sc(40),px-sc(20),py-sc(25)),fill=color+(255,),width=sc(4))
        d.line((px+sc(10),py-sc(40),px+sc(18),py-sc(30)),fill=color+(255,),width=sc(4))
    def plant2d(x,y,s=1.0):
        px,py=P(x,y,.04)
        d.ellipse((px-sc(15*s),py-sc(9*s),px+sc(15*s),py+sc(9*s)),fill=(220,220,205,255))
        for i in range(10):
            ang=2*math.pi*i/10
            ex=px+math.cos(ang)*sc(18*s); ey=py-sc(30*s)+math.sin(ang)*sc(8*s)
            d.ellipse((ex-sc(9*s),ey-sc(18*s),ex+sc(9*s),ey+sc(18*s)),fill=(42,125,62,235))
    # central scene area
    # shadow base
    shadow=Image.new('RGBA',(W,H),(0,0,0,0)); sd=ImageDraw.Draw(shadow,'RGBA')
    sd.polygon([P(-6,-4,0),P(6,-4,0),P(6,4,0),P(-6,4,0)],fill=(0,0,0,80))
    shadow=shadow.filter(ImageFilter.GaussianBlur(sc(30))); img.alpha_composite(shadow)
    # floor zones
    poly([(-6,-4,0),(6,-4,0),(6,4,0),(-6,4,0)],(142,145,145,255),(42,48,55,200),2)
    poly([(-5.8,-3.8,.01),(-1.2,-3.8,.01),(-1.2,-1.3,.01),(-5.8,-1.3,.01)],(119,75,42,255),(42,48,55,130),1)
    for x in [i*.9-5.4 for i in range(13)]:
        d.line([P(x,-3.9,.02),P(x,3.8,.02)],fill=(68,73,78,90),width=sc(1))
    for y in [i*.85-3.4 for i in range(9)]:
        d.line([P(-5.8,y,.02),P(5.8,y,.02)],fill=(68,73,78,90),width=sc(1))
    # reception wall and desk
    iso_box(-5.4,2.1,3.7,.18,2.1,(96,58,34,255),(137,84,44,255))
    for i in range(22):
        x=-5.25+i*.16; iso_box(x,2.0,.035,.15,2.28,(118,69,37,255),(162,94,50,255))
    glow_line([(-5.3,1.98,2.25),(-1.9,1.98,2.25)],(255,222,145,190),7,12)
    px,py=P(-3.6,1.92,1.35); d.text((px-sc(100),py-sc(45)),'ACME',font=FONT_HUGE,fill=(245,250,255,255)); d.text((px-sc(78),py+sc(20)),'CORPORATION',font=FONT_MED,fill=(205,220,245,255))
    iso_box(-4.35,.8,2.35,.75,.75,(222,220,210,255),(255,255,248,255))
    glow_line([(-4.22,.76,.15),(-2.15,.76,.15)],(255,220,142,190),5,10)
    # lobby shelf and sofa
    iso_box(-2.0,1.8,.9,.38,1.5,(80,48,28,255),(120,74,42,255))
    for k in range(4): iso_box(-1.95,1.82+k*.01,.8,.03,.45+k*.35,(88,54,31,255))
    iso_box(-5.1,-.65,1.4,.65,.38,(88,96,105,255),(120,130,140,255))
    iso_box(-4.8,-.95,1.3,.08,.55,(72,84,96,255),(92,105,120,255))
    poly([(-5.4,-1.15,.02),(-3.4,-1.15,.02),(-3.4,.0,.02),(-5.4,.0,.02)],(62,84,116,240),(105,130,165,160),1)
    # pantry
    iso_box(-5.2,-3.25,3.0,.9,.72,(221,218,211,255),(255,255,250,255))
    glow_line([(-5.05,-3.3,.18),(-2.35,-3.3,.18)],(255,220,142,165),6,10)
    for x in [-4.7,-3.9,-3.1]:
        iso_box(x,-3.8,.32,.32,.55,(25,55,90,255),(45,86,132,255)); d.ellipse((P(x+.16,-3.64,.65)[0]-sc(12),P(x+.16,-3.64,.65)[1]-sc(8),P(x+.16,-3.64,.65)[0]+sc(12),P(x+.16,-3.64,.65)[1]+sc(8)),fill=(35,38,45,255))
    # workstation clusters
    def workstation(x,y):
        iso_box(x,y,3.0,1.15,.72,(179,112,54,255),(213,143,77,255))
        iso_box(x+.1,y+.46,2.8,.18,.96,(190,195,185,255),(230,230,215,255))
        for ix in [x+.55,x+1.5,x+2.45]:
            iso_box(ix,y+.05,.08,.18,.45,(20,24,30,255))
            iso_box(ix-.22,y+.12,.45,.05,.28,(16,25,38,255),(24,42,65,255))
            iso_box(ix-.24,y+.75,.45,.05,.28,(16,25,38,255),(24,42,65,255))
        for ix,iy in [(x+.6,y-.55),(x+2.4,y-.55),(x+.6,y+1.3),(x+2.4,y+1.3)]:
            iso_box(ix,iy,.45,.42,.55,(28,30,36,255),(45,47,54,255));
        plant2d(x+.55,y+.55,.55); plant2d(x+1.55,y+.55,.55); plant2d(x+2.4,y+.55,.55)
    workstation(-1.35,-.85); workstation(.3,-2.65)
    # glass rooms
    def glass_room(x,y,w=3.25,dpth=2.15,cap='Product Sync'):
        # translucent floor
        poly([(x,y,.03),(x+w,y,.03),(x+w,y+dpth,.03),(x,y+dpth,.03)],(116,135,145,120),(60,85,110,180),1)
        # furniture inside
        iso_box(x+.75,y+.65,1.75,.75,.65,(180,112,55,255),(215,145,78,255))
        for ix in [x+.55,x+1.25,x+2.0,x+2.65]: iso_box(ix,y+.15,.35,.35,.45,(28,30,38,255),(45,48,58,255))
        for ix in [x+.55,x+1.25,x+2.0,x+2.65]: iso_box(ix,y+1.6,.35,.35,.45,(28,30,38,255),(45,48,58,255))
        # glass walls
        poly([(x,y,0),(x+w,y,0),(x+w,y,1.85),(x,y,1.85)],(120,190,220,55),(40,62,78,180),2)
        poly([(x+w,y,0),(x+w,y+dpth,0),(x+w,y+dpth,1.85),(x+w,y,1.85)],(120,190,220,45),(40,62,78,180),2)
        poly([(x,y+dpth,0),(x+w,y+dpth,0),(x+w,y+dpth,1.85),(x,y+dpth,1.85)],(120,190,220,38),(40,62,78,160),2)
        glow_line([(x,y,1.9),(x+w,y,1.9),(x+w,y+dpth,1.9),(x,y+dpth,1.9),(x,y,1.9)],(45,135,255,220),8,15)
        label(cap,'5 in room',x+w*.55,y-.1,2.35,190)
    glass_room(2.1,.25,3.2,2.2,'Design Room')
    glass_room(2.55,-2.85,3.4,2.3,'Product Sync')
    # lounge sofa and plants
    iso_box(-5.2,-.3,1.75,.75,.38,(27,55,88,255),(44,80,118,255))
    iso_box(-5.0,.18,1.55,.12,.65,(24,49,80,255),(40,74,112,255))
    iso_box(-4.6,-1.1,.72,.55,.34,(211,146,77,255),(232,168,90,255))
    for x0,y0,s0 in [(-5.65,1.5,1.05),(-.6,1.8,.75),(-1.9,-.2,.75),(5.45,2.5,.9),(5.2,-2.8,.85),(-5.4,-2.0,.8)]:
        plant2d(x0,y0,s0)
    # people and tags
    people=[('Olivia',-2.9,.4,(64,100,135)),('Liam',-.6,.85,(70,112,80)),('Sophia',.8,.3,(55,80,120)),('Noah',-1.0,-1.25,(42,70,105)),('Ethan',-1.6,-3.2,(38,95,155))]
    for n,x,y,c in people:
        person2d(x,y,c); name_tag(n,x,y,.95)
    # video icon
    vx,vy=P(2.2,-3.2,1.1); d.ellipse((vx-sc(28),vy-sc(28),vx+sc(28),vy+sc(28)),fill=(58,120,255,240),outline=(200,230,255,255),width=sc(4))
    d.rectangle((vx-sc(10),vy-sc(8),vx+sc(8),vy+sc(8)),fill=(255,255,255,255)); d.polygon([(vx+sc(8),vy-sc(6)),(vx+sc(20),vy-sc(12)),(vx+sc(20),vy+sc(12)),(vx+sc(8),vy+sc(6))],fill=(255,255,255,255))
    # UI panels
    left_w=230*S; right_w=330*S; top_h=76*S
    d.rectangle((0,0,left_w,H),fill=(7,16,29,246)); d.rectangle((W-right_w,0,W,H),fill=(9,18,31,248)); d.rectangle((left_w,0,W-right_w,top_h),fill=(5,10,18,235))
    d.rounded_rectangle((24*S,24*S,50*S,50*S),radius=7*S,fill=(34,52,76,255),outline=(112,140,180,130),width=2*S)
    d.text((72*S,21*S),'Virtual Office',font=FONT_BOLD,fill=(255,255,255,255)); d.text((315*S,27*S),'Acme Corp HQ⌄',font=FONT_MED,fill=(245,245,248,255))
    items=['Office','Rooms','People','Chat','Events','Whiteboard','Files','Settings']; yy=116*S
    for item in items:
        if item=='Office': d.rounded_rectangle((18*S,yy-10*S,left_w-18*S,yy+42*S),radius=14*S,fill=(54,97,225,245))
        d.rectangle((36*S,yy+5*S,56*S,yy+25*S),outline=(196,212,235,210),width=2*S); d.text((78*S,yy),item,font=FONT_SMALL,fill=(245,250,255,255)); yy+=62*S
    # minimap
    panel_y=(H-300*S); d.rounded_rectangle((18*S,panel_y,left_w-18*S,H-110*S),radius=18*S,fill=(18,29,45,232),outline=(70,90,120,120),width=2*S); d.text((36*S,panel_y+20*S),'Floor 1⌃',font=FONT_SMALL,fill=(255,255,255,255)); d.rectangle((48*S,panel_y+65*S,left_w-54*S,panel_y+145*S),outline=(88,105,130,180),width=3*S)
    for px0,py0 in [(88,panel_y//S+95),(130,panel_y//S+118),(155,panel_y//S+88),(180,panel_y//S+138),(112,panel_y//S+145),(147,panel_y//S+130),(95,panel_y//S+125)]: d.ellipse((px0*S-5*S,py0*S-5*S,px0*S+5*S,py0*S+5*S),fill=(50,120,255,255))
    d.text((34*S,H-72*S),'●  29 People Online',font=FONT_SMALL,fill=(182,238,205,255))
    # search and profile
    d.rounded_rectangle((W-right_w-400*S,18*S,W-right_w-100*S,58*S),radius=10*S,fill=(7,13,22,225),outline=(70,86,110,130),width=1*S); d.text((W-right_w-365*S,28*S),'Search...        ⌘ K',font=FONT_SMALL,fill=(155,166,184,255))
    d.ellipse((W-right_w-66*S,18*S,W-right_w-22*S,62*S),fill=(218,172,136,255)); d.text((W-right_w-10*S,27*S),'Ava Taylor  ● Online',font=FONT_SMALL,fill=(245,250,255,255))
    # right people
    d.text((W-right_w+28*S,108*S),'People (29)',font=FONT_BOLD,fill=(255,255,255,255))
    sections=[('In Office (18)',['Ava Taylor','Liam Chen','Sophia Patel','Noah Johnson','Olivia Kim']),('In a Meeting (5)',['Product Sync','Design Review']),('Online (6)',['Ethan Wright','Mia Davis'])]
    yy=160*S; cols=[(210,166,132),(130,170,145),(180,135,160),(115,160,210),(170,180,120)]
    for sec,names in sections:
        d.text((W-right_w+28*S,yy),sec+'⌄',font=FONT_SMALL,fill=(170,185,205,255)); yy+=42*S
        for idx,n in enumerate(names):
            c=cols[idx%len(cols)]; d.ellipse((W-right_w+30*S,yy,W-right_w+66*S,yy+36*S),fill=c+(255,)); d.ellipse((W-right_w+60*S,yy+26*S,W-right_w+72*S,yy+38*S),fill=(65,210,110,255))
            d.text((W-right_w+82*S,yy),n,font=FONT_SMALL,fill=(230,238,250,255)); d.text((W-right_w+82*S,yy+22*S),'Online' if 'Sync' not in n and 'Review' not in n else '5 people',font=FONT_SMALL,fill=(140,155,175,255)); yy+=56*S
        yy+=16*S
    # video panel
    panel=(W-right_w-560*S,H-400*S,W-right_w-40*S,H-58*S)
    d.rounded_rectangle(panel,radius=20*S,fill=(13,21,34,240),outline=(85,115,160,180),width=2*S)
    d.text((panel[0]+24*S,panel[1]+20*S),'Product Sync  ',font=FONT_SMALL,fill=(255,255,255,255)); d.rounded_rectangle((panel[0]+126*S,panel[1]+18*S,panel[0]+176*S,panel[1]+39*S),radius=7*S,fill=(230,60,64,255)); d.text((panel[0]+134*S,panel[1]+21*S),'LIVE',font=FONT_SMALL,fill=(255,255,255,255)); d.text((panel[0]+190*S,panel[1]+21*S),'24:18',font=FONT_SMALL,fill=(220,230,244,255))
    tile_w=150*S; tile_h=84*S; sx=panel[0]+30*S; sy=panel[1]+62*S; names=['Ava Taylor','Noah Johnson','Sophia Patel','Liam Chen','Olivia Kim']
    for i,n in enumerate(names):
        x=sx+(i%3)*(tile_w+18*S); y0=sy+(i//3)*(tile_h+17*S); d.rounded_rectangle((x,y0,x+tile_w,y0+tile_h),radius=12*S,fill=(36,48,63,255),outline=(80,100,130,110),width=1*S)
        d.ellipse((x+48*S,y0+11*S,x+102*S,y0+65*S),fill=cols[i%len(cols)]+(255,)); d.rectangle((x,y0+58*S,x+tile_w,y0+tile_h),fill=(0,0,0,80)); d.text((x+10*S,y0+61*S),n,font=FONT_TINY,fill=(255,255,255,255))
    for i,label_sym in enumerate(['●','▣','☻','✋','…']):
        cx=panel[0]+55*S+i*62*S; cy=panel[3]-42*S; d.ellipse((cx-20*S,cy-20*S,cx+20*S,cy+20*S),fill=(28,39,56,255)); d.text((cx-5*S,cy-10*S),label_sym,font=FONT_SMALL,fill=(235,242,255,255))
    d.rounded_rectangle((panel[2]-76*S,panel[3]-62*S,panel[2]-24*S,panel[3]-24*S),radius=12*S,fill=(214,69,75,255));
    d.rounded_rectangle((W//2-235*S,H-84*S,W//2+235*S,H-38*S),radius=16*S,fill=(50,46,44,210),outline=(130,120,110,100),width=1*S); d.text((W//2-170*S,H-71*S),'Walk up to a room and press   E   to enter',font=FONT_SMALL,fill=(245,240,235,255))
    # vignette / downscale
    v=Image.new('RGBA',(W,H),(0,0,0,0)); vd=ImageDraw.Draw(v,'RGBA'); vd.rectangle((0,0,W,H),outline=(0,0,0,120),width=100*S); v=v.filter(ImageFilter.GaussianBlur(45*S)); img.alpha_composite(v)
    img=img.convert('RGB').resize((1920,1080),Image.LANCZOS)
    img.save(path,quality=95)

make_preview(ROOT/'previews/v4/hero-office-preview-v4.png')
shutil.copy(ROOT/'previews/v4/hero-office-preview-v4.png','/mnt/data/hero-office-preview-v4.png')
shutil.copy(ROOT/'previews/v4/hero-office-preview-v4.png',ROOT/'hero-office-preview-v4.png')

# Make simplified thumbnails/contact sheets
def module_thumb(asset_id, path, color):
    W,H=760,540
    im=Image.new('RGBA',(W,H),(230,233,238,255)); d=ImageDraw.Draw(im,'RGBA')
    d.rounded_rectangle((24,24,W-24,H-24),radius=26,fill=(247,248,250,255),outline=(105,118,138,120),width=2)
    # sketchy isometric icon from asset type
    cx,cy=W//2,H//2+20
    def p(x,y,z=0): return (cx+(x-y)*56, cy+(x+y)*26-z*65)
    def ib(x,y,w,dpth,h,fill):
        pts=[p(x,y,h),p(x+w,y,h),p(x+w,y+dpth,h),p(x,y+dpth,h)]
        d.polygon(pts,fill=tuple(min(255,c+25) for c in fill[:3])+(255,),outline=(52,62,78,150))
        d.polygon([p(x,y,0),p(x+w,y,0),p(x+w,y,h),p(x,y,h)],fill=fill+(255,),outline=(52,62,78,120))
        d.polygon([p(x+w,y,0),p(x+w,y+dpth,0),p(x+w,y+dpth,h),p(x+w,y,h)],fill=tuple(max(0,c-30) for c in fill)+(255,),outline=(52,62,78,120))
    if 'RECEPTION' in asset_id:
        ib(-1.8,.3,3.3,.18,1.5,(120,72,40)); ib(-1.0,-.6,2.0,.65,.55,(220,217,210));
        d.text((cx-70,cy-115),'ACME',font=FONT_HUGE,fill=(240,245,255,255))
    elif 'GLASS' in asset_id:
        ib(-1.7,-.9,3.4,2.0,.02,(120,140,145));
        for pts in [[(-1.7,-.9,1.4),(1.7,-.9,1.4),(1.7,1.1,1.4),(-1.7,1.1,1.4),(-1.7,-.9,1.4)]]:
            d.line([p(*q) for q in pts],fill=(45,135,255,255),width=5)
        ib(-.8,-.25,1.6,.65,.45,(185,116,60))
    elif 'WORKSTATION' in asset_id:
        ib(-1.8,-.6,3.3,1.2,.55,(190,120,60)); ib(-1.6,-.05,3.0,.18,.85,(190,195,185))
        for x in [-1.2,0,1.2]: ib(x,-.55,.42,.06,.35,(18,25,36))
    elif 'LOUNGE' in asset_id:
        ib(-1.5,-.8,3.0,1.6,.02,(60,82,116)); ib(-1.1,-.15,2.2,.65,.42,(28,55,88)); ib(-.4,-.8,.8,.6,.34,(210,145,76))
    elif 'PANTRY' in asset_id:
        ib(-1.6,-.5,3.1,.9,.65,(220,217,210));
        for x in [-1.0,0,1.0]: ib(x,-1.0,.35,.3,.4,(35,70,110))
    elif 'CHAR' in asset_id:
        d.ellipse((cx-40,cy-150,cx+40,cy-70),fill=(210,160,125,255)); d.rounded_rectangle((cx-48,cy-70,cx+48,cy+60),radius=24,fill=color+(255,)); d.line((cx-28,cy+60,cx-52,cy+150),fill=(30,34,42,255),width=12); d.line((cx+28,cy+60,cx+52,cy+150),fill=(30,34,42,255),width=12)
    d.rounded_rectangle((24,24,W-24,66),radius=14,fill=(12,18,28,190)); d.text((42,34),asset_id,font=FONT_SMALL,fill=(245,248,255,255))
    im.convert('RGB').save(path,quality=92)

for m in v4_metas:
    path=ROOT/m.get('thumbnail',f'previews/v4/thumbnails/{m["asset_id"]}.png')
    path.parent.mkdir(parents=True,exist_ok=True)
    module_thumb(m['asset_id'],path,(48,88,140))

# asset contact sheet
items=[]
for m in v4_metas:
    p=ROOT/m.get('thumbnail','')
    if p.exists(): items.append((m['asset_id'],p))
items.append(('SCENE_ACME_HQ_HERO_V4_001',ROOT/'previews/v4/hero-office-preview-v4.png'))
cell_w,cell_h=520,360; cols=3; rows=math.ceil(len(items)/cols)
sheet=Image.new('RGB',(cols*cell_w,rows*cell_h),(20,26,36)); d=ImageDraw.Draw(sheet)
for idx,(name,p) in enumerate(items):
    im=Image.open(p).convert('RGBA'); im.thumbnail((cell_w-40,cell_h-76),Image.LANCZOS)
    x=(idx%cols)*cell_w; y=(idx//cols)*cell_h
    d.rounded_rectangle((x+14,y+14,x+cell_w-14,y+cell_h-14),radius=18,fill=(32,40,54),outline=(80,105,142),width=2)
    sheet.paste(im,(x+(cell_w-im.width)//2,y+26),im)
    d.text((x+24,y+cell_h-42),name,font=FONT_SMALL,fill=(235,242,255))
sheet.save(ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png','/mnt/data/asset-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png',ROOT/'asset-contact-sheet-v4.png')

# character contact sheet
chars=[m for m in v4_metas if m.get('category')=='characters']
cell_w,cell_h=420,480
sheet2=Image.new('RGB',(max(1,len(chars))*cell_w,cell_h),(22,28,38)); d=ImageDraw.Draw(sheet2)
for idx,m in enumerate(chars):
    p=ROOT/m['thumbnail']; im=Image.open(p).convert('RGBA'); im.thumbnail((cell_w-50,cell_h-90),Image.LANCZOS)
    x=idx*cell_w
    d.rounded_rectangle((x+14,14,x+cell_w-14,cell_h-14),radius=18,fill=(32,40,54),outline=(80,105,142),width=2)
    sheet2.paste(im,(x+(cell_w-im.width)//2,30),im)
    d.text((x+24,cell_h-48),m['asset_id'],font=FONT_SMALL,fill=(245,248,255))
sheet2.save(ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png','/mnt/data/character-contact-sheet-v4.png')
shutil.copy(ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png',ROOT/'character-contact-sheet-v4.png')

# docs and qa
report='''# Virtual Office Production Asset Pack v4.0 — Hero Refinement Report

## 핵심 변경
- v3 전체 매니페스트 에셋을 유지하면서 v4 히어로 모듈을 추가했습니다.
- 리셉션, 유리 회의실, 워크스테이션, 라운지, 팬트리, 캐릭터를 우선 고도화했습니다.
- v4 GLB는 `models/v4_hero/`, 캐릭터는 `models/v4_characters/`, 메타데이터는 `metadata/v4_assets/`에 있습니다.
- 메인 씬은 `scenes/SCENE_ACME_HQ_HERO_V4_001.glb`입니다.

## v4 신규 에셋
- HERO_RECEPTION_LOBBY_V4_001
- HERO_GLASS_MEETING_ROOM_V4_001
- HERO_WORKSTATION_CLUSTER_V4_001
- HERO_LOUNGE_BLUE_AREA_V4_001
- HERO_PANTRY_CAFE_V4_001
- CHAR_MALE_HERO_V4_001
- CHAR_FEMALE_HERO_V4_001
- CHAR_RECEPTIONIST_HERO_V4_001

## 현실적인 주의점
현재 파일은 개발에서 바로 로딩 가능한 절차적 GLB 고도화 패키지입니다. 첨부 시안의 완전한 런칭급 포토리얼 수준까지 마감하려면 Blender/Maya/Substance Painter 수작업 디테일링, 캐릭터 스켈레탈 리깅, 엔진 조명/HDRI/SSAO/Bloom 세팅이 필요합니다.
'''
(ROOT/'docs/v4-hero-refinement-report.md').write_text(report,encoding='utf-8')
readme=ROOT/'README.md'
if 'v4.0 Hero Refinement' not in readme.read_text(encoding='utf-8'):
    readme.write_text(readme.read_text(encoding='utf-8')+'\n\n## v4.0 Hero Refinement\n\nMain scene: `scenes/SCENE_ACME_HQ_HERO_V4_001.glb`. Main preview: `previews/v4/hero-office-preview-v4.png`. See `docs/v4-hero-refinement-report.md`.\n',encoding='utf-8')
rows=[['asset_id','triangle_count','file']]
for m in v4_metas:
    rows.append([m.get('asset_id'),m.get('triangle_count'),m.get('file')])
(ROOT/'qa/polycount-report-v4.csv').write_text('\n'.join(','.join(map(str,r)) for r in rows),encoding='utf-8')
(ROOT/'qa/validation-report-v4.json').write_text(json.dumps({'version':'4.0','checks':{'v4_assets':len(v4_metas),'main_scene_exists':(ROOT/'scenes/SCENE_ACME_HQ_HERO_V4_001.glb').exists(),'preview_exists':(ROOT/'previews/v4/hero-office-preview-v4.png').exists()},'notes':['Full v3 package retained; v4 hero modules added.']},indent=2,ensure_ascii=False),encoding='utf-8')
shutil.copy('/mnt/data/create_virtual_office_v4.py', ROOT/'source/create_virtual_office_v4.py')
shutil.copy('/mnt/data/finish_virtual_office_v4.py', ROOT/'source/finish_virtual_office_v4.py')
# preview ZIP
if PREVIEW_ZIP.exists(): PREVIEW_ZIP.unlink()
with zipfile.ZipFile(PREVIEW_ZIP,'w',zipfile.ZIP_DEFLATED) as z:
    for p in [ROOT/'previews/v4/hero-office-preview-v4.png', ROOT/'previews/v4/contact_sheets/asset-contact-sheet-v4.png', ROOT/'previews/v4/contact_sheets/character-contact-sheet-v4.png']:
        z.write(p,p.name)
# full ZIP
if ZIP_PATH.exists(): ZIP_PATH.unlink()
with zipfile.ZipFile(ZIP_PATH,'w',zipfile.ZIP_DEFLATED) as z:
    for p in ROOT.rglob('*'):
        z.write(p,p.relative_to(ROOT.parent))
print('v4 assets:',len(v4_metas))
print('zip:',ZIP_PATH,ZIP_PATH.stat().st_size)
print('preview:',ROOT/'previews/v4/hero-office-preview-v4.png')
