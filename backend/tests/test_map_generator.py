"""
맵 생성기 단위 테스트 — backend/app/services/map_generator.py

범위:
  - TeamSpec / MapConfig 생성 및 유효성
  - generate_office_map: TMJ 구조 (필수 필드, 레이어 목록)
  - 팀 구역(zone) 주입: 개수, 존 이름, 프로퍼티
  - 좌석(seat) 주입: headcount만큼 생성, 팀 연결
  - spawn 포인트 (startLayer=true) 존재 확인
  - 슬롯 용량 초과 검증 에러 (D12 정신)
  - 다수 팀 → 격자 배치
  - 타일 맵 크기 계산 정합
  - GPS 코드 없음 확인 (D20-c)

참조: 00-decisions.md D12, D20-c, D26
"""

import pytest

from app.services.map_generator import (
    MapConfig,
    MapGeneratorError,
    TeamSpec,
    _reset_oid,
    _safe_zone_name,
    _validate_capacity,
    generate_office_map,
)


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_oid():
    """각 테스트 전 OID 시퀀스 리셋 (결정론적 테스트)."""
    _reset_oid(start=1)
    yield
    _reset_oid(start=1)


@pytest.fixture
def single_team():
    return [TeamSpec(name="엔지니어링", headcount=3, color="#FF5733")]


@pytest.fixture
def three_teams():
    return [
        TeamSpec(name="엔지니어링", headcount=4),
        TeamSpec(name="디자인", headcount=2),
        TeamSpec(name="마케팅", headcount=3),
    ]


@pytest.fixture
def default_config():
    return MapConfig()


# ---------------------------------------------------------------------------
# TeamSpec 유효성
# ---------------------------------------------------------------------------

class TestTeamSpec:
    def test_basic_creation(self):
        t = TeamSpec(name="Dev", headcount=5)
        assert t.name == "Dev"
        assert t.headcount == 5

    def test_default_color_is_hex(self):
        t = TeamSpec(name="Dev", headcount=1)
        assert t.color.startswith("#")
        assert len(t.color) == 7

    def test_custom_color(self):
        t = TeamSpec(name="Dev", headcount=1, color="#AABBCC")
        assert t.color == "#AABBCC"

    def test_zero_headcount_allowed(self):
        t = TeamSpec(name="Empty", headcount=0)
        assert t.headcount == 0

    def test_negative_headcount_raises(self):
        with pytest.raises(MapGeneratorError):
            TeamSpec(name="Bad", headcount=-1)


# ---------------------------------------------------------------------------
# MapConfig
# ---------------------------------------------------------------------------

class TestMapConfig:
    def test_max_seats_per_zone(self):
        cfg = MapConfig(seat_cols=4, seat_rows=2)
        assert cfg.max_seats_per_zone == 8

    def test_custom_zone_size(self):
        cfg = MapConfig(seat_cols=3, seat_rows=3)
        assert cfg.max_seats_per_zone == 9


# ---------------------------------------------------------------------------
# generate_office_map: 기본 TMJ 구조
# ---------------------------------------------------------------------------

