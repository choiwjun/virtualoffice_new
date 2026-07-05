"""
클라이언트 자동 업데이트 채널 API (P7-R3-T2, D8).

- GET /api/client/version?current=X   최신 버전/다운로드 URL/강제여부 반환

강제 업데이트: current < client_min_version 이면 required=true. 서명/체크섬 검증과 실제
pak 배포 스토리지 서빙은 배포 인프라(공인 도메인/Let's Encrypt, D21-r) 범위.
"""

from typing import Optional

from fastapi import APIRouter, Query

from app.config import settings

router = APIRouter(prefix="/api", tags=["client"])


def _ver_tuple(v: str) -> tuple:
    """semver 문자열을 비교 가능한 튜플로. 파싱 실패분은 0으로 채운다."""
    parts = []
    for p in (v or "0").split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


@router.get("/client/version")
async def client_version(current: Optional[str] = Query(default=None)) -> dict:
    latest = settings.client_latest_version
    minimum = settings.client_min_version
    required = current is not None and _ver_tuple(current) < _ver_tuple(minimum)
    up_to_date = current is not None and _ver_tuple(current) >= _ver_tuple(latest)
    return {
        "latest": latest,
        "min": minimum,
        "current": current,
        "url": settings.client_download_url or None,
        "required": required,
        "up_to_date": up_to_date,
    }
