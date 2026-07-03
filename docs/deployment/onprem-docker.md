# 사내 서버 PC 배포 아키텍처 (Docker Compose)

**작성**: 2026-07-02 · **정본 근거**: 02-trd §호스팅(Docker Compose 권장), 11-tech-stack §4.2, OQ5(LiveKit self-host 확정)
**배포 대상**: 사내 온프렘 **로컬 서버 PC 1대** · 단일 조직 도그푸딩(동시 ~20명) · 1인 운영
**오케스트레이션**: **Docker Compose** (Kubernetes 미사용 — 단일 노드·1인 운영에 과잉, ERP도 compose 사용)

---

## 1. 전체 배치 지도 — 무엇이 Docker에 들어가고, 무엇이 안 들어가나

### 서버 PC 1대 (Docker Compose)

| 서비스 | 이미지/빌드 | 포트 | 도입 시기 | 상태 |
|---|---|---|---|---|
| `db` | postgres:17 | 5432(내부) | 지금 | ✅ 구성됨 |
| `backend` | ./backend (FastAPI) | 8000 | 지금 | ✅ 구성됨 |
| `web` | ./web (Next.js 콘솔) | 3000 | Phase 2~3 | 예정 |
| `godot-server` | Godot 헤드리스 export (Linux) | 9000(WSS) | Phase 4 | 예정 |
| `livekit` | livekit/livekit-server | 7880(TCP)+**UDP 범위** | Phase 5 | 예정 ⚠️ |
| `coturn` | coturn/coturn | 3478, 5349(TLS) | Phase 5 | 예정 ⚠️ |
| `proxy` | caddy (TLS 종단/리버스 프록시) | 80/443 | web 도입 시 | 예정 |

- EOD 배치(18:00 KST ERP push)·ERP 동기화 스케줄은 **backend 내 APScheduler**로 실행 — 별도 컨테이너 불필요.
  자세한 cron 표·동시성 가드는 §3.4 참조.
- STT 워커(Phase 5)는 부하 보고 backend 내장 vs 분리 결정.

### Docker에 들어가지 **않는** 것

| 컴포넌트 | 실행 위치 | 이유 |
|---|---|---|
| **Godot 데스크톱 클라이언트** | 각 직원 PC (네이티브 설치) | D11 확정 — Forward+ 최고품질은 네이티브. 자동 업데이트(P7 태스크)로 갱신 |
| Blender→GLB 에셋 파이프라인 | 개발 PC | 빌드타임 도구 |
| ERP(space-daily) | 기존 ERP 서버 (별도) | 우리는 read-only 접속만. 같은 사내망 |

```
[직원 PC들]                          [사내 서버 PC - Docker Compose]
 Godot 클라이언트(네이티브) ──WSS──▶  godot-server (헤드리스, 이동/근접/점유 권위)
 브라우저(관리콘솔)       ──HTTPS─▶  proxy(caddy) ─▶ web(Next.js) / backend(FastAPI)
 화상(클라이언트 내)      ──WebRTC─▶  livekit + coturn (UDP)
                                      backend ──read-only──▶ [ERP dailylog PG] (기존 사내망)
                                      backend ──EOD push───▶ [ERP API]
                                      db(postgres:17, pgdata 볼륨)
```

---

> **확정 (2026-07-02 사용자 인터뷰)**
> - **서버 OS = Linux 설치 예정** (§2 권장안 채택) → LiveKit/coturn 경로 순탄.
> - **회사 VPN 없음 → 외부 공개 필요** (OQ5 종결) → §3이 "사내망 전용"에서 **"인터넷 노출 아키텍처"**로 격상됨. 보안 요구 대폭 상승.

## 2. ⚠️ 성패를 가르는 결정: 서버 PC의 OS — ✅ Linux 확정

| | **Linux (Ubuntu Server 24.04 권장)** | Windows + Docker Desktop |
|---|---|---|
| LiveKit/coturn UDP·host 네트워크 | ✅ 정상 (`network_mode: host` 지원) | ❌ host networking 제약 → 화상 품질/연결 문제 위험 |
| 부팅 시 자동 시작 | ✅ systemd + `restart: unless-stopped` | ⚠️ 로그인 세션 필요(Desktop 앱 기동 전 컨테이너 안 뜸) |
| 라이선스 | 무료 | Docker Desktop 상업용 유료 조건 존재 |
| 리소스 오버헤드 | 낮음 | WSL2 VM 오버헤드 |

**권장**: 서버 PC에 **Ubuntu Server를 설치**하고 Docker Engine(비-Desktop)으로 운영.
Windows를 유지해야 한다면 — Phase 4까지(3D 서버까지)는 가능하나, **Phase 5 화상(LiveKit)에서 벽**에 부딪힐 가능성이 높음. 그 경우 WSL2에 직접 docker engine을 넣거나 화상만 별도 Linux 미니PC로 분리하는 폴백 필요.

