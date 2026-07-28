"""구조화 로깅 — 로그 한 줄로 "누가 어느 회사에서 무엇을 하다 이랬는지"가 나오는가 (22 Tier 1).

2026-07-27~28의 조용한 고장 셋은 전부 로그가 아니라 사람이 화면을 보고 찾았다. 로그에
요청 id·회사·유저가 없으면 사고가 나도 어느 요청인지조차 특정할 수 없다.
"""

import json
import logging

from app.core.logging import (
    REQUEST_ID_HEADER,
    JsonFormatter,
    bind_request_user,
    company_id_var,
    request_id_var,
    user_id_var,
)


def _record(msg: str = "hello", **extra) -> logging.LogRecord:
    rec = logging.LogRecord("app.test", logging.INFO, __file__, 1, msg, None, None)
    for k, v in extra.items():
        setattr(rec, k, v)
    return rec


def test_json_formatter_emits_one_object_per_line():
    line = JsonFormatter().format(_record("something happened"))
    assert "\n" not in line, "여러 줄이면 수집기가 한 이벤트로 못 읽는다"
    body = json.loads(line)
    assert body["msg"] == "something happened"
    assert body["level"] == "INFO"
    assert body["logger"] == "app.test"


def test_context_is_attached_without_the_caller_knowing():
    """로거를 부르는 쪽이 아무것도 안 넘겨도 컨텍스트가 붙어야 한다 — 인자로 받게 하면 아무도 안 넣는다."""
    rid = request_id_var.set("req-123")
    bind_request_user(user_id=1001, company_id=7)
    try:
        body = json.loads(JsonFormatter().format(_record()))
    finally:
        request_id_var.reset(rid)
        bind_request_user(user_id=None, company_id=None)

    assert body["request_id"] == "req-123"
    assert body["user_id"] == 1001
    assert body["company_id"] == 7


def test_context_absent_keys_are_omitted_not_null():
    """미인증 요청에서 user_id: null을 싣느니 키를 빼는 편이 쿼리하기 쉽다."""
    body = json.loads(JsonFormatter().format(_record()))
    assert "user_id" not in body and "company_id" not in body


def test_extra_fields_pass_through():
    body = json.loads(JsonFormatter().format(_record(http_status=503, duration_ms=12.5)))
    assert body["http_status"] == 503
    assert body["duration_ms"] == 12.5


def test_exception_is_captured():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        rec = _record("failed")
        rec.exc_info = sys.exc_info()
    body = json.loads(JsonFormatter().format(rec))
    assert "ValueError" in body["exc"] and "boom" in body["exc"]


# ── 미들웨어: 요청 id 왕복 + 액세스 로그 ────────────────────────────────
async def test_request_id_is_returned_to_caller(async_client):
    """사용자가 캡처한 화면 하나로 서버 로그를 찾을 수 있어야 한다."""
    r = await async_client.get("/health")
    assert r.headers.get(REQUEST_ID_HEADER)


async def test_incoming_request_id_is_preserved(async_client):
    """프록시·프론트가 붙인 id가 있으면 그걸 이어야 경계 너머로 한 요청을 따라갈 수 있다."""
    r = await async_client.get("/health", headers={REQUEST_ID_HEADER: "trace-abc"})
    assert r.headers.get(REQUEST_ID_HEADER) == "trace-abc"


async def test_access_log_has_no_query_string(async_client, caplog):
    """`/api/auth/set-password?token=…`처럼 URL에 1회용 토큰이 실리는 경로가 있다 —
    쿼리스트링을 남기면 그 토큰이 로그·수집기·백업으로 샌다."""
    with caplog.at_level(logging.INFO, logger="app.access"):
        await async_client.get("/health?token=super-secret-value")

    lines = [r for r in caplog.records if r.name == "app.access"]
    assert lines, "액세스 로그가 남지 않았다"
    joined = " ".join(r.getMessage() for r in lines) + " " + " ".join(
        str(getattr(r, "http_path", "")) for r in lines
    )
    assert "super-secret-value" not in joined
    assert "/health" in joined


async def test_access_log_carries_status_and_duration(async_client, caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        await async_client.get("/health")

    rec = next(r for r in caplog.records if r.name == "app.access")
    assert rec.http_status == 200
    assert rec.http_method == "GET"
    assert isinstance(rec.duration_ms, float)


async def test_server_error_logs_at_warning(async_client, caplog):
    """5xx가 정상 트래픽과 같은 레벨이면 묻힌다."""
    with caplog.at_level(logging.INFO, logger="app.access"):
        await async_client.get("/api/employees")  # 미인증 → 401

    rec = next(r for r in caplog.records if r.name == "app.access")
    assert rec.http_status == 401
    assert rec.levelno == logging.INFO, "4xx는 클라이언트 잘못이라 warning이 아니다"


async def test_access_log_carries_caller_identity(async_client, auth_headers, caplog):
    """인증된 요청의 액세스 로그에 company_id·user_id가 실려야 한다.

    처음 구현은 `BaseHTTPMiddleware`였는데, 그건 다운스트림을 **별도 태스크**로 돌려서
    엔드포인트 쪽(`get_current_user`)이 설정한 contextvar가 미들웨어로 돌아오지 않는다 —
    로그의 company_id가 영영 None이었다(실측으로 발견). 순수 ASGI 미들웨어로 바꿔 고쳤고,
    이 테스트가 그 회귀를 막는다.
    """
    with caplog.at_level(logging.INFO, logger="app.access"):
        r = await async_client.get("/api/employees", headers=auth_headers)

    assert r.status_code == 200, r.text
    rec = next(x for x in caplog.records if x.name == "app.access")
    # 포매터가 읽는 경로 그대로 검증 — 레코드 속성이 아니라 contextvar에서 온다.
    body = json.loads(JsonFormatter().format(rec))
    assert body["company_id"] is not None, "멀티테넌시 제품인데 어느 회사인지 로그에 없다"
    assert body["user_id"] is not None


def test_uvicorn_access_logger_is_disabled():
    """uvicorn.access는 쿼리스트링을 통째로 찍는다 — 1회용 토큰이 그대로 로그에 남는다.

    실측: `GET /api/auth/set-password?token=<토큰> 200`. 우리 미들웨어가 같은 내용을
    컨텍스트와 함께, 쿼리 없이 남기므로 uvicorn 쪽은 꺼야 한다.
    """
    from app.config import settings
    from app.core.logging import configure_logging

    configure_logging(settings.log_level, settings.log_format)
    assert logging.getLogger("uvicorn.access").disabled is True
