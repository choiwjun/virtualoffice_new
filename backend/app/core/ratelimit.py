"""
로그인 IP rate-limit 미들웨어 (P1-2, 2026-07-17).

PRD §7 보안 수용기준 "IP당 10 req/min" 대응. 인터넷 공개(D21-r) 전제에서
- email 키 잠금(auth.py)만으로는 (a) 타인 계정 잠금 DoS, (b) 분산 브루트포스를 막지 못함.
- 이 미들웨어는 **클라이언트 IP** 기준으로 로그인 POST 빈도를 제한한다.

한계(정직): 인메모리 슬라이딩 윈도우라 멀티워커 배포 시 워커별 독립 카운터다.
정밀·전역 제한은 리버스프록시(Caddy rate_limit)가 담당하고, 이 미들웨어는 앱단 2차 방어다.
프록시 뒤 배포에서는 settings.trust_proxy_ip_header=True로 X-Forwarded-For 첫 홉을 신뢰한다.
한도·프록시 신뢰 여부는 settings에서 매 요청 동적으로 읽는다(테스트는 0으로 비활성).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque, Dict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_WINDOW_SEC = 60.0


class LoginRateLimitMiddleware(BaseHTTPMiddleware):
    """POST /api/auth/login 에 대해 IP당 분당 요청 수를 제한한다(429)."""

    def __init__(self, app, *, path: str = "/api/auth/login"):
        super().__init__(app)
        self._path = path
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def _client_ip(self, request: Request, trust_proxy: bool) -> str:
        if trust_proxy:
            fwd = request.headers.get("x-forwarded-for")
            if fwd:
                return fwd.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next):
        from app.config import settings

        limit = settings.login_rate_limit_per_min
        if limit <= 0 or request.method != "POST" or request.url.path != self._path:
            return await call_next(request)

        ip = self._client_ip(request, settings.trust_proxy_ip_header)
        now = time.monotonic()
        bucket = self._hits[ip]
        cutoff = now - _WINDOW_SEC
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= limit:
            retry = int(_WINDOW_SEC - (now - bucket[0])) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": f"too_many_login_attempts_from_ip (retry in {retry}s)"},
                headers={"Retry-After": str(retry)},
            )

        bucket.append(now)
        resp = await call_next(request)
        return resp
