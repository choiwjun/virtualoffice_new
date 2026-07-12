from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.tables import (
    ErpRole,
    ErpUser,
    RecordingConsent,
    Room,
    RoomStatus,
    RoomType,
)


@pytest.fixture
def attendee_headers() -> dict[str, str]:
    token = create_access_token(
        {"sub": "4", "email": "attendee@example.com", "role": "employee"}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def host_headers() -> dict[str, str]:
    token = create_access_token(
        {"sub": "1", "email": "host@example.com", "role": "employee"}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        {"sub": "3", "email": "admin@example.com", "role": "admin"}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def consent_seed(db_session: AsyncSession) -> dict[str, str]:
    room = Room(
        id=uuid4(),
        floor_id=uuid4(),
        type=RoomType.MEETING,
        name="동의 테스트 회의실",
        capacity=8,
        coords={"x": 0, "y": 0, "width": 10, "height": 10},
        status=RoomStatus.ACTIVE,
    )
    db_session.add(room)
    for uid, email, name, role in [
        (1, "host@example.com", "Host", ErpRole.EMPLOYEE),
        (3, "admin@example.com", "Admin", ErpRole.ADMIN),
        (4, "attendee@example.com", "Attendee", ErpRole.EMPLOYEE),
    ]:
        db_session.add(
            ErpUser(
                id=uid,
                company_id=1,
                email=email,
                name=name,
                erp_team_id=1,
                role=role,
            )
        )
    await db_session.commit()
    return {"room_id": str(room.id)}


async def _create_meeting(
    client: AsyncClient,
    room_id: str,
    headers: dict[str, str],
) -> str:
    response = await client.post(
        "/api/meetings",
        json={
            "room_id": room_id,
            "title": "동의 테스트",
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _create_minute(
    client: AsyncClient,
    meeting_id: str,
    headers: dict[str, str],
) -> str:
    response = await client.post(
        "/api/meeting-minutes",
        json={"meeting_id": meeting_id, "decisions": "동의 게이트 확인"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _join_meeting(
    client: AsyncClient,
    meeting_id: str,
    headers: dict[str, str],
) -> None:
    response = await client.post(
        f"/api/meetings/{meeting_id}/join",
        headers=headers,
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_register_consent_returns_201(
    async_client: AsyncClient,
    consent_seed: dict[str, str],
    host_headers: dict[str, str],
) -> None:
    meeting_id = await _create_meeting(async_client, consent_seed["room_id"], host_headers)

    response = await async_client.post(
        f"/api/meetings/{meeting_id}/consent",
        json={"consent_type": "stt", "granted": True},
        headers=host_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["meeting_id"] == meeting_id
    assert body["user_id"] == 1
    assert body["consent_type"] == "stt"
    assert body["granted"] is True


@pytest.mark.asyncio
async def test_duplicate_consent_updates_existing_row(
    async_client: AsyncClient,
    db_session: AsyncSession,
    consent_seed: dict[str, str],
    host_headers: dict[str, str],
) -> None:
    meeting_id = await _create_meeting(async_client, consent_seed["room_id"], host_headers)
    path = f"/api/meetings/{meeting_id}/consent"
    first = await async_client.post(
        path,
        json={"consent_type": "stt", "granted": True},
        headers=host_headers,
    )
    assert first.status_code == 201

    second = await async_client.post(
        path,
        json={"consent_type": "stt", "granted": False},
        headers=host_headers,
    )

    assert second.status_code == 201
    assert second.json()["granted"] is False
    count = await db_session.scalar(select(func.count()).select_from(RecordingConsent))
    assert count == 1


@pytest.mark.asyncio
async def test_stt_draft_requires_attendee_stt_consent(
    async_client: AsyncClient,
    consent_seed: dict[str, str],
    host_headers: dict[str, str],
    attendee_headers: dict[str, str],
) -> None:
    meeting_id = await _create_meeting(async_client, consent_seed["room_id"], host_headers)
    await _join_meeting(async_client, meeting_id, attendee_headers)
    minute_id = await _create_minute(async_client, meeting_id, host_headers)

    response = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/stt-draft",
        headers=host_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "consent_required"


@pytest.mark.asyncio
async def test_stt_draft_reaches_stub_after_attendee_stt_consent(
    async_client: AsyncClient,
    consent_seed: dict[str, str],
    host_headers: dict[str, str],
    attendee_headers: dict[str, str],
) -> None:
    meeting_id = await _create_meeting(async_client, consent_seed["room_id"], host_headers)
    await _join_meeting(async_client, meeting_id, attendee_headers)
    minute_id = await _create_minute(async_client, meeting_id, host_headers)
    consent_response = await async_client.post(
        f"/api/meetings/{meeting_id}/consent",
        json={"consent_type": "stt", "granted": True},
        headers=attendee_headers,
    )
    assert consent_response.status_code == 201

    response = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/stt-draft",
        headers=host_headers,
    )

    assert response.status_code == 501
    assert response.json()["detail"] == "stt_not_implemented"


@pytest.mark.asyncio
async def test_admin_or_host_can_view_participant_consent(
    async_client: AsyncClient,
    consent_seed: dict[str, str],
    host_headers: dict[str, str],
    attendee_headers: dict[str, str],
    admin_headers: dict[str, str],
) -> None:
    meeting_id = await _create_meeting(async_client, consent_seed["room_id"], host_headers)
    await _join_meeting(async_client, meeting_id, attendee_headers)
    await async_client.post(
        f"/api/meetings/{meeting_id}/consent",
        json={"consent_type": "recording", "granted": True},
        headers=attendee_headers,
    )

    host_response = await async_client.get(
        f"/api/meetings/{meeting_id}/consent",
        headers=host_headers,
    )
    admin_response = await async_client.get(
        f"/api/meetings/{meeting_id}/consent",
        headers=admin_headers,
    )

    assert host_response.status_code == 200
    assert admin_response.status_code == 200
    assert host_response.json() == admin_response.json()
    assert host_response.json()[0]["recording"] is True
