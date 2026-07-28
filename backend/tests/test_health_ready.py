"""liveness(/health)와 readiness(/ready) 분리 — 22 Tier 1 관측성.

둘을 한 엔드포인트로 합치면 둘 중 하나가 반드시 틀린다:
  - /health가 DB를 보면 → DB가 잠깐 끊겼을 때 오케스트레이터가 멀쩡한 프로세스를 재시작한다.
    재시작해도 DB는 그대로라 재시작 루프만 돈다.
  - /ready가 DB를 안 보면 → 연결 풀이 죽은 인스턴스에도 로드밸런서가 트래픽을 보낸다.
"""


async def test_health_is_liveness_only(async_client):
    """의존성이 어떻든 프로세스가 살아 있으면 200 — 재시작 루프 방지."""
    r = await async_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "checks" not in body, "/health가 의존성을 보면 liveness가 아니다"


async def test_ready_checks_database(async_client):
    r = await async_client.get("/ready")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ready"] is True
    assert body["checks"]["database"] == "ok"


async def test_ready_fails_with_503_not_200(async_client, monkeypatch):
    """실패를 200 + ready:false로 돌려주면 프로브가 통과해 버려 아무 소용이 없다."""
    import app.main as main

    class _BrokenEngine:
        def connect(self):  # noqa: D401
            raise RuntimeError("pool is closed")

    monkeypatch.setattr(main, "engine", _BrokenEngine())
    r = await async_client.get("/ready")
    assert r.status_code == 503, r.text
    body = r.json()
    assert body["ready"] is False
    # 이유가 담겨야 한다 — 503만 오면 무엇이 죽었는지 알 수 없다.
    assert body["checks"]["database"].startswith("error:")
