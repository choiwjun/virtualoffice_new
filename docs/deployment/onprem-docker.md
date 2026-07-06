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

---

## 8. WorkAdventure self-host 스택 (D26, 2026-07-06)

> **D26 전환** — Godot 네이티브 클라이언트·헤드리스 서버 노선 보류. 가상오피스 본체 = **WorkAdventure self-host (AGPL-3.0 + Commons Clause, 사내 도그푸딩 한정 적법)**.  
> §1 서비스 표의 `godot-server` 예정 항목은 보류됨.

### 8.1 추가된 서비스 구성

| 서비스 | 이미지 | 역할 | 포트(내부) |
|---|---|---|---|
| `wa-play` | `thecodingmachine/workadventure-play:v1.21.5` | 정적 에셋·WebSocket pusher | 3000(HTTP), 3001(WS) |
| `wa-back` | `thecodingmachine/workadventure-back:v1.21.5` | 룸 상태 관리, gRPC API | 8080(HTTP), 50051(gRPC) |
| `wa-map-storage` | `thecodingmachine/workadventure-map-storage:v1.21.5` | TMJ 맵 파일 저장·편집 | 3000(HTTP), 50053(gRPC) |
| `wa-uploader` | `thecodingmachine/workadventure-uploader:v1.21.5` | 채팅 파일 업로드 | 8080 |
| `wa-icon` | `matthiasluedtke/iconserver:v3.21.0` | iframe 파비콘 프록시 | 8080 |
| `wa-redis` | `redis:6` | 스크립팅 API 변수·채팅 세션 저장 | 6379(내부) |
| `livekit` | `livekit/livekit-server:v1.7.2` | SFU (4인 이상 버블 화상/음성) | 7880, 7881/TCP, 50000-50200/UDP |
| `coturn` | `coturn/coturn:4.6.2` | TURN 릴레이 (P2P WebRTC) | 3478/UDP+TCP, 5349/TCP |
| `caddy` | `caddy:2-alpine` | TLS 종단·역방향 프록시 | 80, 443 |

**업데이트된 아키텍처 다이어그램**:
```
[직원 브라우저]                   [사내 서버 PC - Docker Compose]
 WorkAdventure 클라이언트 ──WSS──▶  caddy:443 ─▶ wa-play:3000/3001
                          ──HTTPS─▶  caddy:443 ─▶ wa-back:8080 (REST /api)
                          ──HTTPS─▶  caddy:443 ─▶ wa-map-storage:3000 (/map-storage)
                          ──HTTPS─▶  caddy:443 ─▶ livekit:7880 (livekit.도메인)
                          ──WebRTC─▶ livekit:7881/UDP50000-50200 (SFU 직결)
                          ──TURN──▶  coturn:3478/UDP (P2P 릴레이)
                          ──TURNS─▶  coturn:5349/TCP (TURN-TLS 폴백)
 관리 브라우저            ──HTTPS─▶  caddy:443 ─▶ backend:8000 (api.도메인)
                                      backend ──OIDC──▶ wa-play (ERP 사용자 SSO)
                                      backend ──read-only──▶ [ERP dailylog PG]
                                      wa-back ──gRPC──▶ wa-map-storage
                                      wa-back, wa-play ──▶ wa-redis
                                      wa-back ──gRPC──▶ livekit:7880
                                      db(postgres:17, pgdata 볼륨)
```

### 8.2 도메인·DNS 요구사항

WorkAdventure는 **3개 A레코드** 필요 (단일 서버 공인 IP 가리킴):

| A레코드 | 역할 | 예시 |
|---|---|---|
| `office.example.com` | WorkAdventure 메인 (WA_DOMAIN) | `WA_DOMAIN=office.example.com` |
| `api.office.example.com` | FastAPI 백엔드·OIDC Provider (WA_API_DOMAIN) | `WA_API_DOMAIN=api.office.example.com` |
| `livekit.office.example.com` | LiveKit SFU 공개 엔드포인트 (LIVEKIT_DOMAIN) | `LIVEKIT_DOMAIN=livekit.office.example.com` |

Caddy가 3개 도메인 모두 Let's Encrypt 인증서를 자동 발급·갱신한다.  
도메인 구매 전 임시 운용: Caddyfile에서 `tls {$ACME_EMAIL}` 를 제거하고 IP:포트 직접 접속.

### 8.3 포트 개방 업데이트 (D21-r §3.2 갱신)

| 포트 | 용도 | 방화벽 |
|---|---|---|
| 443/TCP | HTTPS + WSS (Caddy, 모든 도메인) | ✅ 개방 |
| 80/TCP | Let's Encrypt ACME challenge + HTTPS 리다이렉트 | ✅ 개방 |
| 7881/TCP | LiveKit RTC over TCP (UDP 차단 클라이언트 폴백) | ✅ 개방 |
| 50000-50200/UDP | LiveKit WebRTC 직결 (품질 최우선) | ✅ 개방 |
| 3478/UDP+TCP | coturn TURN/STUN (표준 P2P 릴레이) | ✅ 개방 |
| 5349/TCP | coturn TURN-TLS (D21-r 폴백 — 5349를 443으로 전환하려면 §8.6 참조) | ✅ 개방 |
| 5432, 8000, 6379 | DB·백엔드·Redis | ❌ 내부 전용 |

