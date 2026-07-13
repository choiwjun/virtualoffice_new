"""커뮤니케이션 채널 채팅 API 테스트 (/api/chat/*).

채널: general(전사) | team:{id}(팀원 또는 admin). 메시지 불변, after 커서 폴링.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_chat_requires_auth(async_client: AsyncClient):
    r = await async_client.get("/api/chat/messages?channel=general")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_channels_general_only_without_team(async_client: AsyncClient, auth_headers):
    # employee_token(sub=1)에는 team_id 클레임 없음 → general만
    r = await async_client.get("/api/chat/channels", headers=auth_headers)
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()]
    assert ids == ["general"]


@pytest.mark.asyncio
async def test_channels_include_team(async_client: AsyncClient, leader_token):
    # leader_token은 team_id=1
    headers = {"Authorization": f"Bearer {leader_token}"}
    r = await async_client.get("/api/chat/channels", headers=headers)
    ids = [c["id"] for c in r.json()]
    assert "general" in ids
    assert "team:1" in ids


@pytest.mark.asyncio
async def test_send_and_list_messages(async_client: AsyncClient, auth_headers):
    r = await async_client.post(
        "/api/chat/messages",
        headers=auth_headers,
        json={"channel": "general", "content": "안녕하세요!"},
    )
    assert r.status_code == 201, r.text
    msg = r.json()
    assert msg["channel"] == "general"
    assert msg["user_id"] == 1
    assert msg["content"] == "안녕하세요!"
    assert msg["user_name"]  # erp_user 부재 시에도 폴백 이름 존재

    r2 = await async_client.get("/api/chat/messages?channel=general", headers=auth_headers)
    assert r2.status_code == 200
    items = r2.json()
    assert len(items) == 1
    assert items[0]["content"] == "안녕하세요!"


@pytest.mark.asyncio
async def test_message_order_and_after_cursor(async_client: AsyncClient, auth_headers):
    for i in range(3):
        await async_client.post(
            "/api/chat/messages",
            headers=auth_headers,
            json={"channel": "general", "content": f"msg-{i}"},
        )

    r = await async_client.get("/api/chat/messages?channel=general", headers=auth_headers)
    items = r.json()
    assert [m["content"] for m in items] == ["msg-0", "msg-1", "msg-2"]  # 시간 오름차순

    # after 커서: 마지막 메시지 이후 → 빈 목록
    last_ts = items[-1]["created_at"]
    r2 = await async_client.get(
        f"/api/chat/messages?channel=general&after={last_ts}", headers=auth_headers
    )
    assert r2.json() == []

    # 새 메시지 전송 후 after 커서로 증분 수신
    await async_client.post(
        "/api/chat/messages", headers=auth_headers, json={"channel": "general", "content": "new"}
    )
    r3 = await async_client.get(
        f"/api/chat/messages?channel=general&after={last_ts}", headers=auth_headers
    )
    assert [m["content"] for m in r3.json()] == ["new"]


@pytest.mark.asyncio
async def test_team_channel_access_control(
    async_client: AsyncClient, auth_headers, leader_token, admin_auth_headers
):
    leader_headers = {"Authorization": f"Bearer {leader_token}"}

    # 팀원(leader, team_id=1)은 team:1 전송 가능
    r = await async_client.post(
        "/api/chat/messages", headers=leader_headers, json={"channel": "team:1", "content": "팀 공지"}
    )
    assert r.status_code == 201, r.text

    # 비팀원(employee, team 없음)은 접근 불가
    r2 = await async_client.get("/api/chat/messages?channel=team:1", headers=auth_headers)
    assert r2.status_code == 403
    r3 = await async_client.post(
        "/api/chat/messages", headers=auth_headers, json={"channel": "team:1", "content": "x"}
    )
    assert r3.status_code == 403

    # admin은 모든 팀 채널 접근 가능
    r4 = await async_client.get("/api/chat/messages?channel=team:1", headers=admin_auth_headers)
    assert r4.status_code == 200
    assert len(r4.json()) == 1


@pytest.mark.asyncio
async def test_invalid_channel_and_content(async_client: AsyncClient, auth_headers):
    r = await async_client.get("/api/chat/messages?channel=bogus", headers=auth_headers)
    assert r.status_code == 400

    r2 = await async_client.get("/api/chat/messages?channel=team:abc", headers=auth_headers)
    assert r2.status_code == 400

    r3 = await async_client.post(
        "/api/chat/messages", headers=auth_headers, json={"channel": "general", "content": "   "}
    )
    assert r3.status_code == 400  # 공백만 → empty_content

    r4 = await async_client.post(
        "/api/chat/messages", headers=auth_headers, json={"channel": "general", "content": "x" * 2001}
    )
    assert r4.status_code == 422  # max_length 초과

    r5 = await async_client.get(
        "/api/chat/messages?channel=general&after=not-a-date", headers=auth_headers
    )
    assert r5.status_code == 400
