# 사내 서버 PC 배포 아키텍처 (Docker Compose)

> 🟢 **D27 반영(2026-07-09) — WorkAdventure(D26)·Godot 노선 폐기.** 가상오피스 본체 = **Colyseus 실시간 이동서버(Node/TS, SkyOffice 이식, 20Hz) + Next.js 통합 웹앱(R3F 뷰포트 내장, 무설치) + 정적 렌더 산출물 서빙(Blender 오프라인 렌더: office_bg/depth/camera.json)**. 회의 화상 인프라(FastAPI·PostgreSQL·Redis·LiveKit·coturn·Caddy)는 보존, 라우팅만 정정. 인증 = 단일세션 FastAPI JWT(OIDC 이중로그인/wa OIDC 브리지 제거).  
> 현행 정본 = 00-decisions §H(D27) · 14-virtual-office-spec · 15-realtime-server-spec §8(배포) · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}. §8의 WorkAdventure wa-* 스택은 아래에서 D27 Colyseus 배포로 대체됨.

**작성**: 2026-07-02 · **최종 갱신**: 2026-07-09 (D27) · **버전**: v2.0 (D27) · **정본 근거**: 00-decisions §H(D27), 15-realtime-server-spec §8(배포), 14-virtual-office-spec, 16-render-spike-and-roadmap
**배포 대상**: 사내 온프렘 **로컬 서버 PC 1대** · 단일 조직 도그푸딩(동시 ~20명) · 1인 운영
**오케스트레이션**: **Docker Compose** (Kubernetes 미사용 — 단일 노드·1인 운영에 과잉, ERP도 compose 사용)

---

## 1. 전체 배치 지도 — 무엇이 Docker에 들어가고, 무엇이 안 들어가나

### 서버 PC 1대 (Docker Compose)

| 서비스 | 이미지/빌드 | 포트 | 도입 시기 | 상태 |
|---|---|---|---|---|
| `db` | postgres:17 | 5432(내부) | 지금 | ✅ 구성됨 |
| `backend` | ./backend (FastAPI) | 8000 | 지금 | ✅ 구성됨 |
| `web` | ./frontend (Next.js 통합 웹앱, R3F 뷰포트 내장) | 3000 | Phase 2~3 | 예정 |
| `colyseus-server` | ./realtime (Node/TS, SkyOffice 이식) | 2567(WSS) | Phase 4 | 예정 |
| `redis` | redis:7 | 6379(내부) | Phase 4 | 예정 (Colyseus presence/세션) |
| `livekit` | livekit/livekit-server | 7880(TCP)+**UDP 범위** | Phase 5 | 예정 ⚠️ |
| `coturn` | coturn/coturn | 3478, 5349(TLS) | Phase 5 | 예정 ⚠️ |
| `proxy` | caddy (TLS 종단/리버스 프록시) | 80/443 | web 도입 시 | 예정 |

- **정적 렌더 산출물**(office_bg.png / office_depth.png / camera.json)은 Blender 오프라인 렌더 결과물로, `web`(Next.js) 컨테이너의 `public/` 정적 서빙 또는 Caddy 정적 파일 서빙으로 배포 — 상시 렌더 컨테이너 불필요.
- **Colyseus**는 실시간 이동/근접/점유 권위 서버(20Hz). Caddy가 `/ws/office/*` WSS를 colyseus-server로 라우팅.
- EOD 배치(18:00 KST ERP push)·ERP 동기화 스케줄은 **backend 내 APScheduler**로 실행 — 별도 컨테이너 불필요.
- STT 워커(Phase 5)는 부하 보고 backend 내장 vs 분리 결정.

### Docker에 들어가지 **않는** 것

| 컴포넌트 | 실행 위치 | 이유 |
|---|---|---|
| **데스크톱 클라이언트** | 없음 (D27) | 웹 무설치 — Next.js 통합 웹앱 + R3F 뷰포트가 브라우저에서 직접 렌더. 네이티브 설치 항목 폐기 |
| **Blender 렌더 파이프라인** | 개발 PC / 배치(오프라인) | office_bg/depth/camera.json 생성 도구 — 빌드타임·배치 실행, 상시 컨테이너 아님. 산출물만 서버에 서빙 |
| ERP(space-daily) | 기존 ERP 서버 (별도) | 우리는 read-only 접속만. 같은 사내망 |

