"""알림 서비스·API·실패 훅 배선 테스트 (P7-R3-T3)."""

from sqlalchemy import select

from app.models.tables import Notification
from app.services.notification_service import record_notification


async def test_record_notification_stages_row(db_session):
    await record_notification(
        db_session, category="sync_failure", title="t", message="m", send_external=False
    )
    await db_session.commit()
    rows = (await db_session.execute(select(Notification))).scalars().all()
    assert len(rows) == 1
    assert rows[0].category == "sync_failure"
    assert rows[0].is_read is False


async def test_sync_failure_records_notification(async_client, db_session, admin_auth_headers, monkeypatch):
    # ErpSyncService.sync_users를 강제 실패시켜 트리거 실패 경로 → 알림 적재 검증.
    async def boom(self, reader, company_id):  # noqa: ANN001
        raise RuntimeError("erp down")

    monkeypatch.setattr("app.api.sync.ErpSyncService.sync_users", boom)
    resp = await async_client.post("/sync/erp", headers=admin_auth_headers)
    assert resp.status_code == 202
    assert resp.json()["status"] == "failed"

    rows = (
        await db_session.execute(
            select(Notification).where(Notification.category == "sync_failure")
        )
    ).scalars().all()
    assert len(rows) >= 1
    assert "erp down" in (rows[0].message or "")


async def test_notifications_api(async_client, db_session, admin_auth_headers, auth_headers):
    db_session.add(Notification(category="sync_failure", severity="error", title="X"))
    await db_session.commit()

    r = await async_client.get("/notifications", headers=admin_auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["unread_total"] >= 1
    nid = body["items"][0]["notification_id"]

    r2 = await async_client.put(f"/notifications/{nid}/read", headers=admin_auth_headers)
    assert r2.status_code == 200
    assert r2.json()["is_read"] is True

    # 비관리자 차단
    r3 = await async_client.get("/notifications", headers=auth_headers)
    assert r3.status_code == 403


async def test_notifications_unread_filter_and_read_all(async_client, db_session, admin_auth_headers):
    db_session.add(Notification(category="sync_failure", severity="error", title="A"))
    db_session.add(Notification(category="kpi_push_failure", severity="error", title="B"))
    await db_session.commit()

    r = await async_client.get("/notifications?unread=true", headers=admin_auth_headers)
    assert r.status_code == 200
    assert len(r.json()["items"]) >= 2

    r2 = await async_client.post("/notifications/read-all", headers=admin_auth_headers)
    assert r2.status_code == 200
    assert r2.json()["marked"] >= 2

    r3 = await async_client.get("/notifications?unread=true", headers=admin_auth_headers)
    assert r3.json()["unread_total"] == 0
