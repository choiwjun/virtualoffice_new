# Poly Haven CC0 모델 다운로더 — gltf(1k) + 동봉 텍스처를 상대경로 그대로 저장
import json
import os
import sys
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "polyhaven")
SLUGS = [
    "metal_office_desk", "modern_arm_chair_01", "Sofa_01", "coffee_table_round_01",
    "potted_plant_01", "potted_plant_02", "Shelf_01", "classic_laptop", "dining_table",
]
RES = "1k"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}

def fetch_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return 0
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        data = r.read()
        f.write(data)
    return len(data)

total = 0
for slug in SLUGS:
    try:
        files = fetch_json(f"https://api.polyhaven.com/files/{slug}")
        node = files["gltf"][RES]
        main = node["gltf"] if "gltf" in node else node
        size = download(main["url"], os.path.join(OUT, slug, f"{slug}.gltf"))
        total += size
        incl = main.get("include", {})
        for rel, meta in incl.items():
            total += download(meta["url"], os.path.join(OUT, slug, rel))
        print(f"OK {slug} (+{len(incl)} files)")
    except Exception as e:
        print(f"FAIL {slug}: {e}")

print(f"TOTAL_BYTES {total}")
