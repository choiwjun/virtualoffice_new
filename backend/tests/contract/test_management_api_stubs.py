"""
관리 API 계약 테스트 스텁 (Phase 0)

참조:
- docs/api/management-api.yaml: API 명세
- 00-decisions.md: D4(JWT), D10(좌석 배정), D12(레이아웃 검증), D14(KPI), D15(이의신청)
- 04-data-model.md: 엔티티 스키마
- test-strategy.md: 테스트 전략

구성:
- 모든 P0 관리 API 엔드포인트의 기본 테스트 케이스 골격
- 구현 전이므로 @pytest.mark.skip 마킹
- Phase 1: 실제 구현과 함께 테스트 활성화

테스트 케이스 수: ~61개
- 인증: 5개
- 좌석: 8개
- 레이아웃: 10개
- 회의: 8개
- 회의록: 5개
- 업무: 6개
- KPI: 12개
- 동기화: 4개
- 감사: 3개
"""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4


# ============================================================================
# 인증 API (Authentication)
# ============================================================================

class TestAuthAPI:
    """
    POST /auth/login: 사용자 로그인 및 JWT 토큰 발급

    명세:
    - 요청: { email, password }
    - 응답: { token, refresh_token, user }
    - 에러: 401 Unauthorized (잘못된 credentials)
    """

    async def test_auth_login_success(self, async_client, test_user):
        """
        로그인 성공 시 201 + JWT 토큰 반환

        @TEST T1.1.1 - 인증 성공 케이스
        @IMPL app/api/routes/auth.py::login
        @SPEC docs/api/management-api.yaml#/auth/login
        """
        response = await async_client.post(
            "/auth/login",
            json={
                "email": test_user["email"],
                "password": "TestPass123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert "token" in data
        assert "refresh_token" in data
        assert data["user"]["email"] == test_user["email"]

    async def test_auth_login_invalid_password(self, async_client, test_user):
        """
        잘못된 비밀번호 → 401 Unauthorized

        @TEST T1.1.2 - 인증 실패 (잘못된 비밀번호)
        """
        response = await async_client.post(
            "/auth/login",
            json={
                "email": test_user["email"],
                "password": "WrongPassword!"
            }
        )
        assert response.status_code == 401

    async def test_auth_login_nonexistent_user(self, async_client):
        """
        존재하지 않는 사용자 → 401 Unauthorized

        @TEST T1.1.3 - 인증 실패 (미존재 사용자)
        """
        response = await async_client.post(
            "/auth/login",
            json={
                "email": "nonexistent@example.com",
                "password": "AnyPassword!"
            }
        )
        assert response.status_code == 401

    async def test_auth_login_missing_email(self, async_client):
        """
        필수 필드 누락 (email) → 400 Bad Request

        @TEST T1.1.4 - 입력 검증 (필수 필드)
        """
        response = await async_client.post(
            "/auth/login",
            json={"password": "TestPass123!"}
        )
        assert response.status_code == 400

    async def test_auth_refresh_token(self, async_client, test_user):
        """
        Refresh 토큰으로 새 Access 토큰 발급 → 200

        POST /auth/refresh (login이 발급한 refresh_token 사용; access 토큰 재사용 차단)

        @TEST T1.1.5 - 토큰 갱신
        """
        login = await async_client.post(
            "/auth/login",
            json={"email": test_user["email"], "password": "TestPass123!"},
        )
        refresh_token = login.json()["refresh_token"]
        response = await async_client.post(
            "/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data


# ============================================================================
# 좌석 배치 API (Seat Assignment)
# ============================================================================

class TestSeatAssignmentAPI:
    """
    좌석 CRUD 및 배정 관리

    명세:
    - GET /seats: 모든 좌석 조회 (필터: 층, 상태)
    - POST /seats: 좌석 생성
    - POST /seats/{seat_number}/assign: 좌석 배정
    - DELETE /seats/{seat_number}/assign: 배정 해제
    - GET /seats/available: 사용 가능 좌석 조회 (자율좌석 용)
    - POST /seats/{seat_number}/occupy: 자율좌석 점유
    - DELETE /seats/{seat_number}/occupy: 자율좌석 반납

    @SPEC 00-decisions.md D10 (좌석배정=layout JSON에서 분리,
    seat.assigned_user_id 현재값 + seat_assignment_history 이력)
    """

    @staticmethod
    async def _seed_floor(db_session):
        """Office + Floor 시드 (Seat.floor_id FK 대상)."""
        import uuid

        from app.models.tables import Floor, Office

        office = Office(id=uuid.uuid4(), company_id=uuid.uuid4(), name="Test Office")
        db_session.add(office)
        await db_session.flush()
        floor = Floor(id=uuid.uuid4(), office_id=office.id, level=1, name="1F")
        db_session.add(floor)
        await db_session.flush()
        return floor

    @classmethod
    async def _seed_seat(cls, db_session, seat_number, seat_type="fixed", seat_status="available"):
        """Seat 시드 (유효 SeatType/SeatStatus, coords JSONB, floor_id 필수)."""
        from app.models.tables import Seat, SeatStatus, SeatType

        floor = await cls._seed_floor(db_session)
        seat = Seat(
            floor_id=floor.id,
            seat_number=seat_number,
            type=SeatType(seat_type),
            status=SeatStatus(seat_status),
            coords={"x": 1.0, "y": 2.0, "facing": 0},
        )
        db_session.add(seat)
        await db_session.commit()
        await db_session.refresh(seat)
        return seat

    async def test_list_seats(self, async_client, auth_headers, db_session):
        """
        전체 좌석 목록 조회 → 200 + seats 배열

        GET /seats

        @TEST T1.2.1 - 좌석 목록 조회
        """
        await self._seed_seat(db_session, "1F-A01", seat_type="fixed")

        response = await async_client.get(
            "/seats",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "seats" in data
        assert isinstance(data["seats"], list)
        assert any(s["seat_number"] == "1F-A01" for s in data["seats"])

    async def test_create_seat(self, async_client, admin_auth_headers, db_session):
        """
        새 좌석 생성 → 201 + SeatOut(floor_id, seat_number)

        POST /seats

        @TEST T1.2.2 - 좌석 생성
        """
        floor = await self._seed_floor(db_session)

        response = await async_client.post(
            "/seats",
            json={
                "floor_id": str(floor.id),
                "seat_number": "1F-A01",
                "type": "fixed",
                "coords": {"x": 10.0, "y": 10.0, "facing": 0},
            },
            headers=admin_auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["seat_number"] == "1F-A01"
        assert data["floor_id"] == str(floor.id)
        assert data["type"] == "fixed"
        assert data["status"] == "available"

    async def test_assign_seat(self, async_client, admin_auth_headers, test_user, db_session):
        """
        직원에게 좌석 배정 → 200 + assigned_user_id 반영

        POST /seats/{seat_number}/assign

        @TEST T1.2.3 - 좌석 배정
        """
        await self._seed_seat(db_session, "1F-A01", seat_type="fixed")

        response = await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["id"]},
            headers=admin_auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_user_id"] == test_user["id"]
        assert data["status"] == "occupied"

    async def test_assign_seat_duplicate(self, async_client, admin_auth_headers, test_user, db_session):
        """
        중복 배정 시도 (이미 배정된 좌석) → 409 Conflict

        @TEST T1.2.4 - 중복 배정 방지 (uk_current_seat 배타성)
        """
        await self._seed_seat(db_session, "1F-A01", seat_type="fixed")

        # 첫 번째 배정
        first = await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["id"]},
            headers=admin_auth_headers
        )
        assert first.status_code == 200

        # 두 번째 배정 (같은 좌석)
        response = await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["id"]},
            headers=admin_auth_headers
        )
        assert response.status_code == 409

    async def test_unassign_seat(self, async_client, admin_auth_headers, test_user, db_session):
        """
        좌석 배정 해제 → 200 + assigned_user_id None, status available

        DELETE /seats/{seat_number}/assign

        @TEST T1.2.5 - 좌석 배정 해제
        """
        await self._seed_seat(db_session, "1F-A01", seat_type="fixed")
        assign_resp = await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["id"]},
            headers=admin_auth_headers
        )
        assert assign_resp.status_code == 200

        response = await async_client.delete(
            "/seats/1F-A01/assign",
            headers=admin_auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_user_id"] is None
        assert data["status"] == "available"

    async def test_available_seats(self, async_client, auth_headers, db_session):
        """
        사용 가능 좌석 조회 (자율좌석 용) → 200

        GET /seats/available

        @TEST T1.2.6 - 사용 가능 좌석 조회
        """
        await self._seed_seat(db_session, "1F-A01", seat_type="fixed", seat_status="available")

        response = await async_client.get(
            "/seats/available",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "available_seats" in data
        assert any(s["seat_number"] == "1F-A01" for s in data["available_seats"])

    async def test_occupy_flexible_seat(self, async_client, auth_headers, test_user, db_session):
        """
        자율좌석 점유 (임시 배정) → 200

        POST /seats/{seat_number}/occupy

        @TEST T1.2.7 - 자율좌석 점유
        """
        await self._seed_seat(db_session, "1F-FLEX-01", seat_type="free", seat_status="available")

        response = await async_client.post(
            "/seats/1F-FLEX-01/occupy",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_user_id"] == test_user["id"]
        assert data["status"] == "occupied"

    async def test_release_flexible_seat(self, async_client, auth_headers, test_user, db_session):
        """
        자율좌석 반납 → 200

        DELETE /seats/{seat_number}/occupy

        @TEST T1.2.8 - 자율좌석 반납
        """
        await self._seed_seat(db_session, "1F-FLEX-01", seat_type="free", seat_status="available")
        occupy_resp = await async_client.post(
            "/seats/1F-FLEX-01/occupy",
            headers=auth_headers
        )
        assert occupy_resp.status_code == 200

        response = await async_client.delete(
            "/seats/1F-FLEX-01/occupy",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_user_id"] is None
        assert data["status"] == "available"


# ============================================================================
# 오피스 레이아웃 API (Office Layout)
# ============================================================================

class TestOfficeLayoutAPI:
    """
    레이아웃 CRUD, 검증, 배포, 롤백

    명세:
    - GET /layouts: 레이아웃 버전 목록
    - POST /layouts: 레이아웃 생성
    - GET /layouts/{id}: 개별 레이아웃 조회
    - PUT /layouts/{id}: 레이아웃 수정
    - POST /layouts/{id}/deploy: 배포 (admin만)
    - POST /layouts/{id}/rollback: 롤백 (admin만)
    - POST /layouts/validate: 검증 (배포 전 확인)

    참조: D12(서버 단일 정밀 검증), 05-office-layout-schema.md

    layout_id는 실제로는 UUID(OfficeLayout.id)이며, 계약 스텁의 문자열 리터럴
    ('layout-001')은 시드된 실제 UUID로 대체한다. 배포/롤백/현재조회 해피패스는
    05-office-layout-schema.md §4 샘플 JSON(자체 검증 통과 명시)에서 파생한
    _DEPLOYABLE_LAYOUT을 사용하며, 아래 test_deployable_layout_sample_is_valid에서
    validate_office_layout(...).is_deployable is True 임을 별도로 검증한다.
    """

    # 05-office-layout-schema.md §4 예시 JSON(자체 검증 통과 명시)에서 파생.
    # spawn_points를 빈 배열로 둔 것 외에는 동일 구조 — reachability 검증은
    # spawn이 없으면 WARNING(REACH_NO_SPAWN)만 발생시키고 ERROR 없음(D12: WARNING 무시 가능).
    _DEPLOYABLE_LAYOUT = {
        "metadata": {
            "version": "1.1",
            "schema_version": 1,
            "layout_id": "550e8400-e29b-41d4-a716-446655440001",
            "office_id": "550e8400-e29b-41d4-a716-446655440010",
            "floor_id": "550e8400-e29b-41d4-a716-446655440020",
            "floor_name": "3F",
            "created_at": "2026-07-01T10:00:00Z",
            "updated_at": "2026-07-02T09:10:00Z",
            "created_by": 101,
            "updated_by": 102,
            "description": "Sample deployable layout (05-office-layout-schema.md sec 4)",
            "language": "ko-KR",
        },
        "floor": {
            "id": "550e8400-e29b-41d4-a716-446655440020",
            "level": 3,
            "name": "3F",
            "total_area_m2": 2500,
            "coordinate_origin": "top_left",
            "floor_height_m": 8.4,
            "grid_snap_unit_cm": 10,
            "unit_system": "metric",
        },
        "dimensions": {
            "width_m": 80.0, "height_m": 60.0,
            "min_x": 0.0, "max_x": 80.0, "min_y": 0.0, "max_y": 60.0,
            "unit": "meter",
        },
        "zones": [
            {
                "zone_id": "Z_001", "team_zone_db_id": "550e8400-e29b-41d4-a716-446655440030",
                "org_group_id": "550e8400-e29b-41d4-a716-446655440040", "erp_team_id": 201,
                "label": "Dev Team", "type": "team", "color": "#4A90E2",
                "polygon": [
                    {"x": 0.0, "y": 0.0}, {"x": 25.0, "y": 0.0},
                    {"x": 25.0, "y": 20.0}, {"x": 0.0, "y": 20.0},
                ],
                "access_control": {"allowed_roles": ["admin", "leader", "employee"], "restricted": False},
                "visual": {"show_boundary": True, "boundary_style": "dashed", "boundary_width_cm": 2},
            },
            {
                "zone_id": "Z_002", "team_zone_db_id": "550e8400-e29b-41d4-a716-446655440031",
                "org_group_id": "550e8400-e29b-41d4-a716-446655440040", "erp_team_id": 202,
                "label": "Marketing Team", "type": "team", "color": "#E24A8E",
                "polygon": [
                    {"x": 25.0, "y": 0.0}, {"x": 50.0, "y": 0.0},
                    {"x": 50.0, "y": 20.0}, {"x": 25.0, "y": 20.0},
                ],
                "access_control": {"allowed_roles": ["admin", "leader", "employee"], "restricted": False},
                "visual": {"show_boundary": True, "boundary_style": "dashed", "boundary_width_cm": 2},
            },
        ],
        "rooms": [
            {
                "room_id": "R_001", "room_db_id": "550e8400-e29b-41d4-a716-446655440050",
                "name": "Meeting Room A", "type": "meeting", "capacity": 6,
                "floor_id": "550e8400-e29b-41d4-a716-446655440020",
                "coords": {"x": 55.0, "y": 5.0, "width": 6.0, "height": 4.5},
                "entrance": {
                    "trigger_x": 57.4, "trigger_y": 8.5,
                    "trigger_width": 1.5, "trigger_height": 0.8, "entry_direction": "south",
                },
                "livekit_room": "meeting_3f_001", "capacity_mode": "by_room", "max_concurrent_users": 6,
                "doors": [
                    {"door_id": "D_R001_S", "wall": "south", "offset": 3.0, "width": 1.2, "door_type": "glass_single"},
                ],
                "glass_walls": [
                    {"wall_id": "GW_001", "edge": "south", "start": {"x": 55.0, "y": 9.5}, "end": {"x": 61.0, "y": 9.5}, "transparency": 0.7, "frame_color": "#333333"},
                ],
                "climate": {"ac_outlet": {"x": 56.0, "y": 6.0}},
                "markers": {"whiteboard": {"x": 56.5, "y": 7.0}, "projector": {"x": 57.5, "y": 5.5}},
            },
            {
                "room_id": "R_002", "room_db_id": "550e8400-e29b-41d4-a716-446655440051",
                "name": "Lounge", "type": "lounge", "capacity": 15,
                "floor_id": "550e8400-e29b-41d4-a716-446655440020",
                "coords": {"x": 65.0, "y": 15.0, "width": 12.0, "height": 8.0},
                "entrance": {
                    "trigger_x": 68.0, "trigger_y": 22.2,
                    "trigger_width": 2.0, "trigger_height": 0.8, "entry_direction": "south",
                },
                "livekit_room": None, "capacity_mode": "by_room", "max_concurrent_users": 15,
                "doors": [
                    {"door_id": "D_R002_S", "wall": "south", "offset": 4.0, "width": 2.0, "door_type": "open"},
                ],
                "glass_walls": [],
                "climate": {"ac_outlet": {"x": 70.0, "y": 18.0}},
                "markers": {"coffee_machine": {"x": 66.0, "y": 17.0}, "snack_table": {"x": 72.0, "y": 19.0}},
            },
        ],
        "seats": [
            {"seat_id": "S_001", "seat_db_id": "550e8400-e29b-41d4-a716-446655440060", "team_zone_id": "550e8400-e29b-41d4-a716-446655440030", "seat_type": "fixed", "coords": {"x": 3.5, "y": 2.0}, "facing": 180, "furniture_id": "F_001", "desk_dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "lifecycle_status": "deployed", "accessibility": {"wheelchair_accessible": False, "ergonomic_type": "standard"}, "nearby_amenities": {"has_monitor_stand": True, "has_keyboard": True, "has_phone": False}},
            {"seat_id": "S_002", "seat_db_id": "550e8400-e29b-41d4-a716-446655440061", "team_zone_id": "550e8400-e29b-41d4-a716-446655440030", "seat_type": "fixed", "coords": {"x": 5.0, "y": 2.0}, "facing": 180, "furniture_id": "F_002", "desk_dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "lifecycle_status": "deployed", "accessibility": {"wheelchair_accessible": False, "ergonomic_type": "standard"}, "nearby_amenities": {"has_monitor_stand": True, "has_keyboard": True, "has_phone": False}},
            {"seat_id": "S_003", "seat_db_id": "550e8400-e29b-41d4-a716-446655440062", "team_zone_id": "550e8400-e29b-41d4-a716-446655440030", "seat_type": "free", "coords": {"x": 6.5, "y": 2.0}, "facing": 180, "furniture_id": "F_003", "desk_dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "lifecycle_status": "deployed", "accessibility": {"wheelchair_accessible": False, "ergonomic_type": "standard"}, "nearby_amenities": {"has_monitor_stand": True, "has_keyboard": True, "has_phone": False}},
            {"seat_id": "S_101", "seat_db_id": "550e8400-e29b-41d4-a716-446655440063", "team_zone_id": "550e8400-e29b-41d4-a716-446655440031", "seat_type": "fixed", "coords": {"x": 28.0, "y": 3.0}, "facing": 180, "furniture_id": "F_101", "desk_dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "lifecycle_status": "deployed", "accessibility": {"wheelchair_accessible": False, "ergonomic_type": "standard"}, "nearby_amenities": {"has_monitor_stand": True, "has_keyboard": True, "has_phone": True}},
        ],
        "furniture": [
            {"furniture_id": "F_001", "asset_id": "DESK_STANDARD_001", "type": "desk", "category": "workspace", "coords": {"x": 3.5, "y": 2.0, "rotation": 0}, "dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "collision": True, "physics": {"type": "static", "mass": 0}, "visual": {"color": "#D4A574", "material": "wood"}, "interactive": False},
            {"furniture_id": "F_002", "asset_id": "DESK_STANDARD_001", "type": "desk", "category": "workspace", "coords": {"x": 5.0, "y": 2.0, "rotation": 0}, "dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "collision": True, "physics": {"type": "static", "mass": 0}, "visual": {"color": "#D4A574", "material": "wood"}, "interactive": False},
            {"furniture_id": "F_003", "asset_id": "DESK_STANDARD_001", "type": "desk", "category": "workspace", "coords": {"x": 6.5, "y": 2.0, "rotation": 0}, "dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "collision": True, "physics": {"type": "static", "mass": 0}, "visual": {"color": "#D4A574", "material": "wood"}, "interactive": False},
            {"furniture_id": "F_101", "asset_id": "DESK_STANDARD_001", "type": "desk", "category": "workspace", "coords": {"x": 28.0, "y": 3.0, "rotation": 0}, "dimension": {"width": 1.5, "depth": 0.8, "height": 0.75}, "collision": True, "physics": {"type": "static", "mass": 0}, "visual": {"color": "#D4A574", "material": "wood"}, "interactive": False},
            {"furniture_id": "F_CABINET_001", "asset_id": "CABINET_STORAGE_001", "type": "cabinet", "category": "storage", "coords": {"x": 15.0, "y": 1.0, "rotation": 0}, "dimension": {"width": 1.2, "depth": 0.6, "height": 2.0}, "collision": True, "physics": {"type": "static", "mass": 0}, "visual": {"color": "#CCCCCC", "material": "metal"}, "interactive": False},
            {"furniture_id": "F_SOFA_LOUNGE", "asset_id": "SOFA_3SEAT_001", "type": "sofa", "category": "lounge", "coords": {"x": 68.0, "y": 17.0, "rotation": 0}, "dimension": {"width": 2.1, "depth": 0.9, "height": 0.8}, "collision": True, "physics": {"type": "static", "mass": 0}, "visual": {"color": "#4A4A4A", "material": "fabric"}, "interactive": False},
        ],
        "colliders": [
            {"collider_id": "C_EXT_WALL_NORTH", "shape": "box", "box": {"x": 0.0, "y": 0.0, "width": 80.0, "height": 0.3, "rotation": 0}, "physics": {"is_kinematic": False, "block_avatar": True, "block_interaction": False}, "layer": 1, "description": "north exterior wall"},
            {"collider_id": "C_EXT_WALL_SOUTH", "shape": "box", "box": {"x": 0.0, "y": 59.7, "width": 80.0, "height": 0.3, "rotation": 0}, "physics": {"is_kinematic": False, "block_avatar": True, "block_interaction": False}, "layer": 1, "description": "south exterior wall"},
        ],
        "spawn_points": [],
        "spawn_default": {"spawn_id": "SP_LOBBY", "fallback_spawn_id": "SP_LOBBY", "facing_default": 0},
        "minimap": {
            "enabled": True, "viewport_x": 0.0, "viewport_y": 0.0,
            "viewport_width": 80.0, "viewport_height": 60.0,
            "pixel_width": 400, "pixel_height": 300, "pixels_per_meter": 5.0,
            "show_zones": True, "show_seats": True, "show_rooms": True, "show_avatars": True, "show_grid": False,
            "layers": [
                {"layer_id": "base", "type": "background", "color": "#F5F5F5"},
                {"layer_id": "zones", "type": "vector", "visible": True},
                {"layer_id": "rooms", "type": "vector", "visible": True},
                {"layer_id": "seats", "type": "vector", "visible": True},
                {"layer_id": "avatars", "type": "raster", "visible": True},
            ],
        },
        "connections": {
            "floor_adjacencies": [],
            "exit_points": [],
            "zone_to_room_shortcuts": [
                {"zone_id": "Z_001", "room_id": "R_001", "relation": "primary_meeting_room"},
            ],
        },
        "performance": {
            "total_furniture_count": 6, "total_colliders": 2, "total_assets": 3,
            "estimated_polygon_count": 118000, "estimated_draw_calls": 9, "estimated_memory_mb": 96,
            "recommended_device_tier": "low",
            "optimization_notes": "Sample layout; 4 desks share one asset_id so they batch into a single draw call.",
        },
    }

    @classmethod
    def _deployable_layout(cls) -> dict:
        """뮤테이션 방지를 위한 깊은 복사본 반환."""
        import copy

        return copy.deepcopy(cls._DEPLOYABLE_LAYOUT)

    def test_deployable_layout_sample_is_valid(self):
        """
        _DEPLOYABLE_LAYOUT이 서버 검증(D12)을 통과함을 직접 증명한다
        (deploy/rollback/current 해피패스 전제 조건).

        @TEST G004 - 샘플 레이아웃 deployable 증명
        """
        from app.services.office_layout_validator import validate_office_layout

        result = validate_office_layout(self._deployable_layout())
        print(
            f"[G004] sample layout deployable={result.is_deployable} "
            f"errors={[e.as_dict() for e in result.errors]} "
            f"warnings={len(result.warnings)}"
        )
        assert result.is_deployable is True
        assert result.errors == []

    @staticmethod
    async def _seed_office_floor(db_session):
        """Office + Floor 시드 (OfficeLayout.office_id/floor_id FK 대상)."""
        import uuid

        from app.models.tables import Floor, Office

        office = Office(id=uuid.uuid4(), company_id=uuid.uuid4(), name="Test Office")
        db_session.add(office)
        await db_session.flush()
        floor = Floor(id=uuid.uuid4(), office_id=office.id, level=1, name="1F")
        db_session.add(floor)
        await db_session.flush()
        await db_session.commit()
        return office, floor

    @classmethod
    async def _create_layout(cls, async_client, admin_auth_headers, db_session, layout_json=None):
        """Office/Floor 시드 후 POST /layouts로 실제 UUID를 가진 레이아웃 생성."""
        office, floor = await cls._seed_office_floor(db_session)
        response = await async_client.post(
            "/layouts",
            json={
                "office_id": str(office.id),
                "floor_id": str(floor.id),
                "json": layout_json if layout_json is not None else cls._deployable_layout(),
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201, response.text
        return response.json(), office, floor

    async def test_list_layouts(self, async_client, admin_auth_headers, auth_headers, db_session):
        """
        레이아웃 버전 목록 조회 → 200

        GET /layouts

        @TEST T1.3.1 - 레이아웃 목록
        """
        created, _office, _floor = await self._create_layout(async_client, admin_auth_headers, db_session)

        response = await async_client.get(
            "/layouts",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "layouts" in data
        assert any(l["layout_id"] == created["layout_id"] for l in data["layouts"])

    async def test_create_layout(self, async_client, admin_auth_headers, test_layout, db_session):
        """
        레이아웃 생성 → 201

        POST /layouts

        @TEST T1.3.2 - 레이아웃 생성
        """
        office, floor = await self._seed_office_floor(db_session)
        response = await async_client.post(
            "/layouts",
            json={"office_id": str(office.id), "floor_id": str(floor.id), "json": test_layout},
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert "layout_id" in data
        assert data["status"] == "draft"
        assert data["version"] == 1

    async def test_validate_layout(self, async_client, admin_auth_headers, test_layout):
        """
        레이아웃 검증 (배포 전) → 200 또는 400 (검증 실패)

        POST /layouts/validate

        근거 (D12):
        - 서버 단일 정밀 검증 (JSON Schema + 도달성 A*)
        - ERROR는 배포 불가
        - WARNING만 무시 가능

        @TEST T1.3.3 - 레이아웃 검증
        """
        response = await async_client.post(
            "/layouts/validate",
            json=test_layout,
            headers=admin_auth_headers,
        )
        assert response.status_code in [200, 400]
        data = response.json()
        assert "errors" in data or "warnings" in data

    async def test_validate_layout_invalid_json(self, async_client, admin_auth_headers):
        """
        잘못된 레이아웃 JSON → 400

        @TEST T1.3.4 - 레이아웃 검증 실패 (스키마)
        """
        response = await async_client.post(
            "/layouts/validate",
            json={"invalid": "schema"},
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        data = response.json()
        assert data["deployable"] is False
        assert len(data["errors"]) > 0

    async def test_deploy_layout(self, async_client, admin_auth_headers, db_session):
        """
        레이아웃 배포 → 200 (deployable 샘플 사용)

        POST /layouts/{id}/deploy

        동작:
        1. 레이아웃 검증 (자동)
        2. ERROR 있으면 배포 거부 (400)
        3. 검증 통과 → status=deployed, deployed_at 기록

        @TEST T1.3.5 - 레이아웃 배포
        """
        created, _office, _floor = await self._create_layout(async_client, admin_auth_headers, db_session)

        response = await async_client.post(
            f"/layouts/{created['layout_id']}/deploy",
            headers=admin_auth_headers,
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == "deployed"
        assert data["deployed_at"] is not None

    async def test_deploy_layout_rejects_validation_errors(
        self, async_client, admin_auth_headers, test_layout, db_session
    ):
        """
        검증 ERROR가 있는 레이아웃 배포 시도 → 400 (D12 배포 게이트 실증).

        test_layout(최소 스텁)은 05 공식 스키마 필수 필드(dimensions 등)가 없어
        SCHEMA ERROR가 발생 → is_deployable=False → 배포 거부되어야 한다.

        @TEST G004 - 배포 검증 게이트(ERROR→400)
        """
        office, floor = await self._seed_office_floor(db_session)
        create_resp = await async_client.post(
            "/layouts",
            json={"office_id": str(office.id), "floor_id": str(floor.id), "json": test_layout},
            headers=admin_auth_headers,
        )
        assert create_resp.status_code == 201
        layout_id = create_resp.json()["layout_id"]

        response = await async_client.post(
            f"/layouts/{layout_id}/deploy",
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        data = response.json()
        assert data["deployable"] is False
        assert len(data["errors"]) > 0

    async def test_deploy_layout_permission_denied(self, async_client, admin_auth_headers, auth_headers, db_session):
        """
        일반 사용자가 배포 시도 → 403 Forbidden

        @TEST T1.3.6 - 배포 권한 검증
        """
        created, _office, _floor = await self._create_layout(async_client, admin_auth_headers, db_session)

        response = await async_client.post(
            f"/layouts/{created['layout_id']}/deploy",
            headers=auth_headers,
        )
        assert response.status_code == 403

    async def test_layout_version_history(self, async_client, admin_auth_headers, auth_headers, db_session):
        """
        레이아웃 버전 히스토리 조회 → 200

        GET /layouts/{id}/history

        @TEST T1.3.7 - 버전 히스토리
        """
        v1, office, floor = await self._create_layout(async_client, admin_auth_headers, db_session)
        v2_resp = await async_client.post(
            "/layouts",
            json={
                "office_id": str(office.id),
                "floor_id": str(floor.id),
                "json": self._deployable_layout(),
            },
            headers=admin_auth_headers,
        )
        assert v2_resp.status_code == 201
        v2 = v2_resp.json()
        assert v2["version"] == 2

        response = await async_client.get(
            f"/layouts/{v1['layout_id']}/history",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "versions" in data
        versions = {v["version"] for v in data["versions"]}
        assert versions == {1, 2}

    async def test_rollback_layout(self, async_client, admin_auth_headers, db_session):
        """
        레이아웃 롤백 (이전 버전으로) → 200

        POST /layouts/{id}/rollback?version=1 (v1 배포 → v2 생성 → v1로 롤백)

        @TEST T1.3.8 - 레이아웃 롤백
        """
        v1, office, floor = await self._create_layout(async_client, admin_auth_headers, db_session)
        deploy_resp = await async_client.post(
            f"/layouts/{v1['layout_id']}/deploy", headers=admin_auth_headers
        )
        assert deploy_resp.status_code == 200

        v2_resp = await async_client.post(
            "/layouts",
            json={
                "office_id": str(office.id),
                "floor_id": str(floor.id),
                "json": self._deployable_layout(),
            },
            headers=admin_auth_headers,
        )
        assert v2_resp.status_code == 201
        v2 = v2_resp.json()
        v2_deploy = await async_client.post(
            f"/layouts/{v2['layout_id']}/deploy", headers=admin_auth_headers
        )
        assert v2_deploy.status_code == 200

        response = await async_client.post(
            f"/layouts/{v2['layout_id']}/rollback?version=1",
            headers=admin_auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["version"] == 1
        assert data["status"] == "deployed"

        v2_check = await async_client.get(f"/layouts/{v2['layout_id']}", headers=admin_auth_headers)
        assert v2_check.json()["status"] == "archived"

    async def test_get_current_layout(self, async_client, admin_auth_headers, auth_headers, db_session):
        """
        현재 배포된 레이아웃 조회 → 200

        GET /layouts/current

        @TEST T1.3.9 - 현재 레이아웃 조회
        """
        created, office, floor = await self._create_layout(async_client, admin_auth_headers, db_session)
        deploy_resp = await async_client.post(
            f"/layouts/{created['layout_id']}/deploy", headers=admin_auth_headers
        )
        assert deploy_resp.status_code == 200

        response = await async_client.get(
            "/layouts/current",
            params={"office_id": str(office.id), "floor_id": str(floor.id)},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "layout_json" in data
        assert data["status"] == "deployed"

    async def test_layout_notfound(self, async_client, auth_headers):
        """
        미존재 레이아웃 조회 → 404

        @TEST T1.3.10 - 레이아웃 미존재
        """
        response = await async_client.get(
            "/layouts/nonexistent",
            headers=auth_headers,
        )
        assert response.status_code == 404


# ============================================================================
# 회의 API (Meeting)
# ============================================================================
@pytest_asyncio.fixture
async def test_room(db_session):
    """회의 API 테스트용 회의실 시드 (Office → Floor → Room, RoomType.MEETING)."""
    from app.models.tables import Floor, Office, Room, RoomType

    office = Office(id=uuid4(), company_id=uuid4(), name="본사")
    db_session.add(office)
    await db_session.flush()

    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1층")
    db_session.add(floor)
    await db_session.flush()

    room = Room(
        id=uuid4(),
        floor_id=floor.id,
        type=RoomType.MEETING,
        name="1F-MR01",
        capacity=6,
        coords={"x": 0.0, "y": 0.0, "width": 4.0, "height": 3.0},
    )
    db_session.add(room)
    await db_session.commit()
    await db_session.refresh(room)
    return room


@pytest_asyncio.fixture
async def test_meeting(db_session, test_room, test_user):
    """호스트=test_user(id=1)인 예약된 회의 시드 (join/leave/cancel/participants/conflict 공용)."""
    from app.models.tables import Meeting, MeetingStatus

    meeting = Meeting(
        room_id=test_room.id,
        host_user_id=test_user["id"],
        title="주간 회의",
        description="정기 주간 회의",
        scheduled_at=datetime(2026, 7, 3, 10, 0, tzinfo=timezone.utc),
        scheduled_end=datetime(2026, 7, 3, 11, 0, tzinfo=timezone.utc),
        status=MeetingStatus.SCHEDULED,
    )
    db_session.add(meeting)
    await db_session.commit()
    await db_session.refresh(meeting)
    return meeting


class TestMeetingAPI:
    """
    회의 CRUD, 예약, 입장 관리

    명세:
    - POST /meetings: 회의 생성
    - GET /meetings: 회의 목록 (필터: 기간, 상태)
    - GET /meetings/{id}: 개별 회의 조회
    - DELETE /meetings/{id}: 회의 취소 (호스트만)
    - POST /meetings/{id}/join: 회의 입장 (LiveKit 토큰 발급)
    - POST /meetings/{id}/leave: 회의 퇴장
    - GET /meetings/{id}/participants: 참석자 목록

    참조: D23(예약+FCFS, 충돌 검증), D24(명시적 입장, LiveKit는 FastAPI 경유 단일화)
    """

    async def test_create_meeting(self, async_client, auth_headers, test_room, test_user):
        """
        회의 생성 → 201 (직원도 회의 생성 가능, host_user_id=현재 사용자)

        POST /meetings

        @TEST T1.4.1 - 회의 생성
        """
        response = await async_client.post(
            "/meetings",
            json={
                "title": "팀 회의",
                "room_id": str(test_room.id),
                "start_time": "2026-07-03T10:00:00",
                "end_time": "2026-07-03T11:00:00",
                "description": "주간 회의"
            },
            headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert "meeting_id" in data
        assert data["room_id"] == str(test_room.id)
        assert data["host_user_id"] == test_user["id"]
        assert data["status"] == "scheduled"
        assert data["scheduled_at"].startswith("2026-07-03T10:00:00")
        assert data["scheduled_end"].startswith("2026-07-03T11:00:00")

    async def test_list_meetings(self, async_client, auth_headers, test_meeting):
        """
        회의 목록 조회 → 200

        GET /meetings

        @TEST T1.4.2 - 회의 목록
        """
        response = await async_client.get(
            "/meetings",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "meetings" in data
        ids = [m["meeting_id"] for m in data["meetings"]]
        assert str(test_meeting.id) in ids

    async def test_create_meeting_room_conflict(self, async_client, auth_headers, test_meeting):
        """
        예약 충돌 감지 (같은 회의실, 겹치는 시간) → 409

        근거 (D23): 예약 시스템으로 충돌 방지 — [start,end) 반개구간 겹침 검증

        @TEST T1.4.3 - 예약 충돌 방지
        """
        # test_meeting: room=test_room, 2026-07-03T10:00~11:00, SCHEDULED
        # 충돌하는 시간에 같은 회의실 예약 (10:30~11:30, 10:00~11:00과 겹침)
        response = await async_client.post(
            "/meetings",
            json={
                "title": "회의 2",
                "room_id": str(test_meeting.room_id),
                "start_time": "2026-07-03T10:30:00",
                "end_time": "2026-07-03T11:30:00"
            },
            headers=auth_headers
        )
        assert response.status_code == 409

        # 겹치지 않는 시간(11:00 이후 시작)은 충돌 아님 — 반개구간 경계 검증
        ok_response = await async_client.post(
            "/meetings",
            json={
                "title": "회의 3",
                "room_id": str(test_meeting.room_id),
                "start_time": "2026-07-03T11:00:00",
                "end_time": "2026-07-03T12:00:00"
            },
            headers=auth_headers
        )
        assert ok_response.status_code == 201

    async def test_join_meeting_explicit(self, async_client, auth_headers, test_meeting, db_session):
        """
        회의 입장 (명시적 확인 필수) → 200 + LiveKit 토큰, 최초 입장 시 IN_PROGRESS 전환

        POST /meetings/{id}/join

        근거 (D24): 자동 연결 금지, 명시적 입장 확인
        - 클라이언트: 입장 버튼 클릭
        - 서버: FastAPI 경유 LiveKit 토큰 발급(stub — 실제 LiveKit 연동은 G011 blocker)

        @TEST T1.4.4 - 명시적 회의 입장
        """
        response = await async_client.post(
            f"/meetings/{test_meeting.id}/join",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "livekit_token" in data
        assert data["livekit_token"]
        assert "room_name" in data
        assert data["room_name"] == f"meeting-{test_meeting.id}"

        # DB 회귀 검증: 최초 입장 → status=in_progress, participant upsert
        from app.models.tables import Meeting, MeetingParticipant
        from sqlalchemy import select

        await db_session.refresh(test_meeting)
        refreshed = await db_session.get(Meeting, test_meeting.id)
        assert refreshed.status.value == "in_progress"
        assert refreshed.started_at is not None

        participant = (
            await db_session.execute(
                select(MeetingParticipant).where(
                    MeetingParticipant.meeting_id == test_meeting.id,
                    MeetingParticipant.user_id == 1,
                )
            )
        ).scalar_one_or_none()
        assert participant is not None
        assert participant.joined_at is not None

    async def test_join_meeting_nonexistent(self, async_client, auth_headers):
        """
        미존재 회의 입장 → 404

        @TEST T1.4.5 - 회의 미존재
        """
        response = await async_client.post(
            f"/meetings/{uuid4()}/join",
            headers=auth_headers
        )
        assert response.status_code == 404

        # 비-UUID 문자열도 422가 아닌 404 (수동 파싱 계약)
        response_malformed = await async_client.post(
            "/meetings/nonexistent/join",
            headers=auth_headers
        )
        assert response_malformed.status_code == 404

    async def test_leave_meeting(self, async_client, auth_headers, test_meeting, db_session):
        """
        회의 퇴장 → 200 (입장 후 퇴장 시 left_at 기록)

        POST /meetings/{id}/leave

        @TEST T1.4.6 - 회의 퇴장
        """
        # 먼저 입장해야 participant 레코드가 존재
        join_response = await async_client.post(
            f"/meetings/{test_meeting.id}/join",
            headers=auth_headers
        )
        assert join_response.status_code == 200

        response = await async_client.post(
            f"/meetings/{test_meeting.id}/leave",
            headers=auth_headers
        )
        assert response.status_code == 200

        from app.models.tables import MeetingParticipant
        from sqlalchemy import select

        participant = (
            await db_session.execute(
                select(MeetingParticipant).where(
                    MeetingParticipant.meeting_id == test_meeting.id,
                    MeetingParticipant.user_id == 1,
                )
            )
        ).scalar_one_or_none()
        assert participant is not None
        assert participant.left_at is not None

    async def test_cancel_meeting(self, async_client, auth_headers, leader_token, test_meeting, db_session):
        """
        회의 취소 (호스트만) → 200, 비호스트는 403

        DELETE /meetings/{id}

        @TEST T1.4.7 - 회의 취소 (권한)
        """
        # 비-호스트(leader, sub=2) 취소 시도 → 403
        forbidden_response = await async_client.delete(
            f"/meetings/{test_meeting.id}",
            headers={"Authorization": f"Bearer {leader_token}"}
        )
        assert forbidden_response.status_code == 403

        # 호스트(auth_headers, sub=1 == test_meeting.host_user_id) 취소 → 200
        response = await async_client.delete(
            f"/meetings/{test_meeting.id}",
            headers=auth_headers
        )
        assert response.status_code == 200

        from app.models.tables import Meeting

        await db_session.refresh(test_meeting)
        refreshed = await db_session.get(Meeting, test_meeting.id)
        assert refreshed.status.value == "cancelled"

    async def test_get_participants(self, async_client, auth_headers, test_meeting):
        """
        참석자 목록 조회 → 200

        GET /meetings/{id}/participants

        @TEST T1.4.8 - 참석자 목록
        """
        # 입장하여 참석자 레코드 생성
        join_response = await async_client.post(
            f"/meetings/{test_meeting.id}/join",
            headers=auth_headers
        )
        assert join_response.status_code == 200

        response = await async_client.get(
            f"/meetings/{test_meeting.id}/participants",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "participants" in data
        assert len(data["participants"]) == 1
        assert data["participants"][0]["user_id"] == 1
        assert data["participants"][0]["role"] == "participant"
        assert data["participants"][0]["joined_at"] is not None


# ============================================================================
# 회의록 API (Meeting Minute)
# ============================================================================

class TestMeetingMinuteAPI:
    """
    회의록 조회, STT 초안, 확정 관리

    명세:
    - GET /meetings/{id}/minutes: 회의록 조회
    - GET /meetings/{id}/minutes/stt-draft: STT 초안 조회 (자동 생성)
    - PUT /meetings/{id}/minutes: 회의록 수정 (검토 중)
    - POST /meetings/{id}/minutes/confirm: 회의록 확정 (호스트+admin)

    참조: D5(STT 자동 생성), D20(회의 녹음 고지)
    """

    async def test_get_meeting_minute(self, async_client, auth_headers, test_meeting, db_session):
        """
        회의록 조회 → 200 (시드된 회의+회의록)

        GET /meetings/{id}/minutes

        @TEST T1.5.1 - 회의록 조회
        """
        from app.models.tables import MeetingMinute, MeetingMinuteStatus

        db_session.add(
            MeetingMinute(
                meeting_id=test_meeting.id,
                created_by=test_meeting.host_user_id,
                summary="논의 요약",
                decisions="결정 1\n결정 2",
                status=MeetingMinuteStatus.DRAFT,
            )
        )
        await db_session.commit()

        response = await async_client.get(
            f"/meetings/{test_meeting.id}/minutes",
            headers=auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["meeting_id"] == str(test_meeting.id)
        assert data["status"] == "draft"

    async def test_get_stt_draft(self, async_client, auth_headers, test_meeting, db_session):
        """
        STT 초안 조회 → 200 (저장된 초안) / 404 (미존재)

        GET /meetings/{id}/minutes/stt-draft

        참조 (D5): 실 STT 파이프라인은 G011 환경차단 → 저장된 stt_draft 조회 계약만 검증.

        @TEST T1.5.2 - STT 초안 조회
        """
        from app.models.tables import MeetingMinute, MeetingMinuteStatus

        db_session.add(
            MeetingMinute(
                meeting_id=test_meeting.id,
                created_by=test_meeting.host_user_id,
                decisions="",
                stt_draft="화자1: 안건 공유드립니다.",
                status=MeetingMinuteStatus.DRAFT,
            )
        )
        await db_session.commit()

        response = await async_client.get(
            f"/meetings/{test_meeting.id}/minutes/stt-draft",
            headers=auth_headers
        )
        assert response.status_code in [200, 202, 404]
        if response.status_code == 200:
            assert response.json()["stt_draft"] == "화자1: 안건 공유드립니다."

    async def test_update_meeting_minute(self, async_client, auth_headers, test_meeting):
        """
        회의록 수정 (검토 중) → 200, 최초 수정 시 초안 생성(upsert)

        PUT /meetings/{id}/minutes

        @TEST T1.5.3 - 회의록 수정
        """
        response = await async_client.put(
            f"/meetings/{test_meeting.id}/minutes",
            json={
                "content": "수정된 회의록 내용",
                "decisions": ["결정사항 1", "결정사항 2"],
                "action_items": [
                    {"owner_id": 1, "task": "작업 1", "due_date": "2026-07-10"}
                ]
            },
            headers=auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["summary"] == "수정된 회의록 내용"
        assert "결정사항 1" in data["decisions"]
        assert data["status"] == "draft"

    async def test_confirm_meeting_minute(self, async_client, admin_auth_headers, auth_headers, test_meeting):
        """
        회의록 확정 (관리자) → 200, status finalized

        POST /meetings/{id}/minutes/confirm

        동작: draft → finalized(모델 상태값), reviewed_by 기록. 확정 권한=호스트+admin/super_admin(D5).

        @TEST T1.5.4 - 회의록 확정
        """
        put = await async_client.put(
            f"/meetings/{test_meeting.id}/minutes",
            json={"content": "초안", "decisions": ["d1"]},
            headers=auth_headers
        )
        assert put.status_code == 200, put.text

        response = await async_client.post(
            f"/meetings/{test_meeting.id}/minutes/confirm",
            headers=admin_auth_headers
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "finalized"

    @pytest.mark.skip(reason="Phase 4+ (STT 실측, S2 스파이크) — G011 환경차단")
    async def test_stt_accuracy_measurement(self, async_client, auth_headers):
        """
        STT 정확도 측정 (화자분리, 누락률 < 5%)

        참조 (D22):
        - 기준: 누락률 < 5%
        - 측정 방법: 테스트 회의 N회 대비 수동 전사 대조

        근거 (D5):
        - Phase 4+ 스파이크 S2에서 품질 검증

        @TEST T1.5.5 - STT 정확도 (Phase 4+)
        """
        # Phase 0: 스텁만 작성
        # Phase 4: S2 스파이크 검증 후 활성화
        pass


# ============================================================================
# 업무기록 API (Work Log)
# ============================================================================

class TestWorkLogAPI:
    """
    업무기록 CRUD 및 조회

    명세:
    - POST /work-logs: 업무기록 작성
    - GET /work-logs: 목록 (필터: 기간, 사용자)
    - GET /work-logs/{id}: 개별 조회
    - PUT /work-logs/{id}: 수정 (작성자만)
    - DELETE /work-logs/{id}: 삭제 (작성자/admin만)
    """

    async def test_create_work_log(self, async_client, auth_headers, test_user):
        """
        업무기록 작성 → 201

        POST /work-logs

        @TEST T1.6.1 - 업무기록 작성
        """
        response = await async_client.post(
            "/work-logs",
            json={
                "title": "API 테스트 프레임워크 구성",
                "goal": "conftest+스텁으로 계약 검증 기반 마련",
                "result": "conftest.py + 스텁 작성 완료",
                "result_url": "https://github.com/spacecl/voffice/pull/123",
                "next_action": "관리 API 구현 시작"
            },
            headers=auth_headers
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert "work_log_id" in data
        assert data["result"] == "conftest.py + 스텁 작성 완료"

    async def test_list_work_logs(self, async_client, auth_headers, test_user):
        """
        업무기록 목록 → 200

        GET /work-logs?period=2026-07

        @TEST T1.6.2 - 업무기록 목록
        """
        await async_client.post(
            "/work-logs",
            json={"title": "6월 업무", "work_date": "2026-06-15"},
            headers=auth_headers,
        )
        response = await async_client.get(
            "/work-logs?period=2026-06",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "work_logs" in data
        assert len(data["work_logs"]) >= 1

    async def test_list_work_logs_filtered(self, async_client, auth_headers, test_user):
        """
        업무기록 필터 조회 (사용자별) → 200

        GET /work-logs?user_id=1&period=2026-07

        @TEST T1.6.3 - 업무기록 필터
        """
        response = await async_client.get(
            "/work-logs?user_id=1&period=2026-07",
            headers=auth_headers
        )
        assert response.status_code == 200

    async def test_update_work_log(self, async_client, auth_headers, test_user):
        """
        업무기록 수정 (작성자만) → 200

        PUT /work-logs/{id}

        @TEST T1.6.4 - 업무기록 수정
        """
        create = await async_client.post(
            "/work-logs",
            json={"title": "초기", "result": "초기 결과"},
            headers=auth_headers,
        )
        assert create.status_code == 201, create.text
        work_log_id = create.json()["work_log_id"]

        response = await async_client.put(
            f"/work-logs/{work_log_id}",
            json={"result": "수정된 결과"},
            headers=auth_headers
        )
        assert response.status_code == 200, response.text
        assert response.json()["result"] == "수정된 결과"

    async def test_delete_work_log(self, async_client, auth_headers, test_user):
        """
        업무기록 삭제 (작성자/admin만) → 200

        DELETE /work-logs/{id}

        @TEST T1.6.5 - 업무기록 삭제
        """
        create = await async_client.post(
            "/work-logs",
            json={"title": "삭제 대상"},
            headers=auth_headers,
        )
        assert create.status_code == 201, create.text
        work_log_id = create.json()["work_log_id"]

        response = await async_client.delete(
            f"/work-logs/{work_log_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, response.text

        gone = await async_client.get(f"/work-logs/{work_log_id}", headers=auth_headers)
        assert gone.status_code == 404

    async def test_work_log_daily_deadline(self, async_client, auth_headers):
        """
        일일 업무기록 마감 (18:00 KST 기준)

        참조 (D17):
        - 매일 18:00 KST
        - 18:00 이후 활동은 익일 귀속

        @TEST T1.6.6 - 일일 마감 기준 (결정론적 규칙)
        """
        from datetime import datetime, timezone

        from app.api.worklogs import work_log_date_for

        # 17:59 KST(08:59 UTC) → 당일 귀속
        before_cutoff = datetime(2026, 7, 15, 8, 59, tzinfo=timezone.utc)
        assert work_log_date_for(before_cutoff).isoformat() == "2026-07-15"
        # 18:00 KST(09:00 UTC) 이후 → 익일 귀속
        after_cutoff = datetime(2026, 7, 15, 9, 0, tzinfo=timezone.utc)
        assert work_log_date_for(after_cutoff).isoformat() == "2026-07-16"


# ============================================================================
# KPI 평가 API (KPI Result)
# ============================================================================

@pytest_asyncio.fixture
async def kpi_result_seed(db_session, test_user):
    """
    KPI 평가 API 테스트용 시드 (G008).

    user_id=1(test_user, erp_team_id=1 → leader_token team_id=1과 일치),
    period_type=quarterly, period_key='2026-Q3', metric='collaboration_score'.
    """
    from decimal import Decimal

    from app.models.tables import KpiResult, KpiPeriodType, KpiSource

    kr = KpiResult(
        user_id=1,
        period_type=KpiPeriodType.QUARTERLY,
        period_key="2026-Q3",
        metric="collaboration_score",
        value=Decimal("72.50"),
        unit="score",
        source=KpiSource.VIRTUAL_OFFICE,
        ai_draft={
            "strength": "협업 기여도 우수",
            "improvement": "액션아이템 기한 준수 개선 필요",
            "basis": "work_log 4건 완료, 회의록 2건 작성",
        },
    )
    db_session.add(kr)
    await db_session.commit()
    await db_session.refresh(kr)
    return kr


class TestKPIResultAPI:
    """
    KPI 조회, 관리자 조정, 확정, 이의신청

    명세 (모델 정본 04-data-model.md/tables.py 기준, 계약 경로는 backend/app/api/kpi.py 참조):
    - GET /kpi-results: 조회 (필터: user_id, period, period_type, period_key, metric)
    - GET /kpi-results/{id}: 개별 조회
    - PUT /kpi-results/{id}/adjust: 관리자 조정
    - POST /kpi-results/{id}/confirm: 확정 (관리자만)
    - POST /kpi-results/{id}/objections: 이의신청 제출
    - GET /kpi-results/{id}/ai-draft: AI 초안 조회

    참조: D14(KPI 로직), D14-e(결정론 점수), D15(이의신청), D16(스키마)
    """

    async def test_list_kpi_results(self, async_client, auth_headers, kpi_result_seed):
        """
        KPI 목록 조회 (본인) → 200

        GET /kpi-results?period=2026-Q3

        @TEST T1.7.1 - KPI 목록 조회 (권한)
        """
        response = await async_client.get(
            "/kpi-results?period=2026-Q3",
            headers=auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert "kpi_results" in data
        ids = [r["kpi_result_id"] for r in data["kpi_results"]]
        assert str(kpi_result_seed.id) in ids

    async def test_get_kpi_result_detail(self, async_client, auth_headers, kpi_result_seed):
        """
        KPI 상세 조회 → 200

        GET /kpi-results/{id}

        응답 (모델 정본 4상태, 스텁의 aspirational 7상태 문구는 폐기):
        - metric: 평가 항목 (04-data-model.md 어휘사전)
        - ai_draft: AI 초안 (strength, improvement, basis)
        - admin_adjusted_score: 관리자 조정 점수
        - objection_status: 이의신청 상태 (none/submitted/reviewing/resolved)
        - final_score: 최종 점수

        @TEST T1.7.2 - KPI 상세 조회
        """
        response = await async_client.get(
            f"/kpi-results/{kpi_result_seed.id}",
            headers=auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["metric"] == "collaboration_score"
        assert data["objection_status"] == "none"
        assert data["ai_draft"]["strength"] == "협업 기여도 우수"

    async def test_adjust_kpi_score(self, async_client, admin_auth_headers, kpi_result_seed):
        """
        KPI 관리자 조정 → 200

        PUT /kpi-results/{id}/adjust

        동작:
        - admin_adjusted_score: 조정된 점수
        - admin_note: 조정 사유
        - admin_user_id: 조정자

        @TEST T1.7.3 - KPI 관리자 조정
        """
        response = await async_client.put(
            f"/kpi-results/{kpi_result_seed.id}/adjust",
            json={
                "admin_adjusted_score": 85.0,
                "admin_note": "추가 프로젝트 기여 반영"
            },
            headers=admin_auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["admin_adjusted_score"] == 85.0
        assert data["admin_note"] == "추가 프로젝트 기여 반영"
        assert data["admin_user_id"] == 3

    async def test_confirm_kpi_result(self, async_client, admin_auth_headers, kpi_result_seed):
        """
        KPI 확정 → 200

        POST /kpi-results/{id}/confirm

        동작 (D15):
        - final_score = admin_adjusted_score ?? value
        - finalized_at 세팅

        @TEST T1.7.4 - KPI 확정
        """
        response = await async_client.post(
            f"/kpi-results/{kpi_result_seed.id}/confirm",
            headers=admin_auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["final_score"] == float(kpi_result_seed.value)
        assert data["finalized_at"] is not None

    async def test_submit_kpi_objection(self, async_client, auth_headers, kpi_result_seed):
        """
        KPI 이의신청 제출 → 201

        POST /kpi-results/{id}/objections

        상태머신 (D15, 모델 4상태): none → submitted

        권한: employee 본인만

        @TEST T1.7.5 - KPI 이의신청 제출
        """
        response = await async_client.post(
            f"/kpi-results/{kpi_result_seed.id}/objections",
            json={
                "category": "calculation_error",
                "text": "협업 점수 산정 기준이 명확하지 않음",
                "evidence": "https://example.com/evidence"
            },
            headers=auth_headers
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["objection_status"] == "submitted"
        assert data["objection_detail"]["category"] == "calculation_error"

    async def test_get_ai_draft(self, async_client, auth_headers, kpi_result_seed):
        """
        AI 초안 조회 → 200

        GET /kpi-results/{id}/ai-draft

        동작 (D14, D21):
        - 인풋: work_log + meeting_minute + action_item
        - 출력: ai_draft (strength/improvement/basis, 서술만 — 점수 미포함)
        - 최종이 아닌 초안 (관리자 검토 필수)

        @TEST T1.7.6 - AI 초안 조회
        """
        response = await async_client.get(
            f"/kpi-results/{kpi_result_seed.id}/ai-draft",
            headers=auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert "ai_draft" in data
        assert data["ai_draft"]["strength"] == "협업 기여도 우수"

    async def test_kpi_metric_vocabulary(self, async_client, admin_auth_headers):
        """
        KPI 메트릭 어휘사전 조회 → 200

        GET /kpi/metrics

        참조 (D16):
        - 메트릭 정본: 04-data-model.md §2.5 (8개)
        - 롱포맷: user_id, period_type, period_key, metric, value

        @TEST T1.7.7 - 메트릭 어휘
        """
        response = await async_client.get(
            "/kpi/metrics",
            headers=admin_auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert set(data["metrics"]) == {
            "work_completed_count",
            "work_quality_score",
            "minutes_authored_count",
            "action_items_completed",
            "action_items_ontime_rate",
            "report_fidelity_score",
            "collaboration_score",
            "quarterly_total",
        }

    async def test_kpi_quarterly_aggregation(
        self, db_session, async_client, admin_auth_headers, auth_headers, test_user
    ):
        """
        분기별 KPI 집계 (관리자 동기 트리거) → 200 + quarterly KpiResult 멱등 upsert

        POST /kpi/aggregate?period=2026-Q3

        동작:
        - 지정 분기에 KPI 신호(완료 work_log 등)가 있는 사용자별 결정론 metric(1~7) upsert
        - 멱등: 재호출 시 행 중복 없이 값만 갱신 (uq_kpi_result_metric)
        - RBAC: admin/super_admin 전용 (비admin 403), 잘못된 기간(daily) 400

        참조: D14-e(결정론)/D16(롱포맷)/D17. 실 cron 상시발화는 환경차단(G011 B-16), 여기서는
        admin 동기 트리거 활성화.

        @TEST T1.7.8 - 분기 집계
        """
        from datetime import date
        from decimal import Decimal

        from sqlalchemy import func, select

        from app.models.tables import KpiPeriodType, KpiResult, WorkLog, WorkLogStatus

        # Q3 2026 완료 work_log 2건 (user 1 = test_user)
        db_session.add_all([
            WorkLog(user_id=1, work_date=date(2026, 7, 15), title="설계 완료",
                    status=WorkLogStatus.COMPLETED, goal="아키텍처", result_url="https://x/1",
                    next_action="후속"),
            WorkLog(user_id=1, work_date=date(2026, 8, 20), title="구현 완료",
                    status=WorkLogStatus.COMPLETED, goal="엔드포인트", result_url="https://x/2",
                    next_action="리뷰"),
        ])
        await db_session.commit()

        # RBAC: 비admin 403
        forbidden = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=auth_headers)
        assert forbidden.status_code == 403, forbidden.text

        # admin 동기 집계 → 200
        resp = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "completed"
        assert body["period_key"] == "2026-Q3"
        assert body["aggregated_users"] >= 1
        assert body["aggregated_metrics"] >= 1

        # quarterly KpiResult 산출 확인 (user 1, 완료 2건)
        rows = (await db_session.execute(
            select(KpiResult).where(
                KpiResult.user_id == 1,
                KpiResult.period_type == KpiPeriodType.QUARTERLY,
                KpiResult.period_key == "2026-Q3",
            )
        )).scalars().all()
        metrics = {r.metric: r.value for r in rows}
        assert "work_completed_count" in metrics
        assert metrics["work_completed_count"] == 2
        count_after_first = len(rows)
        assert count_after_first >= 1

        # 멱등: 재호출 → 행 중복 없음
        resp2 = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
        assert resp2.status_code == 200, resp2.text
        total = (await db_session.execute(
            select(func.count()).select_from(KpiResult).where(
                KpiResult.user_id == 1,
                KpiResult.period_type == KpiPeriodType.QUARTERLY,
                KpiResult.period_key == "2026-Q3",
            )
        )).scalar_one()
        assert total == count_after_first, "재집계 시 KpiResult 행이 중복 생성되면 안 됨(멱등)"

        # 잘못된 기간(daily) → 400
        bad = await async_client.post("/kpi/aggregate?period=2026-07-15", headers=admin_auth_headers)
        assert bad.status_code == 400, bad.text

    async def test_kpi_deterministic_calculation(self, async_client):
        """
        KPI 점수 결정론적 계산 (AI 제외)

        근거 (D14-e):
        - 정량: 결정론적 코드 (함수형, compute_kpi_metrics)
        - AI는 이 계산에 관여하지 않음(서술만 별도 생성)

        테스트: 동일 입력 → 동일 출력 보증 (감사 재현성)

        @TEST T1.7.9 - 결정론적 계산
        """
        from datetime import date, datetime
        from types import SimpleNamespace

        from app.services.kpi_scoring import compute_kpi_metrics

        def _build_inputs():
            work_logs = [
                SimpleNamespace(status="completed", goal="목표", category="개발",
                                 result_url="https://x/1", next_action="후속"),
                SimpleNamespace(status="completed", goal=None, category="리뷰",
                                 result_url=None, next_action="후속"),
                SimpleNamespace(status="started", goal="미완", category=None,
                                 result_url=None, next_action=None),
            ]
            minutes = [SimpleNamespace(created_by=1), SimpleNamespace(created_by=1)]
            action_items = [
                SimpleNamespace(status="completed", due_date=date(2026, 7, 10),
                                 completed_at=datetime(2026, 7, 9, 10, 0)),
                SimpleNamespace(status="completed", due_date=date(2026, 7, 1),
                                 completed_at=datetime(2026, 7, 5, 10, 0)),
                SimpleNamespace(status="open", due_date=date(2026, 7, 20), completed_at=None),
            ]
            return work_logs, minutes, action_items

        r1 = compute_kpi_metrics(*_build_inputs())
        r2 = compute_kpi_metrics(*_build_inputs())
        assert r1 == r2
        assert r1["work_completed_count"] == 2
        assert r1["minutes_authored_count"] == 2
        assert r1["action_items_completed"] == 2
        # 소수 1자리 반올림 규칙 명시 검증
        assert str(r1["action_items_ontime_rate"]) in ("50.0",)

    async def test_kpi_double_counting_prevention(self, async_client):
        """
        KPI 이중집계 방지 (attendance vs presence)

        근거 (D14-d):
        - ERP attendance: 근태 관리 (지각·조퇴·결근)
        - 우리 KPI: 근태 보정 미반영 (ERP가 이미 attendance 반영, 이중 반영 금지)

        검증: compute_kpi_metrics는 attendance/presence 입력 자체를 받지 않는다
        (구조적으로 반영 불가능 — 함수 시그니처에 존재하지 않음).

        @TEST T1.7.10 - 이중집계 방지
        """
        import inspect

        from app.services.kpi_scoring import compute_kpi_metrics

        params = set(inspect.signature(compute_kpi_metrics).parameters.keys())
        assert params == {"work_logs", "minutes", "action_items"}
        assert "attendance" not in params
        assert "presence" not in params

    async def test_kpi_objection_workflow(
        self, async_client, auth_headers, admin_auth_headers, kpi_result_seed
    ):
        """
        KPI 이의신청 워크플로우 (상태머신, 모델 4상태)

        상태 전이 (D15, backend/app/api/kpi.py 설계 근거 주석 참조):
        none → submitted(직원 제출) → reviewing(관리자 adjust) → resolved(관리자 confirm)

        @TEST T1.7.11 - 이의신청 상태머신
        """
        detail = await async_client.get(
            f"/kpi-results/{kpi_result_seed.id}", headers=auth_headers
        )
        assert detail.json()["objection_status"] == "none"

        submit = await async_client.post(
            f"/kpi-results/{kpi_result_seed.id}/objections",
            json={"category": "calculation_error", "text": "이의 있음"},
            headers=auth_headers,
        )
        assert submit.status_code == 201, submit.text
        assert submit.json()["objection_status"] == "submitted"

        adjust = await async_client.put(
            f"/kpi-results/{kpi_result_seed.id}/adjust",
            json={"admin_adjusted_score": 80.0, "admin_note": "재검토"},
            headers=admin_auth_headers,
        )
        assert adjust.status_code == 200, adjust.text
        assert adjust.json()["objection_status"] == "reviewing"

        confirm = await async_client.post(
            f"/kpi-results/{kpi_result_seed.id}/confirm", headers=admin_auth_headers
        )
        assert confirm.status_code == 200, confirm.text
        confirmed = confirm.json()
        assert confirmed["objection_status"] == "resolved"
        assert confirmed["final_score"] == 80.0

    async def test_kpi_grace_period(self, async_client, auth_headers, db_session, test_user):
        """
        KPI 이의신청 유예 기간 (7일)

        참조 (D15):
        - 공개(대용: created_at) 후 7일 내만 이의신청 가능
        - 이후: 거부 (410 Gone)

        @TEST T1.7.12 - 이의신청 유예 기간
        """
        from datetime import datetime, timedelta, timezone
        from decimal import Decimal

        from app.models.tables import KpiPeriodType, KpiResult, KpiSource

        old_kr = KpiResult(
            user_id=1,
            period_type=KpiPeriodType.QUARTERLY,
            period_key="2026-Q2",
            metric="collaboration_score",
            value=Decimal("60.00"),
            source=KpiSource.VIRTUAL_OFFICE,
            created_at=datetime.now(timezone.utc) - timedelta(days=10),
        )
        db_session.add(old_kr)
        await db_session.commit()
        await db_session.refresh(old_kr)

        response = await async_client.post(
            f"/kpi-results/{old_kr.id}/objections",
            json={"category": "calculation_error", "text": "너무 늦은 이의신청"},
            headers=auth_headers,
        )
        assert response.status_code == 410, response.text


# ============================================================================
# ERP 동기화 API (ERP Integration)
# ============================================================================

class TestSyncAPI:
    """
    ERP 동기화 상태 및 수동 트리거

    명세:
    - POST /sync/erp: 수동 트리거
    - GET /sync/status: 동기화 상태 조회
    - GET /sync/errors: 동기화 실패 이력

    참조: D18(증분+전체 대사), D20(컴플라이언스)
    """

    async def test_trigger_erp_sync(self, async_client, admin_auth_headers):
        """
        ERP 수동 동기화 트리거 → 202 Accepted

        POST /sync/erp

        동작:
        - MockErpReader(테스트 환경 폴백) 기반 동기 실행, ErpSyncLog에 결과 기록
        - 응답: sync_job_id (상태 조회용)

        @TEST T1.8.1 - ERP 동기화 트리거
        """
        response = await async_client.post(
            "/sync/erp",
            headers=admin_auth_headers
        )
        assert response.status_code == 202, response.text
        data = response.json()
        assert "sync_job_id" in data
        assert data["status"] == "success"

    async def test_get_sync_status(self, async_client, admin_auth_headers):
        """
        동기화 상태 조회 → 200 (실제 생성된 job_id) | 404 (미존재 job_id)

        GET /sync/status?job_id=<POST /sync/erp가 반환한 실 sync_job_id>

        응답:
        - status: "running" | "success" | "failed"
        - synced_at: 마지막 동기화 시각
        - next_scheduled: 다음 예정 시각
        - error_count: 실패 건수

        @TEST T1.8.2 - 동기화 상태 조회
        """
        trigger = await async_client.post("/sync/erp", headers=admin_auth_headers)
        job_id = trigger.json()["sync_job_id"]

        response = await async_client.get(
            f"/sync/status?job_id={job_id}",
            headers=admin_auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == "success"
        assert data["error_count"] == 0
        assert data["synced_at"] is not None

        missing = await async_client.get(
            f"/sync/status?job_id={uuid4()}",
            headers=admin_auth_headers
        )
        assert missing.status_code == 404

    async def test_get_sync_errors(self, async_client, admin_auth_headers):
        """
        동기화 실패 이력 조회 → 200

        GET /sync/errors?limit=10

        응답:
        - errors: [{sync_job_id, error_message, error_count, attempted_at}]
          (계약 초안의 table/row_count는 ErpSyncLog 정본 모델에 없어 제외 — G009 컨텍스트 정본)

        @TEST T1.8.3 - 동기화 오류 이력
        """
        response = await async_client.get(
            "/sync/errors?limit=10",
            headers=admin_auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "errors" in data
        assert data["errors"] == []

    async def test_sync_incremental_plus_daily_full(self, db_session):
        """
        동기화 전략 (증분 + 일일 전체 대사) — 서비스 계약 실증 (D18)

        - 증분/전체 대사 모두 ErpSyncService.sync_users 재사용
          (erp_incremental_sync / erp_full_reconciliation, 주기만 다름)
        - 증분 재실행 멱등: 동일 리더 2회 → 중복 ErpUser 없이 upsert(created→updated)
        - 전체 대사 하드삭제 감지: ERP에서 사라진 사용자 → soft-delete(is_active=false), 행 보존
        - 재등장 사용자 → 복원(is_active=true)

        참조 (D18): 증분 매시간 / 전체 매일 00:00 KST / 하드삭제 감지 soft-delete / FK RESTRICT
        (실 cron 상시발화는 환경차단 G011 B-16; 여기서는 서비스 함수 계약을 실증)

        @TEST T1.8.4 - 동기화 전략
        """
        from sqlalchemy import select

        from app.erp.dtos import ErpUserDTO
        from app.erp.mock_reader import MockErpReader
        from app.models.tables import ErpUser
        from app.services.scheduler import erp_full_reconciliation, erp_incremental_sync

        def _dto(uid, active=True):
            return ErpUserDTO(
                id=uid, company_id=1, email=f"u{uid}@example.com", name=f"User {uid}",
                team_id=1, role="employee", position="사원", position_id=1,
                manager_id=None, default_work_type="office", default_work_hours=8,
                is_active=active,
            )

        full_reader = MockErpReader(users=[_dto(1), _dto(2), _dto(3)])

        # 1) 증분 최초 동기화 → 3건 created
        r1 = await erp_incremental_sync(db_session, full_reader, company_id=1)
        assert r1.created == 3 and r1.deactivated == 0

        # 2) 증분 재실행(멱등) → updated 3, 중복 행 없음
        r2 = await erp_incremental_sync(db_session, full_reader, company_id=1)
        assert r2.created == 0 and r2.updated == 3
        rows = (
            await db_session.execute(select(ErpUser).where(ErpUser.company_id == 1))
        ).scalars().all()
        assert len(rows) == 3, "증분 재실행 시 ErpUser 중복 생성됨(멱등 위반)"

        # 3) 전체 대사: user 3이 ERP에서 사라짐 → soft-delete(is_active=false), 행 보존
        reduced_reader = MockErpReader(users=[_dto(1), _dto(2)])
        r3 = await erp_full_reconciliation(db_session, reduced_reader, company_id=1)
        assert r3.deactivated == 1, "하드삭제 감지 soft-delete 미동작"
        u3 = await db_session.get(ErpUser, 3)
        assert u3 is not None, "soft-delete가 아니라 하드삭제됨(행 소멸)"
        assert u3.is_active is False

        # 4) 재등장 → 복원(is_active=true)
        await erp_full_reconciliation(db_session, full_reader, company_id=1)
        await db_session.refresh(u3)
        assert u3.is_active is True, "재등장 사용자 복원 실패"


# ============================================================================
# 감사 로그 API (Audit Log)
# ============================================================================

class TestAuditLogAPI:
    """
    감사 로그 조회 (읽기 전용)

    명세:
    - GET /audit-logs: 로그 조회 (필터: 사용자, 액션, 기간)
    - GET /audit-logs/{id}: 개별 로그 조회

    참조: D20(보존 기한 5년)
    """

    async def test_list_audit_logs(self, db_session, async_client, admin_auth_headers):
        """
        감사 로그 조회 (admin만) → 200

        GET /audit-logs?days=7

        응답:
        - logs: [{timestamp, user_id, action, resource_type, resource_id, changes}]

        @TEST T1.9.1 - 감사 로그 조회
        """
        from app.models.tables import AuditLog

        db_session.add_all([
            AuditLog(action="seat_assigned", entity_type="seat", entity_id="seat-1"),
            AuditLog(action="meeting_created", entity_type="meeting", entity_id="meeting-1"),
        ])
        await db_session.commit()

        response = await async_client.get(
            "/audit-logs?days=7",
            headers=admin_auth_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert "logs" in data
        assert len(data["logs"]) == 2
        actions = {log["action"] for log in data["logs"]}
        assert actions == {"seat_assigned", "meeting_created"}
        first = data["logs"][0]
        assert set(["timestamp", "user_id", "action", "resource_type", "resource_id", "changes"]) <= set(first)

    async def test_audit_log_permission_denied(self, async_client, auth_headers):
        """
        일반 사용자의 감사 로그 조회 → 403 Forbidden

        @TEST T1.9.2 - 감사 로그 권한
        """
        response = await async_client.get(
            "/audit-logs",
            headers=auth_headers
        )
        assert response.status_code == 403

    @pytest.mark.skip(reason="보존 정책 D20-e/Phase2")
    async def test_audit_log_retention_5years(self, async_client):
        """
        감사 로그 보존 기한 (5년)

        참조 (D20(e)):
        - 평가 데이터: 5년 보존 후 파기/익명화
        - audit_log: 5년 보존

        @TEST T1.9.3 - 감사 로그 보존
        """
        # Phase 2: 보존 정책 구현 시 테스트
        pass

# ============================================================================
# 통합 테스트 (Integration) — Phase 1+
# ============================================================================

class TestIntegrationAPIFlow:
    """
    전체 API 플로우 통합 테스트 (Phase 1+)

    시나리오:
    1. 로그인 → 토큰 획득
    2. 회의 생성 → 입장 (LiveKit)
    3. 회의록 STT 초안 → 확정
    4. KPI 계산 → 이의신청
    5. ERP 동기화 → 확정 점수 전송
    """

    async def test_full_workflow_login_to_kpi(self, db_session, async_client, test_user):
        """
        전체 워크플로우 e2e: 로그인 → 회의 생성/입장 → 회의록 작성/확정 → KPI 조회/이의신청

        기존 구현 엔드포인트로 크로스컷 실증(단일 사용자 = host = 평가 대상). LiveKit 실 룸·실 ERP
        push는 환경차단(G011)이라 계약 표면(결정적 room_name/토큰 발급)까지만 검증한다. 각 단계의
        상태 전이(SCHEDULED→IN_PROGRESS, minute DRAFT→FINALIZED, objection none→submitted)와
        RBAC(호스트 확정·소유자 이의신청)를 하나의 흐름으로 확인한다.

        @TEST T1.10+ - 통합 워크플로우
        """
        from datetime import datetime, timedelta, timezone
        from decimal import Decimal
        from uuid import uuid4

        from app.models.tables import (
            Floor, KpiPeriodType, KpiResult, KpiSource, Office, Room, RoomType,
        )

        # 시드: 회의실(Office/Floor/Room) + user1(test_user) KPI
        office = Office(id=uuid4(), company_id=uuid4(), name="HQ")
        db_session.add(office)
        await db_session.flush()
        floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
        db_session.add(floor)
        await db_session.flush()
        room = Room(id=uuid4(), floor_id=floor.id, type=RoomType.MEETING, name="회의실 A",
                    capacity=8, coords={"x": 0, "y": 0, "width": 5, "height": 5})
        db_session.add(room)
        kpi = KpiResult(user_id=1, period_type=KpiPeriodType.QUARTERLY, period_key="2026-Q3",
                        metric="collaboration_score", value=Decimal("72.50"),
                        source=KpiSource.VIRTUAL_OFFICE)
        db_session.add(kpi)
        await db_session.commit()

        # 1) 로그인 → 토큰
        login = await async_client.post(
            "/auth/login", json={"email": "testuser@example.com", "password": "TestPass123!"}
        )
        assert login.status_code == 201, login.text
        token = login.json()["token"]
        hdr = {"Authorization": f"Bearer {token}"}

        # 2) 회의 생성 (host=user1)
        now = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)
        create = await async_client.post(
            "/meetings",
            json={"title": "통합 검토", "room_id": str(room.id),
                  "start_time": now.isoformat(), "end_time": (now + timedelta(hours=1)).isoformat()},
            headers=hdr,
        )
        assert create.status_code == 201, create.text
        meeting_id = create.json()["meeting_id"]
        assert create.json()["status"] == "scheduled"

        # 3) 입장 → 토큰 발급, SCHEDULED→IN_PROGRESS
        join = await async_client.post(f"/meetings/{meeting_id}/join", headers=hdr)
        assert join.status_code == 200, join.text
        assert join.json()["livekit_token"], "입장 토큰 미발급"
        # 결정적 room_name(LiveKit 실연동은 환경차단 G011 — 결정적 stub만): meeting-{id}
        assert join.json()["room_name"] == f"meeting-{meeting_id}"
        assert "livekit_url" in join.json()  # LiveKit 미설정 시 "" (계약 필드 존재)
        detail = await async_client.get(f"/meetings/{meeting_id}", headers=hdr)
        assert detail.json()["status"] == "in_progress"

        # 4) 회의록 작성 (DRAFT 생성)
        put = await async_client.put(
            f"/meetings/{meeting_id}/minutes",
            json={"title": "회의록", "content": "논의 요약", "decisions": ["결정1", "결정2"]},
            headers=hdr,
        )
        assert put.status_code == 200, put.text

        # 5) 회의록 확정 (host=user1 → 허용, DRAFT→FINALIZED)
        confirm = await async_client.post(f"/meetings/{meeting_id}/minutes/confirm", headers=hdr)
        assert confirm.status_code == 200, confirm.text
        assert confirm.json()["status"] == "finalized"

        # 6) 확정 회의록 재수정 차단 (409 불변)
        put2 = await async_client.put(
            f"/meetings/{meeting_id}/minutes", json={"content": "수정 시도"}, headers=hdr
        )
        assert put2.status_code == 409, put2.text

        # 7) KPI 조회 (본인)
        kpi_list = await async_client.get("/kpi-results", headers=hdr)
        assert kpi_list.status_code == 200, kpi_list.text
        ids = [r["kpi_result_id"] for r in kpi_list.json()["kpi_results"]]
        assert str(kpi.id) in ids

        # 8) 이의신청 (소유자 user1 → 201, none→submitted)
        obj = await async_client.post(
            f"/kpi-results/{kpi.id}/objections",
            json={"category": "scoring", "text": "재검토 요청"}, headers=hdr,
        )
        assert obj.status_code == 201, obj.text
        detail_kpi = await async_client.get(f"/kpi-results/{kpi.id}", headers=hdr)
        assert detail_kpi.json()["objection_status"] == "submitted"
