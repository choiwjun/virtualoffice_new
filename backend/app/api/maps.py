"""
Maps API — 오피스 맵 생성 및 검증 엔드포인트.

POST /api/maps/generate — 조직 데이터로 TMJ 맵 자동 생성
POST /api/maps/validate — TMJ 맵 구조 검증

D12 정신: 서버 단일 정밀 검증.
Phase 3: 맵 제너레이터 + 좌석 배치 자동화.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.map_generator import (
    MapConfig,
    MapGeneratorError,
    TeamSpec,
    generate_office_map,
)

router = APIRouter(prefix="/api/maps", tags=["maps"])


# --- 요청/응답 스키마 ---

class TeamSpecIn(BaseModel):
    """팀 명세 입력 스키마."""
    name: str = Field(..., description="팀 이름")
    headcount: int = Field(..., ge=0, description="팀 인원 수")
    color: str = Field("#4A90E2", description="구역 색상 (hex)")


class MapConfigIn(BaseModel):
    """맵 생성 파라미터 입력 스키마 (선택)."""
    tile_size: int | None = Field(None, ge=16, le=64, description="타일 픽셀 크기")
    zone_width: int | None = Field(None, ge=4, description="팀 구역 너비 (tiles)")
    zone_height: int | None = Field(None, ge=4, description="팀 구역 높이 (tiles)")
    zones_per_row: int | None = Field(None, ge=1, description="행당 구역 수")
    seat_cols: int | None = Field(None, ge=1, description="구역 내 좌석 열 수")
    seat_rows: int | None = Field(None, ge=1, description="구역 내 좌석 행 수")
    margin_tiles: int | None = Field(None, ge=0, description="구역 간 여백 (tiles)")
    entry_area_height: int | None = Field(None, ge=2, description="로비 영역 높이 (tiles)")


class MapGenerateRequest(BaseModel):
    """맵 생성 요청."""
    teams: list[TeamSpecIn] = Field(..., min_length=1, description="팀 명세 목록")
    config: MapConfigIn | None = Field(None, description="맵 생성 파라미터 (선택)")
    script_url: str = Field("scripts/presence.js", description="WA scripting 파일 URL")


class MapGenerateResponse(BaseModel):
    """맵 생성 응답."""
    tmj: dict[str, Any] = Field(..., description="생성된 TMJ JSON")
    summary: dict[str, Any] = Field(..., description="생성 요약 정보")


class MapValidateRequest(BaseModel):
    """맵 검증 요청."""
    tmj: dict[str, Any] = Field(..., description="검증할 TMJ JSON")


class MapValidateResponse(BaseModel):
    """맵 검증 응답."""
    valid: bool = Field(..., description="검증 통과 여부")
    errors: list[str] = Field(default_factory=list, description="검증 에러 목록")
    warnings: list[str] = Field(default_factory=list, description="검증 경고 목록")


# --- 엔드포인트 ---

@router.post("/generate", response_model=MapGenerateResponse)
def generate_map(req: MapGenerateRequest) -> MapGenerateResponse:
    """
    조직 데이터로 WorkAdventure 호환 TMJ 맵 자동 생성.
    
    - 팀 구역 + 좌석 배치 자동 생성
    - 회의실 존 3개 추가 (D24 명시 입장)
    - 슬롯 용량 초과 시 ValidationError (D12)
    """
    try:
        # 입력 변환
        teams = [
            TeamSpec(name=t.name, headcount=t.headcount, color=t.color)
            for t in req.teams
        ]
        
        # MapConfig 생성 (None 값 제외)
        config_dict = {}
        if req.config:
            for field, value in req.config.model_dump().items():
                if value is not None:
                    config_dict[field] = value
        
        config = MapConfig(**config_dict) if config_dict else None
        
        # 맵 생성
        tmj = generate_office_map(teams, config, script_url=req.script_url)
        
        # 요약 정보
        summary = {
            "team_count": len(teams),
            "width": tmj["width"],
            "height": tmj["height"],
            "tile_size": tmj["tilewidth"],
            "total_seats": sum(t.headcount for t in teams),
            "meeting_rooms": 3,
        }
        
        return MapGenerateResponse(tmj=tmj, summary=summary)
    
    except MapGeneratorError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"맵 생성 실패: {e}")


@router.post("/validate", response_model=MapValidateResponse)
def validate_map(req: MapValidateRequest) -> MapValidateResponse:
    """
    TMJ 맵 구조 검증.
    
    - 필수 레이어 존재 확인 (floor, walls, zones, seats, start, floorLayer)
    - 타일셋 참조 확인
    - WA 필수 프로퍼티 확인 (script, generator)
    
    D12: ERROR는 배포 불가, WARNING만 무시 가능.
    """
    tmj = req.tmj
    errors = []
    warnings = []
    
    # 기본 구조 검증
    required_fields = ["version", "type", "orientation", "width", "height", "tilewidth", "tileheight", "layers", "tilesets"]
    for field in required_fields:
        if field not in tmj:
            errors.append(f"필수 필드 누락: {field}")
    
    if errors:
        return MapValidateResponse(valid=False, errors=errors, warnings=warnings)
    
    # type 검증
    if tmj.get("type") != "map":
        errors.append(f"type은 'map'이어야 함 (현재: {tmj.get('type')})")
    
    # orientation 검증
    if tmj.get("orientation") != "orthogonal":
        errors.append(f"orientation은 'orthogonal'이어야 함 (현재: {tmj.get('orientation')})")
    
    # 레이어 검증
    layers = tmj.get("layers", [])
    layer_names = {layer.get("name") for layer in layers}
    required_layers = ["floor", "walls", "zones", "seats", "start", "floorLayer"]
    
    for req_layer in required_layers:
        if req_layer not in layer_names:
            errors.append(f"필수 레이어 누락: {req_layer}")
    
    # floorLayer는 objectgroup이어야 함 (WA 필수)
    floor_layer = next((l for l in layers if l.get("name") == "floorLayer"), None)
    if floor_layer and floor_layer.get("type") != "objectgroup":
        errors.append("floorLayer는 objectgroup 타입이어야 함")
    
    # 타일셋 검증
    tilesets = tmj.get("tilesets", [])
    if not tilesets:
        errors.append("최소 1개의 tileset 필요")
    
    # WA 프로퍼티 검증
    properties = tmj.get("properties", [])
    prop_names = {p.get("name") for p in properties}
    
    if "script" not in prop_names:
        warnings.append("WA scripting: 'script' 프로퍼티 권장")
    
    if "generator" not in prop_names:
        warnings.append("'generator' 프로퍼티 권장 (맵 생성 도구 표시)")
    
    # zones 레이어의 area 오브젝트 검증
    zones_layer = next((l for l in layers if l.get("name") == "zones"), None)
    if zones_layer:
        objects = zones_layer.get("objects", [])
        for obj in objects:
            if obj.get("type") != "area":
                warnings.append(f"zone 오브젝트 '{obj.get('name')}'의 type은 'area' 권장")
            
            # zone_type 프로퍼티 확인
            obj_props = {p.get("name") for p in obj.get("properties", [])}
            if "zone_type" not in obj_props:
                warnings.append(f"zone 오브젝트 '{obj.get('name')}'에 zone_type 프로퍼티 권장")
    
    valid = len(errors) == 0
    return MapValidateResponse(valid=valid, errors=errors, warnings=warnings)
