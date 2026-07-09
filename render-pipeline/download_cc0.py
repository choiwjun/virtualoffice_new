"""CC0 에셋 다운로드 (Poly Haven API) — 증거 렌더용. 전부 CC0(상용/웹배포 안전)."""
import json, os, subprocess, urllib.request

API = "https://api.polyhaven.com/files/"
OUT = os.path.join(os.path.dirname(__file__), "assets_cc0")
RES = "2k"
MODELS = ["metal_office_desk", "modern_arm_chair_01", "Sofa_01", "potted_plant_01", "classic_laptop"]
HDRI = "newman_lobby"

UA = "Mozilla/5.0 (evidence-render; +local)"

def getjson(url):
    out = subprocess.run(["curl", "-sSL", "-A", UA, url], check=True, capture_output=True)
    return json.loads(out.stdout)

def dl(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["curl", "-sSL", "-A", UA, "-o", path, url], check=True)
    sz = os.path.getsize(path)
    print(f"  saved {os.path.relpath(path, OUT)}  ({sz:,} B)")
    return sz

for m in MODELS:
    try:
        j = getjson(API + m)
        node = j["gltf"][RES]["gltf"]
        base = os.path.join(OUT, m)
        dl(node["url"], os.path.join(base, m + ".gltf"))
        for rel, info in node.get("include", {}).items():
            dl(info["url"], os.path.join(base, rel.replace("/", os.sep)))
        print(f"[MODEL] {m} OK")
    except Exception as e:
        print(f"[MODEL] {m} FAIL: {e}")

# HDRI
try:
    j = getjson(API + HDRI)
    hurl = j["hdri"][RES]["hdr"]["url"]
    dl(hurl, os.path.join(OUT, "hdri", f"{HDRI}_{RES}.hdr"))
    print(f"[HDRI] {HDRI} OK")
except Exception as e:
    print(f"[HDRI] {HDRI} FAIL: {e}")

print("DONE")
