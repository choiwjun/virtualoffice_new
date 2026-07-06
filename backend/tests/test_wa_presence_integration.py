"""
통합 테스트 — Lane A G002 Presence 7종 WA scripting API 배선 (완료 증거).

검증 범위:
1. POST /api/wa/presence — zone/event → D13 상태 응답 검증
   desk→working, meeting_room→meeting, focus_room→focus, idle→away
2. presence.js 파일 존재 확인
3. map_generator 산출 TMJ에 script 프로퍼티 포함 확인
4. map_generator 산출 zone 오브젝트에 zone_type 프로퍼티 포함 확인

참조: 00-decisions.md D13, D20-c(GPS 금지), D24(명시 입장)
"""

import os
import pathlib
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.services.map_generator import MapConfig, TeamSpec, generate_office_map


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """인메모리 SQLite DB 오버라이드 포함 클라이언트 (wa_presence → DB 저장 필요)."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


# ---------------------------------------------------------------------------
# 1. POST /api/wa/presence — zone 이벤트 → D13 상태 매핑 검증
# ---------------------------------------------------------------------------

class TestWaPresenceEndpointMapping:
    """각 zone/event → 기대 D13 상태 응답 검증."""

    @pytest.mark.asyncio
    async def test_desk_enter_zone_returns_working(self, client: AsyncClient):
        """desk 존 진입 → working (D13)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 1,
            "kind": "enter_zone",
            "zone_name": "desk",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "working"
        assert body["employee_id"] == 1

    @pytest.mark.asyncio
    async def test_meeting_room_enter_zone_returns_meeting(self, client: AsyncClient):
        """meeting_room 존 진입 → meeting (D13, D24 명시 입장)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 2,
            "kind": "enter_zone",
            "zone_name": "meeting_room",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "meeting"

    @pytest.mark.asyncio
    async def test_focus_room_enter_zone_returns_focus(self, client: AsyncClient):
        """focus_room 존 진입 → focus (D13)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 3,
            "kind": "enter_zone",
            "zone_name": "focus_room",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "focus"

    @pytest.mark.asyncio
    async def test_idle_event_returns_away(self, client: AsyncClient):
        """idle 이벤트 → away (D13: 5분 무입력, presence.js 클라이언트 감지)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 4,
            "kind": "idle",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "away"

    @pytest.mark.asyncio
    async def test_connect_event_returns_online(self, client: AsyncClient):
        """connect 이벤트 → online (D13)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 5,
            "kind": "connect",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "online"

    @pytest.mark.asyncio
    async def test_disconnect_event_returns_offline(self, client: AsyncClient):
        """disconnect 이벤트 → offline (D13)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 6,
            "kind": "disconnect",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "offline"

    @pytest.mark.asyncio
    async def test_desk_leave_zone_returns_online(self, client: AsyncClient):
        """desk 존 이탈 → online (복귀)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 7,
            "kind": "leave_zone",
            "zone_name": "desk",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "online"

    @pytest.mark.asyncio
    async def test_variable_focus_returns_focus(self, client: AsyncClient):
        """presence_status 변수 = focus → focus (D13)."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 8,
            "kind": "variable",
            "variable_name": "presence_status",
            "variable_value": "focus",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["resolved_status"] == "focus"

    @pytest.mark.asyncio
    async def test_unknown_kind_returns_422(self, client: AsyncClient):
        """알 수 없는 kind → 422 Unprocessable Entity."""
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 9,
            "kind": "unknown_event_xyz",
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_unmapped_event_returns_none_resolved_status(self, client: AsyncClient):
        """매핑 없는 이벤트 → resolved_status=None, message에 '매핑' 포함."""
        # leave_zone without a known zone_name → no mapping
        resp = await client.post("/api/wa/presence", json={
            "employee_id": 10,
            "kind": "leave_zone",
            "zone_name": "unknown_zone_xyz",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["resolved_status"] is None


# ---------------------------------------------------------------------------
# 2. presence.js 파일 존재 확인
# ---------------------------------------------------------------------------

class TestPresenceJsExists:
    def test_presence_js_file_exists(self):
        """backend/wa_maps/scripts/presence.js 파일이 존재해야 함."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        assert js_path.exists(), f"presence.js not found at {js_path}"
        assert js_path.stat().st_size > 100, "presence.js is suspiciously small"

    def test_presence_js_contains_wa_oninit(self):
        """presence.js가 WA.onInit() 호출을 포함해야 함."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        content = js_path.read_text(encoding="utf-8")
        assert "WA.onInit" in content, "WA.onInit() 호출 없음"

    def test_presence_js_contains_on_enter_zone(self):
        """presence.js가 WA.room.area.onEnter 구독을 포함해야 함 (WA 현행 area API)."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        content = js_path.read_text(encoding="utf-8")
        assert "area.onEnter" in content, "WA.room.area.onEnter() 구독 없음 — WA area API 필수"

    def test_presence_js_contains_on_leave_zone(self):
        """presence.js가 WA.room.area.onLeave 구독을 포함해야 함 (WA 현행 area API)."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        content = js_path.read_text(encoding="utf-8")
        assert "area.onLeave" in content, "WA.room.area.onLeave() 구독 없음 — WA area API 필수"

    def test_presence_js_no_gps_code(self):
        """presence.js에 GPS API 코드 없음 (D20-c) — 코멘트 제외."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        raw = js_path.read_text(encoding="utf-8")
        # 주석 제거 후 검사 (// 한줄 주석 및 /* */ 블록 주석 제거)
        import re
        no_comments = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
        no_comments = re.sub(r"//[^\n]*", "", no_comments)
        lower = no_comments.lower()
        # GPS API 식별자 (D20-c: 실제 코드에서 금지)
        gps_api_keywords = ["geolocation", "getcurrentposition", "watchposition", "latitude", "longitude"]
        for kw in gps_api_keywords:
            assert kw not in lower, f"GPS API 식별자 '{kw}' 발견 — D20-c 위반"

    def test_presence_js_contains_idle_detection(self):
        """presence.js가 유휴(idle) 감지 로직을 포함해야 함 (D13: 5분 → away)."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        content = js_path.read_text(encoding="utf-8")
        assert "idle" in content.lower(), "idle 감지 로직 없음"
        assert "IDLE_TIMEOUT" in content or "5 * 60" in content, "5분 유휴 임계값 없음"

    def test_presence_js_posts_to_backend(self):
        """presence.js가 백엔드 /api/wa/presence URL을 참조해야 함."""
        js_path = pathlib.Path(__file__).parent.parent / "wa_maps" / "scripts" / "presence.js"
        content = js_path.read_text(encoding="utf-8")
        assert "/api/wa/presence" in content, "백엔드 URL 참조 없음"


# ---------------------------------------------------------------------------
# 3. map_generator TMJ에 script 프로퍼티 포함 확인
# ---------------------------------------------------------------------------

class TestMapGeneratorScriptProperty:
    """map_generator가 생성하는 TMJ에 WA scripting 연동 프로퍼티 포함 검증."""

    def _generate(self):
        teams = [TeamSpec(name="개발팀", headcount=3)]
        return generate_office_map(teams)

    def test_tmj_has_script_property(self):
        """TMJ 맵 레벨 properties에 'script' 항목 존재."""
        tmj = self._generate()
        prop_names = {p["name"] for p in tmj.get("properties", [])}
        assert "script" in prop_names, "TMJ map-level 'script' 프로퍼티 없음"

    def test_script_property_value_points_to_presence_js(self):
        """script 프로퍼티 값이 presence.js URL을 가리켜야 함."""
        tmj = self._generate()
        props = {p["name"]: p["value"] for p in tmj.get("properties", [])}
        assert "presence.js" in props["script"], f"script 값이 presence.js 미포함: {props['script']}"

    def test_script_property_type_is_string(self):
        """script 프로퍼티 type이 'string'이어야 함 (WA 규약)."""
        tmj = self._generate()
        script_prop = next(p for p in tmj["properties"] if p["name"] == "script")
        assert script_prop["type"] == "string"


# ---------------------------------------------------------------------------
# 4. zone 오브젝트에 zone_type 프로퍼티 포함 확인
# ---------------------------------------------------------------------------

class TestMapGeneratorZoneTypeProperty:
    """map_generator가 생성하는 zone 오브젝트에 zone_type 프로퍼티 포함 검증."""

    def _zones(self, teams=None):
        """Get team zones (excluding meeting zones)."""
        if teams is None:
            teams = [TeamSpec(name="개발팀", headcount=2)]
        tmj = generate_office_map(teams)
        zones_layer = next(l for l in tmj["layers"] if l["name"] == "zones")
        # Filter for team zones only (those with team_name property)
        return [obj for obj in zones_layer["objects"]
                if any(p.get("name") == "team_name" for p in obj.get("properties", []))]

    def test_zone_has_zone_type_property(self):
        """zone 오브젝트에 'zone_type' 프로퍼티가 존재해야 함."""
        zones = self._zones()
        zone = zones[0]
        prop_names = {p["name"] for p in zone.get("properties", [])}
        assert "zone_type" in prop_names, "zone 오브젝트에 'zone_type' 프로퍼티 없음"

    def test_team_zone_type_is_desk(self):
        """팀 구역 zone_type 값은 'desk'이어야 함 (좌석 존)."""
        zones = self._zones()
        for zone in zones:
            props = {p["name"]: p["value"] for p in zone.get("properties", [])}
            assert props.get("zone_type") == "desk", (
                f"zone '{zone['name']}' zone_type={props.get('zone_type')!r}, expected 'desk'"
            )

    def test_multi_team_all_zones_have_zone_type(self):
        """다수 팀 → 모든 zone 오브젝트에 zone_type 프로퍼티 존재."""
        teams = [
            TeamSpec(name="개발팀", headcount=2),
            TeamSpec(name="디자인팀", headcount=1),
            TeamSpec(name="마케팅팀", headcount=3),
        ]
        zones = self._zones(teams)
        assert len(zones) == 3
        for zone in zones:
            prop_names = {p["name"] for p in zone.get("properties", [])}
            assert "zone_type" in prop_names, f"zone '{zone['name']}' zone_type 없음"

    def test_zone_also_retains_existing_zone_property(self):
        """zone_type 추가 후에도 기존 'zone' 프로퍼티가 유지되어야 함."""
        zones = self._zones()
        zone = zones[0]
        prop_names = {p["name"] for p in zone.get("properties", [])}
        assert "zone" in prop_names, "기존 'zone' 프로퍼티가 사라짐"
        assert "team_name" in prop_names, "기존 'team_name' 프로퍼티가 사라짐"
