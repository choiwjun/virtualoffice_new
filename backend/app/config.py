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
    # D17 공휴일 스킵: EOD 배치를 건너뛸 KST 날짜(ISO, 콤마 구분). 예: "2026-01-01,2026-03-01"
    # 외부 공휴일 캘린더 API 연동 전까지 운영자가 연 단위로 유지한다.
    eod_holidays: str = ""

    # ── 로그인 IP rate-limit (P1-2, 2026-07-17 — PRD §7 보안 수용기준 'IP당 10 req/min') ──
    # 리버스프록시(Caddy)에서 1차 차단하되, 앱단에서도 방어(인메모리 슬라이딩 윈도우).
    # 멀티워커 배포 시 워커별 독립 카운터 — 정밀 제한은 Caddy가 담당. 0이면 앱단 비활성.
    login_rate_limit_per_min: int = 10
    # 프록시 뒤 실 클라이언트 IP 헤더(Caddy가 설정). 신뢰 프록시 경유일 때만 사용.
    trust_proxy_ip_header: bool = False

    # ── D31 외부 계정 토큰 암호화(at-rest, P1-5) ──
    # Fernet 대칭키(urlsafe base64 32B). 비어 있으면 environment!=production 한정 개발 고정키 사용.
    # 운영은 반드시 강한 키 주입(없으면 assert_production_safe가 기동 거부).
    integration_encryption_key: str = ""

    # ── AI 서술 초안/회의록 요약 (REQ-007, D14-e, D20 가명화) ──
    # NVIDIA Integrate API(OpenAI 호환). nvidia_api_key 비었거나 ai_draft_enabled=False면
    # 결정론적 mock 사용(네트워크·비용 없음). 실패 시에도 항상 mock 폴백.
    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    ai_draft_enabled: bool = False
    ai_draft_model: str = "google/gemma-4-31b-it"

    # ── JWT (D4: HS256 + 자체 시크릿, ERP와 미공유) ──
    jwt_secret_key: str = "dev-only-secret-CHANGE-IN-PRODUCTION"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_hours: int = 24  # D4 확정: 24h

    # ── 서버간 내부 API (Colyseus 이동서버 → FastAPI presence batch write, D3) ──
    # 운영: .env에서 강한 랜덤값 주입. Colyseus의 PRESENCE_SINK_TOKEN과 동일해야 함.
    internal_api_token: str = "dev-internal-token-CHANGE-IN-PRODUCTION"

    # ── CORS (Next.js 웹 관리콘솔) ──
    # localhost와 127.0.0.1은 브라우저 Origin이 다르다 — 둘 다 허용(2026-07-17: 127.0.0.1 접속 시 preflight 400 실측)
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    # ── LiveKit SFU (D24: 명시적 입장, G004) ──
    # 운영: .env에서 실제 api_key / api_secret 주입 (이 기본값은 로컬 개발 전용)
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "devsecret01234567890123456789012345"  # ≥32자
    # localhost는 브라우저가 ::1(IPv6)로 해석할 수 있는데 도커 포트 매핑은 127.0.0.1(IPv4)뿐이라
    # LiveKit 시그널 웹소켓이 주기적으로 끊긴다(2026-07-17 실측) — 127.0.0.1로 고정.
    livekit_url: str = "http://127.0.0.1:7880"
    livekit_token_expiry_seconds: int = 3600  # 1시간

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def assert_production_safe(self) -> None:
        """production 기동 가드(spec-gap-audit 2026-07-17 P1-3) — dev 기본 시크릿으로는 기동 거부.

        인터넷 공개(D21-r) 전제: 기본값 JWT/내부토큰/LiveKit 시크릿을 그대로 쓰면
        토큰 위조·내부 API 접근이 가능하므로 fail-fast 한다. main.py lifespan에서 호출.
        """
        if not self.is_production:
            return
        insecure = []
        if "CHANGE-IN-PRODUCTION" in self.jwt_secret_key:
            insecure.append("JWT_SECRET_KEY")
        if "CHANGE-IN-PRODUCTION" in self.internal_api_token:
            insecure.append("INTERNAL_API_TOKEN")
        if self.livekit_api_key == "devkey" or self.livekit_api_secret.startswith("devsecret"):
            insecure.append("LIVEKIT_API_KEY/SECRET")
        if not self.integration_encryption_key:
            insecure.append("INTEGRATION_ENCRYPTION_KEY(D31 토큰 암호화)")
        if insecure:
            raise RuntimeError(
                "production 환경에서 dev 기본 시크릿으로 기동할 수 없습니다: "
                + ", ".join(insecure)
                + " — .env에 강한 랜덤값을 주입하세요."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
