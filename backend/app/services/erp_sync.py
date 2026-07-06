"""
ERP 동기화 공개 서비스 레이어 (G003).

이 모듈은 app.erp.* 구현을 서비스 계층 공개 API로 재노출한다.
소비자(스크립트·라우터·태스크 등)는 이 모듈만 임포트하면 된다.

공개 이름:
  ErpSource      — ERP 읽기 추상 인터페이스 (app.erp.reader.ErpReader 별칭)
  MockErpSource  — 인메모리 목 구현 (app.erp.mock_reader.MockErpReader 별칭)
  ErpSyncService — 동기화 서비스 (app.erp.sync.ErpSyncService)
  SyncResult     — 동기화 결과 DTO
  get_erp_source — 팩토리 (ERP_DATABASE_URL 기반 소스 선택)

사용 예::
    from app.services.erp_sync import ErpSyncService, get_erp_source

    reader = get_erp_source()        # 설정에 따라 Mock / Postgres 자동 선택
    async with AsyncSession(...) as session:
        result = await ErpSyncService(session).sync_users(reader, company_id=1)

컬럼 화이트리스트(D20-f): GPS·슬랙·깃허브·지라 등 민감 컬럼 미수집.
GPS 기반 자동 상태 전이 금지(D20-c).
실 ERP DB 연결은 ERP_DATABASE_URL 설정 후 가능; 미설정 시 Mock으로 동작.
"""

# ── 공개 재노출 ────────────────────────────────────────────────────────────────

from app.erp.reader import ErpReader as ErpSource  # noqa: F401
from app.erp.reader import get_erp_reader as get_erp_source  # noqa: F401
from app.erp.mock_reader import MockErpReader as MockErpSource  # noqa: F401
from app.erp.sync import ErpSyncService, SyncResult  # noqa: F401

# ── 하위 호환 별칭 ──────────────────────────────────────────────────────────────
ErpReader = ErpSource  # 내부 코드가 ErpReader를 직접 쓰는 경우 허용

__all__ = [
    "ErpSource",
    "MockErpSource",
    "ErpSyncService",
    "SyncResult",
    "get_erp_source",
    "ErpReader",
]