```
[직원 브라우저]                       [사내 서버 PC - Docker Compose]
 통합 웹앱(Next.js+R3F, 무설치) ─HTTPS▶  proxy(caddy) ─▶ web(Next.js) / backend(FastAPI)
                              ──WSS──▶  proxy(caddy) /ws/office/* ─▶ colyseus-server (이동/근접/점유 권위, 20Hz)
                              ─HTTPS─▶  proxy(caddy) ─▶ 정적 렌더 산출물(office_bg/depth/camera.json)
 화상(웹앱 내 WebRTC)         ──WebRTC▶  livekit + coturn (UDP)
                                      colyseus-server ──▶ redis (presence/세션)
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
- [ ] 로그인 rate-limit (fastapi 미들웨어 또는 Caddy rate_limit)
- [ ] fail2ban 또는 Caddy 레벨 차단 + ssh 키 인증 전용(패스워드 로그인 off)
- [ ] Docker 자동 보안업데이트(unattended-upgrades) + 이미지 주기 갱신
- [ ] 관리자 기능(POST /erp/sync 등)은 admin 역할 — 적용됨. 추가로 audit_log 기록(P6 태스크)
- [ ] ERP read-only 접속은 서버→ERP 방향 아웃바운드만 (ERP를 외부 노출하지 않음)

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
| colyseus-server (Node/TS) + redis | ~0.7GB | 이동 20Hz, 20명, presence/세션 |
| livekit + coturn | ~1.5GB | 1 SFU, 회의 동시 2~3방 |
| **합계** | **~4.7GB** | **서버 PC 16GB RAM이면 충분, 8GB는 빠듯** |

- GPU 불필요(서버는 실시간 렌더링 안 함 — 3D는 직원 브라우저의 R3F가 렌더, 배경은 Blender 오프라인 렌더 산출물 정적 서빙).
- 디스크: SSD 256GB+ (pgdata + 정적 렌더 산출물 + 회의 녹음/STT 임시파일 고려).

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

---

## 8. Colyseus 실시간 스택 + 통합 웹앱 + 정적 렌더 서빙 (D27, 2026-07-09)

> **D27 전환** — WorkAdventure(D26) 및 Godot 노선 폐기. 가상오피스 본체 = **Colyseus 실시간 이동서버(Node/TS, SkyOffice 이식, 20Hz) + Next.js 통합 웹앱(R3F 뷰포트 내장, 무설치) + Blender 오프라인 렌더 산출물 정적 서빙**.  
> wa-play/wa-back/wa-map-storage/wa-uploader/wa-icon/wa-redis 등 wa-* 컨테이너는 **전량 제거**. LiveKit·coturn·Caddy·PostgreSQL은 회의 화상용으로 보존, 라우팅만 정정. 인증 = **단일세션 FastAPI JWT**(wa OIDC 브리지 제거).

### 8.1 D27 서비스 구성

| 서비스 | 이미지/빌드 | 역할 | 포트(내부) |
|---|---|---|---|
| `web` | `./frontend` (Next.js) | 통합 웹앱(관리콘솔 + R3F 3D 뷰포트) + 정적 렌더 산출물(`public/office_bg.png`·`office_depth.png`·`camera.json`) 서빙 | 3000 |
| `colyseus-server` | `./realtime` (Node/TS, SkyOffice 이식) | 실시간 이동/근접/점유 권위 서버, 20Hz 상태 동기화 | 2567(WSS) |
| `backend` | `./backend` (FastAPI) | REST API·JWT 인증·ERP 연동·회의록·KPI | 8000 |
| `redis` | `redis:7` | Colyseus presence·세션·매치메이킹 상태 | 6379(내부) |
| `livekit` | `livekit/livekit-server:v1.7.2` | SFU (회의 화상/음성) | 7880, 7881/TCP, 50000-50200/UDP |
| `coturn` | `coturn/coturn:4.6.2` | TURN 릴레이 (WebRTC 폴백) | 3478/UDP+TCP, 5349/TCP |
| `caddy` | `caddy:2-alpine` | TLS 종단·역방향 프록시 | 80, 443 |
| `db` | `postgres:17` | 주 데이터베이스 (pgdata 볼륨) | 5432(내부) |

> **정적 렌더 산출물**은 Blender 오프라인/배치 렌더의 결과물이다. 상시 컨테이너가 아니며, 산출물 파일만 `web` 컨테이너의 `public/`(또는 별도 Caddy 정적 서빙 경로)에 배치되어 HTTPS로 서빙된다. 렌더 파이프라인 실행은 빌드타임/배치(개발 PC 또는 CI)에서 수행.

**D27 아키텍처 다이어그램**:
```
[직원 브라우저]                        [사내 서버 PC - Docker Compose]
 통합 웹앱(Next.js+R3F, 무설치) ─HTTPS▶  caddy:443 ─▶ web:3000 (웹앱 + 정적 렌더 산출물)
                              ──WSS──▶  caddy:443 /ws/office/* ─▶ colyseus-server:2567 (이동/근접/점유 권위 20Hz)
                              ─HTTPS─▶  caddy:443 /api/* ─▶ backend:8000 (REST + JWT)
                              ─HTTPS─▶  caddy:443 ─▶ livekit:7880 (livekit.도메인)
                              ──WebRTC▶ livekit:7881/UDP50000-50200 (SFU 직결, 회의 화상)
                              ──TURN──▶ coturn:3478/UDP (WebRTC 릴레이)
                              ──TURNS─▶ coturn:5349/TCP (TURN-TLS 폴백)
                                      colyseus-server ──▶ redis (presence/세션)
                                      backend ──read-only──▶ [ERP dailylog PG]
                                      backend ──EOD push───▶ [ERP API]
                                      db(postgres:17, pgdata 볼륨)
```

### 8.2 도메인·DNS 요구사항

D27은 단일 웹앱 통합으로 **2개 A레코드**면 충분 (단일 서버 공인 IP 가리킴):

| A레코드 | 역할 | 예시 |
|---|---|---|
| `office.example.com` | 통합 웹앱 + API + 실시간(WSS) — Caddy가 경로별 라우팅(`/`, `/api/*`, `/ws/office/*`) | `APP_DOMAIN=office.example.com` |
| `livekit.office.example.com` | LiveKit SFU 공개 엔드포인트 (회의 화상) | `LIVEKIT_DOMAIN=livekit.office.example.com` |

Caddy가 두 도메인 모두 Let's Encrypt 인증서를 자동 발급·갱신한다. 실시간 서버(Colyseus)와 API·정적 렌더는 모두 메인 도메인 하위 경로이므로 별도 A레코드가 필요 없다.  
도메인 구매 전 임시 운용: Caddyfile에서 `tls` 블록을 내부 CA/자체서명으로 두고 IP:포트 직접 접속.

### 8.3 포트 개방 (D27)

| 포트 | 용도 | 방화벽 |
|---|---|---|
| 443/TCP | HTTPS(웹앱·API·정적 렌더) + WSS(Colyseus 실시간) + TURN-TLS 폴백 | ✅ 개방 |
| 80/TCP | Let's Encrypt ACME challenge + HTTPS 리다이렉트 | ✅ 개방 |
| 7881/TCP | LiveKit RTC over TCP (UDP 차단 클라이언트 폴백) | ✅ 개방 |
| 50000-50200/UDP | LiveKit WebRTC 직결 (회의 화상 품질) | ✅ 개방 |
| 3478/UDP+TCP | coturn TURN/STUN (WebRTC 릴레이) | ✅ 개방 |
| 5349/TCP | coturn TURN-TLS (§8.6 폴백) | ✅ 개방 |
| 2567, 5432, 8000, 6379 | Colyseus·DB·백엔드·Redis | ❌ 내부 전용 (Caddy 프록시 뒤) |

### 8.4 초기 설치 절차

```bash
git clone https://github.com/choiwjun/virtualoffice_new.git && cd virtualoffice_new

# 1. 환경변수 설정
cp .env.example .env
# .env 필수 항목 채우기:
#   APP_DOMAIN, LIVEKIT_DOMAIN
#   JWT_SECRET (openssl rand -hex 32)          # 단일세션 FastAPI JWT
#   POSTGRES_PASSWORD, ERP_DATABASE_URL
#   COLYSEUS_REDIS_URL=redis://redis:6379
#   LIVEKIT_API_KEY, LIVEKIT_API_SECRET
#   COTURN_STATIC_SECRET (openssl rand -hex 32)
#   ACME_EMAIL

# 2. coturn 정적 시크릿 교체 (REPLACE_WITH_COTURN_STATIC_SECRET → .env의 COTURN_STATIC_SECRET 값)
sed -i "s/REPLACE_WITH_COTURN_STATIC_SECRET/$(grep COTURN_STATIC_SECRET .env | cut -d= -f2)/" config/coturn.conf
# 또는 직접 텍스트 편집기로 config/coturn.conf 수정

# 3. 정적 렌더 산출물 배치 (Blender 오프라인 렌더 결과)
#    frontend/public/assets/3d/scenes/{floor}/{layout_version}/ 에
#    office_bg.png / office_depth.png / camera.json 배치 (예: .../scenes/floor1/v3/)
#    — 층·레이아웃 버전별 계층 규약. 경로 정본: docs/3d-design/asset-registry.md §3.3
#    (렌더 파이프라인은 spikes/depth-composite 및 16-render-spike-and-roadmap 참조)

# 4. 기동
docker compose up -d --build

# 5. 헬스 확인
curl https://${APP_DOMAIN}/
docker compose ps
docker compose logs colyseus-server --tail 50
```

### 8.5 정적 렌더 산출물 갱신

오피스 배경/깊이맵/카메라는 Blender 오프라인 렌더 산출물이다. 맵 편집 서버(구 wa-map-storage) 없이 파일 교체만으로 갱신한다.

```bash
# Blender 렌더 파이프라인으로 산출물 재생성 (개발 PC / 배치)
#   → office_bg.png, office_depth.png, camera.json 생성
# 산출물을 웹앱 정적 경로에 배치 — 층·레이아웃 버전별 계층 규약
#   frontend/public/assets/3d/scenes/{floor}/{layout_version}/ (정본: docs/3d-design/asset-registry.md §3.3)
mkdir -p frontend/public/assets/3d/scenes/floor1/v3
cp office_bg.png office_depth.png camera.json frontend/public/assets/3d/scenes/floor1/v3/

# 웹앱 재빌드/재기동으로 새 산출물 반영
docker compose up -d --build web
```

> R3F 뷰포트는 `camera.json`의 카메라 파라미터로 3D 오브젝트를 배경 렌더와 정합시키고, `office_depth.png`로 깊이 합성(오클루전)을 수행한다. 산출물 3종의 좌표계·해상도 일관성이 깨지면 합성이 어긋난다(§13 리스크).

### 8.6 TURN-TLS 443 폴백

일부 제한적 네트워크(기업 방화벽)는 5349도 차단한다. 이 경우 TURN-TLS를 443 포트로 서비스해야 한다.  
Caddy가 443을 이미 점유하므로 **단일 IP** 서버에서는 다음 중 하나를 선택:

| 방법 | 난이도 | 설명 |
|---|---|---|
| **sslh (TCP multiplexer)** | ★★☆ | sslh이 443으로 들어오는 트래픽을 HTTPS(→Caddy:443) 또는 TURN(→coturn:5349)으로 분기. |
| **보조 IP 바인딩** | ★☆☆ | 서버에 IP 2개 할당. Caddy는 IP1:443, coturn은 IP2:443. config/coturn.conf에서 `alt-tls-listening-port=443` 활성화. |
| **5349 유지** | ★☆☆ | 대부분의 기업망은 5349 허용. 443 폴백 없이 5349 TURN-TLS만으로 운용. |

도그푸딩 단계에서는 **5349 유지**로 시작하고, 실제 연결 불가 사례가 나오면 sslh를 도입한다.

### 8.7 리소스 계획 (D27 스택)

| 서비스 그룹 | RAM 추정 | 비고 |
|---|---|---|
| db + backend | ~1.0GB | |
| caddy + redis | ~0.4GB | |
| web (Next.js) | ~0.6GB | 통합 웹앱 + 정적 서빙 |
| colyseus-server | ~0.5GB | Node/TS, 이동 20Hz, 20명 |
| livekit | ~0.8GB | SFU, 회의 동시 화상 |
| coturn | ~0.2GB | TURN 릴레이 |
| **합계** | **~3.5GB** | **8GB RAM이면 여유, 4GB는 빠듯** |

디스크: pgdata + 정적 렌더 산출물(office_bg/depth/camera.json) + 회의 녹음/STT 임시파일 → SSD 256GB+ 권장.

### 8.8 버전 업그레이드

```bash
# LiveKit/coturn/redis/postgres/caddy: docker-compose.yml 이미지 태그 갱신 후
docker compose pull && docker compose up -d

# web·colyseus-server·backend (자체 빌드): git pull 후 재빌드
git pull
docker compose up -d --build web colyseus-server backend
docker compose logs -f colyseus-server  # 정상 기동 확인
```

> ⚠️ Colyseus 스키마(@colyseus/schema) 변경은 클라이언트(웹앱)와 서버 버전이 일치해야 한다. web과 colyseus-server를 함께 배포하고, 실시간 상태 스키마 호환성을 릴리스 시 확인.

---

## 변경 이력

| 버전 | 일자 | 변경 |
|---|---|---|
| v2.0 (D27) | 2026-07-09 | **WorkAdventure(D26)·Godot 노선 폐기 → Colyseus 전환.** §8을 wa-* 스택에서 Colyseus 실시간 이동서버 + Next.js 통합 웹앱(R3F 무설치) + Blender 정적 렌더 산출물 서빙으로 재작성. §1 서비스표 `godot-server`→`colyseus-server`, 네이티브 데스크톱 클라 항목 삭제. 인증을 OIDC 브리지에서 단일세션 FastAPI JWT로 정정. LiveKit·coturn·Caddy·PostgreSQL은 회의 화상용으로 보존(라우팅만 정정). |
| v1.x (D26) | 2026-07-06 | WorkAdventure self-host 스택(§8) 추가 — D27에서 폐기됨. |
| v1.0 | 2026-07-02 | 초판 — Godot 헤드리스 서버 + 네이티브 클라 기준. Linux 확정·외부 공개 아키텍처(§2·§3). |
