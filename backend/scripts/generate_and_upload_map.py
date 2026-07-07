"""
조직 맵 생성 → map-storage 업로드 스크립트.

샘플 조직 (개발팀 6명, 디자인팀 4명, 경영지원 3명) TMJ를 생성하고
실행 중인 map-storage(http://localhost:8090/map-storage)에 업로드.

업로드 방식:
  POST /map-storage/upload  (multipart/form-data)
    - file: ZIP 아카이브 (org-map.tmj + tileset.png 포함)
    - directory: (선택, 빈 문자열 → 루트)
  인증: Basic admin/localadmin

WA MapValidator 요구사항 (upload 시 서버 사이드 검증):
  - floorLayer objectgroup 필수 (error)
  - tileset image 파일 ZIP 내 포함 필수 (error)
  - orientation = orthogonal 필수 (error)

업로드 후 접근 URL:
  파일 서빙: http://localhost:8090/map-storage/<filename>.tmj
  WA 룸   : http://localhost:8090/_/global/localhost:8090/map-storage/<filename>.tmj

참조:
  - docs/planning/00-decisions.md D12 (좌석 배치 자동화), D26 (WorkAdventure)
  - WA MapStorage UploadController 소스 (postUpload → ZipFileFetcher → MapValidator)
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import httpx

# 프로젝트 루트를 sys.path에 추가 (backend/ 기준 실행 시)
_BACKEND_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_BACKEND_ROOT))

from app.services.map_generator import MapConfig, TeamSpec, generate_office_map, generate_wam
from scripts.generate_tileset import generate_tileset

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

MAP_STORAGE_URL = "http://localhost:8090/map-storage"
MAP_AUTH = ("admin", "localadmin")
MAP_FILENAME = "org-map.tmj"
PRESENCE_JS_SRC = Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
PRESENCE_JS_DEST = "scripts/presence.js"  # map-storage 내 상대 경로 (TMJ script 프로퍼티와 동기화)
TILESET_FILENAME = "tileset.png"
WAM_FILENAME = "org-map.wam"

# 샘플 조직 (개발팀 6명, 디자인팀 4명, 경영지원 3명)
SAMPLE_TEAMS = [
    TeamSpec(name="개발팀", headcount=6, color="#4A90E2"),
    TeamSpec(name="디자인팀", headcount=4, color="#7ED321"),
    TeamSpec(name="경영지원", headcount=3, color="#F5A623"),
]

# 디폴트 MapConfig: seat_cols=4, seat_rows=2 → max 8 → 개발팀 6 ≤ 8 OK
SAMPLE_CONFIG = MapConfig(
    tile_size=32,
    zone_width=12,   # 조금 넓게 (6인 팀 좌석 여유)
    zone_height=8,
    zones_per_row=3,
    seat_cols=4,
    seat_rows=2,
    margin_tiles=2,
    entry_area_height=4,
)


# ---------------------------------------------------------------------------
# 최소 유효 PNG 생성 (WA MapValidator tileset image 검증 통과용)
# ---------------------------------------------------------------------------

def _make_tileset_png() -> bytes:
    """
    Generate a recognizable office tileset PNG.
    
    Uses the tileset generator to create a multi-tile PNG with distinct colors
    for floor, wall, desk, meeting zones, etc.
    """
    return generate_tileset(tile_size=32, columns=4, rows=4)


# ---------------------------------------------------------------------------
# ZIP 패키징
# ---------------------------------------------------------------------------

def _build_zip(tmj_bytes: bytes, png_bytes: bytes, wam_bytes: bytes | None = None) -> bytes:
    """TMJ + tileset PNG + presence.js (+ org-map.wam) 를 ZIP 아카이브로 묶기.

    map-storage 업로드 후 접근 경로:
      TMJ    : http://localhost:8090/map-storage/org-map.tmj
      PNG    : http://localhost:8090/map-storage/tileset.png
      WAM    : http://localhost:8090/map-storage/org-map.wam (회의존 인터랙티브 area, D24)
      스크립트 : http://localhost:8090/map-storage/scripts/presence.js
    TMJ script 프로퍼티 "scripts/presence.js" (상대 URL)가 이 경로를 가리킴.
    """
    buf = io.BytesIO()
    with ZipFile(buf, mode="w", compression=ZIP_DEFLATED) as zf:
        zf.writestr(MAP_FILENAME, tmj_bytes)
        zf.writestr(TILESET_FILENAME, png_bytes)
        if wam_bytes is not None:
            zf.writestr(WAM_FILENAME, wam_bytes)
        # presence.js: WA scripting 파일 — scripts/ 서브디렉토리로 업로드
        if PRESENCE_JS_SRC.exists():
            zf.writestr(PRESENCE_JS_DEST, PRESENCE_JS_SRC.read_text(encoding="utf-8"))
        else:
            print(f"  [WARN] presence.js not found at {PRESENCE_JS_SRC} — 스크립트 없이 계속")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# 업로드
# ---------------------------------------------------------------------------

def upload_map(zip_bytes: bytes, directory: str = "") -> httpx.Response:
    """map-storage에 ZIP 업로드 (POST /upload)."""
    files = {"file": (f"{MAP_FILENAME[:-4]}.zip", zip_bytes, "application/zip")}
    data = {"directory": directory}
    with httpx.Client(auth=MAP_AUTH, timeout=30.0) as client:
        resp = client.post(
            f"{MAP_STORAGE_URL}/upload",
            files=files,
            data=data,
        )
    return resp


# ---------------------------------------------------------------------------
# 검증
# ---------------------------------------------------------------------------

def verify_map_accessible(filename: str = MAP_FILENAME) -> httpx.Response:
    """업로드된 TMJ 파일이 HTTP 200으로 서빙되는지 확인."""
    url = f"{MAP_STORAGE_URL}/{filename}"
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url)
    return resp


def verify_play_room(filename: str = MAP_FILENAME) -> httpx.Response:
    """WA play가 해당 room URL로 HTML을 서빙하는지 확인."""
    room_url = f"http://localhost:8090/_/global/localhost:8090/map-storage/{filename}"
    with httpx.Client(timeout=10.0, follow_redirects=True) as client:
        resp = client.get(room_url)
    return resp


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("조직 맵 생성·업로드 스크립트")
    print("=" * 60)

    # 1. TMJ 생성
    print("\n[1] TMJ 생성 중...")
    tmj = generate_office_map(SAMPLE_TEAMS, SAMPLE_CONFIG)
    tmj_bytes = json.dumps(tmj, ensure_ascii=False, indent=2).encode("utf-8")
    layers = [l["name"] for l in tmj["layers"]]
    print(f"  팀 수    : {len(SAMPLE_TEAMS)}")
    print(f"  맵 크기  : {tmj['width']}x{tmj['height']} tiles")
    print(f"  레이어   : {layers}")
    print(f"  TMJ 크기 : {len(tmj_bytes):,} bytes")

    # 2. 최소 PNG 생성
    print("\n[2] 타일셋 PNG 생성 중 (4x4 multi-tile 128x128)...")
    png_bytes = _make_tileset_png()
    print(f"  PNG 크기 : {len(png_bytes):,} bytes")

    # 2b. WAM 생성 (회의존 인터랙티브 area, D24)
    wam = generate_wam(tmj)
    wam_bytes = json.dumps(wam, ensure_ascii=False, indent=2).encode("utf-8")
    print(f"  WAM areas: {len(wam['areas'])}개")

    # 3. ZIP 패키징
    print("\n[3] ZIP 패키징...")
    zip_bytes = _build_zip(tmj_bytes, png_bytes, wam_bytes)
    print(f"  ZIP 크기 : {len(zip_bytes):,} bytes")
    script_ok = PRESENCE_JS_SRC.exists()
    print(f"  포함 파일: {MAP_FILENAME}, {TILESET_FILENAME}, {WAM_FILENAME}" + (f", {PRESENCE_JS_DEST}" if script_ok else " [presence.js 없음]"))

    # 4. map-storage 업로드
    print(f"\n[4] map-storage 업로드...")
    print(f"  URL : POST {MAP_STORAGE_URL}/upload")
    print(f"  인증: Basic {MAP_AUTH[0]}/*****")
    upload_resp = upload_map(zip_bytes)
    print(f"  응답 코드: {upload_resp.status_code}")
    print(f"  응답 본문: {upload_resp.text[:300]}")

    if upload_resp.status_code not in (200, 201):
        print(f"\n[ERROR] 업로드 실패 (HTTP {upload_resp.status_code})")
        sys.exit(1)
    print("  ✓ 업로드 성공")

    # 5. 파일 접근 검증
    print(f"\n[5] 파일 접근 검증...")
    tmj_url = f"{MAP_STORAGE_URL}/{MAP_FILENAME}"
    access_resp = verify_map_accessible()
    print(f"  URL : GET {tmj_url}")
    print(f"  응답 코드: {access_resp.status_code}")
    if access_resp.status_code == 200:
        print(f"  ✓ TMJ 파일 HTTP 200 확인")
        content = access_resp.json()
        print(f"  맵 크기 : {content.get('width')}x{content.get('height')}")
        print(f"  레이어 수: {len(content.get('layers', []))}")
    else:
        print(f"  [WARN] TMJ 파일 접근 실패 (HTTP {access_resp.status_code})")

    # 6. WA play room URL 검증
    print(f"\n[6] WA play room URL 검증...")
    room_url = f"http://localhost:8090/_/global/localhost:8090/map-storage/{MAP_FILENAME}"
    play_resp = verify_play_room()
    print(f"  URL : GET {room_url}")
    print(f"  응답 코드: {play_resp.status_code}")
    content_type = play_resp.headers.get("content-type", "")
    print(f"  Content-Type: {content_type}")
    if play_resp.status_code == 200 and "text/html" in content_type:
        print(f"  ✓ WA play HTML 서빙 확인")
    elif play_resp.status_code == 200:
        print(f"  ✓ HTTP 200 (Content-Type: {content_type})")
    else:
        print(f"  [INFO] play room: HTTP {play_resp.status_code} (익명 비활성화 환경에서는 리다이렉트 예상)")

    print("\n" + "=" * 60)
    print("완료 요약")
    print("=" * 60)
    print(f"  TMJ 파일  : {tmj_url}")
    print(f"  WA 룸 URL : {room_url}")
    print(f"  업로드    : HTTP {upload_resp.status_code}")
    print(f"  파일 접근 : HTTP {access_resp.status_code}")
    print(f"  play 룸   : HTTP {play_resp.status_code}")


if __name__ == "__main__":
    main()