## 3. 외부 공개 아키텍처 — VPN 없음 확정 (OQ5 종결, 2026-07-02)

재택·외근자가 **공인 인터넷에서 직접 접속**한다. "사내망이라 안전" 전제 폐기.

### 3.1 도메인·인증서
- **공인 IP = 고정 확정** (2026-07-02) → DDNS 불필요. 도메인 구매 후 A레코드만 지정하면 끝.
- **도메인 = 추후 구매 예정** — 데드라인: **외부(재택) 접속 개시 전** (Let's Encrypt가 도메인 필수).
  - 그때까지 사내 도그푸딩은 도메인 없이 가능: 사내 IP 직결 + Caddy 내부 CA(자체서명 루트를 직원 PC에 배포) 임시 운용.
  - 도메인 구매 시 전환: A레코드 등록 → Caddyfile 도메인 교체 → 인증서 자동 발급 (작업 수분, 코드 무변경).
- 인증서: **Let's Encrypt** — Caddy가 자동 발급·갱신 (80/443 인바운드 필요).
- WSS(D1)·HTTPS·TURN-TLS 모두 이 인증서로 통일.

### 3.2 포트 노출 원칙 — 최소만 연다
| 포트 | 용도 | 공유기/방화벽 포워딩 |
|---|---|---|
| 443/TCP | HTTPS(웹콘솔·API) + WSS(3D) + TURN-TLS(화상 폴백) | ✅ 개방 |
| 80/TCP | Let's Encrypt 검증 + HTTPS 리다이렉트 | ✅ 개방 |
| 7881/TCP + UDP 50000-60000 | LiveKit WebRTC 직결(품질↑) | Phase 5에서 개방 (안되면 TURN-TLS 443 폴백) |
| **5432(DB), 8000(backend), 3000(web)** | 내부 전용 | ❌ **절대 비개방** — compose에서 127.0.0.1 바인딩(적용됨) |

### 3.3 공개 노출 보안 체크리스트 (도그푸딩 시작 전 필수)
- [x] DB 포트 localhost 바인딩 (compose 적용, 2026-07-02)
- [ ] 모든 외부 트래픽 Caddy 단일 진입 → backend/web은 프록시 뒤로 (직접 노출 금지)
- [ ] JWT 시크릿 강한 값 교체 + `ENVIRONMENT=production`
- [x] 로그인 rate-limit — 애플리케이션 레벨 계정 잠금(C2, G010): 연속 실패 5회(설정: `LOGIN_MAX_ATTEMPTS`) 시 423 Locked, 15분 잠금(`LOGIN_LOCKOUT_MINUTES`). Caddy `rate_limit`(IP 기준)은 추가 방어층으로 선택 적용 가능(미필수).
- [ ] fail2ban 또는 Caddy 레벨 차단 + ssh 키 인증 전용(패스워드 로그인 off)
- [ ] Docker 자동 보안업데이트(unattended-upgrades) + 이미지 주기 갱신
- [ ] 관리자 기능(POST /erp/sync 등)은 admin 역할 — 적용됨. 추가로 audit_log 기록(P6 태스크)
- [ ] ERP read-only 접속은 서버→ERP 방향 아웃바운드만 (ERP를 외부 노출하지 않음)

### 3.4 Caddy 라우팅 규약 + 배치 스케줄러 운영 노트 (D21-r, D17, G010)

**Caddy 리버스 프록시 매핑** — 계약 테스트/구현 라우터는 대부분 prefix 없이 root 경로로
동작한다(`/auth/*`, `/work-logs`, `/kpi-results`, `/sync/*`, `/seats`, `/meetings` 등).
`docs/api/management-api.yaml`의 `servers.url`에 있는 `/api`는 리버스 프록시가 얹는 base이며,
`app/api/erp.py`만 예외로 라우터 자체에 `/api` prefix가 붙어 있다(`/api/employees`,
`/api/erp/sync`, `/api/attendances`, `/api/teams`, `/api/org-groups`). Caddyfile은 다음 규칙을
따른다:

```caddyfile
example.com {
    # erp.py 라우터만 이미 /api prefix를 갖고 있다 — 실제 erp 경로만 그대로 통과시킨다.
    # 광범위한 `handle /api/*`로 erp를 잡으면 strip이 필요한 비-erp 계약 경로
    # (/api/auth/* 등)까지 같이 잠식하는 예시가 되므로, erp 실경로를 명시 나열한다.
    handle /api/employees* /api/teams* /api/org-groups* /api/attendances* /api/erp/* {
        reverse_proxy backend:8000
    }
    # 그 외 계약 경로(/auth/*, /work-logs, /kpi-results, /sync/*, /seats, /meetings, /health 등)는
    # 외부에서 /api/* 로 노출하되 backend에는 prefix 없이 전달한다(D21-r).
    handle /api/* {
        uri strip_prefix /api
        reverse_proxy backend:8000
    }
    handle /* {
        reverse_proxy web:3000
    }
}
```

요지: **erp 실경로만 `/api` 그대로 통과**(명시 나열, 광범위 `/api/*` 패스스루 금지), 나머지 계약
라우터는 **외부 `/api/*` → 내부 `/*`**로 strip한다(D21-r). 웹 콘솔(`web:3000`)은 API가 아닌
나머지 경로를 받는다.

**배치 스케줄러 운영 노트(D17, G010 구현, 라이브 검증은 G011)** — `backend` 컨테이너 내
APScheduler(`AsyncIOScheduler`, `timezone=Asia/Seoul`)로 4개 잡을 cron 등록한다. 별도 워커
컨테이너는 두지 않는다(단일 인스턴스 전제, D21 1인 운영).

| 잡 | cron(KST) | 목적 |
|---|---|---|
| `daily_reports_push` | 평일(mon-fri) 18:00 | 일일 업무 요약 → `daily_status_push`(ERP_DAILY_REPORTS) 멱등 적재 — 공휴일 캘린더는 G011 이연 |
| `kpi_ai_draft_generation` | 매일 21:00 | 당일 `kpi_result.ai_draft` 초안 채움(결정론 placeholder) |
| `erp_incremental_sync` | 매시 정각 | `ErpSyncService.sync_users` 증분 동기화 |
| `erp_full_reconciliation` | 매일 00:00 | 동일 서비스로 전체 대사(soft-delete 감지, D18) |

- `settings.scheduler_enabled`(기본 `False`)가 `True`일 때만 `main.lifespan`에서
  `build_scheduler().start()`가 실행된다. 운영 배포는 `.env`에 `SCHEDULER_ENABLED=true`를
  설정해야 배치가 실제로 돈다 — 기본값 그대로 두면 컨테이너는 뜨지만 배치는 미기동.
- 동시성 가드: `pg_advisory_lock`/`pg_advisory_unlock`로 각 잡 실행을 감싼다. PostgreSQL에서만
  유효하며, 비-PostgreSQL(테스트 SQLite 등)에서는 no-op으로 통과한다(단일 인스턴스 전제라
  운영에서도 이론상 불필요하지만, 향후 다중 인스턴스/수동 재실행 중복 방지용 방어선).
- **환경차단(이 리포지토리의 로컬/CI 테스트 환경에서는 검증 불가, G011 durable blocker로
  등록됨)**: 실제 APScheduler 프로세스의 상시 실행, 실 18:00/21:00/매시/00:00 KST cron 발화,
  PostgreSQL `pg_advisory_lock` 동시성(다중 인스턴스 경쟁), 실 ERP 라이브 DB로의 push는 모두
  운영 Docker Compose 환경에서만 검증할 수 있다. 이 리포지토리의 단위/e2e 테스트는 잡 함수
  로직·멱등성·스케줄 등록(트리거 시각/타임존)까지만 커버한다.

### 3.5 LiveKit 화상 회의 토큰 (D24, B-03 슬라이스)

- 회의 입장(`POST /meetings/{id}/join`)의 `livekit_token`은 `app/services/livekit_service.issue_join_token`
  단일 진입점으로 발급한다. `.env`에 `LIVEKIT_API_KEY`+`LIVEKIT_API_SECRET`이 설정되면 **실 LiveKit
  AccessToken**(VideoGrants `room_join`, `iss=api_key`, `sub=user_id`, `room=meeting-{id}`, TTL 6h)을,
  미설정이면 **결정적 stub 토큰**(자체 JWT — 하위호환)을 반환한다. 코드 변경 없이 `.env`만으로 전환된다.
- self-host LiveKit/coturn은 **opt-in profile**이다(기본 스택 미포함). 활성화:
  ```bash
  # .env: LIVEKIT_API_KEY / LIVEKIT_API_SECRET(>=32자) / LIVEKIT_URL 설정 후
  docker compose --profile livekit up -d
  ```
  `livekit`(signaling 7880 / RTC-TCP 7881)와 `coturn`(TURN 3478)이 함께 기동된다.
- **환경차단(B-03, 이 리포지토리에서 검증 불가)**: 실 LiveKit 서버 룸 생성·미디어(오디오/비디오)·Egress→STT
  (한국어 화자분리)·AI 요약은 서버/엔진/GPU 및 운영 네트워크(RTC UDP 포트 범위·TURN 튜닝)가 필요하다. 이
  슬라이스는 **토큰 발급 계약 + 배포 스캐폴드**까지만 커버한다(coturn UDP/포트·realm·인증은 운영 전 튜닝 필요).

## 4. 운영 절차 (1인 운영 기준 최소셋)

### 최초 설치 (서버 PC)
```bash
git clone https://github.com/choiwjun/virtualoffice_new.git && cd virtualoffice_new
cp .env.example .env    # 비밀번호·JWT_SECRET·ERP_DATABASE_URL 입력
docker compose up -d --build
curl http://localhost:8000/health
```

### 업데이트 배포 (레지스트리 불필요 — 단일 서버는 pull&build가 가장 단순)
```bash
git pull && docker compose up -d --build   # 변경된 서비스만 재빌드·재기동
```

### DB 백업 (필수 — pgdata는 PC 디스크 1개에만 존재)
```bash
# 매일 새벽 크론: 덤프 → NAS/타 PC 복사
docker exec vo_db pg_dump -U postgres virtualoffice | gzip > /backup/vo_$(date +%F).sql.gz
```
- 보존: 일 7 + 주 4. **복원 리허설을 도그푸딩 시작 전 1회 필수.**
- KPI/회의록은 인사평가 자료(분기 사용) → 백업 유실 = 평가 데이터 유실.

### 재부팅 내성
- 모든 서비스 `restart: unless-stopped` (구성됨) + Docker 서비스 부팅 자동시작(Linux: `systemctl enable docker`).

### 마이그레이션 (Alembic 도입 완료, 2026-07-02)
- 위치: `backend/alembic/` (루트 `migrations/alembic/`은 ERP 브랜치용 — 별개).
- dev/도그푸딩 초기: `AUTO_CREATE_TABLES=true` 유지 가능.
- **운영 전환 시**: `.env`에서 `AUTO_CREATE_TABLES=false` 후 배포 절차:
  ```bash
  git pull
  docker compose up -d --build
  docker compose exec backend alembic upgrade head
  ```
- 스키마 변경 워크플로: 모델 수정 → `alembic revision --autogenerate -m "..."` → 리뷰 → 커밋.
- 규약: 운영 첫 배포 전에는 0001이 최신 모델 반영(create_all 참조 방식). 첫 배포 후 0001 불변, 이후 신규 리비전만.

## 5. 리소스 계획 (동시 20명 검증 기준, D22)

| 서비스 | RAM 추정 | 비고 |
|---|---|---|
| db + backend + web + proxy | ~2.5GB | |
| godot-server (헤드리스) | ~1GB | 물리 20Hz, 20명 |
| livekit + coturn | ~1.5GB | 1 SFU, 회의 동시 2~3방 |
| **합계** | **~5GB** | **서버 PC 16GB RAM이면 충분, 8GB는 빠듯** |

- GPU 불필요(서버는 렌더링 안 함 — 렌더링은 직원 PC의 네이티브 클라이언트).
- 디스크: SSD 256GB+ (pgdata + 회의 녹음/STT 임시파일 고려).

## 6. 리스크 요약

| 리스크 | 완화 |
|---|---|
| ~~Windows 서버 + LiveKit UDP~~ | ✅ 해소 — Linux 확정 (§2) |
| **인터넷 공개 노출 (VPN 없음)** | §3.2 포트 최소화 + §3.3 보안 체크리스트. 도그푸딩 전 완료 필수 |
| 서버 PC 1대 = SPOF | 도그푸딩 수용(사내). 백업 절차(§4)로 데이터만 보호 |
| 디스크 유실 | 일일 pg_dump 외부 복사 + 복원 리허설 |
| WSS 인증서 관리 | ✅ 단순화 — 공인 도메인 + Let's Encrypt 자동 (Caddy) |
| Docker Desktop 개발PC(Windows)와 서버 환경 차이 | compose 파일 동일 사용, 서버는 Linux Engine |

## 7. 미결(사용자/사내 확인 필요)

- [x] ~~서버 PC OS~~ → **Linux 설치 예정 확정** (2026-07-02)
- [x] ~~VPN 여부~~ → **VPN 없음, 외부 공개 확정** (2026-07-02, §3 참조)
- [x] ~~공인 IP~~ → **고정 IP 확정** (2026-07-02) — DDNS 불필요
- [x] ~~도메인~~ → **추후 구매 예정** (2026-07-02) — 데드라인: 외부 접속 개시 전 (§3.1 임시 운용안 참조)
- [ ] 서버 PC 사양 (RAM 16GB+ 권장 / 디스크 SSD 256GB+)
- [ ] 백업 목적지 (NAS? 다른 PC? — 서버 PC 외부여야 함)
