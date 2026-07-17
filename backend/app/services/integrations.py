"""
외부 계정 연동 검증·활동 수집 (D31 — 본인 opt-in).

- GitHub: 계정 존재 검증(GET /users/{u}) + 최근 공개 이벤트 요약(GET /users/{u}/events/public).
  토큰(선택)이 있으면 Authorization 헤더로 rate limit 완화 + private 이벤트 접근.
- Figma: 토큰 필수(X-Figma-Token, GET /v1/me) — 토큰 없으면 계정명만 저장(verified=False).

활동 요약은 KPI 화면 표시용이며 KPI 정량식(08 §1.2)에는 반영하지 않는다.
테스트는 이 모듈의 함수를 monkeypatch — 외부 네트워크 차단.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import httpx

_TIMEOUT = httpx.Timeout(10.0)
_GITHUB_API = "https://api.github.com"
_FIGMA_API = "https://api.figma.com"


class IntegrationError(Exception):
    """공급자 검증/수집 실패 — status_code로 API 응답 매핑."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


async def verify_github(account: str, token: Optional[str]) -> dict[str, Any]:
    """GitHub 계정 실존 검증. 반환: 프로필 요약."""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(f"{_GITHUB_API}/users/{account}", headers=headers)
    if r.status_code == 404:
        raise IntegrationError(f"GitHub 계정 '{account}'를 찾을 수 없습니다", 400)
    if r.status_code == 401:
        raise IntegrationError("GitHub 토큰이 유효하지 않습니다", 400)
    if r.status_code >= 400:
        raise IntegrationError(f"GitHub API 오류 ({r.status_code})", 502)
    p = r.json()
    return {
        "login": p.get("login"),
        "name": p.get("name"),
        "public_repos": p.get("public_repos"),
        "profile_url": p.get("html_url"),
    }


async def fetch_github_activity(account: str, token: Optional[str]) -> dict[str, Any]:
    """최근 공개 이벤트(최대 100건) 집계 — push/PR/리뷰 수 + 최근 저장소."""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(
            f"{_GITHUB_API}/users/{account}/events/public",
            headers=headers,
            params={"per_page": 100},
        )
    if r.status_code >= 400:
        raise IntegrationError(f"GitHub 이벤트 조회 실패 ({r.status_code})", 502)
    events = r.json() if isinstance(r.json(), list) else []
    pushes = sum(1 for e in events if e.get("type") == "PushEvent")
    prs = sum(1 for e in events if e.get("type") == "PullRequestEvent")
    reviews = sum(1 for e in events if e.get("type") in ("PullRequestReviewEvent", "PullRequestReviewCommentEvent"))
    repos: list[str] = []
    for e in events:
        name = (e.get("repo") or {}).get("name")
        if name and name not in repos:
            repos.append(name)
        if len(repos) >= 5:
            break
    return {
        "sample_size": len(events),
        "push_events": pushes,
        "pull_request_events": prs,
        "review_events": reviews,
        "recent_repos": repos,
        "last_event_at": events[0].get("created_at") if events else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


async def verify_figma(token: str) -> dict[str, Any]:
    """Figma 개인 액세스 토큰 검증(GET /v1/me). 반환: 계정 요약."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(f"{_FIGMA_API}/v1/me", headers={"X-Figma-Token": token})
    if r.status_code in (401, 403):
        raise IntegrationError("Figma 토큰이 유효하지 않습니다", 400)
    if r.status_code >= 400:
        raise IntegrationError(f"Figma API 오류 ({r.status_code})", 502)
    p = r.json()
    return {
        "email": p.get("email"),
        "handle": p.get("handle"),
        "img_url": p.get("img_url"),
    }


async def fetch_figma_activity(token: str) -> dict[str, Any]:
    """Figma 활동 요약 — 계정(me) 재확인 기반. (파일 목록 API는 team_id 필요 → 후속)"""
    me = await verify_figma(token)
    return {
        "handle": me.get("handle"),
        "email": me.get("email"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
