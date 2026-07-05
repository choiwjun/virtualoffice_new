"""
office_layout JSON 직렬화/역직렬화 (P3-R3-T1).

레이아웃은 이미 JSON(dict)로 저장되므로, 직렬화 계약은 (a) 정본 스키마 키 순서 정규화,
(b) round-trip 동일성 보장, (c) 버전 호환(누락 컬렉션 기본값 채움)을 담당한다. Godot 변환은
office_layout_to_godot.py, 검증은 office_layout_validator.py가 담당한다.
"""

from __future__ import annotations

import json
from typing import Any

# 정본 스키마 최상위 키(office-layout-schema.json required + 선택 컬렉션).
_TOP_KEYS = [
    "metadata",
    "floor",
    "dimensions",
    "zones",
    "rooms",
    "seats",
    "furniture",
    "colliders",
    "spawn_points",
    "spawn_default",
    "minimap",
]
_COLLECTION_KEYS = ["zones", "rooms", "seats", "furniture", "colliders", "spawn_points"]


def normalize(layout: dict[str, Any]) -> dict[str, Any]:
    """최상위 키 순서 정규화 + 누락 컬렉션 빈 배열 기본값(버전 호환). 원본 불변."""
    out: dict[str, Any] = {}
    for k in _TOP_KEYS:
        if k in layout:
            out[k] = layout[k]
        elif k in _COLLECTION_KEYS:
            out[k] = []
    # 스키마에 없는 추가 키도 보존(끝에 부착).
    for k, v in layout.items():
        if k not in out:
            out[k] = v
    return out


def to_json(layout: dict[str, Any]) -> str:
    """dict → 정규화된 JSON 문자열(ensure_ascii=False, 안정 키 순서)."""
    return json.dumps(normalize(layout), ensure_ascii=False, sort_keys=False)


def from_json(blob: str) -> dict[str, Any]:
    """JSON 문자열 → 정규화 dict."""
    return normalize(json.loads(blob))


def round_trip(layout: dict[str, Any]) -> dict[str, Any]:
    """to_json → from_json 왕복(감사 재현성 확인용)."""
    return from_json(to_json(layout))
