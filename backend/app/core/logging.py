"""구조화 로깅 — 로그 한 줄로 "누가 어느 회사에서 무엇을 하다 이랬는지"가 나오게 (22 Tier 1).

지금까지 로그는 포맷 없는 문장이었다. 그래서 사고가 나면 **어느 요청의 로그인지** 알 수 없었고,
멀티테넌시 제품인데 **어느 회사에서 난 일인지도** 없었다. 2026-07-27~28의 조용한 고장 셋
(배포 도면이 화면 밖 · 서버·클라 세계 불일치 · nullability 드리프트)은 전부 로그가 아니라
사람이 화면을 보고 찾았다.

## 구조
- `contextvars`로 요청 스코프 컨텍스트를 들고 다닌다 — 로거를 호출하는 쪽이 아무것도 몰라도
  request_id·company_id·user_id가 자동으로 붙는다. 인자로 넘기게 하면 결국 아무도 안 넣는다.
- `company_id`·`user_id`는 미들웨어가 아니라 **`get_current_user`가 채운다**. 미들웨어는
  의존성보다 먼저 돌아 토큰을 아직 모른다.
- 액세스 로그는 요청 **끝**에 한 줄. 시작·끝 두 줄을 찍으면 양이 두 배인데 얻는 건 없다
  (느린 요청은 duration_ms로 드러난다).

## 로그에 넣지 않는 것
- **쿼리스트링** — `/api/auth/set-password?token=…`처럼 URL에 1회용 토큰이 실리는 경로가 있다.
  경로만 남기면 그 토큰이 로그·로그수집기·백업으로 새지 않는다.
- 요청/응답 본문 — 비밀번호·개인정보가 그대로 들어온다(D20 최소수집).
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextvars import ContextVar
from typing import Optional

from starlette.datastructures import Headers
from starlette.types import ASGIApp

request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
user_id_var: ContextVar[Optional[int]] = ContextVar("user_id", default=None)
company_id_var: ContextVar[Optional[int]] = ContextVar("company_id", default=None)

# 요청 스코프 공유 상자. 미들웨어가 만들고 인증이 채운다.
#
# **왜 contextvar 값이 아니라 딕셔너리인가**: 스택 중간에 `BaseHTTPMiddleware`가 하나라도
# 있으면(현재 `LoginRateLimitMiddleware`) 그 지점에서 다운스트림이 별도 태스크로 갈라져,
# 엔드포인트가 `set()`한 값은 바깥 미들웨어로 **돌아오지 않는다**. 액세스 로그의 company_id가
# 영영 비는 형태로 드러났다. 컨텍스트 복사는 **참조**를 복사하므로, 같은 딕셔너리를 변이하면
# 태스크 경계를 넘어 보인다.
_holder_var: ContextVar[Optional[dict]] = ContextVar("vo_log_holder", default=None)

REQUEST_ID_HEADER = "X-Request-ID"

# LogRecord의 기본 속성 + 우리가 따로 처리하는 컨텍스트 — extra만 골라내기 위한 제외 목록.
_CONTEXT_FIELDS = ("request_id", "user_id", "company_id")
_RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message", "asctime", "taskName", *_CONTEXT_FIELDS,
}


def _ctx(record: logging.LogRecord, field: str):
    """레코드에 박힌 값 우선, 없으면 현재 컨텍스트.

    **레코드 생성 시점에 박아 둔다**(`install_record_factory`). 포맷 시점에 읽으면 요청이
    끝난 뒤 포맷되는 경로(큐 핸들러·테스트)에서 이미 리셋된 값을 보게 된다 — 실제로
    액세스 로그의 company_id가 비는 형태로 드러났다.
    """
    value = getattr(record, field, None)
    if value is not None:
        return value
    holder = _holder_var.get()
    if holder is not None and holder.get(field) is not None:
        return holder[field]
    return {"request_id": request_id_var, "user_id": user_id_var, "company_id": company_id_var}[field].get()


def install_record_factory() -> None:
    """모든 LogRecord에 요청 컨텍스트를 생성 시점에 박는다."""
    base = logging.getLogRecordFactory()
    if getattr(base, "_vo_context", False):
        return  # 이미 설치됨(테스트가 configure_logging을 여러 번 부른다)

    def factory(*args, **kwargs):
        record = base(*args, **kwargs)
        holder = _holder_var.get() or {}
        record.request_id = holder.get("request_id") or request_id_var.get()
        record.user_id = holder.get("user_id") if holder.get("user_id") is not None else user_id_var.get()
        record.company_id = (
            holder.get("company_id") if holder.get("company_id") is not None else company_id_var.get()
        )
        return record

    factory._vo_context = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)


def bind_request_user(*, user_id: Optional[int], company_id: Optional[int]) -> None:
    """인증이 끝난 뒤 호출자 신원을 컨텍스트에 심는다(`get_current_user`가 호출)."""
    user_id_var.set(user_id)
    company_id_var.set(company_id)
    holder = _holder_var.get()
    if holder is not None:
        holder["user_id"] = user_id
        holder["company_id"] = company_id


class JsonFormatter(logging.Formatter):
    """한 줄 = 한 JSON 객체. 수집기(Loki·CloudWatch·ELK)가 그대로 파싱한다."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = _ctx(record, "request_id")
        if rid:
            payload["request_id"] = rid
        uid = _ctx(record, "user_id")
        if uid is not None:
            payload["user_id"] = uid
        cid = _ctx(record, "company_id")
        if cid is not None:
            payload["company_id"] = cid
        # 호출부가 넘긴 extra={...}를 그대로 싣는다.
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class TextFormatter(logging.Formatter):
    """사람이 읽는 개발용 — 컨텍스트를 접두어로 붙인다."""

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        bits = []
        rid = _ctx(record, "request_id")
        if rid:
            bits.append(str(rid)[:8])
        cid = _ctx(record, "company_id")
        if cid is not None:
            bits.append(f"c{cid}")
        uid = _ctx(record, "user_id")
        if uid is not None:
            bits.append(f"u{uid}")
        return f"[{' '.join(bits)}] {base}" if bits else base


