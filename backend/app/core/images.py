"""업로드 이미지 검증 (22 T1-12 — content_type만 신뢰 금지).

`UploadFile.content_type`은 **클라이언트가 보낸 문자열**이다. HTML/JS 파일을 `image/png`라고
주장해 올리면 `/media/*` 정적 서빙 경로에서 그대로 실행돼 저장형 XSS가 된다. 실제 바이트의
시그니처(매직 넘버)를 확인해 형식을 판정한다.

Pillow 의존을 두지 않는다 — 필요한 건 "이 바이트가 정말 그 형식인가"이고, 시그니처 검사로
충분하다. (완전한 디코딩 검증이 필요해지면 그때 도입한다.)
"""

from __future__ import annotations

from typing import Optional

# 허용 형식 → 저장 확장자. SVG는 스크립트를 품을 수 있어 의도적으로 제외한다.
PNG = "image/png"
JPEG = "image/jpeg"
WEBP = "image/webp"

EXTENSIONS: dict[str, str] = {PNG: ".png", JPEG: ".jpg", WEBP: ".webp"}


def sniff_image_type(data: bytes) -> Optional[str]:
    """바이트 시그니처로 이미지 형식 판정. 지원하지 않으면 None.

    - PNG : 89 50 4E 47 0D 0A 1A 0A
    - JPEG: FF D8 FF
    - WEBP: 'RIFF' ....(4B 크기) 'WEBP'
    """
    if len(data) < 12:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    if data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    return None
