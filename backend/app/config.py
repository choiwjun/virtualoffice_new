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

    # ── ERP dailylog read-only DB (03-erp-integration, D18) ──
    # 같은 사내망, company_id 스코프. 비어있으면 ERP 연동 비활성.
    erp_database_url: str = ""

    # ── JWT (D4: HS256 + 자체 시크릿, ERP와 미공유) ──
    jwt_secret_key: str = "dev-only-secret-CHANGE-IN-PRODUCTION"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_hours: int = 24  # D4 확정: 24h

    # ── CORS (Next.js 웹 관리콘솔) ──
    cors_origins: list[str] = ["http://localhost:3000"]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