def configure_logging(level: str = "INFO", fmt: str = "text") -> None:
    """루트 핸들러를 하나로 통일한다 — uvicorn·앱 로그가 같은 포맷으로 나가게."""
    install_record_factory()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter()
        if fmt.strip().lower() == "json"
        else TextFormatter("%(levelname)s %(name)s: %(message)s")
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.strip().upper() or "INFO")
    # uvicorn은 자기 핸들러를 따로 붙인다 → 전파만 시켜 중복 출력을 막는다.
    for name in ("uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True

    # uvicorn.access는 **끈다**. 우리 미들웨어가 같은 내용을 컨텍스트와 함께 남기고,
    # 무엇보다 uvicorn은 쿼리스트링을 통째로 찍는다 —
    #   GET /api/auth/set-password?token=<1회용 토큰> 200
    # 이 한 줄이 로그·수집기·백업으로 토큰을 흘린다(실측으로 확인하고 껐다).
    access = logging.getLogger("uvicorn.access")
    access.handlers = []
    access.propagate = False
    access.disabled = True


class RequestContextMiddleware:
    """요청마다 id를 부여하고, 끝에 액세스 로그 한 줄을 남긴다.

    들어온 `X-Request-ID`는 그대로 이어받는다 — 프록시·프론트가 붙인 id가 있으면 그걸 써야
    한 요청을 시스템 경계 너머로 따라갈 수 있다. 응답에도 같은 헤더를 실어, 사용자가 캡처한
    화면 하나로 서버 로그를 찾을 수 있게 한다.

    **`BaseHTTPMiddleware`가 아니라 순수 ASGI다.** BaseHTTPMiddleware는 다운스트림을 별도
    태스크로 돌리기 때문에, 엔드포인트 쪽(`get_current_user`)에서 설정한 contextvar가
    미들웨어로 돌아오지 않는다 — 액세스 로그에 company_id·user_id가 영영 비어 있게 된다
    (실측으로 확인하고 바꿨다). 순수 ASGI는 같은 태스크에서 이어져 값이 보인다.
    """

    def __init__(self, app: ASGIApp, logger_name: str = "app.access") -> None:
        self.app = app
        self.logger = logging.getLogger(logger_name)

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        rid = headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        method = scope.get("method", "-")
        path = scope.get("path", "-")  # 쿼리스트링 제외 — 1회용 토큰이 실리는 경로가 있다

        token = request_id_var.set(rid)
        user_token = user_id_var.set(None)
        company_token = company_id_var.set(None)
        holder_token = _holder_var.set({"request_id": rid, "user_id": None, "company_id": None})
        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                message.setdefault("headers", []).append(
                    (REQUEST_ID_HEADER.lower().encode(), rid.encode())
                )
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            # 5xx는 warning으로 — 정상 트래픽에 묻히면 안 된다. 4xx는 클라이언트 잘못이라 info.
            self.logger.log(
                logging.WARNING if status_code >= 500 else logging.INFO,
                "%s %s %s %sms",
                method,
                path,
                status_code,
                duration_ms,
                extra={
                    "http_method": method,
                    "http_path": path,
                    "http_status": status_code,
                    "duration_ms": duration_ms,
                },
            )
            request_id_var.reset(token)
            user_id_var.reset(user_token)
            company_id_var.reset(company_token)
            _holder_var.reset(holder_token)
