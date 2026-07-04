"""
확정 KPI 결과 → ERP 푸시 backfill (D17, G006).

@TASK P6-R3-T3c - KPI ERP push feature-flag + backfill
@SPEC docs/planning/00-decisions.md D17(배치/피처 플래그), D15(확정 이벤트 푸시)

settings.kpi_erp_push_enabled가 False(기본)면 confirm은 로컬에만 반영되고 pushed_to_erp는
False로 남는다(D17 리스크 완화: 로컬 우선 적재). True면 확정되었지만 아직 푸시되지 않은
(final_score/finalized_at 존재, pushed_to_erp=False) 행만 골라 ERP로 POST하는 멱등 backfill을
수행한다 — 이미 pushed_to_erp=True인 행은 재조회 대상이 아니므로 재실행해도 중복 푸시가 없다.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as default_settings
from app.models.tables import KpiResult

logger = logging.getLogger(__name__)


async def push_confirmed_kpi_to_erp(
    db: AsyncSession, client: httpx.AsyncClient | None = None
) -> dict:
    """확정(final_score/finalized_at) + 미푸시(pushed_to_erp=False) kpi_result를 ERP로 backfill.

    settings.kpi_erp_push_enabled가 False면 아무것도 하지 않는다(로컬 우선 적재, D17).
    True면 대상 행을 `{erp_push_base_url}/api/kpi-results`로 POST하고, 2xx 응답이면
    pushed_to_erp=True + pushed_at을 기록한다. 실패 행은 pushed_to_erp=False로 남아
    다음 실행에서 재시도 대상이 된다(멱등).
    """
    settings = default_settings
    if not settings.kpi_erp_push_enabled:
        return {"pushed": 0, "failed": 0, "skipped": "flag_off"}

    if not settings.erp_push_base_url:
        logger.warning("push_confirmed_kpi_to_erp: 플래그 ON이나 erp_push_base_url 미설정 — 스킵")
        return {"pushed": 0, "failed": 0, "skipped": "base_url_missing"}

    rows = (
        await db.execute(
            select(KpiResult).where(
                KpiResult.final_score.is_not(None),
                KpiResult.finalized_at.is_not(None),
                KpiResult.pushed_to_erp.is_(False),
            )
        )
    ).scalars().all()
    if not rows:
        return {"pushed": 0, "failed": 0, "skipped": "no_pending_rows"}

    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=10.0)
    pushed = 0
    failed = 0
    now = datetime.now(timezone.utc)
    try:
        for kr in rows:
            payload = {
                "kpi_result_id": str(kr.id),
                "user_id": kr.user_id,
                "period_type": kr.period_type.value,
                "period_key": kr.period_key,
                "metric": kr.metric,
                "final_score": float(kr.final_score),
            }
            try:
                response = await http_client.post(
                    f"{settings.erp_push_base_url}/api/kpi-results", json=payload
                )
                ok = 200 <= response.status_code < 300
            except httpx.HTTPError:
                ok = False
            if ok:
                kr.pushed_to_erp = True
                kr.pushed_at = now
                pushed += 1
            else:
                failed += 1
    finally:
        if owns_client:
            await http_client.aclose()

    await db.flush()
    return {"pushed": pushed, "failed": failed}
