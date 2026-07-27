"""유저 발급·검증 공용 헬퍼 (셀프가입 Phase 2 · admin 유저 CRUD Phase 3 공유 정본).

셀프가입(`api/auth.register`)과 admin 직접 생성(`api/employees.create_employee`)이
같은 규칙으로 native 유저를 만들어야 한다 — id 대역·이메일 정규화가 갈리면 ERP 대사와
로그인 조회가 깨진다. 그 규칙을 여기 한 곳에 둔다.
"""

from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpUser

# 경량 이메일 검증(RFC 완전판 아님) — email-validator 미설치 환경에서도 동작.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# native(ERP無) 유저 id 대역 바닥값 (24-spec §3): ERP 조인키(BigInteger PK)·시드(1001~,
# 2001~)와 충돌하지 않도록 10억 이상에서 발급. Postgres에서도 BigInteger PK는 자동
# 시퀀스가 아니므로 max(id)+1을 명시 계산해 넣는다(floor로 하한 보장).
NATIVE_ID_FLOOR = 1_000_000_000

# native 유저의 ERP 팀 미매핑 센티널 (ERP teams와 조인되지 않음).
UNASSIGNED_TEAM_ID = 0


def normalize_email(raw: str) -> str:
    """소문자·공백제거 후 형식 검증. 부적합하면 ValueError (pydantic validator에서 소비)."""
    v = raw.strip().lower()
    if not EMAIL_RE.match(v) or len(v) > 255:
        raise ValueError("invalid_email")
    return v


async def next_native_user_id(db: AsyncSession) -> int:
    """자체 생성 유저의 안전한 PK 발급 = max(existing id, floor-1) + 1.

    전 테넌트 통틀어 max를 본다 — id는 전역 PK이므로 회사별로 계산하면 충돌한다.
    """
    result = await db.execute(select(func.max(ErpUser.id)))
    current_max = result.scalar() or 0
    return max(current_max, NATIVE_ID_FLOOR - 1) + 1
