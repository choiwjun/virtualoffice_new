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

    # ── JWT (D4: HS256 + 자체 시크릿, ERP와 미공유) ──
    jwt_secret_key: str = "dev-only-secret-CHANGE-IN-PRODUCTION"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_hours: int = 24  # D4 확정: 24h

    # ── CORS (Next.js 웹 관리콘솔) ──
    cors_origins: list[str] = ["http://localhost:3000"]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def uses_default_jwt_secret(self) -> bool:
        # prod에서 기본 시크릿이면 토큰 위조 가능 → 부팅 시 fail-fast(main.lifespan).
        default = type(self).model_fields["jwt_secret_key"].default
        return self.jwt_secret_key == default

    # ── 로그인 보안 (C2: 계정 잠금 + rate-limit) ──────────
    login_max_attempts: int = 5
    """연속 로그인 실패 허용 횟수 (초과 시 잠금, G010)"""
    login_lockout_minutes: int = 15
    """계정 잠금 지속 시간(분) (G010)"""

    # ── 배치 스케줄러 (D17: APScheduler, G010) ──────────
    scheduler_enabled: bool = False
    """True면 main.lifespan에서 APScheduler 기동. 기본 False(테스트/개발 미기동)."""

    # ── LiveKit 화상 (D24, Phase 5 — B-03 토큰 발급 슬라이스) ──────────
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    """key+secret 설정 시 회의 입장에 실 LiveKit AccessToken 발급. 비면 결정적 stub 토큰(하위호환).
    실 LiveKit 서버 룸 생성·화상·Egress·STT는 범위 밖(B-03 환경차단)."""

    @property
    def livekit_enabled(self) -> bool:
        return bool(self.livekit_api_key and self.livekit_api_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