### 8.4 초기 설치 절차

```bash
git clone https://github.com/choiwjun/virtualoffice_new.git && cd virtualoffice_new

# 1. 환경변수 설정
cp .env.example .env
# .env 필수 항목 채우기:
#   WA_DOMAIN, WA_API_DOMAIN, LIVEKIT_DOMAIN
#   WA_SECRET_KEY (openssl rand -hex 32)
#   WA_MAP_STORAGE_PASSWORD
#   WA_OIDC_CLIENT_ID, WA_OIDC_CLIENT_SECRET, WA_OIDC_ISSUER
#   LIVEKIT_API_KEY, LIVEKIT_API_SECRET
#   COTURN_STATIC_SECRET (openssl rand -hex 32)
#   WA_TURN_SERVER=turn:<도메인>:5349
#   ACME_EMAIL

# 2. coturn 정적 시크릿 교체 (REPLACE_WITH_COTURN_STATIC_SECRET → .env의 COTURN_STATIC_SECRET 값)
sed -i "s/REPLACE_WITH_COTURN_STATIC_SECRET/$(grep COTURN_STATIC_SECRET .env | cut -d= -f2)/" config/coturn.conf
# 또는 직접 텍스트 편집기로 config/coturn.conf 수정

# 3. 기동
docker-compose up -d --build

# 4. 헬스 확인
curl https://${WA_DOMAIN}/
docker-compose ps
docker-compose logs wa-play --tail 50
```

### 8.5 맵 초기 업로드

WorkAdventure는 첫 기동 후 맵 파일이 없으면 빈 공간만 표시된다.  
기본 오피스 맵을 map-storage에 업로드하려면:

```bash
# map-starter-kit 클론 후 업로드 (map-storage Basic 인증 사용)
git clone https://github.com/workadventure/map-starter-kit /tmp/wa-map
cd /tmp/wa-map
# WA 공식 업로드 절차: https://docs.workadventu.re/map-building/tiled-editor/publish/wa-hosted
# 또는 curl로 직접:
curl -u admin:${WA_MAP_STORAGE_PASSWORD} \
     -F "file=@office.tmj" \
     https://${WA_DOMAIN}/map-storage/upload

# 업로드 후 .env에서 WA_START_ROOM_URL 업데이트:
# WA_START_ROOM_URL=/~/office.wam   (wam 파일 기준)
docker-compose up -d wa-play  # play 서버 재기동으로 새 URL 반영
```

### 8.6 TURN-TLS 443 폴백 (D21-r)

일부 제한적 네트워크(기업 방화벽)는 5349도 차단한다. 이 경우 TURN-TLS를 443 포트로 서비스해야 한다.  
Caddy가 443을 이미 점유하므로 **단일 IP** 서버에서는 다음 중 하나를 선택:

| 방법 | 난이도 | 설명 |
|---|---|---|
| **sslh (TCP multiplexer)** | ★★☆ | sslh이 443으로 들어오는 트래픽을 HTTPS(→Caddy:443) 또는 TURN(→coturn:5349)으로 분기. |
| **보조 IP 바인딩** | ★☆☆ | 서버에 IP 2개 할당. Caddy는 IP1:443, coturn은 IP2:443. config/coturn.conf에서 `alt-tls-listening-port=443` 활성화. |
| **5349 유지** | ★☆☆ | 대부분의 기업망은 5349 허용. 443 폴백 없이 5349 TURN-TLS만으로 운용. |

도그푸딩 단계에서는 **5349 유지**로 시작하고, 실제 연결 불가 사례가 나오면 sslh를 도입한다.

### 8.7 리소스 계획 갱신 (WA 스택 포함)

| 서비스 그룹 | RAM 추정 | 비고 |
|---|---|---|
| db + backend | ~1.0GB | |
| caddy + wa-redis + wa-icon + wa-uploader | ~0.5GB | |
| wa-play + wa-back + wa-map-storage | ~1.5GB | Node.js 기반 |
| livekit | ~0.8GB | SFU, 20명 동시 화상 |
| coturn | ~0.2GB | TURN 릴레이 |
| **합계** | **~4.0GB** | **8GB RAM이면 여유 있음, 4GB는 빠듯** |

디스크: 맵 파일(wa_maps 볼륨) + 채팅 업로드 파일(wa-redis) → SSD 256GB+ 권장.

### 8.8 WA 버전 업그레이드

```bash
# .env에서 WA_VERSION을 새 버전으로 변경 (예: v1.22.0)
# 릴리스 노트 확인: https://github.com/workadventure/workadventure/releases
vim .env  # WA_VERSION=v1.22.0

# 재기동 (이미지 pull + 컨테이너 교체)
docker-compose up -d --force-recreate wa-play wa-back wa-map-storage wa-uploader
docker-compose logs -f wa-play  # 정상 기동 확인
```

> ⚠️ WA_VERSION과 docker-compose.yml의 이미지 태그가 항상 일치해야 함. 메이저 버전 업그레이드 시 릴리스 노트에서 환경변수 변경사항 필수 확인.