class TestGenerateOfficeMapStructure:
    def test_returns_dict(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert isinstance(result, dict)

    def test_required_tmj_fields(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        required = {"version", "type", "orientation", "width", "height",
                    "tilewidth", "tileheight", "layers", "tilesets"}
        assert required.issubset(result.keys())

    def test_orientation_orthogonal(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert result["orientation"] == "orthogonal"

    def test_tile_size_matches_config(self, single_team):
        cfg = MapConfig(tile_size=32)
        result = generate_office_map(single_team, cfg)
        assert result["tilewidth"] == 32
        assert result["tileheight"] == 32

    def test_has_tileset(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert len(result["tilesets"]) >= 1

    def test_has_properties(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert "properties" in result
        prop_names = {p["name"] for p in result["properties"]}
        assert "generator" in prop_names
        assert "team_count" in prop_names

    def test_team_count_property_correct(self, three_teams, default_config):
        result = generate_office_map(three_teams, default_config)
        tc = next(p for p in result["properties"] if p["name"] == "team_count")
        assert tc["value"] == 3
    def test_script_property_exists(self, single_team, default_config):
        """WA scripting: map 레벨 'script' 프로퍼티가 TMJ properties에 존재."""
        result = generate_office_map(single_team, default_config)
        prop_names = {p["name"] for p in result["properties"]}
        assert "script" in prop_names, "'script' 프로퍼티 없음 — WA scripting 연결 불가"

    def test_script_property_default_value(self, single_team, default_config):
        """기본 script URL이 'scripts/presence.js' (map-storage 상대 경로)."""
        result = generate_office_map(single_team, default_config)
        script_prop = next(p for p in result["properties"] if p["name"] == "script")
        assert script_prop["value"] == "scripts/presence.js"
        assert script_prop["type"] == "string"

    def test_script_property_custom_url(self, single_team, default_config):
        """script_url 파라미터로 커스텀 URL 지정 가능."""
        custom = "http://localhost:8090/map-storage/scripts/presence.js"
        result = generate_office_map(single_team, default_config, script_url=custom)
        script_prop = next(p for p in result["properties"] if p["name"] == "script")
        assert script_prop["value"] == custom


    def test_empty_teams_raises(self, default_config):
        with pytest.raises(MapGeneratorError, match="비어"):
            generate_office_map([], default_config)


# ---------------------------------------------------------------------------
# generate_office_map: 레이어 구성
# ---------------------------------------------------------------------------

class TestGenerateOfficeMapLayers:
    def _layers_by_name(self, result):
        return {layer["name"]: layer for layer in result["layers"]}

    def test_has_floor_layer(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert "floor" in layers

    def test_has_walls_layer(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert "walls" in layers

    def test_has_zones_layer(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert "zones" in layers

    def test_has_seats_layer(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert "seats" in layers

    def test_has_start_layer(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert "start" in layers

    def test_floor_layer_is_tilelayer(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert layers["floor"]["type"] == "tilelayer"

    def test_zones_layer_is_objectgroup(self, single_team, default_config):
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert layers["zones"]["type"] == "objectgroup"
    def test_has_floor_obj_layer(self, single_team, default_config):
        """WA MapValidator 필수: 'floorLayer' 타입 objectgroup 존재."""
        layers = self._layers_by_name(generate_office_map(single_team, default_config))
        assert "floorLayer" in layers
        assert layers["floorLayer"]["type"] == "objectgroup"

    def test_tileset_has_image_field(self, single_team, default_config):
        """WA MapValidator 필수: tileset에 image 필드 존재 (collection-of-images 아님)."""
        result = generate_office_map(single_team, default_config)
        for ts in result["tilesets"]:
            assert "image" in ts, f"tileset '{ts.get('name')}' image 필드 없음"

    def test_tileset_has_distinct_office_tile_types(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        tileset = result["tilesets"][0]
        tile_types = {tile["type"] for tile in tileset["tiles"]}
        assert {"floor", "wall", "desk", "meeting", "passage"}.issubset(tile_types)
        assert tileset["tilecount"] >= 5
        assert tileset["columns"] >= 5


    def test_floor_data_length_matches_map_size(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        floor = next(l for l in result["layers"] if l["name"] == "floor")
        assert len(floor["data"]) == result["width"] * result["height"]

    def test_walls_data_length_matches_map_size(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        walls = next(l for l in result["layers"] if l["name"] == "walls")
        assert len(walls["data"]) == result["width"] * result["height"]


# ---------------------------------------------------------------------------
# 팀 구역(zone) 주입
# ---------------------------------------------------------------------------

class TestZoneInjection:
    def _zones(self, result):
        """Get team zones (excluding meeting zones)."""
        layer = next(l for l in result["layers"] if l["name"] == "zones")
        # Filter for team zones only (those with team_name property)
        return [obj for obj in layer["objects"] 
                if any(p.get("name") == "team_name" for p in obj.get("properties", []))]
    
    def _all_zones(self, result):
        """Get all zones (team zones + meeting zones)."""
        layer = next(l for l in result["layers"] if l["name"] == "zones")
        return layer["objects"]

    def test_single_team_one_zone(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert len(self._zones(result)) == 1

    def test_three_teams_three_zones(self, three_teams, default_config):
        result = generate_office_map(three_teams, default_config)
        assert len(self._zones(result)) == 3

    def test_zone_has_required_fields(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        zone = self._zones(result)[0]
        for field in ("id", "name", "x", "y", "width", "height", "type"):
            assert field in zone, f"zone 필드 '{field}' 없음"

    def test_zone_type_is_area(self, single_team, default_config):
        """WA.room.area.onEnter() 연동: zone 오브젝트 type="area" 필수."""
        result = generate_office_map(single_team, default_config)
        zone = self._zones(result)[0]
        assert zone["type"] == "area"

    def test_zone_has_team_name_property(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        zone = self._zones(result)[0]
        props = {p["name"]: p["value"] for p in zone.get("properties", [])}
        assert "team_name" in props
        assert props["team_name"] == "엔지니어링"

    def test_zone_has_headcount_property(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        zone = self._zones(result)[0]
        props = {p["name"]: p["value"] for p in zone.get("properties", [])}
        assert "headcount" in props
        assert props["headcount"] == 3

    def test_zone_has_zone_property(self, single_team, default_config):
        """WA area API: WA.room.area.onEnter(name) 연동용 'zone' 프로퍼티 존재."""
        result = generate_office_map(single_team, default_config)
        zone = self._zones(result)[0]
        props = {p["name"]: p["value"] for p in zone.get("properties", [])}
        assert "zone" in props

    def test_zone_names_unique_for_multiple_teams(self, three_teams, default_config):
        result = generate_office_map(three_teams, default_config)
        zone_names = [z["name"] for z in self._zones(result)]
        assert len(zone_names) == len(set(zone_names)), "존 이름 중복"

    def test_map_has_meeting_zones(self, single_team, default_config):
        """맵 생성 시 회의실 존이 추가됨 (D24 명시 입장 지원)."""
        result = generate_office_map(single_team, default_config)
        all_zones = self._all_zones(result)
        meeting_zones = [z for z in all_zones 
                        if any(p.get("name") == "zone_type" and p.get("value") == "meeting_room" 
                               for p in z.get("properties", []))]
        assert len(meeting_zones) == 3, "3개의 회의실 존이 있어야 함"
        
        # 각 회의실이 적절한 프로퍼티를 가져야 함
        for mz in meeting_zones:
            props = {p["name"]: p["value"] for p in mz.get("properties", [])}
            assert props["zone_type"] == "meeting_room"
            assert "room_name" in props
            assert "capacity" in props

    def test_zone_has_nonzero_dimensions(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        zone = self._zones(result)[0]
        assert zone["width"] > 0
        assert zone["height"] > 0


# ---------------------------------------------------------------------------
# 좌석(seat) 주입
# ---------------------------------------------------------------------------

class TestSeatInjection:
    def _seats(self, result):
        layer = next(l for l in result["layers"] if l["name"] == "seats")
        return layer["objects"]

    def test_seat_count_equals_headcount(self, single_team, default_config):
        """headcount=3 → 좌석 3개."""
        result = generate_office_map(single_team, default_config)
        assert len(self._seats(result)) == 3

    def test_seat_count_multi_team(self, three_teams, default_config):
        """총 좌석 = 합산 headcount (4+2+3=9)."""
        result = generate_office_map(three_teams, default_config)
        assert len(self._seats(result)) == 9

    def test_seat_has_required_fields(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        seat = self._seats(result)[0]
        for field in ("id", "name", "x", "y", "width", "height"):
            assert field in seat

    def test_seat_type_is_seat(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        seat = self._seats(result)[0]
        assert seat["type"] == "seat"

    def test_seat_has_team_name_property(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        seat = self._seats(result)[0]
        props = {p["name"]: p["value"] for p in seat.get("properties", [])}
        assert "team_name" in props

    def test_seat_has_desk_property(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        seat = self._seats(result)[0]
        props = {p["name"]: p["value"] for p in seat.get("properties", [])}
        assert props.get("desk") is True

    def test_zero_headcount_no_seats(self, default_config):
        result = generate_office_map([TeamSpec(name="Empty", headcount=0)], default_config)
        assert len(self._seats(result)) == 0

    def test_seat_ids_unique(self, three_teams, default_config):
        result = generate_office_map(three_teams, default_config)
        ids = [s["id"] for s in self._seats(result)]
        assert len(ids) == len(set(ids)), "좌석 OID 중복"


# ---------------------------------------------------------------------------
# spawn 포인트
# ---------------------------------------------------------------------------

class TestSpawnPoint:
    def _start_objects(self, result):
        layer = next(l for l in result["layers"] if l["name"] == "start")
        return layer["objects"]

    def test_spawn_exists(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert len(self._start_objects(result)) >= 1

    def test_spawn_has_start_layer_property(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        spawn = self._start_objects(result)[0]
        props = {p["name"]: p["value"] for p in spawn.get("properties", [])}
        assert props.get("startLayer") is True


# ---------------------------------------------------------------------------
# 슬롯 용량 초과 검증 (D12 정신)
# ---------------------------------------------------------------------------

class TestCapacityValidation:
    def test_overflow_single_team_raises(self):
        """headcount > max_seats_per_zone → MapGeneratorError."""
        cfg = MapConfig(seat_cols=2, seat_rows=2)  # max=4
        teams = [TeamSpec(name="BigTeam", headcount=5)]
        with pytest.raises(MapGeneratorError, match="슬롯 용량 초과"):
            generate_office_map(teams, cfg)

    def test_overflow_message_mentions_team_name(self):
        cfg = MapConfig(seat_cols=2, seat_rows=2)
        teams = [TeamSpec(name="SuperBigTeam", headcount=99)]
        with pytest.raises(MapGeneratorError, match="SuperBigTeam"):
            generate_office_map(teams, cfg)

    def test_overflow_message_mentions_counts(self):
        cfg = MapConfig(seat_cols=2, seat_rows=2)  # max=4
        teams = [TeamSpec(name="T", headcount=10)]
        with pytest.raises(MapGeneratorError) as exc_info:
            generate_office_map(teams, cfg)
        msg = str(exc_info.value)
        assert "10" in msg  # headcount 언급
        assert "4" in msg   # max 언급

    def test_multiple_overflow_teams_all_reported(self):
        cfg = MapConfig(seat_cols=2, seat_rows=1)  # max=2
        teams = [
            TeamSpec(name="TeamA", headcount=5),
            TeamSpec(name="TeamB", headcount=3),
        ]
        with pytest.raises(MapGeneratorError) as exc_info:
            generate_office_map(teams, cfg)
        msg = str(exc_info.value)
        assert "TeamA" in msg
        assert "TeamB" in msg

    def test_exact_capacity_ok(self):
        """headcount == max_seats_per_zone → 에러 없음."""
        cfg = MapConfig(seat_cols=2, seat_rows=2)  # max=4
        teams = [TeamSpec(name="Full", headcount=4)]
        result = generate_office_map(teams, cfg)
        seats = next(l for l in result["layers"] if l["name"] == "seats")
        assert len(seats["objects"]) == 4

    def test_validate_capacity_standalone(self):
        cfg = MapConfig(seat_cols=3, seat_rows=2)  # max=6
        good = [TeamSpec(name="OK", headcount=6)]
        _validate_capacity(good, cfg)  # 예외 없음

    def test_validate_capacity_raises_standalone(self):
        cfg = MapConfig(seat_cols=3, seat_rows=2)  # max=6
        bad = [TeamSpec(name="Bad", headcount=7)]
        with pytest.raises(MapGeneratorError):
            _validate_capacity(bad, cfg)


# ---------------------------------------------------------------------------
# 격자 배치 (zones_per_row)
# ---------------------------------------------------------------------------

class TestGridLayout:
    def test_map_wider_with_more_teams_per_row(self):
        """zones_per_row=3 > 1 → 맵 너비 더 넓음."""
        single_cfg = MapConfig(zones_per_row=1)
        multi_cfg = MapConfig(zones_per_row=3)
        teams = [TeamSpec(name=f"T{i}", headcount=1) for i in range(3)]
        w1 = generate_office_map(teams, single_cfg)["width"]
        w3 = generate_office_map(teams, multi_cfg)["width"]
        assert w3 > w1

    def test_one_team_row_height_minimal(self):
        """팀 1개: 행 1줄 → 높이가 2줄 팀 배치보다 작음."""
        cfg = MapConfig(zones_per_row=1)
        one_team = [TeamSpec(name="A", headcount=1)]
        two_teams = [TeamSpec(name="A", headcount=1), TeamSpec(name="B", headcount=1)]
        h1 = generate_office_map(one_team, cfg)["height"]
        h2 = generate_office_map(two_teams, cfg)["height"]
        assert h2 > h1


# ---------------------------------------------------------------------------
# 맵 크기 계산 정합
# ---------------------------------------------------------------------------

class TestMapSizeCalculation:
    def test_map_dimensions_positive(self, single_team, default_config):
        result = generate_office_map(single_team, default_config)
        assert result["width"] > 0
        assert result["height"] > 0

    def test_map_width_formula(self):
        cfg = MapConfig(zone_width=10, zones_per_row=3, margin_tiles=2)
        teams = [TeamSpec(name=f"T{i}", headcount=1) for i in range(3)]
        result = generate_office_map(teams, cfg)
        expected_width = cfg.zones_per_row * (cfg.zone_width + cfg.margin_tiles) + cfg.margin_tiles
        assert result["width"] == expected_width

    def test_map_width_single_zone(self):
        cfg = MapConfig(zone_width=8, zones_per_row=3, margin_tiles=2)
        teams = [TeamSpec(name="Solo", headcount=1)]
        result = generate_office_map(teams, cfg)
        # zones_per_row=3 이지만 팀 1개 → 맵 너비는 zones_per_row 기준으로 계산
        expected_width = cfg.zones_per_row * (cfg.zone_width + cfg.margin_tiles) + cfg.margin_tiles
        assert result["width"] == expected_width


# ---------------------------------------------------------------------------
# 존 이름 안전화 (_safe_zone_name)
# ---------------------------------------------------------------------------

class TestSafeZoneName:
    def test_english_name(self):
        assert _safe_zone_name("Engineering") == "team_engineering"

    def test_korean_name(self):
        name = _safe_zone_name("엔지니어링")
        assert name.startswith("team_")
        assert len(name) > len("team_")

    def test_spaces_become_underscore(self):
        name = _safe_zone_name("Sales Team")
        assert " " not in name
        assert "_" in name

    def test_special_chars_removed(self):
        name = _safe_zone_name("Team@#!")
        assert "@" not in name
        assert "#" not in name

    def test_empty_name_fallback(self):
        name = _safe_zone_name("")
        assert name == "team_team"

    def test_always_ascii_safe(self):
        """존 이름은 WA scripting API에서 JS 변수로 쓰이므로 ASCII 안전해야 함."""
        name = _safe_zone_name("마케팅-팀 2024!")
        # 결과는 ASCII 소문자 + 언더스코어만
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789_")
        stripped = name[len("team_"):]  # 'team_' 접두사 제거
        assert all(c in allowed for c in stripped), f"비ASCII 문자 포함: {name}"


# ---------------------------------------------------------------------------
# D20-c GPS 금지 확인
# ---------------------------------------------------------------------------

class TestNoGpsCode:
    def test_no_gps_in_map_generator(self):
        """D20-c: GPS 관련 코드(import/변수명) 없음 — 정책 주석은 허용."""
        import ast
        import inspect
        import app.services.map_generator as mod
        source = inspect.getsource(mod)
        tree = ast.parse(source)
        # GPS 관련 모듈 import 금지
        gps_import_names = {"gps", "geopy", "geolocation", "geocoder"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in getattr(node, "names", []):
                    assert alias.name.lower() not in gps_import_names, (
                        f"GPS 모듈 import 발견 — D20-c 위반: {alias.name}"
                    )
                mod_name = getattr(node, "module", "") or ""
                assert mod_name.lower() not in gps_import_names, (
                    f"GPS 모듈 from-import 발견 — D20-c 위반: {mod_name}"
                )
        # GPS 관련 식별자(변수/함수명) 금지
        gps_id_names = {"latitude", "longitude", "lat_lng", "get_location", "get_coordinates"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Name, ast.Attribute, ast.FunctionDef, ast.AsyncFunctionDef)):
                name = getattr(node, "id", None) or getattr(node, "attr", None) or getattr(node, "name", None)
                if name and name.lower() in gps_id_names:
                    raise AssertionError(f"GPS 식별자 '{name}' 발견 — D20-c 위반")
