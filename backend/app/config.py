"""
애플리케이션 설정 (pydantic-settings).

정본: docs/planning/00-decisions.md (D4 JWT HS256 자체시크릿), 11-tech-stack.md
- 환경변수 또는 .env 파일로 오버라이드 (.env.example 참조)
- 시크릿은 절대 커밋하지 않음 (.gitignore로 .env 제외)
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── 앱 ──────────────────────────────────────────────
    app_name: str = "가상오피스 운영 플랫폼 API"
    environment: str = "development"  # development | staging | production
    debug: bool = True

    # ── 우리 DB (PostgreSQL async, D3: 단일 FastAPI 경유) ──
    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/virtualoffice"
    )
    db_echo: bool = False

    # dev/도그푸딩 편의: 기동 시 테이블 자동 생성 (운영은 Alembic 마이그레이션 사용).
    auto_create_tables: bool = False

    # ── ERP dailylog read-only DB (03-erp-integration, D18) ──
    # 같은 사내망, company_id 스코프. 비어있으면 ERP 연동 비활성.
    erp_database_url: str = ""
    # ERP write-back(EOD 전송) 대상. 비어있으면 mock 전송(상태머신만 동작, 실 ERP 미접속).
    erp_push_endpoint: str = ""

    # ── AI 서술 초안 (REQ-007, D14-e, D20 가명화) ──
    # anthropic_api_key 비어있거나 ai_draft_enabled=False면 결정론적 mock 초안 사용(네트워크·비용 없음).
    anthropic_api_key: str = ""
    ai_draft_enabled: bool = False
    ai_draft_model: str = "claude-opus-4-8"

    # ── JWT (D4: HS256 + 자체 시크릿, ERP와 미공유) ──
    jwt_secret_key: str = "dev-only-secret-CHANGE-IN-PRODUCTION"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_hours: int = 24  # D4 확정: 24h

    # ── CORS (Next.js 웹 관리콘솔) ──
    cors_origins: list[str] = ["http://localhost:3000"]
    # ── LiveKit SFU (D24: 명시적 입장, G004) ──
    # 운영: .env에서 실제 api_key / api_secret 주입 (이 기본값은 로컬 개발 전용)
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "devsecret01234567890123456789012345"  # ≥32자
    livekit_url: str = "http://localhost:7880"
    livekit_token_expiry_seconds: int = 3600  # 1시간

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
