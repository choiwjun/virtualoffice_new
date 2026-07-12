"""
백엔드 기반(foundation) 검증 테스트.

앱 부트스트랩이 실제로 동작하는지 확인:
- /health 엔드포인트
- DB 스키마 생성 (20개 테이블)
- JWT 발급/검증 + 만료
- bcrypt 비밀번호 해시
- get_current_user / require_role 인증 흐름
"""

from datetime import timedelta

import jwt
import pytest
from fastapi import Depends
from sqlalchemy import text

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.db import Base


# ── 헬스체크 ──────────────────────────────────────────────
async def test_health_endpoint(async_client):
    resp = await async_client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body


# ── DB 스키마 ─────────────────────────────────────────────
def test_all_tables_registered():
    assert len(Base.metadata.tables) == 24  # +user_avatar (C4, 06-screens §3.9, 2026-07-12)
    assert "erp_user" in Base.metadata.tables
    assert "kpi_result" in Base.metadata.tables
    assert "user_avatar" in Base.metadata.tables


async def test_db_session_usable(db_session):
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar() == 1


# ── JWT ───────────────────────────────────────────────────
def test_jwt_roundtrip():
    token = create_access_token({"sub": "42", "role": "admin", "email": "a@b.com"})
    decoded = decode_access_token(token)
    assert decoded["sub"] == "42"
    assert decoded["role"] == "admin"
    assert "exp" in decoded


def test_jwt_expired_rejected():
    token = create_access_token({"sub": "1", "role": "employee"}, expires_delta=timedelta(seconds=-1))
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token)


def test_jwt_tampered_rejected():
    token = create_access_token({"sub": "1", "role": "employee"})
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(token + "tampered")


# ── 비밀번호 ──────────────────────────────────────────────
def test_password_hash_verify():
    hashed = hash_password("S3cure!pass")
    assert hashed != "S3cure!pass"
    assert verify_password("S3cure!pass", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_password_over_72_bytes_does_not_crash():
    # bcrypt 72바이트 상한 — 절단 처리로 예외 없이 동작해야 함
    long_pw = "a" * 200
    hashed = hash_password(long_pw)
    assert verify_password(long_pw, hashed) is True


# ── 인증 의존성 (get_current_user / require_role) ─────────
async def test_protected_route_requires_auth(async_client):
    """보호 라우트: 토큰 없으면 401 (임시 라우트 주입으로 검증)."""
    from app.core.deps import get_current_user, require_role
    from app.main import app

    @app.get("/_test/me")
    async def _me(user=Depends(get_current_user)):
        return {"user_id": user.user_id, "role": user.role}

    @app.get("/_test/admin-only")
    async def _admin(user=Depends(require_role("admin"))):
        return {"ok": True}

    try:
        # 토큰 없음 → 401
        assert (await async_client.get("/_test/me")).status_code == 401

        # employee 토큰 → me OK, admin-only 403
        emp = create_access_token({"sub": "1", "role": "employee"})
        h = {"Authorization": f"Bearer {emp}"}
        r = await async_client.get("/_test/me", headers=h)
        assert r.status_code == 200 and r.json()["role"] == "employee"
        assert (await async_client.get("/_test/admin-only", headers=h)).status_code == 403

        # admin 토큰 → admin-only OK
        adm = create_access_token({"sub": "3", "role": "admin"})
        ha = {"Authorization": f"Bearer {adm}"}
        assert (await async_client.get("/_test/admin-only", headers=ha)).status_code == 200
    finally:
        # 주입 라우트 정리
        app.router.routes = [
            r for r in app.router.routes
            if getattr(r, "path", "") not in ("/_test/me", "/_test/admin-only")
        ]
