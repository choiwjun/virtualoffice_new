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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_auth_refresh_token(self, async_client, employee_token):
        """
        Refresh 토큰으로 새 Access 토큰 발급 → 200

        POST /auth/refresh

        @TEST T1.1.5 - 토큰 갱신
        """
        response = await async_client.post(
            "/auth/refresh",
            json={"refresh_token": employee_token}
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
    - GET /seats/{seat_id}: 개별 좌석 조회
    - PUT /seats/{seat_id}: 좌석 수정
    - POST /seats/{seat_id}/assign: 좌석 배정
    - DELETE /seats/{seat_id}/assign: 배정 해제
    - GET /seats/available: 사용 가능 좌석 조회 (자율좌석 용)
    """

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_seats(self, async_client, auth_headers, test_layout):
        """
        전체 좌석 목록 조회 → 200 + seats 배열

        GET /seats

        @TEST T1.2.1 - 좌석 목록 조회
        """
        response = await async_client.get(
            "/seats",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "seats" in data
        assert isinstance(data["seats"], list)

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_create_seat(self, async_client, admin_auth_headers):
        """
        새 좌석 생성 → 201 + seat_id

        POST /seats

        @TEST T1.2.2 - 좌석 생성
        """
        response = await async_client.post(
            "/seats",
            json={
                "seat_id": "1F-A01",
                "x": 10.0,
                "y": 10.0,
                "type": "desk",
                "facing": 0
            },
            headers=admin_auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["seat_id"] == "1F-A01"

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_assign_seat(self, async_client, admin_auth_headers, test_user):
        """
        직원에게 좌석 배정 → 200

        POST /seats/{seat_id}/assign

        @TEST T1.2.3 - 좌석 배정
        """
        response = await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["user_id"]},
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_assign_seat_duplicate(self, async_client, admin_auth_headers, test_user):
        """
        중복 배정 시도 (이미 배정된 좌석) → 409 Conflict

        @TEST T1.2.4 - 중복 배정 방지
        """
        # 첫 번째 배정
        await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["user_id"]},
            headers=admin_auth_headers
        )

        # 두 번째 배정 (같은 좌석)
        response = await async_client.post(
            "/seats/1F-A01/assign",
            json={"user_id": test_user["user_id"]},
            headers=admin_auth_headers
        )
        assert response.status_code == 409

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_unassign_seat(self, async_client, admin_auth_headers, test_user):
        """
        좌석 배정 해제 → 200

        DELETE /seats/{seat_id}/assign

        @TEST T1.2.5 - 좌석 배정 해제
        """
        response = await async_client.delete(
            "/seats/1F-A01/assign",
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_available_seats(self, async_client, auth_headers):
        """
        사용 가능 좌석 조회 (자율좌석 용) → 200

        GET /seats/available

        @TEST T1.2.6 - 사용 가능 좌석 조회
        """
        response = await async_client.get(
            "/seats/available",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "available_seats" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_occupy_flexible_seat(self, async_client, auth_headers):
        """
        자율좌석 점유 (임시 배정) → 200

        POST /seats/{seat_id}/occupy

        @TEST T1.2.7 - 자율좌석 점유
        """
        response = await async_client.post(
            "/seats/1F-FLEX-01/occupy",
            headers=auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_release_flexible_seat(self, async_client, auth_headers):
        """
        자율좌석 반납 → 200

        DELETE /seats/{seat_id}/occupy

        @TEST T1.2.8 - 자율좌석 반납
        """
        response = await async_client.delete(
            "/seats/1F-FLEX-01/occupy",
            headers=auth_headers
        )
        assert response.status_code == 200


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
    """

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_layouts(self, async_client, auth_headers):
        """
        레이아웃 버전 목록 조회 → 200

        GET /layouts

        @TEST T1.3.1 - 레이아웃 목록
        """
        response = await async_client.get(
            "/layouts",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "layouts" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_create_layout(self, async_client, admin_auth_headers, test_layout):
        """
        레이아웃 생성 → 201

        POST /layouts

        @TEST T1.3.2 - 레이아웃 생성
        """
        response = await async_client.post(
            "/layouts",
            json=test_layout,
            headers=admin_auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert "layout_id" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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
            headers=admin_auth_headers
        )
        assert response.status_code in [200, 400]
        data = response.json()
        assert "errors" in data or "warnings" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_validate_layout_invalid_json(self, async_client, admin_auth_headers):
        """
        잘못된 레이아웃 JSON → 400

        @TEST T1.3.4 - 레이아웃 검증 실패 (스키마)
        """
        response = await async_client.post(
            "/layouts/validate",
            json={"invalid": "schema"},
            headers=admin_auth_headers
        )
        assert response.status_code == 400

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_deploy_layout(self, async_client, admin_auth_headers):
        """
        레이아웃 배포 → 200

        POST /layouts/{id}/deploy

        동작:
        1. 레이아웃 검증 (자동)
        2. ERROR 있으면 배포 거부 (400)
        3. 검증 통과 → 모든 클라이언트에 푸시

        @TEST T1.3.5 - 레이아웃 배포
        """
        response = await async_client.post(
            "/layouts/layout-001/deploy",
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_deploy_layout_permission_denied(self, async_client, auth_headers):
        """
        일반 사용자가 배포 시도 → 403 Forbidden

        @TEST T1.3.6 - 배포 권한 검증
        """
        response = await async_client.post(
            "/layouts/layout-001/deploy",
            headers=auth_headers
        )
        assert response.status_code == 403

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_layout_version_history(self, async_client, auth_headers):
        """
        레이아웃 버전 히스토리 조회 → 200

        GET /layouts/{id}/history

        @TEST T1.3.7 - 버전 히스토리
        """
        response = await async_client.get(
            "/layouts/layout-001/history",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "versions" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_rollback_layout(self, async_client, admin_auth_headers):
        """
        레이아웃 롤백 (이전 버전으로) → 200

        POST /layouts/{id}/rollback?version=2

        @TEST T1.3.8 - 레이아웃 롤백
        """
        response = await async_client.post(
            "/layouts/layout-001/rollback?version=2",
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_current_layout(self, async_client, auth_headers):
        """
        현재 배포된 레이아웃 조회 → 200

        GET /layouts/current

        @TEST T1.3.9 - 현재 레이아웃 조회
        """
        response = await async_client.get(
            "/layouts/current",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "layout_json" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_layout_notfound(self, async_client, auth_headers):
        """
        미존재 레이아웃 조회 → 404

        @TEST T1.3.10 - 레이아웃 미존재
        """
        response = await async_client.get(
            "/layouts/nonexistent",
            headers=auth_headers
        )
        assert response.status_code == 404


# ============================================================================
# 회의 API (Meeting)
# ============================================================================

class TestMeetingAPI:
    """
    회의 CRUD, 예약, 입장 관리

    명세:
    - POST /meetings: 회의 생성
    - GET /meetings: 회의 목록 (필터: 기간, 상태)
    - GET /meetings/{id}: 개별 회의 조회
    - PUT /meetings/{id}: 회의 수정 (호스트만)
    - DELETE /meetings/{id}: 회의 취소 (호스트만)
    - POST /meetings/{id}/join: 회의 입장 (LiveKit 토큰 발급)
    - POST /meetings/{id}/leave: 회의 퇴장
    - GET /meetings/{id}/participants: 참석자 목록

    참조: D23(예약+FCFS), D24(명시적 입장)
    """

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_create_meeting(self, async_client, auth_headers):
        """
        회의 생성 → 201

        POST /meetings

        @TEST T1.4.1 - 회의 생성
        """
        response = await async_client.post(
            "/meetings",
            json={
                "title": "팀 회의",
                "room_id": "1F-MR01",
                "start_time": "2026-07-03T10:00:00",
                "end_time": "2026-07-03T11:00:00",
                "description": "주간 회의"
            },
            headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert "meeting_id" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_meetings(self, async_client, auth_headers):
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_create_meeting_room_conflict(self, async_client, auth_headers, test_meeting):
        """
        예약 충돌 감지 (같은 회의실, 같은 시간) → 409

        근거 (D23): 예약 시스템으로 충돌 방지

        @TEST T1.4.3 - 예약 충돌 방지
        """
        # 첫 번째 회의 생성
        await async_client.post(
            "/meetings",
            json={
                "title": "회의 1",
                "room_id": "1F-MR01",
                "start_time": "2026-07-03T10:00:00",
                "end_time": "2026-07-03T11:00:00"
            },
            headers=auth_headers
        )

        # 충돌하는 시간에 같은 회의실 예약
        response = await async_client.post(
            "/meetings",
            json={
                "title": "회의 2",
                "room_id": "1F-MR01",
                "start_time": "2026-07-03T10:30:00",
                "end_time": "2026-07-03T11:30:00"
            },
            headers=auth_headers
        )
        assert response.status_code == 409

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_join_meeting_explicit(self, async_client, auth_headers, test_meeting):
        """
        회의 입장 (명시적 확인 필수) → 200 + LiveKit 토큰

        POST /meetings/{id}/join

        근거 (D24): 자동 연결 금지, 명시적 입장 확인
        - 클라이언트: 입장 버튼 클릭
        - 서버: FastAPI 경유 LiveKit 룸 생성 + 토큰 발급

        @TEST T1.4.4 - 명시적 회의 입장
        """
        response = await async_client.post(
            "/meetings/test-meeting-001/join",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "livekit_token" in data
        assert "room_name" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_join_meeting_nonexistent(self, async_client, auth_headers):
        """
        미존재 회의 입장 → 404

        @TEST T1.4.5 - 회의 미존재
        """
        response = await async_client.post(
            "/meetings/nonexistent/join",
            headers=auth_headers
        )
        assert response.status_code == 404

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_leave_meeting(self, async_client, auth_headers):
        """
        회의 퇴장 → 200

        POST /meetings/{id}/leave

        @TEST T1.4.6 - 회의 퇴장
        """
        response = await async_client.post(
            "/meetings/test-meeting-001/leave",
            headers=auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_cancel_meeting(self, async_client, auth_headers):
        """
        회의 취소 (호스트만) → 200

        DELETE /meetings/{id}

        @TEST T1.4.7 - 회의 취소 (권한)
        """
        response = await async_client.delete(
            "/meetings/test-meeting-001",
            headers=auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_participants(self, async_client, auth_headers):
        """
        참석자 목록 조회 → 200

        GET /meetings/{id}/participants

        @TEST T1.4.8 - 참석자 목록
        """
        response = await async_client.get(
            "/meetings/test-meeting-001/participants",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "participants" in data


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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_meeting_minute(self, async_client, auth_headers):
        """
        회의록 조회 → 200

        GET /meetings/{id}/minutes

        @TEST T1.5.1 - 회의록 조회
        """
        response = await async_client.get(
            "/meetings/test-meeting-001/minutes",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "meeting_id" in data or response.status_code == 404

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_stt_draft(self, async_client, auth_headers):
        """
        STT 초안 조회 → 200 (또는 202 생성 중)

        GET /meetings/{id}/minutes/stt-draft

        동작 (D5):
        - LiveKit Egress → 음성 추출 (화자별)
        - STT 엔진 (한국어 화자분리)
        - AI 후처리 (Claude/Gemini) → 요약, 결정사항, 액션아이템
        - 초안 저장 (ai_draft JSONB)

        응답:
        - 200: STT 초안 준비 완료
        - 202: 처리 중 (비동기)
        - 404: 회의 미존재

        @TEST T1.5.2 - STT 초안 조회
        """
        response = await async_client.get(
            "/meetings/test-meeting-001/minutes/stt-draft",
            headers=auth_headers
        )
        assert response.status_code in [200, 202, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_update_meeting_minute(self, async_client, auth_headers):
        """
        회의록 수정 (검토 중) → 200

        PUT /meetings/{id}/minutes

        @TEST T1.5.3 - 회의록 수정
        """
        response = await async_client.put(
            "/meetings/test-meeting-001/minutes",
            json={
                "content": "수정된 회의록 내용",
                "decisions": ["결정사항 1", "결정사항 2"],
                "action_items": [
                    {"owner_id": 1, "task": "작업 1", "due_date": "2026-07-10"}
                ]
            },
            headers=auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_confirm_meeting_minute(self, async_client, admin_auth_headers):
        """
        회의록 확정 (관리자) → 200

        POST /meetings/{id}/minutes/confirm

        동작:
        - 상태: draft → confirmed
        - 확정자: admin 기록
        - 액션아이템: 참석자에게 푸시

        @TEST T1.5.4 - 회의록 확정
        """
        response = await async_client.post(
            "/meetings/test-meeting-001/minutes/confirm",
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_create_work_log(self, async_client, auth_headers):
        """
        업무기록 작성 → 201

        POST /work-logs

        @TEST T1.6.1 - 업무기록 작성
        """
        response = await async_client.post(
            "/work-logs",
            json={
                "goal": "API 테스트 프레임워크 구성",
                "result": "conftest.py + 스텁 작성 완료",
                "result_url": "https://github.com/spacecl/voffice/pull/123",
                "next_action": "관리 API 구현 시작"
            },
            headers=auth_headers
        )
        assert response.status_code == 201

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_work_logs(self, async_client, auth_headers):
        """
        업무기록 목록 → 200

        GET /work-logs?period=2026-07

        @TEST T1.6.2 - 업무기록 목록
        """
        response = await async_client.get(
            "/work-logs?period=2026-07",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "work_logs" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_work_logs_filtered(self, async_client, auth_headers):
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_update_work_log(self, async_client, auth_headers):
        """
        업무기록 수정 (작성자만) → 200

        PUT /work-logs/{id}

        @TEST T1.6.4 - 업무기록 수정
        """
        response = await async_client.put(
            "/work-logs/wlog-001",
            json={"result": "수정된 결과"},
            headers=auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_delete_work_log(self, async_client, auth_headers):
        """
        업무기록 삭제 (작성자/admin만) → 200

        DELETE /work-logs/{id}

        @TEST T1.6.5 - 업무기록 삭제
        """
        response = await async_client.delete(
            "/work-logs/wlog-001",
            headers=auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_work_log_daily_deadline(self, async_client, auth_headers):
        """
        일일 업무기록 마감 (18:00 KST 기준)

        참조 (D17):
        - 매일 18:00 KST
        - 18:00 이후 활동은 익일 귀속

        @TEST T1.6.6 - 일일 마감 기준
        """
        # Phase 1: 배치 스케줄러 구현 시 테스트
        pass


# ============================================================================
# KPI 평가 API (KPI Result)
# ============================================================================

class TestKPIResultAPI:
    """
    KPI 조회, 관리자 조정, 확정, 이의신청

    명세:
    - GET /kpi-results: 조회 (필터: 사용자, 기간, 상태)
    - GET /kpi-results/{id}: 개별 조회
    - PUT /kpi-results/{id}/adjust: 관리자 조정
    - POST /kpi-results/{id}/confirm: 확정 (관리자만)
    - GET /kpi-results/{id}/objections: 이의신청 목록
    - GET /kpi-results/{id}/ai-draft: AI 초안 조회

    참조: D14(KPI 로직), D15(이의신청), D16(스키마), D17(배치)
    """

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_kpi_results(self, async_client, auth_headers):
        """
        KPI 조회 (자신 + 권한별 다른 사용자) → 200

        GET /kpi-results?period=2026-Q3

        권한:
        - employee: 본인만
        - leader: 팀 직원
        - admin: 전체

        @TEST T1.7.1 - KPI 목록 조회 (권한)
        """
        response = await async_client.get(
            "/kpi-results?period=2026-Q3",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "kpi_results" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_kpi_result_detail(self, async_client, auth_headers):
        """
        KPI 상세 조회 → 200

        GET /kpi-results/{id}

        응답:
        - metric: 평가 항목 (어휘사전: 04-data-model.md)
        - ai_draft: AI 초안 (strength, improvement, basis)
        - admin_adjusted_score: 관리자 조정 점수
        - objection_status: 이의신청 상태 (none/received/under_review/resolved)
        - final_score: 최종 점수

        @TEST T1.7.2 - KPI 상세 조회
        """
        response = await async_client.get(
            "/kpi-results/kpi-001",
            headers=auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_adjust_kpi_score(self, async_client, admin_auth_headers):
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
            "/kpi-results/kpi-001/adjust",
            json={
                "admin_adjusted_score": 85.0,
                "admin_note": "추가 프로젝트 기여 반영"
            },
            headers=admin_auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_confirm_kpi_result(self, async_client, admin_auth_headers):
        """
        KPI 확정 → 200 (ERP 동기화)

        POST /kpi-results/{id}/confirm

        동작 (D15):
        - 상태: draft → confirmed
        - ERP push: POST /api/kpi-results (비동기)
        - upsert: period_type, period_key 기준

        @TEST T1.7.4 - KPI 확정 (ERP 연동)
        """
        response = await async_client.post(
            "/kpi-results/kpi-001/confirm",
            headers=admin_auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_submit_kpi_objection(self, async_client, auth_headers):
        """
        KPI 이의신청 제출 → 201

        POST /kpi-results/{id}/objections

        상태머신 (D15):
        - 평가 공개 → 이의 접수 (7일)
        - 재검토 → 확정 → ERP push

        권한:
        - employee: 본인만
        - admin: 기각/승인

        @TEST T1.7.5 - KPI 이의신청 제출
        """
        response = await async_client.post(
            "/kpi-results/kpi-001/objections",
            json={
                "reason": "평가 기준이 명확하지 않음",
                "supporting_documents": ["link1", "link2"]
            },
            headers=auth_headers
        )
        assert response.status_code in [201, 400, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_ai_draft(self, async_client, auth_headers):
        """
        AI 초안 조회 → 200

        GET /kpi-results/{id}/ai-draft

        동작 (D14, D21):
        - 배치 시간: 매일 21:00 KST (야간)
        - 인풋: work_log + meeting_minute + external_activities
        - 프롬프트: 성과도, 협업품질, 책임감, 지속성
        - 출력: ai_draft (텍스트)
        - 최종이 아닌 초안 (관리자 검토 필수)

        @TEST T1.7.6 - AI 초안 조회
        """
        response = await async_client.get(
            "/kpi-results/kpi-001/ai-draft",
            headers=auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_kpi_metric_vocabulary(self, async_client, admin_auth_headers):
        """
        KPI 메트릭 어휘사전 조회 → 200

        GET /kpi/metrics

        참조 (D16):
        - 메트릭 정본: 04-data-model.md
        - 롱포맷: user_id, period_type, period_key, metric, value

        @TEST T1.7.7 - 메트릭 어휘
        """
        response = await async_client.get(
            "/kpi/metrics",
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_kpi_quarterly_aggregation(self, async_client, admin_auth_headers):
        """
        분기별 KPI 집계 → 배치

        POST /kpi/aggregate?period=2026-Q3

        동작:
        - 일일 기록(daily) 집계
        - 사용자별 최종점수 계산
        - ERP push 준비

        참조 (D17):
        - 분기 마감: 자동 배치

        @TEST T1.7.8 - 분기 집계
        """
        # Phase 2: 배치 구현 시 테스트
        pass

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_kpi_deterministic_calculation(self, async_client):
        """
        KPI 점수 결정론적 계산 (AI 제외)

        근거 (D14):
        - 정량: 결정론적 코드 (함수형)
        - AI: 서술만 생성 (strength/improvement/basis)

        테스트:
        - 동일 입력 → 동일 출력 보증
        - 소수점 반올림 규칙 명시

        @TEST T1.7.9 - 결정론적 계산
        """
        # Phase 1: 점수 계산 함수 단위테스트로 검증
        pass

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_kpi_double_counting_prevention(self, async_client):
        """
        KPI 이중집계 방지 (attendance vs presence)

        근거 (D14(d)):
        - ERP attendance: 근태 관리
        - 3D presence: 위치 기반 활동 (KPI 산출)
        - 보정 ±5% 제거: ERP가 이미 attendance 반영

        @TEST T1.7.10 - 이중집계 방지
        """
        # Phase 1: presence 독립 계산 검증
        pass

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_kpi_objection_workflow(self, async_client, auth_headers, admin_auth_headers):
        """
        KPI 이의신청 워크플로우 (상태머신)

        상태 전이 (D15):
        1. draft (평가 공개 전)
        2. published (공개)
        3. objection_received (이의 접수)
        4. under_review (재검토 중)
        5. resolved (이의 해결)
        6. confirmed (최종 확정)
        7. erp_pushed (ERP 전송 완료)

        @TEST T1.7.11 - 이의신청 상태머신
        """
        # Phase 1: 상태 전이 테스트
        pass

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_kpi_grace_period(self, async_client):
        """
        KPI 이의신청 유예 기간 (7일)

        참조 (D15):
        - 공개 후 7일 내만 이의신청 가능
        - 이후: 거부 (410 Gone)

        @TEST T1.7.12 - 이의신청 유예 기간
        """
        # Phase 1: 시간 기반 검증
        pass


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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_trigger_erp_sync(self, async_client, admin_auth_headers):
        """
        ERP 수동 동기화 트리거 → 202 Accepted

        POST /sync/erp

        동작:
        - 비동기 배치 작업 큐 (APScheduler)
        - 응답: sync_job_id (상태 조회용)

        @TEST T1.8.1 - ERP 동기화 트리거
        """
        response = await async_client.post(
            "/sync/erp",
            headers=admin_auth_headers
        )
        assert response.status_code == 202
        data = response.json()
        assert "sync_job_id" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_sync_status(self, async_client, admin_auth_headers):
        """
        동기화 상태 조회 → 200

        GET /sync/status?job_id=sync-001

        응답:
        - status: "running" | "success" | "failed"
        - synced_at: 마지막 동기화 시각
        - next_scheduled: 다음 예정 시각
        - error_count: 실패 건수

        @TEST T1.8.2 - 동기화 상태 조회
        """
        response = await async_client.get(
            "/sync/status?job_id=sync-001",
            headers=admin_auth_headers
        )
        assert response.status_code in [200, 404]

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_get_sync_errors(self, async_client, admin_auth_headers):
        """
        동기화 실패 이력 조회 → 200

        GET /sync/errors?limit=10

        응답:
        - errors: [{error_message, table, row_count, attempted_at}]

        @TEST T1.8.3 - 동기화 오류 이력
        """
        response = await async_client.get(
            "/sync/errors?limit=10",
            headers=admin_auth_headers
        )
        assert response.status_code == 200

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_sync_incremental_plus_daily_full(self, async_client):
        """
        동기화 전략 (증분 + 일일 전체 대사)

        참조 (D18):
        - 증분: 매시간 (updated_at 기준)
        - 전체: 매일 00:00 KST (하드 삭제 감지)
        - 감지 시: soft-delete (is_active=false)
        - FK: CASCADE 제거, RESTRICT + soft-delete

        @TEST T1.8.4 - 동기화 전략
        """
        # Phase 2: 배치 스케줄러 구현 시 테스트
        pass


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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_list_audit_logs(self, async_client, admin_auth_headers):
        """
        감사 로그 조회 (admin만) → 200

        GET /audit-logs?action=login&user_id=1&days=7

        응답:
        - logs: [{timestamp, user_id, action, resource_type, resource_id, changes}]

        @TEST T1.9.1 - 감사 로그 조회
        """
        response = await async_client.get(
            "/audit-logs?days=7",
            headers=admin_auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "logs" in data

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
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

    @pytest.mark.skip(reason="Phase 1에서 구현 후 활성화")
    async def test_full_workflow_login_to_kpi(self, async_client):
        """
        전체 워크플로우: 로그인 → 회의 → 회의록 → KPI

        @TEST T1.10+ - 통합 워크플로우
        """
        # Phase 1: 구현 후 구성
        pass
