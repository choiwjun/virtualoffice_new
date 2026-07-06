"""
Tests for /api/maps/* endpoints (map generation and validation).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestMapGenerate:
    """POST /api/maps/generate 테스트."""
    
    def test_generate_simple_map(self):
        """단순 맵 생성 요청."""
        payload = {
            "teams": [
                {"name": "개발팀", "headcount": 6, "color": "#4A90E2"},
                {"name": "디자인팀", "headcount": 4, "color": "#50C878"},
            ]
        }
        resp = client.post("/api/maps/generate", json=payload)
        assert resp.status_code == 200
        
        data = resp.json()
        assert "tmj" in data
        assert "summary" in data
        
        tmj = data["tmj"]
        assert tmj["type"] == "map"
        assert tmj["orientation"] == "orthogonal"
        assert "layers" in tmj
        assert "tilesets" in tmj
        
        summary = data["summary"]
        assert summary["team_count"] == 2
        assert summary["total_seats"] == 10
        assert summary["meeting_rooms"] == 3
    
    def test_generate_with_custom_config(self):
        """커스텀 MapConfig로 맵 생성."""
        payload = {
            "teams": [
                {"name": "엔지니어링", "headcount": 3}
            ],
            "config": {
                "tile_size": 32,
                "zone_width": 8,
                "zone_height": 6
            }
        }
        resp = client.post("/api/maps/generate", json=payload)
        assert resp.status_code == 200
        
        tmj = resp.json()["tmj"]
        assert tmj["tilewidth"] == 32
        assert tmj["tileheight"] == 32
    
    def test_generate_empty_teams_error(self):
        """빈 팀 목록은 에러."""
        payload = {"teams": []}
        resp = client.post("/api/maps/generate", json=payload)
        assert resp.status_code == 422  # Validation error
    
    def test_generate_capacity_overflow_error(self):
        """슬롯 용량 초과 시 에러 (D12)."""
        payload = {
            "teams": [
                {"name": "대규모팀", "headcount": 100}  # 기본 max_seats_per_zone=8 초과
            ]
        }
        resp = client.post("/api/maps/generate", json=payload)
        assert resp.status_code == 400
        assert "초과" in resp.json()["detail"] or "overflow" in resp.json()["detail"].lower()


class TestMapValidate:
    """POST /api/maps/validate 테스트."""
    
    def test_validate_valid_map(self):
        """정상 TMJ 검증."""
        # 먼저 맵 생성
        gen_resp = client.post("/api/maps/generate", json={
            "teams": [{"name": "팀A", "headcount": 2}]
        })
        tmj = gen_resp.json()["tmj"]
        
        # 검증
        val_resp = client.post("/api/maps/validate", json={"tmj": tmj})
        assert val_resp.status_code == 200
        
        data = val_resp.json()
        assert data["valid"] is True
        assert len(data["errors"]) == 0
    
    def test_validate_missing_layers_error(self):
        """필수 레이어 누락 시 에러."""
        tmj = {
            "version": "1.6",
            "type": "map",
            "orientation": "orthogonal",
            "width": 10,
            "height": 10,
            "tilewidth": 32,
            "tileheight": 32,
            "layers": [],  # 레이어 없음
            "tilesets": [{"firstgid": 1, "name": "default"}]
        }
        resp = client.post("/api/maps/validate", json={"tmj": tmj})
        assert resp.status_code == 200
        
        data = resp.json()
        assert data["valid"] is False
        assert any("레이어" in err or "layer" in err.lower() for err in data["errors"])
    
    def test_validate_wrong_type_error(self):
        """type이 'map'이 아니면 에러."""
        tmj = {
            "version": "1.6",
            "type": "tileset",  # 잘못된 타입
            "orientation": "orthogonal",
            "width": 10,
            "height": 10,
            "tilewidth": 32,
            "tileheight": 32,
            "layers": [],
            "tilesets": []
        }
        resp = client.post("/api/maps/validate", json={"tmj": tmj})
        assert resp.status_code == 200
        
        data = resp.json()
        assert data["valid"] is False
        assert any("type" in err.lower() for err in data["errors"])
